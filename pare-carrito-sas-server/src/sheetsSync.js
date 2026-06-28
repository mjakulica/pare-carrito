"use strict";

// Sincronizacion con Google Sheets (Apps Script web app).
// Se dispara con el diff entre el estado anterior y el nuevo en cada guardado:
//  - pedidos nuevos  -> pestania "pedidos" (una fila por pedido)
//  - cambios de precio venta / costo / compra hoy -> pestania "precios"
// El mapeo producto -> columna lo resuelve el Apps Script (lee los encabezados en vivo).

function webhookUrl() {
  return process.env.GOOGLE_SHEETS_WEBHOOK_URL || "";
}
function webhookToken() {
  return process.env.GOOGLE_SHEETS_TOKEN || "";
}

function clientNameOf(data, clientId) {
  const c = (data.clients || []).find((x) => x.id === clientId);
  return c ? c.name : String(clientId || "");
}

function priceSnapshot(data) {
  const prices = data.prices || {};
  const map = {};
  (data.products || []).forEach((p) => {
    const rec = prices[p.id] || {};
    map[p.id] = {
      name: p.name,
      venta: Number(rec.price != null ? rec.price : p.salePrice || 0),
      costo: Number(rec.cost != null ? rec.cost : p.baseCost || 0),
      compraHoy: Number(rec.marketPrice || 0)
    };
  });
  return map;
}

async function postBatch(pedidos, precios) {
  const url = webhookUrl();
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: webhookToken(), pedidos, precios }),
      redirect: "follow"
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn("Sheets sync HTTP", res.status, detail.slice(0, 200));
    }
  } catch (error) {
    console.warn("Sheets sync error:", error.message);
  }
}

// No bloquea la respuesta: calcula el diff y dispara el POST en segundo plano.
function syncSheetsFromStateDiff(beforeData, afterData) {
  if (!webhookUrl()) return;
  beforeData = beforeData || {};
  afterData = afterData || {};

  const pedidos = [];
  const beforeOrders = Array.isArray(beforeData.orders) ? beforeData.orders : [];
  const afterOrders = Array.isArray(afterData.orders) ? afterData.orders : [];
  // Empuja pedidos NUEVOS y EDITADOS (nunca en el baseline inicial, para evitar backfill masivo).
  // El Apps Script hace upsert por numero de pedido (recuerda en que fila quedo cada uno).
  if (beforeOrders.length > 0) {
    const beforeById = {};
    beforeOrders.forEach((o) => { if (o) beforeById[o.id] = o; });
    const isCancelled = (o) => ["cancelado", "anulado"].includes(o && o.status);
    const itemsSig = (o) => (o.items || []).map((it) => it.productId + ":" + it.quantity + ":" + (it.note || "")).join("|") + "|" + (o.status || "");
    const mapItems = (o) => (o.items || [])
      .map((it) => ({ producto: it.productName, cantidad: Number(it.quantity || 0), nota: String(it.note || "").trim() }))
      .filter((it) => it.producto && it.cantidad > 0);
    const baseOrder = (o) => ({
      timestamp: o.createdAt || (o.date ? o.date + "T08:00:00" : new Date().toISOString()),
      cliente: clientNameOf(afterData, o.clientId),
      numero: o.id,
      total: Number(o.totalAmount || 0)
    });
    afterOrders.forEach((o) => {
      if (!o || o.exampleOnly) return;
      const before = beforeById[o.id];
      if (!before) {
        if (isCancelled(o)) return;
        const items = mapItems(o);
        if (!items.length) return;
        pedidos.push({ ...baseOrder(o), items });
        return;
      }
      if (isCancelled(o) && !isCancelled(before)) {
        pedidos.push({ ...baseOrder(o), items: [] });
        return;
      }
      if (!isCancelled(o) && itemsSig(o) !== itemsSig(before)) {
        pedidos.push({ ...baseOrder(o), items: mapItems(o) });
      }
    });
  }

  const precios = [];
  if (Array.isArray(beforeData.products) && beforeData.products.length > 0) {
    const beforeP = priceSnapshot(beforeData);
    const afterP = priceSnapshot(afterData);
    Object.keys(afterP).forEach((pid) => {
      const a = afterP[pid];
      const b = beforeP[pid];
      if (!b) return;
      if (a.venta !== b.venta || a.costo !== b.costo) {
        precios.push({ producto: a.name, venta: a.venta, costo: a.costo });
      }
    });
  }

  if (pedidos.length || precios.length) {
    postBatch(pedidos, precios).catch((e) => console.warn("Sheets sync:", e.message));
  }
}

// Empuja una fila de precios puntual (usado al actualizar costo desde "Compra Hoy").
function pushPrecio(producto, venta, costo) {
  if (!webhookUrl()) return;
  postBatch([], [{ producto: producto, venta: venta, costo: costo }]).catch((e) => console.warn("Sheets sync:", e.message));
}

module.exports = { syncSheetsFromStateDiff, pushPrecio };
