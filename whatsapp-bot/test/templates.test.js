"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createTemplateService, createTemplateRouter, validateDraft, present } = require("../src/templates");
const draft = { accountId: "10", name: "pedido_modificado", language: "es", category: "UTILITY", body: "Pare Carrito: actualizamos tu pedido. {{1}} Respondé ante cualquier duda.", sample: "Ejemplo: agregamos 2 cajones de tomate.", footer: "Gracias" };
const raw = (overrides = {}) => ({ id: "20", name: draft.name, language: "es", category: "UTILITY", status: "APPROVED", parameter_format: "POSITIONAL", components: [{ type: "BODY", text: draft.body, example: { body_text: [[draft.sample]] } }, { type: "FOOTER", text: "Gracias" }], ...overrides });
function fixture(replies) {
  const calls = [];
  const service = createTemplateService({ token: "SECRET-TOKEN", wabaId: "10", fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    const next = replies.shift();
    assert.ok(next, "No debe haber llamadas adicionales a Meta");
    return { ok: !next.error, json: async () => next };
  } });
  return { service, calls };
}
test("crear usa la WABA, ejemplo posicional y token solo en cabecera", async () => {
  const { service, calls } = fixture([{ id: "20", status: "PENDING", category: "UTILITY" }]);
  assert.deepEqual(await service.create(draft), { id: "20", status: "PENDING", category: "UTILITY" });
  assert.match(calls[0].url, /\/10\/message_templates$/);
  assert.equal(calls[0].options.headers.authorization, "Bearer SECRET-TOKEN");
  assert.ok(!calls[0].url.includes("SECRET-TOKEN"));
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.parameter_format, "POSITIONAL");
  assert.deepEqual(sent.components[0].example.body_text, [[draft.sample]]);
  assert.equal(sent.components[1].text, "Gracias");
});
test("rechaza variables incompatibles y contenido inválido antes de contactar Meta", async () => {
  const { service, calls } = fixture([]);
  for (const body of ["{{1}}", "Hola {{2}} fin", "Hola {{1}} {{2}} fin", "{{1}} al comienzo", "Termina en {{1}}", "Hola {{1}} {otro} fin"]) {
    await assert.rejects(service.create({ ...draft, body }), e => e.status === 400);
  }
  assert.throws(() => validateDraft({ ...draft, category: "AUTHENTICATION" }));
  assert.throws(() => validateDraft({ ...draft, sample: "" }));
  assert.throws(() => validateDraft({ ...draft, footer: "{{1}}" }));
  assert.equal(calls.length, 0);
});
test("consulta pagina por cursor sin devolver ni seguir URLs con tokens", async () => {
  const { service, calls } = fixture([{ id: "10", name: "Pruebas" }, { data: [raw()], paging: { next: "https://evil.invalid/?access_token=SECRET-TOKEN", cursors: { after: "cursor-a" } } }, { data: [raw({ id: "21", status: "PENDING" })] }]);
  const result = await service.list();
  assert.equal(result.templates.length, 2);
  assert.equal(result.templates[0].canEdit, true);
  assert.equal(result.templates[1].canEdit, false);
  assert.ok(calls.every(c => c.url.startsWith("https://graph.facebook.com/")));
  assert.match(calls[2].url, /after=cursor-a/);
  assert.ok(!JSON.stringify(result).includes("SECRET-TOKEN"));
});
test("no permite editar IDs de otra WABA ni borraría componentes complejos", async () => {
  const { service, calls } = fixture([{ data: [] }]);
  await assert.rejects(service.update("999", draft), e => e.status === 404);
  assert.equal(calls.length, 1);
  assert.equal(present(raw({ components: [...raw().components, { type: "BUTTONS", buttons: [] }] })).canEdit, false);
  assert.equal(present(raw({ components: [...raw().components, { type: "HEADER", text: "Hola" }] })).canEdit, false);
});
test("una plantilla en revisión no se vuelve a enviar", async () => {
  const { service, calls } = fixture([{ data: [raw({ status: "PENDING" })] }]);
  await assert.rejects(service.update("20", draft), e => e.status === 409);
  assert.equal(calls.length, 1);
});
test("revalida cuenta, nombre e idioma al guardar", async () => {
  const { service, calls } = fixture([{ data: [raw()] }, { data: [raw()] }]);
  await assert.rejects(service.create({ ...draft, accountId: "11" }), e => e.status === 409);
  await assert.rejects(service.update("20", { ...draft, name: "otro" }), e => e.status === 400);
  await assert.rejects(service.update("20", { ...draft, language: "en_US" }), e => e.status === 400);
  assert.equal(calls.length, 2);
});
test("edición conserva el pie y no intenta cambiar la categoría de aprobadas", async () => {
  const { service, calls } = fixture([{ data: [raw()] }, { success: true }]);
  await service.update("20", draft);
  const sent = JSON.parse(calls[1].options.body);
  assert.equal(sent.components[1].text, "Gracias");
  assert.equal(sent.category, undefined);
  const other = fixture([{ data: [raw({ category: "MARKETING" })] }]);
  await assert.rejects(other.service.update("20", draft), e => e.status === 409);
});
test("puede corregir categoría de una plantilla rechazada", async () => {
  const { service, calls } = fixture([{ data: [raw({ category: "MARKETING", status: "REJECTED" })] }, { success: true }]);
  await service.update("20", draft);
  assert.equal(JSON.parse(calls[1].options.body).category, "UTILITY");
});
test("redacta secretos incluso si Meta los incluyera en el error", async () => {
  const { service } = fixture([{ error: { message: "Token SECRET-TOKEN inválido", code: 190 } }]);
  await assert.rejects(service.create(draft), e => e.status === 502 && !e.message.includes("SECRET-TOKEN") && e.message.includes("190"));
});
test("sin WABA configurada da una instrucción concreta", async () => {
  const service = createTemplateService({ token: "secret", wabaId: "", fetchImpl: () => assert.fail("No debe consultar Meta") });
  await assert.rejects(service.list(), e => e.status === 503 && e.message.includes("WHATSAPP_BUSINESS_ACCOUNT_ID"));
});
test("rutas internas exigen BROADCAST_KEY y no cachean respuestas", async () => {
  let calls = 0;
  const app = express(); app.use(express.json());
  app.use("/templates", createTemplateRouter({ broadcastKey: "internal-secret", service: { list: async () => { calls++; return { templates: [] }; } } }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const url = "http://127.0.0.1:" + server.address().port + "/templates";
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { "x-broadcast-key": "incorrecta" } })).status, 401);
    const r = await fetch(url, { headers: { "x-broadcast-key": "internal-secret" } });
    assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(calls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
