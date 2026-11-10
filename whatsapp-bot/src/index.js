"use strict";

const express = require("express");
const { config } = require("./config");
const wa = require("./whatsapp");
const ai = require("./ai");
const erp = require("./erp");
const flow = require("./orderFlow");
const { createTemplateService, createTemplateRouter } = require("./templates");
const { createInboxFlow } = require("./inboxFlow");
const linked = require("./linked");

const app = express();
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

app.use("/templates", createTemplateRouter({
  service: createTemplateService({ token: config.whatsapp.token,
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    apiVersion: process.env.WHATSAPP_MANAGEMENT_API_VERSION || "v26.0" }),
  broadcastKey: process.env.BROADCAST_KEY || ""
}));

// Cache simple de nombres de productos para ayudar a la IA.
let productNamesCache = { at: 0, names: [] };
async function getProductNames() {
  if (Date.now() - productNamesCache.at < 10 * 60 * 1000 && productNamesCache.names.length) {
    return productNamesCache.names;
  }
  try {
    const names = await erp.listProductNames();
    productNamesCache = { at: Date.now(), names };
  } catch (e) {
    console.warn("No se pudieron traer nombres de productos:", e.message);
  }
  return productNamesCache.names;
}

// Estado de la configuracion (solo si/no, nunca las claves): lo muestra el ERP en Configuracion.
app.get("/health", (_req, res) => res.json({
  ok: true,
  configured: {
    token: !!config.whatsapp.token,
    phoneNumberId: !!config.whatsapp.phoneNumberId,
    verifyTokenCustom: config.whatsapp.verifyToken !== "pare-carrito-webhook",
    appSecret: !!config.whatsapp.appSecret,
    broadcastKey: !!process.env.BROADCAST_KEY,
    notifyNumbers: config.notifyNumbers.length,
    ownerNumber: !!config.ownerNumber,
    openrouter: !!config.openrouter.apiKey,
    erpApiKey: !!config.erp.apiKey
  }
}));

// Envio masivo por plantilla (lo llama el ERP, ej. aviso de feriado). Auth por clave compartida.
app.post("/broadcast", async (req, res) => {
  const broadcastKey = process.env.BROADCAST_KEY || "";
  if (!broadcastKey || req.get("x-broadcast-key") !== broadcastKey) return res.sendStatus(401);
  const { numbers, templateName, lang, params } = req.body || {};
  if (!Array.isArray(numbers) || !templateName) return res.status(400).json({ error: "Se espera { numbers, templateName }." });
  let sent = 0;
  let failed = 0;
  const errors = [];
  for (const n of numbers) {
    const r = await wa.sendTemplate(n, templateName, lang, params || []);
    if (r === true) sent += 1; else { failed += 1; if (wa.lastError) errors.push(wa.lastError); }
  }
  res.json({ ok: true, sent, failed, errors: errors.slice(0, 3) });
});

// Texto libre a un cliente (lo usa el ERP para confirmar que su pedido quedo cargado). Meta solo lo
// permite dentro de las 24 h del ultimo mensaje del cliente.
app.post("/send", async (req, res) => {
  const broadcastKey = process.env.BROADCAST_KEY || "";
  if (!broadcastKey || req.get("x-broadcast-key") !== broadcastKey) return res.sendStatus(401);
  const { to, text, channel, manual, notice } = req.body || {};
  if (!to || !text) return res.status(400).json({ error: "Se espera { to, text }." });
  // Respuesta escrita por una persona desde el sistema: por el WhatsApp vinculado, aunque este en solo recibir.
  if (manual) {
    if (!linked.isConnected()) return res.status(409).json({ error: "El WhatsApp vinculado no está conectado." });
    const r = await linked.sendText(String(to), String(text).slice(0, 4000), { manual: true });
    return r ? res.json({ ok: true, id: r.id || "" }) : res.status(502).json({ error: "WhatsApp no aceptó el mensaje." });
  }
  if (notice) {
    if (!linked.isConnected()) return res.status(409).json({ error: "El WhatsApp vinculado no está conectado." });
    const ok = await linked.sendText(String(to), String(text).slice(0, 1500), { notice: true });
    return res.status(ok ? 200 : 502).json(ok ? { ok: true } : { error: "WhatsApp no aceptó el mensaje." });
  }
  if (channel === "linked" && linked.receiveOnly()) return res.json({ ok: true, skipped: "solo recibir" });
  const ok = channel === "linked" ? await linked.sendText(String(to), String(text).slice(0, 1000)) : await wa.sendText(String(to), String(text).slice(0, 1000));
  res.status(ok ? 200 : 502).json(ok ? { ok: true } : { error: "WhatsApp no acepto el mensaje." });
});

// WhatsApp vinculado por QR: estado (con el QR para escanear), vincular y desvincular.
const linkedAuth = (req, res, next) => {
  const k = process.env.BROADCAST_KEY || "";
  if (!k || req.get("x-broadcast-key") !== k) return res.sendStatus(401);
  next();
};
app.get("/linked/status", linkedAuth, (req, res) => res.json({ ok: true, ...linked.status(), stats: linkedStats, ia: !!config.openrouter.apiKey }));
app.post("/linked/start", linkedAuth, async (req, res) => res.json({ ok: true, ...(await linked.startLinking()) }));
app.get("/linked/contacts", linkedAuth, (req, res) => res.json({ ok: true, connected: linked.isConnected(), contacts: linked.listContacts(), lids: linked.listLids() }));
app.post("/linked/mode", linkedAuth, (req, res) => res.json({ ok: true, ...linked.setReceiveOnly(!!(req.body && req.body.receiveOnly)) }));
app.post("/linked/stop", linkedAuth, async (req, res) => res.json({ ok: true, ...(await linked.stop()) }));

