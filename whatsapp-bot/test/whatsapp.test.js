"use strict";

const { test, afterEach, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { config } = require("../src/config");
const wa = require("../src/whatsapp");
const originalFetch = global.fetch;
const originalConfig = { ...config.whatsapp };
const phone = "5491112345678";
let calls;

beforeEach(() => {
  calls = [];
  Object.assign(config.whatsapp, { token: "test-token", phoneNumberId: "test-phone" });
});
afterEach(() => {
  global.fetch = originalFetch;
  Object.assign(config.whatsapp, originalConfig);
});
function responses(...items) {
  global.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    assert.ok(items.length, "No debe haber reintentos adicionales");
    const item = items.shift();
    if (item instanceof Error) throw item;
    return new Response(JSON.stringify(item.body || {}), { status: item.status });
  };
}
const rejected = (code) => ({ status: 400, body: { error: { code, message: "Rechazado" } } });
const accepted = { status: 200, body: { messages: [{ id: "accepted" }] } };

test("texto: reintenta sin 9 solo tras rechazo de la lista y conserva contenido", async () => {
  responses(rejected(131030), accepted);
  assert.equal(await wa.sendText(phone, "Hola de prueba"), true);
  assert.deepEqual(calls.map((c) => c.to), [phone, "541112345678"]);
  assert.deepEqual(calls[1], { ...calls[0], to: "541112345678" });
});
test("plantilla: usa el mismo reintento y mantiene parametros e idioma", async () => {
  responses(rejected(131030), accepted);
  assert.equal(await wa.sendTemplate(phone, "pedido_modificado", "es", ["Detalle\nde prueba"]), true);
  assert.deepEqual(calls[1], { ...calls[0], to: "541112345678" });
  assert.equal(calls[1].template.name, "pedido_modificado");
  assert.equal(calls[1].template.components[0].parameters[0].text, "Detalle · de prueba");
  assert.equal(wa.lastError, "");
});
test("un mensaje aceptado nunca se reenvia", async () => {
  responses(accepted);
  assert.equal(await wa.sendText(phone, "Hola"), true);
  assert.equal(calls.length, 1);
});
test("otros errores y otros numeros no provocan reintentos", async () => {
  for (const [to, code] of [[phone, 190], [phone, 132001], ["541112345678", 131030], ["15551234567", 131030]]) {
    responses(rejected(code));
    const before = calls.length;
    assert.equal(await wa.sendText(to, "Hola"), false);
    assert.equal(calls.length, before + 1);
  }
});
test("un error de red no se reintenta para evitar duplicados", async () => {
  responses(new Error("timeout"));
  assert.equal(await wa.sendText(phone, "Hola"), false);
  assert.equal(calls.length, 1);
});
test("un segundo rechazo se informa y no genera otro envio", async () => {
  responses(rejected(131030), rejected(131030));
  assert.equal(await wa.sendTemplate(phone, "pedido_modificado", "es", []), false);
  assert.equal(calls.length, 2);
  assert.match(wa.lastError, /131030/);
});
