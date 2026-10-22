"use strict";

const crypto = require("crypto");
const { config } = require("./config");

const GRAPH = "https://graph.facebook.com";

// Envia un mensaje de texto a un numero (formato internacional sin +).
async function sendText(to, body) {
  if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) {
    console.log("[wa desactivado] Para:", to, "|", body);
    return false;
  }
  const url = `${GRAPH}/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + config.whatsapp.token
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: String(to).replace(/[^\d]/g, ""),
        type: "text",
        text: { body: String(body).slice(0, 4096) }
      })
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("WA send error", res.status, detail.slice(0, 300));
      return false;
    }
    return true;
  } catch (error) {
    console.error("WA send exception:", error.message);
    return false;
  }
}

// "Aviso al grupo": la Cloud API no postea en grupos, asi que avisamos a cada numero del equipo.
async function notifyTeam(body) {
  if (!config.notifyNumbers.length) {
    console.warn("NOTIFY_NUMBERS vacio: no hay a quien avisar.");
    return;
  }
  for (const number of config.notifyNumbers) {
    await sendText(number, body);
  }
}

async function notifyOwner(body) {
  if (!config.ownerNumber) {
    console.warn("OWNER_NUMBER vacio.");
    return;
  }
  await sendText(config.ownerNumber, body);
}

// Verificacion del webhook (GET) que hace Meta al configurarlo.
function verifyWebhook(query) {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode === "subscribe" && token === config.whatsapp.verifyToken) return challenge;
  return null;
}

// Valida la firma del payload (opcional, recomendado).
function validateSignature(rawBody, signatureHeader) {
  if (!config.whatsapp.appSecret) return true; // si no hay secreto configurado, no validamos
  if (!signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", config.whatsapp.appSecret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

// Extrae los mensajes entrantes del payload del webhook.
function extractIncomingMessages(payload) {
  const out = [];
  const entries = Array.isArray(payload && payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change.value || {};
      const contacts = value.contacts || [];
      const messages = value.messages || [];
      for (const msg of messages) {
        if (msg.type !== "text") continue; // por ahora solo texto
        const contact = contacts.find((c) => c.wa_id === msg.from) || contacts[0] || {};
        out.push({
          from: msg.from,
          name: (contact.profile && contact.profile.name) || "",
          text: (msg.text && msg.text.body) || "",
          id: msg.id,
          timestamp: Number(msg.timestamp || 0)
        });
      }
    }
  }
  return out;
}

// Envia una plantilla aprobada (para avisos fuera de la ventana de 24hs, ej. feriados).
async function sendTemplate(to, templateName, lang, bodyParams) {
  if (!config.whatsapp.token || !config.whatsapp.phoneNumberId) {
    console.log("[wa desactivado] plantilla", templateName, "->", to);
    module.exports.lastError = "Falta WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID en el servidor";
    return false;
  }
  const url = `${GRAPH}/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  // Meta rechaza (error 132018) los parametros con saltos de linea, tabs o mas de 4 espacios
  // seguidos: se pasan a una sola linea.
  const limpio = (t) => String(t == null ? "" : t).replace(/[\r\n\t]+/g, " · ").replace(/ {2,}/g, " ").trim().slice(0, 1000);
  const components = (bodyParams && bodyParams.length)
    ? [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: limpio(t) })) }]
    : [];
  module.exports.lastError = "";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + config.whatsapp.token },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: String(to).replace(/[^\d]/g, ""),
        type: "template",
        template: { name: templateName, language: { code: lang || "es" }, components }
      })
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("WA template error", res.status, detail.slice(0, 300));
      let msg = "HTTP " + res.status;
      try { const j = JSON.parse(detail); if (j && j.error) msg = (j.error.error_user_msg || j.error.message || msg) + (j.error.code ? " (codigo " + j.error.code + ")" : ""); } catch (e) { /* texto plano */ }
      module.exports.lastError = msg;
      return false;
    }
    return true;
  } catch (error) {
    console.error("WA template exception:", error.message);
    module.exports.lastError = error.message;
    return false;
  }
}

module.exports = { sendText, sendTemplate, notifyTeam, notifyOwner, verifyWebhook, validateSignature, extractIncomingMessages };