// Verificacion del webhook (Meta).
app.get("/webhook", (req, res) => {
  const challenge = wa.verifyWebhook(req.query);
  if (challenge) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// Recepcion de mensajes.
app.post("/webhook", async (req, res) => {
  if (!wa.validateSignature(req.rawBody, req.get("x-hub-signature-256"))) {
    return res.sendStatus(401);
  }
  res.sendStatus(200); // responder rapido a Meta; procesamos en background
  const messages = wa.extractIncomingMessages(req.body);
  for (const msg of messages) {
    try {
      await handleMessage(msg);
    } catch (e) {
      console.error("handleMessage error:", e.message);
    }
  }
});

const inboxFlow = createInboxFlow({ wa, erp, ai, getProductNames, channel: "cloud" });
// Mismo flujo para el WhatsApp vinculado por QR, contestando por ese mismo WhatsApp.
const linkedWa = { sendText: (to, t) => linked.sendText(to, t), notifyTeam: (t) => wa.notifyTeam(t), notifyOwner: (t) => wa.notifyOwner(t) };
const linkedFlow = createInboxFlow({ wa: linkedWa, erp, ai, getProductNames, channel: "linked", silent: () => linked.receiveOnly() });
// Contadores del dia del WhatsApp vinculado (se ven en Configuracion): cuantos mensajes llegaron y si
// hubo errores al pasarlos a la bandeja.
const linkedStats = { dia: "", recibidos: 0, errores: 0, ultimoError: "", ultimoErrorAt: "" };
linked.init(async (msg) => {
  const hoy = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  if (linkedStats.dia !== hoy) Object.assign(linkedStats, { dia: hoy, recibidos: 0, errores: 0 });
  linkedStats.recibidos += 1;
  try {
    await handleMessage(msg, linkedFlow, linkedWa);
  } catch (e) {
    linkedStats.errores += 1;
    linkedStats.ultimoError = e.message;
    linkedStats.ultimoErrorAt = new Date().toISOString();
    console.error("WhatsApp vinculado, al procesar un mensaje:", e.message);
  }
}, (messages) => erp.archive(messages), async (img) => {
  // Foto que llega al WhatsApp vinculado: puede ser un comprobante de transferencia. El servidor la
  // lee con IA y, si es un comprobante, queda en Pagos para registrarlo.
  let clientId = "";
  try { const r = await erp.findClientByPhone(img.from, img.group || ""); clientId = (r && (r.clientId || (r.client && r.client.id))) || ""; } catch (e) { /* sin vincular */ }
  await erp.receipt({ waId: img.waId, phone: img.from, chatId: img.group || img.from, isGroup: !!img.group, clientId, senderName: img.name, caption: img.caption, imageData: img.imageData });
});

async function handleMessage(msg, flowIn, waIn) {
  const inbox = flowIn || inboxFlow;
  const out = waIn || wa;
  const from = String(msg.from || "").replace(/[^\d]/g, "");
  const text = String(msg.text || "").trim();
  if (!text) return;

  // 0) Grupo de WhatsApp: solo cuenta si esta vinculado a un cliente; nunca se contesta en el grupo.
  if (msg.group) {
    let client = null;
    try {
      const r = await erp.findClientByPhone(from || "0", msg.group);
      client = r && r.client ? r.client : null;
    } catch (e) { console.warn("findClientByPhone (grupo):", e.message); return; }
    if (client && inbox.handleGroup) await inbox.handleGroup({ from, group: msg.group, groupName: msg.groupName || "", text, profileName: msg.name || "", client });
    return;
  }
  if (!from) return;

  // 1) Respuestas del equipo (confirmaciones "ok P37").
  if (config.notifyNumbers.includes(from) || from === config.ownerNumber) {
    const handled = await flow.handleTeamReply(from, text);
    if (handled) return;
    // mensajes del equipo que no son confirmacion: los ignoramos.
    return;
  }

  // 2) Buscar al cliente en el ERP por telefono.
  let client = null;
  try {
    const r = await erp.findClientByPhone(from);
    client = r && r.client ? r.client : null;
  } catch (e) {
    // Sin respuesta del sistema no se sabe si es cliente: no se le pregunta "de que negocio sos".
    console.warn("findClientByPhone:", e.message);
    await out.notifyTeam(`El sistema no respondio al buscar el numero ${from}. Mensaje: "${text}"`);
    return;
  }

  // 3) Todo va a la bandeja de WhatsApp del sistema (ver inboxFlow.js).
  if (client) await inbox.handleKnown({ from, text, profileName: msg.name || "", client });
  else await inbox.handleUnknown({ from, text, profileName: msg.name || "" });
}

app.listen(config.port, () => {
  console.log(`Pare Carrito WhatsApp bot escuchando en :${config.port}`);
  if (!config.whatsapp.token) console.warn("FALTA WHATSAPP_TOKEN");
  if (!config.openrouter.apiKey) console.warn("FALTA OPENROUTER_API_KEY");
  if (!config.erp.baseUrl) console.warn("FALTA ERP_BASE_URL");
});
