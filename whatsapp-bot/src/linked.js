"use strict";

// WhatsApp vinculado como dispositivo (como WhatsApp Web, con codigo QR), para recibir pedidos en un
// numero comun mientras Meta no aprueba la API oficial. NO es oficial: WhatsApp puede bloquear el
// numero si detecta un bot, por eso solo se contesta a quien manda un pedido (ver inboxFlow.js) y
// con una pausa antes de cada respuesta.

const fs = require("fs");
const path = require("path");

const DIR = process.env.WA_LINKED_DIR || path.join(__dirname, "..", "data", "wa-linked");
const JIDS_FILE = path.join(path.dirname(DIR), "wa-linked-jids.json");
const ENABLED_FILE = path.join(path.dirname(DIR), "wa-linked-enabled");

const info = { status: "apagado", qr: "", qrAt: 0, me: "", connectedAt: "", lastError: "" };
let sock = null;
let connecting = false;
let onMessage = null;
let jids = {};
try { jids = JSON.parse(fs.readFileSync(JIDS_FILE, "utf8")) || {}; } catch (e) { jids = {}; }

// Contactos de la agenda del celular vinculado (nombre como esta guardado). Se usan solo cuando el
// gerente pide vincular telefonos a clientes; se guardan en el servidor propio para no perderlos al
// reiniciar el bot.
const CONTACTS_FILE = path.join(path.dirname(DIR), "wa-linked-contacts.json");
let contacts = {};
try { contacts = JSON.parse(fs.readFileSync(CONTACTS_FILE, "utf8")) || {}; } catch (e) { contacts = {}; }
let contactsTimer = null;
function addContacts(list) {
  let cambio = false;
  for (const c of list || []) {
    if (!c || !c.id) continue;
    const jid = String(c.id);
    if (!jid.endsWith("@s.whatsapp.net")) continue; // grupos, canales y contactos sin numero visible
    const phone = digits(jid);
    const name = String(c.name || c.verifiedName || "").trim();
    const notify = String(c.notify || "").trim();
    const prev = contacts[phone] || {};
    const next = { phone, name: name || prev.name || "", notify: notify || prev.notify || "" };
    if (!next.name && !next.notify) continue;
    if (prev.name !== next.name || prev.notify !== next.notify) { contacts[phone] = next; cambio = true; }
  }
  if (cambio) {
    clearTimeout(contactsTimer);
    contactsTimer = setTimeout(() => { try { fs.writeFileSync(CONTACTS_FILE, JSON.stringify(contacts)); } catch (e) { /* se recalcula */ } }, 2000);
  }
}

function listContacts() {
  return Object.values(contacts).filter((c) => c.name || c.notify);
}

const digits = (jid) => String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rememberJid(phone, jid) {
  if (!phone || !jid || jids[phone] === jid) return;
  jids[phone] = jid;
  try { fs.writeFileSync(JIDS_FILE, JSON.stringify(jids)); } catch (e) { /* se recalcula */ }
}

// ---- Archivo de todos los mensajes (respaldo) ----
// Se guardan chats individuales y grupos, recibidos y enviados desde el celular. No se envia nada
// por WhatsApp: solo se copian al servidor propio, en tandas.
let archiveSink = null;
let archiveQueue = [];
let archiveTimer = null;
const groupNames = {};

function messageKind(m) {
  const msg = m && m.message ? m.message : {};
  const inner = msg.ephemeralMessage ? msg.ephemeralMessage.message || {} : msg.viewOnceMessage ? msg.viewOnceMessage.message || {} : msg;
  const tipos = { imageMessage: "imagen", videoMessage: "video", audioMessage: "audio", documentMessage: "documento", stickerMessage: "sticker", locationMessage: "ubicacion", contactMessage: "contacto", pollCreationMessage: "encuesta", reactionMessage: "reaccion" };
  for (const k of Object.keys(tipos)) if (inner[k]) {
    const caption = (inner[k].caption || inner[k].fileName || (k === "reactionMessage" ? inner[k].text : "") || "").trim();
    return { type: tipos[k], text: "[" + tipos[k] + "]" + (caption ? " " + caption : "") };
  }
  const text = String(inner.conversation || (inner.extendedTextMessage && inner.extendedTextMessage.text) || "").trim();
  return text ? { type: "texto", text } : null;
}

