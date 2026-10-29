"use strict";

// Control del gerente: resumen diario (para el correo de cada noche) y lectura de movimientos del
// banco (archivo exportado o texto de una captura) para comprobar las transferencias del reparto.
// Son funciones puras sobre el estado: el servidor las llama con los datos completos.

const CANCELADO = ["cancelado", "anulado"];

function money(value) {
  return "$" + Number(value || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(text) {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function orderIsSettled(order) {
  if (!order) return false;
  if (order.paymentStatus === "paid" || Number(order.paymentReceived || 0) > 0) return true;
  return !!(order.deliveryRemitoPhoto && (order.deliveryRemitoPhoto.data || order.deliveryRemitoPhoto.key));
}

function hasPhoto(order) {
  return !!(order.deliveryRemitoPhoto && (order.deliveryRemitoPhoto.key || order.deliveryRemitoPhoto.data));
}

function transferStatus(order) {
  return (order.transferReview && order.transferReview.status) || "pendiente";
}

// Montos que no coinciden: cobros cargados en un cliente que debia mucho menos, un pago de varios
// pedidos marcando uno solo, pedidos de otro cliente, pagos repetidos, pedidos cobrados de mas o
// que figuran cobrados sin pago, cobros del reparto sin pago registrado, y descuadres entre el pago
// y la cuenta corriente. Cada uno: { tipo, nivel: "alto"|"medio"|"info", clientId, texto, ids }.
function controlPaymentChecks(data, date) {
  const tol = (x) => Math.max(1000, Math.abs(Number(x || 0)) * 0.03);
  const clientes = new Map((data.clients || []).map((c) => [c.id, c]));
  const nombre = (id) => id + " - " + ((clientes.get(id) || {}).name || id);
  const pedidos = (data.orders || []).filter((o) => o && !CANCELADO.includes(o.status) && !o.exampleOnly);
  const pedidoPorId = new Map(pedidos.map((o) => [o.id, o]));
  const pendiente = (o) => Math.max(0, Number(o.totalAmount || 0) - Number(o.paymentReceived || 0));
  const pagos = (data.payments || []).filter((p) => p && p.status !== "anulado");
  const pagoTs = new Map(pagos.map((p) => [p.id, String(p.timestamp || "")]));
  const pagosDia = pagos.filter((p) => p.date === date);
  const saldosPorCliente = new Map();
  const saldosPorPago = new Map();
  (data.saldos || []).forEach((e) => {
    if (!e || !e.clientId) return;
    if (!saldosPorCliente.has(e.clientId)) saldosPorCliente.set(e.clientId, []);
    saldosPorCliente.get(e.clientId).push(e);
    if (e.relatedEntityId) saldosPorPago.set(e.relatedEntityId, (saldosPorPago.get(e.relatedEntityId) || 0) + Number(e.amount || 0));
  });
  const referidos = new Map(); // pedido -> pagos que lo marcan
  pagos.forEach((p) => {
    const ids = Array.isArray(p.orderIds) && p.orderIds.length ? p.orderIds : [p.orderId].filter(Boolean);
    ids.forEach((id) => { if (!referidos.has(id)) referidos.set(id, []); referidos.get(id).push(p); });
  });
  const checks = [];
  const add = (tipo, nivel, clientId, texto, ids) => checks.push({ tipo, nivel, clientId: clientId || "", texto, ids: ids || [] });

  pagosDia.forEach((p) => {
    const monto = Number(p.amount || 0);
    if (!(monto > 0)) return;
    const cuentas = Array.isArray(p.groupClientIds) && p.groupClientIds.length > 1 ? p.groupClientIds : [p.clientId];
    const ts = String(p.timestamp || "");
    // Lo que debia el cliente (o el grupo) justo antes de este pago.
    const antes = cuentas.reduce((suma, id) => suma + (saldosPorCliente.get(id) || []).reduce((s, e) => {
      const d = String(e.date || "");
      if (d > p.date || e.relatedEntityId === p.id) return s;
      if (d === p.date && e.relatedEntityType === "payment" && ts && (pagoTs.get(e.relatedEntityId) || "") > ts) return s;
      return s + Number(e.amount || 0);
    }, 0), 0);
    const quien = p.receivedByName || p.recordedBy || "";
    if (monto - Math.max(0, antes) > tol(monto)) {
      add("pago_mayor_saldo", "alto", p.clientId, "Se cobraron " + money(monto) + " a " + nombre(p.clientId) + " y debía " + money(Math.max(0, antes)) + ": queda " + money(monto - Math.max(0, antes)) + " a favor. ¿Se cargó en el cliente equivocado?" + (quien ? " (" + quien + ")" : ""), [p.id]);
    }
    const ids = Array.isArray(p.orderIds) && p.orderIds.length ? p.orderIds : [p.orderId].filter(Boolean);
    const marcados = ids.map((id) => pedidoPorId.get(id)).filter(Boolean);
    marcados.filter((o) => !cuentas.includes(o.clientId)).forEach((o) => {
      add("pedido_otro_cliente", "alto", p.clientId, "El pago " + p.id + " de " + nombre(p.clientId) + " marca el pedido " + o.id + ", que es de " + nombre(o.clientId) + ".", [p.id, o.id]);
    });
    const impagosOtros = pedidos.filter((o) => cuentas.includes(o.clientId) && !ids.includes(o.id) && String(o.date || "") <= p.date && pendiente(o) > 0);
    const totalMarcados = marcados.reduce((s, o) => s + Number(o.totalAmount || 0), 0);
    // Pago de mas sobre lo marcado: si quedan otros pedidos impagos, seguramente pago varios y se
    // marco uno solo (si no hay otros, es saldo sin pedido o queda a favor, que se ve arriba).
    if (marcados.length && monto - totalMarcados > tol(monto) && impagosOtros.length) {
      const sumaOtros = impagosOtros.reduce((s, o) => s + pendiente(o), 0);
      add("pago_mas_que_pedidos", "alto", p.clientId, "Se cobraron " + money(monto) + " a " + nombre(p.clientId) + " marcando " + marcados.length + " pedido(s) por " + money(totalMarcados) + ", pero tiene " + impagosOtros.length + " pedido(s) más que siguen figurando impagos (" + money(sumaOtros) + "): " + impagosOtros.slice(0, 6).map((o) => o.id).join(", ") + ".", [p.id].concat(impagosOtros.slice(0, 6).map((o) => o.id)));
    } else if (marcados.length && monto - totalMarcados > tol(monto)) {
      // nada: lo de mas fue saldo sin pedido o queda a favor (se avisa en pago_mayor_saldo)
    } else if (marcados.length && totalMarcados - monto > tol(totalMarcados)) {
      add("pago_parcial", "info", p.clientId, "Pago parcial de " + nombre(p.clientId) + ": " + money(monto) + " de " + money(totalMarcados) + " (quedan " + money(totalMarcados - monto) + ").", [p.id]);
    } else if (!marcados.length && impagosOtros.length && !(Array.isArray(p.groupClientIds) && p.groupClientIds.length > 1)) {
      add("pago_sin_pedido", "info", p.clientId, "Pago de " + money(monto) + " de " + nombre(p.clientId) + " sin pedido marcado: sus " + impagosOtros.length + " pedido(s) siguen figurando impagos.", [p.id]);
    }
    const enCuenta = -(saldosPorPago.get(p.id) || 0);
    if (Math.abs(enCuenta - monto) > 1) {
      add("saldo_distinto", "alto", p.clientId, "El pago " + p.id + " de " + nombre(p.clientId) + " es de " + money(monto) + " pero en la cuenta corriente se descontó " + money(enCuenta) + ".", [p.id]);
    }
  });
  // Pagos repetidos: mismo cliente, mismo monto, mismo dia.
  const vistos = new Map();
  pagosDia.forEach((p) => {
    const clave = p.clientId + "|" + Math.round(Number(p.amount || 0));
    if (vistos.has(clave)) {
      const otro = vistos.get(clave);
      add("pago_repetido", "medio", p.clientId, "Dos pagos iguales de " + money(p.amount) + " para " + nombre(p.clientId) + " el mismo día (" + otro.id + " y " + p.id + "). ¿Se cargó dos veces?", [otro.id, p.id]);
    } else vistos.set(clave, p);
  });
  // Pedidos del dia (o marcados por pagos del dia).
  const delDia = new Map();
  pedidos.filter((o) => o.date === date).forEach((o) => delDia.set(o.id, o));
  pagosDia.forEach((p) => (Array.isArray(p.orderIds) ? p.orderIds : [p.orderId]).forEach((id) => { const o = pedidoPorId.get(id); if (o) delDia.set(o.id, o); }));
  delDia.forEach((o) => {
    const recibido = Number(o.paymentReceived || 0);
    const total = Number(o.totalAmount || 0);
    const susPagos = referidos.get(o.id) || [];
    if (recibido - total > tol(total) && total >= 0) {
      add("pedido_cobrado_de_mas", "medio", o.clientId, "El pedido " + o.id + " de " + nombre(o.clientId) + " figura cobrado " + money(recibido) + " y es de " + money(total) + ".", [o.id]);
    }
    if (recibido > 1 && !susPagos.length) {
      add("cobrado_sin_pago", "medio", o.clientId, "El pedido " + o.id + " de " + nombre(o.clientId) + " figura cobrado (" + money(recibido) + ") pero ningún pago lo tiene marcado.", [o.id]);
    }
    const dp = o.deliveryPayment;
    if (o.date === date && dp && dp.method === "efectivo" && Number(dp.amount || 0) > 0) {
      const registrado = susPagos.filter((p) => p.method === "efectivo").reduce((s, p) => s + Number(p.amount || 0), 0);
      if (!susPagos.length) {
        add("reparto_sin_pago", "alto", o.clientId, "En el reparto se cobraron " + money(dp.amount) + " en efectivo a " + nombre(o.clientId) + " (" + o.id + ") y no hay pago registrado.", [o.id]);
      } else if (Math.abs(registrado - Number(dp.amount || 0)) > 1) {
        add("reparto_distinto", "medio", o.clientId, "En el reparto se marcaron " + money(dp.amount) + " en efectivo para " + o.id + " (" + nombre(o.clientId) + ") y los pagos registrados suman " + money(registrado) + ".", [o.id]);
      }
    }
  });
  const peso = { alto: 0, medio: 1, info: 2 };
  return checks.sort((a, b) => peso[a.nivel] - peso[b.nivel]);
}

// Mismos cruces que la pagina Control, para un dia. debts es la lista de controlClientDebts.
function controlDailySummary(data, date, debts) {
  const clientes = new Map((data.clients || []).map((c) => [c.id, c]));
  const nombre = (o) => o.clientId + " - " + ((clientes.get(o.clientId) || {}).name || o.clientId);
  const orders = (data.orders || []).filter((o) => o && o.date === date && !CANCELADO.includes(o.status) && !o.exampleOnly);
  const entregados = orders.filter((o) => o.status === "entregado");
  const sinEntregar = orders.filter((o) => o.status !== "entregado");
  const salteados = sinEntregar.filter((o) => o.routeSkippedAt);
  const sinRendir = entregados.filter((o) => !orderIsSettled(o) && !(o.deliveryPayment && ["transferencia", "cuenta"].includes(o.deliveryPayment.method) && hasPhoto(o)));
  const aCuenta = entregados.filter((o) => o.deliveryPayment && o.deliveryPayment.method === "cuenta");
  const transfDia = entregados.filter((o) => o.deliveryPayment && o.deliveryPayment.method === "transferencia");
  const sinFoto = transfDia.concat(aCuenta).filter((o) => !hasPhoto(o));
  const todasTransf = (data.orders || []).filter((o) => o && o.deliveryPayment && o.deliveryPayment.method === "transferencia" && !CANCELADO.includes(o.status));
  const porComprobar = todasTransf.filter((o) => transferStatus(o) === "pendiente");
  const noLlegaron = todasTransf.filter((o) => transferStatus(o) === "no_llego");
  const pagos = (data.payments || []).filter((p) => p && p.date === date && p.status !== "anulado");
  const cierres = data.cashClosings || [];
  const asistencia = data.attendance || [];
  const caja = (data.users || []).filter((u) => u && u.role === "employee" && u.isActive !== false).map((u) => {
    const mios = pagos.filter((p) => p.method === "efectivo" && (p.receivedByUserId === u.id || (!p.receivedByUserId && p.recordedBy === u.name)));
    const cobrado = mios.reduce((s, p) => s + Number(p.amount || 0), 0);
    const cierre = cierres.find((c) => c.userId === u.id && c.date === date) || null;
    const att = asistencia.find((a) => a.userId === u.id && a.date === date);
    const trabajo = (att && att.present) || mios.length || cierre || entregados.some((o) => String(o.deliveredById || "") === String(u.id));
    if (!trabajo) return null;
    const difCobro = cierre ? Number(cierre.actualCollected || 0) - cobrado : null;
    const difCaja = cierre ? Number(cierre.cashDiff || 0) : null;
    return { nombre: u.name, cobrado, cierre: !!cierre, declarado: cierre ? Number(cierre.actualCollected || 0) : 0, difCobro, difCaja, ok: !!cierre && Math.abs(difCobro) < 1 && Math.abs(difCaja) < 1 };
  }).filter(Boolean);
  const transfSinComp = pagos.filter((p) => p.method === "transferencia" && !p.transferProofFile && !p.transferProofKey);
  const deudas = (debts || []).slice(0, 15);
  const montos = controlPaymentChecks(data, date);
  const montosRevisar = montos.filter((c) => c.nivel !== "info");
  const problemas = sinEntregar.length + sinRendir.length + sinFoto.length + caja.filter((c) => !c.ok).length + porComprobar.length + noLlegaron.length + transfSinComp.length + deudas.length + montosRevisar.length;

  const lista = (arr, extra) => arr.length ? "<ul>" + arr.map((o) => "<li>" + esc(nombre(o)) + " <small>" + esc(o.id) + (extra ? " · " + esc(extra(o)) : "") + "</small></li>").join("") + "</ul>" : "";
  const seccion = (titulo, ok, cuerpo) => `<h3 style="margin:18px 0 6px">${esc(titulo)} ${ok ? '<span style="color:#0c7a52">✔ OK</span>' : '<span style="color:#b42318">⚠ Revisar</span>'}</h3>${cuerpo}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#17212e">
    <h2 style="margin:0 0 4px">Control del ${esc(date.split("-").reverse().join("/"))}</h2>
    <p style="margin:0 0 10px;color:#5d6b7e">${problemas ? problemas + " punto(s) para revisar." : "Todo en orden."}</p>
    ${seccion("1. Pedidos cargados contra entregados", !sinEntregar.length && !sinRendir.length, `<p>${orders.length} cargados · ${entregados.length} entregados</p>
      ${sinEntregar.length ? "<p><b>Sin marcar entregados (" + sinEntregar.length + ")</b>" + (salteados.length ? " — " + salteados.length + " dejados para después" : "") + "</p>" + lista(sinEntregar, (o) => (o.routeSkippedAt ? "dejado para después · " : "") + (o.routeByName ? "ruta de " + o.routeByName : "fuera de Mi recorrido")) : ""}
      ${sinRendir.length ? "<p><b>Entregados sin pago ni foto del remito (" + sinRendir.length + ")</b></p>" + lista(sinRendir) : ""}
      ${aCuenta.length ? "<p><b>Entregados sin cobrar, a cuenta (" + aCuenta.length + ")</b></p>" + lista(aCuenta, (o) => money(o.totalAmount) + (hasPhoto(o) ? " · con foto" : " · SIN foto")) : ""}`)}
    ${seccion("2. Lo cobrado contra la caja", caja.every((c) => c.ok), caja.length ? `<table cellpadding="4" style="border-collapse:collapse"><tr style="background:#eef2f6"><th align="left">Empleado</th><th align="right">Cobrado (Pagos)</th><th align="right">Declarado</th><th align="right">Dif. cobrado</th><th align="right">Dif. efectivo</th></tr>${caja.map((c) => `<tr><td>${esc(c.nombre)}</td><td align="right">${money(c.cobrado)}</td><td align="right">${c.cierre ? money(c.declarado) : "<b style='color:#b42318'>Sin cierre</b>"}</td><td align="right" style="color:${c.difCobro !== null && Math.abs(c.difCobro) >= 1 ? "#b42318" : "#17212e"}">${c.difCobro === null ? "-" : money(c.difCobro)}</td><td align="right" style="color:${c.difCaja !== null && Math.abs(c.difCaja) >= 1 ? "#b42318" : "#17212e"}">${c.difCaja === null ? "-" : money(c.difCaja)}</td></tr>`).join("")}</table>` : "<p>Ningún empleado trabajó ese día.</p>")}
    ${seccion("3. Transferencias contra fotos", !sinFoto.length && !porComprobar.length && !transfSinComp.length, `<p>Del reparto: ${transfDia.length} por transferencia · ${aCuenta.length} a cuenta. Por comprobar contra el banco: <b>${porComprobar.length}</b>${noLlegaron.length ? " · no llegaron: <b>" + noLlegaron.length + "</b>" : ""}.</p>
      ${sinFoto.length ? "<p><b>Sin foto del remito</b></p>" + lista(sinFoto, (o) => (o.deliveryPayment.method === "cuenta" ? "a cuenta" : "transferencia") + " · " + (o.deliveryPayment.by || "")) : ""}
      ${noLlegaron.length ? "<p><b>Transferencias que no llegaron</b></p>" + lista(noLlegaron, (o) => money(o.totalAmount)) : ""}
      ${transfSinComp.length ? "<p><b>Pagos por transferencia sin comprobante (" + transfSinComp.length + ")</b></p><ul>" + transfSinComp.map((p) => "<li>" + esc((clientes.get(p.clientId) || {}).name || p.clientId) + " " + money(p.amount) + "</li>").join("") + "</ul>" : ""}`)}
    ${seccion("4. Montos que no coinciden", !montosRevisar.length, montos.length ? "<ul>" + montos.map((c) => "<li" + (c.nivel === "alto" ? ' style="color:#b42318"' : "") + ">" + (c.nivel === "info" ? "<small>" + esc(c.texto) + "</small>" : esc(c.texto)) + "</li>").join("") + "</ul>" : "<p>Todos los cobros coinciden con los saldos y los pedidos.</p>")}
    ${seccion("5. Clientes con más deuda que lo habitual", !deudas.length, deudas.length ? `<table cellpadding="4" style="border-collapse:collapse"><tr style="background:#eef2f6"><th align="left">Cliente</th><th align="right">Saldo</th><th align="right">Habitual</th><th align="left">Por qué</th></tr>${deudas.map((x) => `<tr><td>${esc(x.clientId + " - " + ((clientes.get(x.clientId) || {}).name || ""))}</td><td align="right"><b>${money(x.actual)}</b></td><td align="right">${x.habitual === null ? "-" : money(x.habitual)}</td><td>${esc(x.motivos.map((m) => m.tipo === "habitual" ? "debe " + money(m.monto) + " más que lo habitual" : m.tipo === "semanas" ? "más de 3 semanas de compras" : (m.dias == null ? "sin pagos registrados" : m.dias + " días sin pagar")).join(", "))}</td></tr>`).join("")}</table>` : "<p>Ninguno.</p>")}
  </div>`;
  // Version de una linea para WhatsApp (las plantillas de Meta no aceptan saltos de linea).
  const partes = [];
  if (sinEntregar.length) partes.push(sinEntregar.length + " sin entregar");
  if (sinRendir.length) partes.push(sinRendir.length + " sin rendir");
  if (aCuenta.length) partes.push(aCuenta.length + " a cuenta");
  caja.filter((c) => !c.ok).forEach((c) => partes.push(c.nombre + (c.cierre ? " caja " + money(c.difCaja) : " sin cierre de caja")));
  if (porComprobar.length) partes.push(porComprobar.length + " transf. por comprobar");
  if (noLlegaron.length) partes.push(noLlegaron.length + " transf. no llegaron");
  if (sinFoto.length) partes.push(sinFoto.length + " sin foto de remito");
  if (montosRevisar.length) partes.push(montosRevisar.length + " montos que no coinciden");
  if (deudas.length) partes.push(deudas.length + " clientes con deuda inusual");
  const fechaCorta = date.slice(8, 10) + "/" + date.slice(5, 7);
  const linea = "Control " + fechaCorta + ": " + entregados.length + " de " + orders.length + " entregados. " + (partes.length ? "Revisar: " + partes.join(", ") + "." : "Todo en orden.");
  return { html, linea, problemas, counts: { pedidos: orders.length, entregados: entregados.length, sinEntregar: sinEntregar.length, salteados: salteados.length, sinRendir: sinRendir.length, aCuenta: aCuenta.length, sinFoto: sinFoto.length, porComprobar: porComprobar.length, noLlegaron: noLlegaron.length, deudas: deudas.length, montos: montosRevisar.length } };
}

// ---------- Movimientos del banco ----------
// Numero argentino o yanqui: "10.000,50", "10,000.50", "10000", "$ 1.234". El ultimo separador con
// 1 o 2 digitos despues es el decimal.
function parseMoneyText(raw) {
  let s = String(raw || "").replace(/[^\d.,-]/g, "");
  if (!/\d/.test(s)) return NaN;
  const neg = /^-/.test(s);
  s = s.replace(/-/g, "");
  const lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  let entero = s;
  let decimales = "";
  if (lastSep >= 0 && s.length - lastSep - 1 <= 2 && s.length - lastSep - 1 > 0) {
    entero = s.slice(0, lastSep);
    decimales = s.slice(lastSep + 1);
  }
  const n = Number(entero.replace(/[.,]/g, "") + (decimales ? "." + decimales : ""));
  return neg ? -n : n;
}

const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };

function parseDateText(raw, year) {
  const s = String(raw || "").trim().toLowerCase();
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
  m = s.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (m) {
    let y = m[3] ? Number(m[3]) : year;
    if (y < 100) y += 2000;
    return y + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  }
  m = s.match(/\b(\d{1,2})\s*(?:de\s+)?(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*\.?(?:\s*(?:de\s+)?(\d{4}))?/);
  if (m) return (m[3] || year) + "-" + String(MESES[m[2]]).padStart(2, "0") + "-" + m[1].padStart(2, "0");
  return "";
}

function splitCsvLine(line, sep) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = !quoted; }
    else if (ch === sep && !quoted) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// Texto de un archivo exportado (CSV del banco o de Mercado Pago) o de una captura pasada por OCR.
// Devuelve solo los INGRESOS: { fecha, monto, descripcion }.
function parseBankText(text, today) {
  const year = Number(String(today || new Date().toISOString()).slice(0, 4));
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  // 1) Tabla con encabezados (CSV).
  for (const sep of [";", "\t", ","]) {
    const headerIdx = lines.findIndex((l) => l.split(sep).length >= 3 && /(fecha|date)/i.test(l) && /(monto|importe|cr[eé]dito|amount|valor|neto)/i.test(l));
    if (headerIdx < 0) continue;
    const headers = splitCsvLine(lines[headerIdx], sep).map((h) => h.toLowerCase());
    const col = (re) => headers.findIndex((h) => re.test(h));
    const cFecha = col(/fecha|date/);
    let cMonto = col(/cr[eé]dito|ingreso/);
    if (cMonto < 0) cMonto = col(/net_amount|monto|importe|amount|valor|neto/);
    const cDebito = col(/d[eé]bito|egreso/);
    const cDesc = col(/descrip|detalle|concepto|nombre|origen|contraparte|transaction_type|referencia|description/);
    if (cFecha < 0 || cMonto < 0) continue;
    const movs = [];
    lines.slice(headerIdx + 1).forEach((l) => {
      const cells = splitCsvLine(l, sep);
      const monto = parseMoneyText(cells[cMonto]);
      if (!(monto > 0)) return;
      if (cDebito >= 0 && cDebito !== cMonto && parseMoneyText(cells[cDebito]) > 0 && !(parseMoneyText(cells[cMonto]) > 0)) return;
      const fecha = parseDateText(cells[cFecha], year);
      if (!fecha) return;
      movs.push({ fecha, monto: Math.round(monto * 100) / 100, descripcion: cDesc >= 0 ? String(cells[cDesc] || "") : cells.filter((_, i) => i !== cFecha && i !== cMonto).join(" ").slice(0, 120) });
    });
    if (movs.length) return movs;
  }
  // 2) Texto suelto (captura de la app del banco): cada renglon con un monto es un movimiento; la
  // fecha es la del renglon o la ultima fecha que aparecio arriba (las apps agrupan por dia).
  const movs = [];
  let fechaActual = "";
  let descPrevia = "";
  lines.forEach((l) => {
    const fecha = parseDateText(l, year);
    if (fecha) fechaActual = fecha;
    const montos = l.match(/[-+]?\s?\$\s?[\d.,]+\d|[-+]\s?[\d.]{1,}\d,\d{2}\b|\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b/g);
    if (!montos) { if (!fecha && /[a-záéíóúñ]{3,}/i.test(l)) descPrevia = l; return; }
    const crudo = montos[montos.length - 1];
    if (/^-/.test(crudo.trim()) || /\b(pagaste|pago a|enviaste|transferiste|compra|débito|debito|extracci)/i.test(l + " " + descPrevia)) { descPrevia = ""; return; }
    const monto = Math.abs(parseMoneyText(crudo));
    if (!(monto > 0) || !fechaActual) return;
    const desc = (l.replace(crudo, "").replace(/\s+/g, " ").trim() || descPrevia).slice(0, 120);
    movs.push({ fecha: fechaActual, monto: Math.round(monto * 100) / 100, descripcion: desc });
    descPrevia = "";
  });
  return movs;
}

// La IA devuelve JSON (a veces con texto alrededor): se toma el primer arreglo.
function parseBankJson(text) {
  const s = String(text || "");
  const a = s.indexOf("[");
  const b = s.lastIndexOf("]");
  if (a < 0 || b <= a) return null;
  try {
    const arr = JSON.parse(s.slice(a, b + 1));
    if (!Array.isArray(arr)) return null;
    return arr.map((m) => ({
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(m.fecha || m.date || "")) ? String(m.fecha || m.date) : "",
      monto: typeof (m.monto ?? m.amount) === "number" ? Number(m.monto ?? m.amount) : parseMoneyText(m.monto ?? m.amount),
      descripcion: String(m.descripcion || m.description || m.nombre || "")
    })).filter((m) => m.fecha && m.monto > 0);
  } catch (e) {
    return null;
  }
}

module.exports = { controlDailySummary, controlPaymentChecks, parseBankText, parseBankJson, parseMoneyText, parseDateText };
