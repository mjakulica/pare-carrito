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

test("WhatsApp vinculado por QR: la bandeja guarda el canal para contestar por el mismo lado", async () => {
  const inbox = [];
  const { createInboxFlow } = require("../src/inboxFlow");
  const flow = createInboxFlow({
    wa: { sendText: async () => true, notifyTeam: async () => {}, notifyOwner: async () => {} },
    erp: { inbox: async (e) => { inbox.push(e); return { ok: true }; }, getTodayOrder: async () => ({}) },
    ai: { classifyMessage: async () => ({ intent: "pedido_nuevo", items: [] }) },
    channel: "linked"
  });
  await flow.handleKnown({ from: "549111", text: "2 kg papa", client: { id: "010" } });
  assert.equal(inbox[0].channel, "linked");
});

test("contactos del WhatsApp vinculado: guarda nombre de agenda por número, ignora grupos y sin nombre", () => {
  process.env.WA_LINKED_DIR = require("path").join(require("os").tmpdir(), "wa-linked-test-" + Date.now(), "auth");
  delete require.cache[require.resolve("../src/linked")];
  const linked = require("../src/linked");
  linked.addContacts([
    { id: "5493871234567@s.whatsapp.net", name: "Vivré Juan", notify: "Juan" },
    { id: "120363000@g.us", name: "Grupo familia" },
    { id: "5493879999999@s.whatsapp.net" },
    { id: "123456789@lid", name: "Oculto" }
  ]);
  linked.addContacts([{ id: "5493871234567@s.whatsapp.net", notify: "Juancito" }]);
  assert.deepEqual(linked.listContacts(), [{ phone: "5493871234567", name: "Vivré Juan", notify: "Juancito" }]);
});

test("archivo: guarda chats individuales y grupos, recibidos y enviados, con fotos y audios; ignora estados", async () => {
  process.env.WA_LINKED_DIR = require("path").join(require("os").tmpdir(), "wa-arch-test-" + Date.now(), "auth");
  delete require.cache[require.resolve("../src/linked")];
  const linked = require("../src/linked");
  const lotes = [];
  linked.init(() => {}, async (l) => { lotes.push(...l); });
  linked.addContacts([{ id: "5493871234567@s.whatsapp.net", name: "Vivré Juan" }]);
  const ts = Math.floor(Date.now() / 1000);
  await linked.archiveMessage({ key: { id: "A1", remoteJid: "5493871234567@s.whatsapp.net" }, pushName: "Juan", messageTimestamp: ts, message: { conversation: "2 kg de papa" } });
  await linked.archiveMessage({ key: { id: "A2", remoteJid: "5493871234567@s.whatsapp.net", fromMe: true }, messageTimestamp: ts, message: { extendedTextMessage: { text: "Dale, anotado" } } });
  await linked.archiveMessage({ key: { id: "A3", remoteJid: "120363@g.us", participant: "5493879999999@s.whatsapp.net" }, pushName: "Pedro", messageTimestamp: ts, message: { imageMessage: { caption: "lista de hoy" } } });
  await linked.archiveMessage({ key: { id: "A4", remoteJid: "status@broadcast" }, messageTimestamp: ts, message: { conversation: "estado" } });
  await linked.archiveMessage({ key: { id: "A5", remoteJid: "5493871234567@s.whatsapp.net" }, messageTimestamp: ts, message: { audioMessage: {} } });
  await linked.flushArchive();
  assert.deepEqual(lotes.map((m) => [m.waId, m.chatId, m.isGroup, m.fromMe, m.type, m.text, m.chatName, m.senderName]), [
    ["A1", "5493871234567", false, false, "texto", "2 kg de papa", "Vivré Juan", "Juan"],
    ["A2", "5493871234567", false, true, "texto", "Dale, anotado", "Vivré Juan", ""],
    ["A3", "120363@g.us", true, false, "imagen", "[imagen] lista de hoy", "", "Pedro"],
    ["A5", "5493871234567", false, false, "audio", "[audio]", "Vivré Juan", ""]
  ]);
  assert.equal(lotes[2].senderPhone, "5493879999999");
});

