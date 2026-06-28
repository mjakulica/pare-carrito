"use strict";

const express = require("express");
const { config } = require("./config");
const wa = require("./whatsapp");
const ai = require("./ai");
const erp = require("./erp");
const flow = require("./orderFlow");

const app = express();
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
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

app.get("/health", (_req, res) => res.json({ ok: true }));

// Envio masivo por plantilla (lo llama el ERP, ej. aviso de feriado). Auth por clave compartida.
app.post("/broadcast", async (req, res) => {
  const broadcastKey = process.env.BROADCAST_KEY || "";
  if (!broadcastKey || req.get("x-broadcast-key") !== broadcastKey) return res.sendStatus(401);
  const { numbers, templateName, lang, params } = req.body || {};
  if (!Array.isArray(numbers) || !templateName) return res.status(400).json({ error: "Se espera { numbers, templateName }." });
  let sent = 0;
  let failed = 0;
  for (const n of numbers) {
    const ok = await wa.sendTemplate(n, templateName, lang, params || []);
    if (ok) sent += 1; else failed += 1;
  }
  res.json({ ok: true, sent, failed });
});

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

async function handleMessage(msg) {
  const from = String(msg.from || "").replace(/[^\d]/g, "");
  const text = String(msg.text || "").trim();
  if (!from || !text) return;

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
    console.warn("findClientByPhone:", e.message);
  }

  if (!client) {
    await wa.notifyOwner(`Mensaje de un numero no reconocido (${from}):\n"${text}"`);
    await wa.sendText(from, "Hola! No tengo tu numero asociado a una cuenta. Avise a administracion para activarte y empezar a hacer pedidos.");
    return;
  }

  // 3) Clasificar la intencion.
  const names = await getProductNames();
  const parsed = await ai.classifyMessage(text, names);
  const ctx = { clientPhone: from, clientName: client.name || msg.name || "cliente", clientId: client.id, text };

  if (parsed.intent === "saludo") {
    await wa.sendText(from, `Hola ${ctx.clientName}! Pasame tu pedido cuando quieras.`);
    return;
  }
  if (parsed.intent === "consulta") {
    await flow.handleConsulta(ctx);
    return;
  }
  if (parsed.intent === "pedido_nuevo") {
    await flow.handleNewOrder({ ...ctx, items: parsed.items });
    return;
  }
  if (parsed.intent === "agregar" || parsed.intent === "cancelar") {
    let order = null;
    try {
      const r = await erp.getTodayOrder(client.id);
      order = r && r.order ? r.order : null;
    } catch (e) {
      console.warn("getTodayOrder:", e.message);
    }
    if (parsed.intent === "agregar") await flow.handleAdd({ ...ctx, order, items: parsed.items });
    else await flow.handleCancel({ ...ctx, order, items: parsed.items });
    return;
  }
  // fallback
  await flow.handleConsulta(ctx);
}

app.listen(config.port, () => {
  console.log(`Pare Carrito WhatsApp bot escuchando en :${config.port}`);
  if (!config.whatsapp.token) console.warn("FALTA WHATSAPP_TOKEN");
  if (!config.openrouter.apiKey) console.warn("FALTA OPENROUTER_API_KEY");
  if (!config.erp.baseUrl) console.warn("FALTA ERP_BASE_URL");
});
