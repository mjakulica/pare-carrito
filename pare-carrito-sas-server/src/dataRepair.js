"use strict";

// Reparacion de la cuenta corriente. Corrige dos problemas que duplicaban montos:
//
// 1) Filas de "Saldo anterior" (apertura) guardadas como si fueran reales. El servidor manda a los
//    celulares una fila resumen por cliente/caja/proveedor con lo anterior a su ventana de dias;
//    cuando el celular recalculaba los saldos la reenviaba y quedaba guardada. La siguiente apertura
//    la volvia a sumar, y el saldo se inflaba cada vez.
// 2) Mas de una fila "pedido" para el mismo pedido. El celular tiene 7 dias de saldos pero 15 de
//    pedidos: al tocar un pedido viejo (precios, pesos, un cobro) no encontraba su fila y creaba
//    otra, y el pedido quedaba sumado dos veces.
//
// Tambien junta filas "pago" repetidas del mismo pago y cliente, y avisa (sin borrar) los pedidos
// que parecen cargados dos veces: mismo cliente, dia y productos.

const OPENING_ID_RE = /^(SAL|CAJ|PLED)-APERTURA-/;
const OPENING_COLLECTIONS = ["saldos", "caja", "providerLedger"];

function isOpeningRow(row) {
  return !!(row && (row.__opening || OPENING_ID_RE.test(String(row.id || ""))));
}

// Numero de pedido de una fila "pedido": el vinculado o el que figura en la descripcion (las filas
// historicas importadas no siempre tienen el vinculo).
function orderRefOfSaldo(entry) {
  if (!entry || entry.type !== "pedido") return "";
  if (entry.relatedEntityType === "order" && entry.relatedEntityId) return String(entry.relatedEntityId);
  const m = String(entry.description || "").replace(/\s+/g, "").match(/((?:HIST|ORD)-[0-9.]+-[0-9]+(?:-[A-Z0-9]{2,4})?)/i);
  return m ? m[1].toUpperCase() : "";
}

function orderSignature(order) {
  const items = (order.items || []).map((it) => String(it.productId || it.productName || "") + ":" + Number(it.quantity || 0)).sort().join("|");
  return items ? order.clientId + "|" + order.date + "|" + items : "";
}