test("solo recibir: no se le contesta a nadie; los pedidos van igual a la bandeja (los de números nuevos sin preguntar)", async () => {
  const sent = [], inbox = [], identify = [];
  const { createInboxFlow } = require("../src/inboxFlow");
  const intents = { "2 kg papa": "pedido_nuevo", "hola": "saludo", "a que hora llegan?": "consulta" };
  const flow = createInboxFlow({
    wa: { sendText: async (to, t) => { sent.push([to, t]); return true; }, notifyTeam: async () => {}, notifyOwner: async () => {} },
    erp: { inbox: async (e) => { inbox.push(e); return { ok: true }; }, getTodayOrder: async () => ({}), getIdentify: async () => { identify.push("get"); return {}; }, setIdentify: async () => identify.push("set") },
    ai: { classifyMessage: async (t) => ({ intent: intents[t], items: [] }) },
    channel: "linked", silent: () => true
  });
  await flow.handleKnown({ from: "549111", text: "hola", client: { id: "010" } });
  await flow.handleKnown({ from: "549111", text: "a que hora llegan?", client: { id: "010" } });
  await flow.handleKnown({ from: "549111", text: "2 kg papa", client: { id: "010" } });
  assert.equal(await flow.handleUnknown({ from: "549222", text: "2 kg papa" }), "guardado_sin_preguntar");
  assert.equal(await flow.handleUnknown({ from: "549333", text: "hola" }), "ignorado");
  assert.equal(sent.length, 0);
  assert.deepEqual(identify, []);
  assert.deepEqual(inbox.map((e) => [e.phone, e.clientId || null, e.kind]), [["549111", "010", "pedido"], ["549222", null, "pedido"]]);
});

test("solo recibir: linked.sendText no manda nada (prendido de entrada)", async () => {
  process.env.WA_LINKED_DIR = require("path").join(require("os").tmpdir(), "wa-ro-test-" + Date.now(), "auth");
  delete require.cache[require.resolve("../src/linked")];
  const linked = require("../src/linked");
  assert.equal(linked.receiveOnly(), true);
  assert.equal(await linked.sendText("549111", "hola"), false);
  assert.equal(linked.setReceiveOnly(false).receiveOnly, false);
  assert.equal(linked.setReceiveOnly(true).receiveOnly, true);
});

test("números ocultos (@lid): se traducen al número real con los contactos o el mensaje", async () => {
  process.env.WA_LINKED_DIR = require("path").join(require("os").tmpdir(), "wa-lid-test-" + Date.now(), "auth");
  delete require.cache[require.resolve("../src/linked")];
  const linked = require("../src/linked");
  const lotes = [];
  linked.init(() => {}, async (l) => { lotes.push(...l); });
  linked.addContacts([{ id: "246033141514406@lid", jid: "5493871234567@s.whatsapp.net", name: "21) Estacion Belgrano" }]);
  assert.equal(linked.phoneOf("246033141514406@lid"), "5493871234567");
  assert.equal(linked.phoneOf("111@lid", { senderPn: "5493870000001@s.whatsapp.net" }), "5493870000001");
  assert.equal(linked.phoneOf("111@lid"), "5493870000001");
  await linked.archiveMessage({ key: { id: "L1", remoteJid: "246033141514406@lid" }, messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: "pedido" } });
  await linked.flushArchive();
  assert.equal(lotes[0].chatId, "5493871234567");
  assert.deepEqual(linked.listContacts().map((c) => c.phone), ["5493871234567"]);
  assert.ok(linked.listLids().some((x) => x.lid === "246033141514406" && x.phone === "5493871234567"));
});

test("grupo vinculado a un cliente: el pedido va a la bandeja como de ese cliente, sin contestar", async () => {
  const sent = [];
  const inbox = [];
  const flowG = createInboxFlow({
    wa: { sendText: async (to, t) => sent.push(t), notifyTeam: async () => {}, notifyOwner: async () => {} },
    erp: { inbox: async (e) => { inbox.push(e); return { ok: true }; }, getTodayOrder: async () => ({ order: null }) },
    ai: { classifyMessage: async (t) => /tomate/.test(t) ? { intent: "pedido_nuevo", items: [{ producto: "tomate", cantidad: 2 }] } : { intent: "otro", items: [] } },
    channel: "linked"
  });
  assert.equal(await flowG.handleGroup({ from: "5493875555555", group: "120363@g.us", groupName: "Factory", text: "2 cajones de tomate", profileName: "Juan", client: { id: "7", name: "Factory" } }), "pedido");
  assert.equal(await flowG.handleGroup({ from: "5493875555555", group: "120363@g.us", groupName: "Factory", text: "jaja buenísimo", profileName: "Juan", client: { id: "7", name: "Factory" } }), "ignorado_grupo");
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].clientId, "7");
  assert.match(inbox[0].profileName, /Factory/);
  assert.equal(sent.length, 0);
});