async function groupName(jid) {
  if (groupNames[jid] !== undefined) return groupNames[jid];
  groupNames[jid] = "";
  try { const md = sock ? await sock.groupMetadata(jid) : null; groupNames[jid] = (md && md.subject) || ""; } catch (e) { /* sin nombre */ }
  return groupNames[jid];
}

async function archiveMessage(m) {
  if (!archiveSink) return;
  const key = m && m.key || {};
  const jid = String(key.remoteJid || "");
  if (!jid || jid === "status@broadcast" || /@(broadcast|newsletter)$/.test(jid)) return;
  const kind = messageKind(m);
  if (!kind) return;
  const isGroup = jid.endsWith("@g.us");
  const senderJid = isGroup ? key.participant || "" : key.fromMe ? "" : jid;
  const chatPhone = isGroup ? jid : digits(jid.endsWith("@lid") ? key.senderPn || key.remoteJidAlt || jid : jid);
  const contacto = !isGroup ? contacts[chatPhone] : null;
  const ts = Number(m.messageTimestamp && m.messageTimestamp.low != null ? m.messageTimestamp.low : m.messageTimestamp || 0) * 1000 || Date.now();
  archiveQueue.push({
    waId: key.id || String(ts), chatId: chatPhone, isGroup, fromMe: !!key.fromMe, type: kind.type, text: kind.text, ts,
    chatName: isGroup ? await groupName(jid) : (contacto && (contacto.name || contacto.notify)) || (!key.fromMe ? m.pushName || "" : ""),
    senderPhone: digits(senderJid), senderName: key.fromMe ? "" : m.pushName || ""
  });
  if (archiveQueue.length >= 200) flushArchive();
  else if (!archiveTimer) archiveTimer = setTimeout(flushArchive, 5000);
}

async function flushArchive() {
  clearTimeout(archiveTimer);
  archiveTimer = null;
  if (!archiveQueue.length || !archiveSink) return;
  const lote = archiveQueue.splice(0, 500);
  try { await archiveSink(lote); } catch (e) {
    // Si el servidor no responde se reintenta (hasta 5000 pendientes, para no llenar la memoria).
    archiveQueue = lote.concat(archiveQueue).slice(0, 5000);
    archiveTimer = setTimeout(flushArchive, 30000);
  }
}

function messageText(m) {
  const msg = m && m.message ? m.message : {};
  const inner = msg.ephemeralMessage ? msg.ephemeralMessage.message || {} : msg;
  return String(inner.conversation || (inner.extendedTextMessage && inner.extendedTextMessage.text) || (inner.imageMessage && inner.imageMessage.caption) || "").trim();
}

