"use strict";

const { config } = require("./config");
const wa = require("./whatsapp");
const erp = require("./erp");
const pending = require("./pendingStore");

// Minutos desde medianoche en la zona horaria del negocio.
function nowMinutes() {
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: config.tz, hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour").value);
  const m = Number(parts.find((p) => p.type === "minute").value);
  return h * 60 + m;
}

function fmtItems(items) {
  return (items || []).map((it) => {
    const qty = it.cantidad != null ? it.cantidad : (it.quantity != null ? it.quantity : "");
    const unit = it.unidad || it.unitType || "";
    const name = it.producto || it.productName || it.productId || "";
    return `${qty} ${unit} ${name}`.replace(/\s+/g, " ").trim();
  }).join(", ");
}

// Maneja un pedido de AGREGAR segun la hora.
async function handleAdd({ clientPhone, clientName, clientId, order, items }) {
  const mins = nowMinutes();
  const itemsTxt = fmtItems(items);
  if (!order || !order.id) {
    await wa.sendText(clientPhone, "No encontre un pedido de hoy para agregarle. Si queres hacer un pedido nuevo, pasamelo y lo cargo.");
    return;
  }

  // Antes de 5:30 -> directo, sin avisar.
  if (mins < config.schedule.addDirectBefore) {
    try {
      await erp.addItems(order.id, items, 1);
      await wa.sendText(clientPhone, `Listo, agregue a tu pedido: ${itemsTxt}.`);
    } catch (e) {
      await wa.sendText(clientPhone, "No pude agregarlo automaticamente, ya avisamos a administracion.");
      await wa.notifyTeam(`Error al agregar al pedido ${order.id} de ${clientName}: ${e.message}. Items: ${itemsTxt}`);
    }
    return;
  }

  // Despues de 5:30 -> requiere confirmacion del equipo.
  let round = 0;
  if (mins < config.schedule.addConfirm1Until) round = 1;
  else if (mins < config.schedule.addConfirm2Until) round = 2;

  if (!round) {
    await wa.sendText(clientPhone, "Por el horario ya salieron los repartos y no puedo agregar mas a tu pedido de hoy. Lo dejamos para el proximo.");
    await wa.notifyTeam(`(Fuera de horario) ${clientName} pidio agregar: ${itemsTxt} al pedido ${order.id}. No se agrego.`);
    return;
  }

  const code = pending.add({ clientPhone, clientName, clientId, orderId: order.id, items, round });
  const rondaTxt = round === 2 ? " (para SEGUNDA ronda de envios)" : "";
  await wa.notifyTeam(
    `Pedido de AGREGAR${rondaTxt}\nCliente: ${clientName} (${clientId})\nPedido: ${order.id}\nItems: ${itemsTxt}\n\nResponder: "ok ${code}" para confirmar, "no ${code}" para rechazar.`
  );
  await wa.sendText(clientPhone, "Recibido. Lo estamos confirmando con el equipo y te aviso en un rato.");
}

// Maneja CANCELAR: aplica y avisa al equipo.
async function handleCancel({ clientPhone, clientName, clientId, order, items }) {
  if (!order || !order.id) {
    await wa.sendText(clientPhone, "No encontre un pedido de hoy para modificar.");
    return;
  }
  const itemsTxt = fmtItems(items);
  try {
    await erp.cancelItems(order.id, items);
    await wa.sendText(clientPhone, itemsTxt ? `Listo, saque de tu pedido: ${itemsTxt}.` : "Listo, cancele tu pedido de hoy.");
    await wa.notifyTeam(`CANCELACION\nCliente: ${clientName} (${clientId})\nPedido: ${order.id}\n${itemsTxt ? "Items: " + itemsTxt : "Pedido completo cancelado"}`);
  } catch (e) {
    await wa.sendText(clientPhone, "No pude modificarlo automaticamente, ya avisamos a administracion.");
    await wa.notifyTeam(`Error al cancelar en pedido ${order.id} de ${clientName}: ${e.message}. Items: ${itemsTxt}`);
  }
}

// Maneja un PEDIDO NUEVO.
async function handleNewOrder({ clientPhone, clientName, clientId, items }) {
  const itemsTxt = fmtItems(items);
  if (!items.length) {
    await wa.sendText(clientPhone, "No entendi bien el pedido. Me lo pasas de nuevo indicando producto y cantidad?");
    return;
  }
  try {
    const result = await erp.createOrder(clientId, items, { source: "whatsapp-bot" });
    await wa.sendText(clientPhone, `Tomamos tu pedido: ${itemsTxt}. Cualquier cambio, avisanos. Gracias!`);
    await wa.notifyTeam(`Pedido nuevo por WhatsApp\nCliente: ${clientName} (${clientId})\n${itemsTxt}${result && result.orderId ? "\nPedido: " + result.orderId : ""}`);
  } catch (e) {
    await wa.sendText(clientPhone, "Recibimos tu pedido, lo estamos cargando. Si hay algo raro te avisamos.");
    await wa.notifyTeam(`Error al cargar pedido de ${clientName} (${clientId}): ${e.message}. Items: ${itemsTxt}`);
  }
}

// Consulta no relacionada a pedidos -> al duenio.
async function handleConsulta({ clientPhone, clientName, text }) {
  await wa.notifyOwner(`Consulta de ${clientName} (${clientPhone}):\n"${text}"`);
  await wa.sendText(clientPhone, "Gracias por tu mensaje. Lo derive a administracion y te van a responder a la brevedad.");
}

// Respuesta del equipo confirmando/rechazando una solicitud pendiente.
// Devuelve true si el texto era una confirmacion/rechazo manejado.
async function handleTeamReply(fromPhone, text) {
  const m = /^\s*(ok|si|s[ií]|confirmar|no|rechazar)\s+(P[A-Z0-9]{2,5})\b/i.exec(String(text || ""));
  if (!m) return false;
  const positive = /^(ok|si|s[ií]|confirmar)$/i.test(m[1]);
  const code = m[2].toUpperCase();
  const req = pending.get(code);
  if (!req) {
    await wa.sendText(fromPhone, `No encontre la solicitud ${code} (quiza ya fue resuelta).`);
    return true;
  }
  pending.remove(code);
  if (!positive) {
    await wa.sendText(req.clientPhone, "No pudimos sumar lo que pediste a tu pedido de hoy. Lo dejamos para la proxima.");
    await wa.notifyTeam(`Solicitud ${code} RECHAZADA (${req.clientName}).`);
    return true;
  }
  try {
    await erp.addItems(req.orderId, req.items, req.round);
    const rondaTxt = req.round === 2 ? " (segunda ronda)" : "";
    await wa.sendText(req.clientPhone, `Confirmado! Agregamos a tu pedido${rondaTxt}: ${fmtItems(req.items)}.`);
    await wa.notifyTeam(`Solicitud ${code} CONFIRMADA y agregada al pedido ${req.orderId}.`);
  } catch (e) {
    await wa.notifyTeam(`Solicitud ${code}: error al agregar al pedido ${req.orderId}: ${e.message}`);
  }
  return true;
}

module.exports = { nowMinutes, handleAdd, handleCancel, handleNewOrder, handleConsulta, handleTeamReply, fmtItems };
