"use strict";

const { config } = require("./config");

// Cliente del ERP. Usa los endpoints externos (a definir en el servidor, protegidos por ERP_API_KEY).
// Ver ERP_ENDPOINTS.md para el contrato esperado.
async function erpRequest(method, path, body) {
  if (!config.erp.baseUrl || !config.erp.apiKey) {
    throw new Error("ERP no configurado (ERP_BASE_URL / ERP_API_KEY).");
  }
  const res = await fetch(config.erp.baseUrl + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-api-key": config.erp.apiKey
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(json.error || ("ERP HTTP " + res.status));
    err.status = res.status;
    throw err;
  }
  return json;
}

// Busca el cliente del ERP por telefono de WhatsApp.
function findClientByPhone(phone) {
  return erpRequest("GET", "/external/clients/by-phone/" + encodeURIComponent(phone));
}

// Pedido de hoy del cliente (si existe).
function getTodayOrder(clientId) {
  return erpRequest("GET", "/external/orders/today/" + encodeURIComponent(clientId));
}

// Crea un pedido nuevo. items: [{producto/productId, cantidad, unidad, nota}]
function createOrder(clientId, items, options) {
  return erpRequest("POST", "/external/orders", { clientId, items, ...(options || {}) });
}

// Agrega items a un pedido existente. round: 1 o 2 (segunda ronda).
function addItems(orderId, items, round) {
  return erpRequest("POST", "/external/orders/" + encodeURIComponent(orderId) + "/items", { items, round: round || 1 });
}

// Cancela/saca items (o todo el pedido si items vacio).
function cancelItems(orderId, items) {
  return erpRequest("POST", "/external/orders/" + encodeURIComponent(orderId) + "/cancel", { items: items || [] });
}

// Lista de nombres de productos validos (para ayudar a la IA).
function listProductNames() {
  return erpRequest("GET", "/external/products/names").then((r) => (Array.isArray(r.products) ? r.products : []));
}

module.exports = { erpRequest, findClientByPhone, getTodayOrder, createOrder, addItems, cancelItems, listProductNames };