async function connect() {
  if (sock || connecting) return;
  connecting = true;
  try {
    const B = await import("@whiskeysockets/baileys");
    const makeWASocket = B.default;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = B;
    const QRCode = require("qrcode");
    fs.mkdirSync(DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(DIR);
    let version;
    try { version = (await fetchLatestBaileysVersion()).version; } catch (e) { /* la que trae la libreria */ }
    const logger = (await import("pino")).default({ level: "silent" });
    info.status = "conectando";
    sock = makeWASocket({ auth: state, version, logger, browser: ["Pare Carrito", "Chrome", "1.0"], markOnlineOnConnect: false, syncFullHistory: false });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async (u) => {
      if (u.qr) {
        info.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 280 });
        info.qrAt = Date.now();
        info.status = "esperando_qr";
      }
      if (u.connection === "open") {
        info.status = "conectado";
        info.qr = "";
        info.me = digits(sock.user && sock.user.id);
        info.connectedAt = new Date().toISOString();
        info.lastError = "";
        console.log("WhatsApp vinculado: conectado como ..." + info.me.slice(-4));
      }
      if (u.connection === "close") {
        const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output ? u.lastDisconnect.error.output.statusCode : 0;
        sock = null;
        if (code === DisconnectReason.loggedOut) {
          // Lo desvincularon desde el celular: se borra la sesion y queda apagado.
          info.status = "desvinculado";
          info.qr = "";
          fs.rmSync(DIR, { recursive: true, force: true });
          try { fs.unlinkSync(ENABLED_FILE); } catch (e) { /* ya no estaba */ }
          console.warn("WhatsApp vinculado: se desvinculo desde el celular.");
        } else if (fs.existsSync(ENABLED_FILE)) {
          info.status = "reconectando";
          info.lastError = String(code || (u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.message) || "");
          setTimeout(() => connect().catch(() => {}), 5000);
        } else info.status = "apagado";
      }
    });
    sock.ev.on("contacts.upsert", (list) => addContacts(list));
    sock.ev.on("contacts.update", (list) => addContacts(list));
    sock.ev.on("messaging-history.set", (h) => {
      addContacts(h && h.contacts);
      // Historial que manda WhatsApp al vincular: tambien al archivo (lo de mas de 90 dias se descarta).
      (h && h.messages || []).forEach((m) => archiveMessage(m).catch(() => {}));
    });
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      for (const m of messages || []) archiveMessage(m).catch(() => {});
      if (type !== "notify") return;
      for (const m of messages || []) {
        try {
          const key = m.key || {};
          const jid = String(key.remoteJid || "");
          // Solo chats con personas: ni grupos, ni estados, ni canales, ni lo que manda el propio celular.
          if (key.fromMe || !jid || /@(g\.us|broadcast|newsletter)$/.test(jid) || jid === "status@broadcast") continue;
          const text = messageText(m);
          if (!text) continue;
          // Contactos con identificador oculto (@lid): se usa el numero si WhatsApp lo manda.
          const phoneJid = jid.endsWith("@lid") ? key.senderPn || key.remoteJidAlt || jid : jid;
          const phone = digits(phoneJid);
          rememberJid(phone, jid);
          if (onMessage) await onMessage({ from: phone, name: m.pushName || "", text, id: key.id });
        } catch (e) {
          console.error("WhatsApp vinculado, mensaje:", e.message);
        }
      }
    });
  } catch (e) {
    sock = null;
    info.status = "error";
    info.lastError = e.message;
    console.error("WhatsApp vinculado: no se pudo iniciar:", e.message);
  } finally {
    connecting = false;
  }
}

// Arranca solo si ya estaba vinculado (se reinicia el bot y sigue conectado).
function init(handler, archiver) {
  onMessage = handler;
  archiveSink = archiver || null;
  if (fs.existsSync(ENABLED_FILE)) connect().catch(() => {});
}

async function startLinking() {
  fs.mkdirSync(path.dirname(DIR), { recursive: true });
  fs.writeFileSync(ENABLED_FILE, new Date().toISOString());
  await connect();
  return status();
}

async function stop() {
  try { fs.unlinkSync(ENABLED_FILE); } catch (e) { /* ya no estaba */ }
  const s = sock;
  sock = null;
  if (s) { try { await s.logout(); } catch (e) { try { s.end(); } catch (e2) { /* cerrado */ } } }
  fs.rmSync(DIR, { recursive: true, force: true });
  // Al desvincular se borran tambien los contactos del celular.
  contacts = {};
  try { fs.unlinkSync(CONTACTS_FILE); } catch (e) { /* no habia */ }
  Object.assign(info, { status: "apagado", qr: "", me: "", connectedAt: "" });
  return status();
}

function status() {
  return { status: info.status, qr: info.status === "esperando_qr" ? info.qr : "", me: info.me, connectedAt: info.connectedAt, lastError: info.lastError };
}

function isConnected() {
  return !!sock && info.status === "conectado";
}

// Respuesta con una pausa corta (2 a 5 s), como una persona: baja el riesgo de bloqueo.
async function sendText(phone, text) {
  if (!isConnected()) { console.warn("WhatsApp vinculado: no conectado, no se envio a ..." + String(phone).slice(-4)); return false; }
  const jid = jids[String(phone)] || String(phone).replace(/\D/g, "") + "@s.whatsapp.net";
  await sleep(2000 + Math.floor(Math.random() * 3000));
  try {
    await sock.sendMessage(jid, { text: String(text) });
    return true;
  } catch (e) {
    console.error("WhatsApp vinculado, envio:", e.message);
    return false;
  }
}

module.exports = { init, startLinking, stop, status, isConnected, sendText, addContacts, listContacts, archiveMessage, flushArchive };
