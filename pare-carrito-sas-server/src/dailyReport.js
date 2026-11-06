"use strict";

// Resumen del dia para el correo de cada noche: pedidos, kilos, ventas, lo cobrado por medio de pago
// y el saldo acumulado de los clientes. Mas los mensajes de WhatsApp del dia (archivo del WhatsApp
// vinculado), agrupados por chat. Funciones puras: el servidor les pasa los datos.

const CANCELADO = ["cancelado", "anulado"];

function money(value) {
  return "$" + Number(value || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function num(value, dec) {
  return Number(value || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: dec == null ? 1 : dec });
}

function esc(text) {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Kilos de un renglon: en kg tal cual, en gramos dividido 1000; otras unidades no suman kilos.
function itemKg(item) {
  const u = String(item && item.unitType || "").toLowerCase().replace(/\./g, "").trim();
  const q = Number(item && item.quantity || 0);
  if (["kg", "kgs", "kilo", "kilos", "kilogramo", "kilogramos"].includes(u)) return q;
  if (["g", "gr", "grs", "gramo", "gramos"].includes(u)) return q / 1000;
  return 0;
}

function dailySalesSummary(data, date) {
  const orders = (data.orders || []).filter((o) => o && o.date === date && !CANCELADO.includes(o.status) && !o.exampleOnly);
  const kg = orders.reduce((s, o) => s + (o.items || []).reduce((t, it) => t + itemKg(it), 0), 0);
  const ventas = orders.reduce((s, o) => s + Number(o.totalAmount || 0), 0);
  const pagos = (data.payments || []).filter((p) => p && p.date === date && p.status !== "anulado");
  const porMedio = (m) => pagos.filter((p) => p.method === m).reduce((s, p) => s + Number(p.amount || 0), 0);
  const efectivo = porMedio("efectivo");
  const transferencia = porMedio("transferencia");
  const cobrado = pagos.reduce((s, p) => s + Number(p.amount || 0), 0);
  const saldoClientes = (data.saldos || []).reduce((s, e) => s + Number(e && e.amount || 0), 0);
  return { pedidos: orders.length, kg, ventas, efectivo, transferencia, otros: cobrado - efectivo - transferencia, cobrado, saldoClientes };
}

function dailySalesHtml(r) {
  const fila = (k, v, fuerte) => `<tr><td style="padding:3px 12px 3px 0;color:#5d6b7e">${esc(k)}</td><td align="right" style="padding:3px 0;${fuerte ? "font-weight:bold" : ""}">${v}</td></tr>`;
  return `<h3 style="margin:18px 0 6px">Resumen del día</h3>
    <table cellpadding="0" style="border-collapse:collapse;font-size:14px">
      ${fila("Pedidos", num(r.pedidos, 0))}
      ${fila("Kilos totales (productos por kg)", num(r.kg) + " kg")}
      ${fila("Ventas (total de los pedidos)", money(r.ventas), true)}
      ${fila("Cobrado en efectivo", money(r.efectivo))}
      ${fila("Cobrado por transferencia", money(r.transferencia))}
      ${r.otros > 0.5 ? fila("Cobrado por otros medios (cheque)", money(r.otros)) : ""}
      ${fila("Cobrado total", money(r.cobrado), true)}
      ${fila("Saldo acumulado de clientes", money(r.saldoClientes), true)}
    </table>`;
}

function dailySalesLine(r) {
  return `${num(r.pedidos, 0)} pedidos, ${num(r.kg)} kg, ventas ${money(r.ventas)}, cobrado ${money(r.cobrado)} (efectivo ${money(r.efectivo)}, transf. ${money(r.transferencia)}), saldo clientes ${money(r.saldoClientes)}`;
}

// rows: mensajes del dia ordenados por hora. clientName(phone) -> nombre del cliente o "".
function archiveEmailHtml(rows, clientName, limit) {
  if (!rows || !rows.length) return `<h3 style="margin:18px 0 6px">Mensajes de WhatsApp del día</h3><p style="color:#5d6b7e">No hubo mensajes en el WhatsApp vinculado (o no está vinculado).</p>`;
  const max = limit || 600;
  const chats = new Map();
  rows.slice(0, max).forEach((m) => {
    if (!chats.has(m.chat_id)) chats.set(m.chat_id, []);
    chats.get(m.chat_id).push(m);
  });
  const hora = (ts) => new Date(ts).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" });
  const bloques = Array.from(chats.values()).map((msgs) => {
    const m0 = msgs[0];
    const cliente = !m0.is_group && clientName ? clientName(m0.chat_id) : "";
    const titulo = m0.is_group ? "Grupo: " + (m0.chat_name || m0.chat_id) : (cliente ? cliente + " · " : "") + (m0.chat_name || "") + " (+" + String(m0.chat_id).replace(/\D/g, "") + ")";
    return `<div style="margin:10px 0 0;padding:8px 10px;border:1px solid #e3e8ef;border-radius:8px">
      <div style="font-weight:bold;margin-bottom:4px">${esc(titulo)} <span style="color:#5d6b7e;font-weight:normal">· ${msgs.length} mensaje(s)</span></div>
      ${msgs.map((m) => `<div style="font-size:13px;margin:2px 0"><span style="color:#5d6b7e">${hora(m.ts)}</span> <b>${esc(m.from_me ? "Nosotros" : m.sender_name || (m.is_group ? "+" + m.sender_phone : "Cliente"))}:</b> ${esc(String(m.text || "").slice(0, 400))}</div>`).join("")}
    </div>`;
  }).join("");
  return `<h3 style="margin:18px 0 6px">Mensajes de WhatsApp del día (${rows.length})</h3>${bloques}${rows.length > max ? `<p style="color:#5d6b7e">Se muestran los primeros ${max}. El resto está en el sistema: Mensajes de WhatsApp.</p>` : ""}`;
}

module.exports = { dailySalesSummary, dailySalesHtml, dailySalesLine, archiveEmailHtml, itemKg };
