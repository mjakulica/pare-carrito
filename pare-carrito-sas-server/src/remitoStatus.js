"use strict";

// Que remitos estan pagos, parciales o pendientes para un cliente, a partir de su cuenta corriente
// (todo el historial del servidor). Los pagos que se registraron con pedidos elegidos van a esos
// pedidos. Los demas (y lo que sobro) se imputan, en orden de fecha:
//   1) a un remito pendiente con el MISMO monto (pago por remito, como Charrua o Gertrudis), el
//      mas cercano en monto; nunca a un remito posterior al pago;
//   2) a varios remitos pendientes que SUMAN el monto (pagaron 3 remitos juntos);
//   3) si no coincide, a cuenta: del remito mas viejo al mas nuevo, el ultimo queda parcial.
// Un remito pendiente MAS VIEJO que otros que se pagaron justos queda marcado "salteado": el
// cliente pago los de despues y se olvido de ese.

// "Mismo monto": igual o con menos del 1% de diferencia (y al menos $1 de tolerancia por redondeo).
const igualMonto = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01);

// Medio del pago y como se cargo (persona, comprobante de WhatsApp o resumen del banco).
function origenPago(c) {
  const p = c.pay;
  if (!p) return { medio: c.e.type === "ajuste" || /ajuste/i.test(c.e.description || "") ? "ajuste" : String(c.e.type || "credito"), cargado: String(c.e.description || "").slice(0, 60) };
  const quien = String(p.recordedBy || p.receivedByName || "");
  const solo = p.autoLoaded ? " (solo)" : quien ? " (" + quien + ")" : "";
  const cargado = p.bankMovementId ? "resumen del banco" + solo
    : p.receiptId ? "comprobante de WhatsApp" + solo
    : quien;
  return { medio: String(p.method || ""), cargado };
}