function repairAccounting(input) {
  const data = input || {};
  const report = { aperturas: [], pedidos: [], pagos: [], pedidosRepetidos: [] };
  let changed = false;

  OPENING_COLLECTIONS.forEach((key) => {
    if (!Array.isArray(data[key])) return;
    const keep = [];
    data[key].forEach((row) => {
      if (isOpeningRow(row)) {
        report.aperturas.push({ coleccion: key, id: row.id, clientId: row.clientId || "", cashBoxId: row.cashBoxId || "", providerId: row.providerId || "", amount: Number(row.amount || 0) || (Number(row.amountIngreso || 0) - Number(row.amountEgreso || 0)), date: row.date || "" });
      } else keep.push(row);
    });
    if (keep.length !== data[key].length) { data[key] = keep; changed = true; }
  });

  if (Array.isArray(data.saldos)) {
    const orders = new Map((data.orders || []).filter(Boolean).map((o) => [String(o.id), o]));
    const groups = new Map();
    const pagos = new Map();
    data.saldos.forEach((entry, index) => {
      if (!entry) return;
      const ref = orderRefOfSaldo(entry);
      if (ref) {
        const key = entry.clientId + "|" + ref;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(index);
      } else if (entry.type === "pago" && entry.relatedEntityType === "payment" && entry.relatedEntityId) {
        const key = entry.clientId + "|" + entry.relatedEntityId;
        if (!pagos.has(key)) pagos.set(key, []);
        pagos.get(key).push(index);
      }
    });
    const remove = new Set();
    groups.forEach((indexes, key) => {
      if (indexes.length < 2) return;
      const entries = indexes.map((i) => data.saldos[i]);
      const ref = key.slice(key.indexOf("|") + 1);
      const order = orders.get(ref);
      // Se queda la fila vinculada al pedido (si hay) y con el total actual del pedido.
      let keepIdx = indexes.find((i) => data.saldos[i].relatedEntityType === "order" && order && Math.abs(Number(data.saldos[i].amount || 0) - Number(order.totalAmount || 0)) < 0.01);
      if (keepIdx === undefined) keepIdx = indexes.find((i) => data.saldos[i].relatedEntityType === "order");
      if (keepIdx === undefined) keepIdx = indexes[0];
      const kept = data.saldos[keepIdx];
      const before = entries.reduce((s, e) => s + Number(e.amount || 0), 0);
      const newAmount = order && kept.relatedEntityType === "order" ? Number(order.totalAmount || 0) : Number(kept.amount || 0);
      if (Math.abs(Number(kept.amount || 0) - newAmount) > 0.004) data.saldos[keepIdx] = { ...kept, amount: newAmount };
      indexes.forEach((i) => { if (i !== keepIdx) remove.add(i); });
      report.pedidos.push({ clientId: kept.clientId, pedido: ref, fecha: kept.date || "", filas: indexes.length, quitadas: indexes.filter((i) => i !== keepIdx).map((i) => data.saldos[i].id), antes: before, despues: newAmount });
    });
    pagos.forEach((indexes, key) => {
      if (indexes.length < 2) return;
      const kept = data.saldos[indexes[0]];
      const before = indexes.reduce((s, i) => s + Number(data.saldos[i].amount || 0), 0);
      indexes.slice(1).forEach((i) => remove.add(i));
      report.pagos.push({ clientId: kept.clientId, pago: kept.relatedEntityId, fecha: kept.date || "", filas: indexes.length, quitadas: indexes.slice(1).map((i) => data.saldos[i].id), antes: before, despues: Number(kept.amount || 0) });
    });
    if (remove.size) {
      data.saldos = data.saldos.filter((_, i) => !remove.has(i));
      changed = true;
    } else if (report.pedidos.length) changed = true;
  }

  // Pedidos que parecen cargados dos veces: solo se avisan, el gerente decide.
  const porFirma = new Map();
  (data.orders || []).forEach((o) => {
    if (!o || o.exampleOnly || o.deletedAt || ["cancelado", "anulado"].includes(o.status)) return;
    const firma = orderSignature(o);
    if (!firma) return;
    if (!porFirma.has(firma)) porFirma.set(firma, []);
    porFirma.get(firma).push(o);
  });
  porFirma.forEach((lista) => {
    if (lista.length < 2) return;
    report.pedidosRepetidos.push({ clientId: lista[0].clientId, fecha: lista[0].date, ids: lista.map((o) => o.id), total: Number(lista[0].totalAmount || 0), entregados: lista.filter((o) => o.status === "entregado").map((o) => o.id) });
  });

  return { data, changed, report };
}

function repairSummary(report) {
  const suma = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  return {
    aperturas: report.aperturas.length,
    aperturasMonto: suma(report.aperturas.filter((x) => x.coleccion === "saldos"), (x) => x.amount),
    pedidos: report.pedidos.length,
    pedidosFilasQuitadas: suma(report.pedidos, (x) => x.quitadas.length),
    pedidosMonto: suma(report.pedidos, (x) => x.antes - x.despues),
    pagos: report.pagos.length,
    pagosMonto: suma(report.pagos, (x) => x.antes - x.despues),
    pedidosRepetidos: report.pedidosRepetidos.length
  };
}

// Pedidos cuyo total cambio en esta escritura: su fila de saldo pasa a ese total. El celular ya no
// crea una fila nueva para un pedido anterior a sus dias de saldos (no la tiene), asi que el ajuste
// lo hace el servidor sobre la fila que existe.
function alignChangedOrderSaldos(before, after) {
  if (!after || !Array.isArray(after.saldos) || !Array.isArray(after.orders)) return 0;
  const antes = new Map(((before && before.orders) || []).filter(Boolean).map((o) => [String(o.id), Number(o.totalAmount || 0)]));
  const cambiados = new Map();
  after.orders.forEach((o) => {
    if (!o || !antes.has(String(o.id))) return;
    if (Math.abs(antes.get(String(o.id)) - Number(o.totalAmount || 0)) > 0.004) cambiados.set(String(o.id), Number(o.totalAmount || 0));
  });
  if (!cambiados.size) return 0;
  let n = 0;
  after.saldos = after.saldos.map((e) => {
    if (!e || e.type !== "pedido" || e.relatedEntityType !== "order" || !cambiados.has(String(e.relatedEntityId))) return e;
    const total = cambiados.get(String(e.relatedEntityId));
    if (Math.abs(Number(e.amount || 0) - total) <= 0.004) return e;
    n += 1;
    return { ...e, amount: total };
  });
  return n;
}

module.exports = { repairAccounting, repairSummary, isOpeningRow, orderRefOfSaldo, alignChangedOrderSaldos };
