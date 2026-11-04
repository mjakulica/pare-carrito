"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { createInboxFlow } = require("../src/inboxFlow");

function fakes(opts = {}) {
  const sent = [], team = [], owner = [], inbox = [], identify = {}, links = [];
  const wa = { sendText: async (to, t) => { sent.push([to, t]); return true; }, notifyTeam: async (t) => team.push(t), notifyOwner: async (t) => owner.push(t) };
  const erp = {
    inbox: async (e) => { inbox.push(e); return { ok: true, id: inbox.length }; },
    getTodayOrder: async () => ({ order: opts.todayOrder || null }),
    getIdentify: async (p) => identify[p] || { stage: "" },
    setIdentify: async (p, d) => { identify[p] = { stage: d.stage || "", candidateId: d.candidateId || "" }; },
    matchClients: async () => ({ candidates: opts.candidates || [] }),
    linkPhone: async (id, p) => { links.push([id, p]); identify[p] = { stage: "" }; return { ok: true, name: "Vivré" }; }
  };
  const ai = { classifyMessage: async (t) => (opts.classify ? opts.classify(t) : { intent: "pedido_nuevo", items: [] }) };
  return { flow: createInboxFlow({ wa, erp, ai }), sent, team, owner, inbox, identify, links };
}

test("cliente conocido: el pedido va a la bandeja (no se carga solo) y se le contesta", async () => {
  const f = fakes();
  const r = await f.flow.handleKnown({ from: "549111", text: "2 kg tomate", profileName: "Juan", client: { id: "010", name: "Vivré" } });
  assert.equal(r, "pedido");
  assert.deepEqual(f.inbox.map((e) => [e.kind, e.clientId, e.text]), [["pedido", "010", "2 kg tomate"]]);
  assert.match(f.sent[0][1], /Recibimos tu pedido/);
});

test("cliente conocido: agregar lleva el pedido de hoy", async () => {
  const f = fakes({ classify: () => ({ intent: "agregar", items: [] }), todayOrder: { id: "ORD-1" } });
  await f.flow.handleKnown({ from: "549111", text: "sumame 1 lechuga", client: { id: "010" } });
  assert.equal(f.inbox[0].kind, "agregar");
  assert.equal(f.inbox[0].orderId, "ORD-1");
});

test("numero desconocido que NO manda un pedido: no se le contesta nada", async () => {
  const f = fakes({ classify: () => ({ intent: "saludo", items: [] }) });
  const r = await f.flow.handleUnknown({ from: "549222", text: "hola tia, como andas?" });
  assert.equal(r, "ignorado");
  assert.equal(f.sent.length, 0);
  assert.equal(f.inbox.length, 0);
});

test("numero desconocido con pedido: guarda el pedido y pregunta de que negocio es; con candidato claro pide confirmar y vincula", async () => {
  const f = fakes({ candidates: [{ id: "010", name: "Vivré", address: "Belgrano 1234", score: 1.85 }, { id: "012", name: "Bar", score: 0.5 }] });
  assert.equal(await f.flow.handleUnknown({ from: "549333", text: "2 cajones de banana" }), "pregunta_negocio");
  assert.equal(f.inbox[0].kind, "pedido");
  assert.equal(f.inbox[0].clientId, undefined);
  assert.match(f.sent[0][1], /de qué negocio/);
  assert.equal(await f.flow.handleUnknown({ from: "549333", text: "vivré bar, belgrano 1234" }), "pregunta_confirmacion");
  assert.match(f.sent[1][1], /¿Sos Vivré \(Belgrano 1234\)\? Respondé SI o NO/);
  assert.equal(await f.flow.handleUnknown({ from: "549333", text: "Sí" }), "vinculado");
  assert.deepEqual(f.links, [["010", "549333"]]);
  assert.match(f.sent[2][1], /Ya registramos este número/);
});

test("sin candidato claro (o dice que no): va al personal, que lo vincula desde la bandeja", async () => {
  const f = fakes({ candidates: [{ id: "014", name: "Panadería La Espiga", score: 0.5 }, { id: "015", name: "La Espiga Dorada", score: 0.5 }] });
  await f.flow.handleUnknown({ from: "549444", text: "1 bolsa de papa" });
  assert.equal(await f.flow.handleUnknown({ from: "549444", text: "La Espiga" }), "al_personal");
  const id = f.inbox.find((e) => e.kind === "identificar");
  assert.ok(id && id.candidates.length === 2);
  // mientras espera al personal, otro pedido se guarda sin volver a preguntar
  assert.equal(await f.flow.handleUnknown({ from: "549444", text: "y 2 de cebolla" }), "guardado_esperando_personal");
  assert.equal(f.sent.length, 2);
  const g = fakes({ candidates: [{ id: "010", name: "Vivré", score: 1 }] });
  await g.flow.handleUnknown({ from: "549555", text: "pedido" });
  await g.flow.handleUnknown({ from: "549555", text: "vivre" });
  assert.equal(await g.flow.handleUnknown({ from: "549555", text: "no" }), "al_personal");
  assert.equal(g.links.length, 0);
});
