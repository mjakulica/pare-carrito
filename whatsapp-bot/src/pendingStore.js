"use strict";

const fs = require("fs");
const path = require("path");

// Almacen simple de solicitudes pendientes de confirmacion del equipo.
// Se persiste en disco para sobrevivir reinicios.
const FILE = process.env.PENDING_FILE || path.join(__dirname, "..", "data", "pending.json");

let pending = {}; // { code: { clientPhone, clientName, clientId, orderId, items, round, createdAt } }

function load() {
  try {
    if (fs.existsSync(FILE)) pending = JSON.parse(fs.readFileSync(FILE, "utf8")) || {};
  } catch (e) {
    console.warn("No se pudo leer pending.json:", e.message);
    pending = {};
  }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(pending, null, 2));
  } catch (e) {
    console.warn("No se pudo guardar pending.json:", e.message);
  }
}

function genCode() {
  // codigo corto facil de tipear en el grupo, ej: A37
  return "P" + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function add(request) {
  let code = genCode();
  while (pending[code]) code = genCode();
  pending[code] = { ...request, code, createdAt: new Date().toISOString() };
  save();
  return code;
}

function get(code) {
  return pending[String(code || "").toUpperCase()] || null;
}

function remove(code) {
  delete pending[String(code || "").toUpperCase()];
  save();
}

function list() {
  return Object.values(pending);
}

load();

module.exports = { add, get, remove, list };