function computeRemitoStatus(data, clientId) {
  const orders = (data.orders || []).filter((o) => o && o.clientId === clientId && !o.exampleOnly && !o.deletedAt && !["cancelado", "anulado"].includes(o.status) && Number(o.totalAmount || 0) > 0);
  const saldos = (data.saldos || []).filter((e) => e && e.clientId === clientId);
  const payments = new Map((data.payments || []).filter((p) => p && p.id).map((p) => [p.id, p]));
  const orderById = new Map(orders.map((o) => [o.id, o]));
  // Deudas: remitos (por el monto de su fila de saldo si existe, si no el total del pedido) y
  // cargos sueltos (ajustes positivos, saldo anterior).
  const items = [];
  const filaPedido = new Map(saldos.filter((e) => e.relatedEntityType === "order" && e.type === "pedido").map((e) => [String(e.relatedEntityId), e]));
  orders.forEach((o) => {
    const fila = filaPedido.get(o.id);
    const total = Math.round(Number(fila ? fila.amount : o.totalAmount) * 100) / 100;
    if (total > 0) items.push({ id: o.id, tipo: "remito", date: String(o.date || (fila && fila.date) || ""), total, pagado: 0, como: [] });
  });
  saldos.filter((e) => Number(e.amount) > 0 && !(e.relatedEntityType === "order" && e.type === "pedido") && !e.annulledAt).forEach((e) => {
    items.push({ id: e.id, tipo: "cargo", descripcion: e.description || e.type, date: String(e.date || ""), total: Math.round(Number(e.amount) * 100) / 100, pagado: 0, como: [] });
  });
  items.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const pend = (it) => Math.max(0, Math.round((it.total - it.pagado) * 100) / 100);
  const aplicar = (it, monto, como) => { it.pagado = Math.round((it.pagado + monto) * 100) / 100; it.como.push(como); };
  // Creditos: pagos y ajustes negativos, en orden de fecha.
  const creditos = saldos.filter((e) => Number(e.amount) < 0 && !e.annulledAt)
    .map((e) => ({ e, monto: Math.round(-Number(e.amount) * 100) / 100, date: String(e.date || ""), pay: e.relatedEntityType === "payment" ? payments.get(String(e.relatedEntityId)) : null }))
    .filter((c) => !(c.pay && c.pay.status === "anulado"))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.e.id).localeCompare(String(b.e.id)));
  creditos.forEach((c) => {
    let resto = c.monto;
    const ref = c.pay ? c.pay.id : c.e.id;
    const info = origenPago(c);
    const aplicarC = (it, monto, extra) => aplicar(it, monto, { ref, date: c.date, total: c.monto, ...info, ...extra });
    // Pago registrado con pedidos elegidos: primero a esos.
    const elegidos = c.pay && Array.isArray(c.pay.orderIds) ? c.pay.orderIds.map((id) => items.find((it) => it.id === id)).filter(Boolean) : [];
    elegidos.forEach((it) => {
      if (resto <= 0.005) return;
      const a = Math.min(resto, pend(it));
      if (a > 0) { aplicarC(it, a, { modo: "elegido", monto: a }); resto -= a; }
    });
    if (resto <= 0.005) return;
    // Un pago nunca paga un remito posterior a el (salvo lo que sobre, a cuenta).
    const abiertos = items.filter((it) => pend(it) > 0.005 && (!c.date || !it.date || it.date <= c.date));
    const dif = (x) => Math.abs(resto - x);
    // 1) mismo monto: el remito con el monto MAS CERCANO (empate: el mas viejo)
    let exacto = null;
    abiertos.forEach((it) => { if (igualMonto(resto, pend(it)) && (!exacto || dif(pend(it)) < dif(pend(exacto)) - 0.005)) exacto = it; });
    if (exacto) { const p = pend(exacto); aplicarC(exacto, p, { modo: "exacto", monto: p, diferencia: Math.round((resto - p) * 100) / 100 }); return; }
    // 2) suma de varios: remitos seguidos (los mas cercanos al pago primero) o cualquier combinacion
    //    de los 16 mas nuevos anteriores al pago; gana la suma mas cercana al monto.
    let grupo = null, mejorDif = Infinity;
    const probar = (g) => { const s2 = g.reduce((t, it) => t + pend(it), 0); if (igualMonto(resto, s2) && dif(s2) < mejorDif - 0.005) { grupo = g; mejorDif = dif(s2); } };
    for (let j = abiertos.length - 1; j >= 1; j--) {
      let s2 = pend(abiertos[j]);
      for (let i = j - 1; i >= 0; i--) {
        s2 += pend(abiertos[i]);
        if (s2 > resto * 1.01 + 1) break;
        probar(abiertos.slice(i, j + 1));
      }
    }
    if (!grupo) {
      const cand = abiertos.slice(-16);
      const n = cand.length;
      for (let mask = 1; mask < (1 << n); mask++) {
        if ((mask & (mask - 1)) === 0) continue; // uno solo ya se probo
        let s2 = 0;
        for (let k = 0; k < n; k++) if (mask & (1 << k)) s2 += pend(cand[k]);
        if (igualMonto(resto, s2) && dif(s2) < mejorDif - 0.005) { grupo = cand.filter((_, k) => mask & (1 << k)); mejorDif = dif(s2); }
      }
    }
    if (grupo) {
      const suma = grupo.reduce((t, it) => t + pend(it), 0);
      grupo.forEach((it) => aplicarC(it, pend(it), { modo: "suma", cuantos: grupo.length, monto: pend(it), diferencia: Math.round((resto - suma) * 100) / 100 }));
      return;
    }
    // 3) a cuenta: del mas viejo al mas nuevo (primero los anteriores al pago; si sobra, adelanto
    //    para los que vienen despues)
    const aCuenta = abiertos.concat(items.filter((it) => pend(it) > 0.005 && !abiertos.includes(it)));
    for (const it of aCuenta) {
      if (resto <= 0.005) break;
      const a = Math.min(resto, pend(it));
      aplicarC(it, a, { modo: "a cuenta", monto: a });
      resto -= a;
    }
  });
  // Salteados: pendientes o parciales con algun remito POSTERIOR pagado justo (exacto o suma).
  items.forEach((it, i) => {
    it.pendiente = pend(it);
    it.estado = it.pendiente <= 0.005 ? "pagado" : it.pagado > 0.005 ? "parcial" : "pendiente";
    it.salteado = it.estado !== "pagado" && items.slice(i + 1).some((x) => x.estado === "pagado" && x.como.some((c) => c.modo === "exacto" || c.modo === "suma" || c.modo === "elegido"));
  });
  // Un remito pagado despues no cuenta hasta calcular estados: segunda pasada para los salteados.
  items.forEach((it, i) => {
    it.salteado = it.estado !== "pagado" && items.slice(i + 1).some((x) => x.estado === "pagado" && x.como.some((c) => c.modo === "exacto" || c.modo === "suma" || c.modo === "elegido"));
  });
  const deuda = items.reduce((t, it) => t + it.pendiente, 0);
  const saldo = saldos.filter((e) => !e.annulledAt).reduce((t, e) => t + Number(e.amount || 0), 0);
  return { items, deuda: Math.round(deuda * 100) / 100, saldo: Math.round(saldo * 100) / 100, salteados: items.filter((it) => it.salteado).length };
}

module.exports = { computeRemitoStatus };
