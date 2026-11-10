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
// "Solo recibir": el sistema no manda NINGUN mensaje por este WhatsApp (menor riesgo de bloqueo). Los
// pedidos igual entran a la bandeja y todo se archiva. Prendido salvo que el gerente lo apague.
const SENDING_FILE = path.join(path.dirname(DIR), "wa-linked-send-enabled");
// "Buscar comprobantes viejos": al volver a vincular, WhatsApp manda el historial con las fotos. Si
// esta prendido, las fotos y PDF de los ultimos N dias se bajan y se mandan a leer (de a una).
const HISTORY_FILE = path.join(path.dirname(DIR), "wa-history-receipts.json");
let historyCfg = null;
try { historyCfg = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")); } catch (e) { historyCfg = null; }
const historyStats = { encolados: 0, procesados: 0, errores: 0, ultimoError: "" };
let historyQueue = [];
let historyRunning = false;
function setHistoryReceipts(days) {
  fs.mkdirSync(path.dirname(DIR), { recursive: true });
  if (!days) { historyCfg = null; try { fs.unlinkSync(HISTORY_FILE); } catch (e) { /* ya estaba */ } return historyStatus(); }
  historyCfg = { desde: Date.now() - Number(days) * 86400000, hasta: Date.now(), dias: Number(days), armadoAt: new Date().toISOString() };
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyCfg));
  Object.assign(historyStats, { encolados: 0, procesados: 0, errores: 0, ultimoError: "" });
  return historyStatus();
}
function historyStatus() {
  return { activo: !!historyCfg, dias: historyCfg ? historyCfg.dias : 0, armadoAt: historyCfg ? historyCfg.armadoAt : "", pendientes: historyQueue.length, ...historyStats };
}
function queueHistoryImage(m) {
  if (!historyCfg || !onImage) return;
  const key = m && m.key || {};
  const jid = String(key.remoteJid || "");
  if (key.fromMe || !jid || /@(broadcast|newsletter)$/.test(jid)) return;
  const ts = Number(m.messageTimestamp && m.messageTimestamp.low != null ? m.messageTimestamp.low : m.messageTimestamp || 0) * 1000;
  if (!ts || ts < historyCfg.desde || ts > historyCfg.hasta) return;
  const msg = m.message || {};
  const inner = msg.ephemeralMessage ? msg.ephemeralMessage.message || {} : msg.viewOnceMessage ? msg.viewOnceMessage.message || {} : msg;
  const doc = inner.documentMessage || (inner.documentWithCaptionMessage && inner.documentWithCaptionMessage.message && inner.documentWithCaptionMessage.message.documentMessage);
  if (!inner.imageMessage && !(doc && /^(image\/|application\/pdf)/.test(doc.mimetype || ""))) return;
  historyQueue.push(m);
  historyStats.encolados += 1;
  if (!historyRunning) runHistoryQueue();
}
async function runHistoryQueue() {
  historyRunning = true;
  while (historyQueue.length) {
    const m = historyQueue.shift();
    try {
      const key = m.key || {};
      await handleImage(m, String(key.remoteJid || ""), key, { historico: true });
      historyStats.procesados += 1;
    } catch (e) {
      historyStats.errores += 1;
      historyStats.ultimoError = e.message;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  historyRunning = false;
}

function receiveOnly() {
  return !fs.existsSync(SENDING_FILE);
}

function setReceiveOnly(value) {
  fs.mkdirSync(path.dirname(DIR), { recursive: true });
  if (value) { try { fs.unlinkSync(SENDING_FILE); } catch (e) { /* ya estaba */ } }
  else fs.writeFileSync(SENDING_FILE, new Date().toISOString());
  console.log("WhatsApp vinculado: solo recibir " + (value ? "PRENDIDO" : "apagado (puede contestar)") + ".");
  return status();
}

const info = { status: "apagado", qr: "", qrAt: 0, me: "", connectedAt: "", lastError: "" };
let sock = null;
let connecting = false;
let onMessage = null;
let onImage = null;
let Baileys = null;
let jids = {};
try { jids = JSON.parse(fs.readFileSync(JIDS_FILE, "utf8")) || {}; } catch (e) { jids = {}; }

// Contactos de la agenda del celular vinculado (nombre como esta guardado). Se usan solo cuando el
// gerente pide vincular telefonos a clientes; se guardan en el servidor propio para no perderlos al
// reiniciar el bot.
const CONTACTS_FILE = path.join(path.dirname(DIR), "wa-linked-contacts.json");
let contacts = {};
try { contacts = JSON.parse(fs.readFileSync(CONTACTS_FILE, "utf8")) || {}; } catch (e) { contacts = {}; }
let contactsTimer = null;
// WhatsApp a veces oculta el numero de un contacto detras de un identificador (@lid). Cuando el contacto
// o un mensaje traen las dos cosas, se guarda la equivalencia para usar el numero real.
const LIDS_FILE = path.join(path.dirname(DIR), "wa-linked-lids.json");
let lids = {};
try { lids = JSON.parse(fs.readFileSync(LIDS_FILE, "utf8")) || {}; } catch (e) { lids = {}; }
let lidsTimer = null;
function rememberLid(lidJid, phoneJid) {
  const l = digits(lidJid), ph = digits(phoneJid);
  if (!l || !ph || !String(phoneJid).endsWith("@s.whatsapp.net") || lids[l] === ph) return;
  lids[l] = ph;
  clearTimeout(lidsTimer);
  lidsTimer = setTimeout(() => { try { fs.writeFileSync(LIDS_FILE, JSON.stringify(lids)); } catch (e) { /* se recalcula */ } }, 2000);
}

// Numero real de un chat: si es un @lid, el que manda el mensaje o el de la tabla de equivalencias.
function phoneOf(jid, key) {
  const j = String(jid || "");
  if (!j.endsWith("@lid")) return digits(j);
  const alt = key && (key.senderPn || key.remoteJidAlt || key.participantPn || key.participantAlt);
  if (alt && String(alt).endsWith("@s.whatsapp.net")) { rememberLid(j, alt); return digits(alt); }
  return lids[digits(j)] || digits(j);
}

function addContacts(list) {
  let cambio = false;
  for (const c of list || []) {
    if (!c || !c.id) continue;
    const id = String(c.id);
    const phoneJid = id.endsWith("@s.whatsapp.net") ? id : c.jid && String(c.jid).endsWith("@s.whatsapp.net") ? String(c.jid) : "";
    const lidJid = id.endsWith("@lid") ? id : c.lid ? String(c.lid) : "";
    if (phoneJid && lidJid) rememberLid(lidJid, phoneJid);
    if (!phoneJid) continue; // grupos, canales y contactos sin numero visible
    const phone = digits(phoneJid);
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

function listLids() {
  return Object.keys(lids).map((lid) => ({ lid, phone: lids[lid] }));
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
  const chatPhone = isGroup ? jid : phoneOf(jid, key);
  const contacto = !isGroup ? contacts[chatPhone] : null;
  const ts = Number(m.messageTimestamp && m.messageTimestamp.low != null ? m.messageTimestamp.low : m.messageTimestamp || 0) * 1000 || Date.now();
  archiveQueue.push({
    waId: key.id || String(ts), chatId: chatPhone, isGroup, fromMe: !!key.fromMe, type: kind.type, text: kind.text, ts,
    chatName: isGroup ? await groupName(jid) : (contacto && (contacto.name || contacto.notify)) || (!key.fromMe ? m.pushName || "" : ""),
    senderPhone: phoneOf(senderJid, { senderPn: key.participantPn || key.participantAlt }), senderName: key.fromMe ? "" : m.pushName || ""
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
    Baileys = B;
    const makeWASocket = B.default;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = B;
    const QRCode = require("qrcode");
    fs.mkdirSync(DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(DIR);
    let version;
    try { version = (await fetchLatestBaileysVersion()).version; } catch (e) { /* la que trae la libreria */ }
    const logger = (await import("pino")).default({ level: "silent" });
    info.status = "conectando";
    // Se pide el historial completo al vincular (archivo de 90 dias y comprobar alias de 30 dias).
    // Ojo: presentarse como "Mac OS Desktop" junto con syncFullHistory hace que WhatsApp corte la
    // conexion (error 428) antes de dar el QR; como Chrome funciona.
    sock = makeWASocket({ auth: state, version, logger, browser: B.Browsers ? B.Browsers.ubuntu("Chrome") : ["Pare Carrito", "Chrome", "1.0"], markOnlineOnConnect: false, syncFullHistory: true });
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
      (h && h.messages || []).forEach((m) => { archiveMessage(m).catch(() => {}); queueHistoryImage(m); });
    });
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      for (const m of messages || []) archiveMessage(m).catch(() => {});
      if (type !== "notify") return;
      for (const m of messages || []) {
        try {
          const key = m.key || {};
          const jid = String(key.remoteJid || "");
          // Chats con personas y grupos: ni estados, ni canales, ni lo que manda el propio celular.
          if (key.fromMe || !jid || /@(broadcast|newsletter)$/.test(jid) || jid === "status@broadcast") continue;
          // Fotos (comprobantes de transferencia): se bajan y se mandan al servidor para leerlas.
          if (onImage) handleImage(m, jid, key).catch((e) => console.error("WhatsApp vinculado, imagen:", e.message));
          const text = messageText(m);
          if (!text) continue;
          if (jid.endsWith("@g.us")) {
            // Grupo: si esta vinculado a un cliente, lo que se escribe es de ese cliente.
            const sender = phoneOf(key.participant || "", { senderPn: key.participantPn || key.participantAlt });
            if (onMessage) await onMessage({ from: sender, group: jid, groupName: await groupName(jid), name: m.pushName || "", text, id: key.id });
            continue;
          }
          // Contactos con identificador oculto (@lid): se usa el numero si WhatsApp lo manda.
          const phone = phoneOf(jid, key);
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

// Imagen o PDF recibido (foto, documento de imagen o comprobante en PDF): se baja y se pasa a onImage
// con el chat y quien lo manda. Hasta 6 MB. El servidor pasa el PDF a imagen para la IA.
async function handleImage(m, jid, key, extra) {
  const msg = m && m.message ? m.message : {};
  const inner = msg.ephemeralMessage ? msg.ephemeralMessage.message || {} : msg.viewOnceMessage ? msg.viewOnceMessage.message || {} : msg;
  const doc = inner.documentMessage || (inner.documentWithCaptionMessage && inner.documentWithCaptionMessage.message && inner.documentWithCaptionMessage.message.documentMessage) || null;
  const media = inner.imageMessage || (doc && /^(image\/|application\/pdf)/.test(doc.mimetype || "") ? doc : null);
  if (!media || !Baileys || !sock) return;
  const esPdf = /pdf/.test(media.mimetype || "");
  const size = Number(media.fileLength && media.fileLength.low != null ? media.fileLength.low : media.fileLength || 0);
  if (size > 6 * 1024 * 1024) return;
  const logger = (await import("pino")).default({ level: "silent" });
  const buf = await Baileys.downloadMediaMessage(m, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
  if (!buf || !buf.length) return;
  const mime = /png/.test(media.mimetype || "") ? "image/png" : /webp/.test(media.mimetype || "") ? "image/webp" : "image/jpeg";
  const isGroup = jid.endsWith("@g.us");
  const from = isGroup ? phoneOf(key.participant || "", { senderPn: key.participantPn || key.participantAlt }) : phoneOf(jid, key);
  const archivo = esPdf ? { pdfData: "data:application/pdf;base64," + buf.toString("base64") } : { imageData: "data:" + mime + ";base64," + buf.toString("base64") };
  const ts = Number(m.messageTimestamp && m.messageTimestamp.low != null ? m.messageTimestamp.low : m.messageTimestamp || 0) * 1000 || Date.now();
  await onImage({ ...(extra || {}), ts, waId: key.id, from, group: isGroup ? jid : "", name: m.pushName || "", caption: String(media.caption || media.fileName || "").trim(), ...archivo });
}

// Arranca solo si ya estaba vinculado (se reinicia el bot y sigue conectado).
function init(handler, archiver, imageHandler) {
  onMessage = handler;
  archiveSink = archiver || null;
  onImage = imageHandler || null;
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
  lids = {};
  try { fs.unlinkSync(CONTACTS_FILE); } catch (e) { /* no habia */ }
  try { fs.unlinkSync(LIDS_FILE); } catch (e) { /* no habia */ }
  Object.assign(info, { status: "apagado", qr: "", me: "", connectedAt: "" });
  return status();
}

function status() {
  return { status: info.status, qr: info.status === "esperando_qr" ? info.qr : "", me: info.me, connectedAt: info.connectedAt, lastError: info.lastError, receiveOnly: receiveOnly() };
}

function isConnected() {
  return !!sock && info.status === "conectado";
}

// Respuesta con una pausa corta (2 a 5 s), como una persona: baja el riesgo de bloqueo.
// opts.manual: lo escribe una persona desde el sistema (Mensajes de WhatsApp); se manda aunque el bot
// este en "solo recibir", que apaga solo las respuestas automaticas. Devuelve el id del mensaje.
// phone puede ser un grupo ("...@g.us").
async function sendText(phone, text, opts) {
  const manual = !!(opts && opts.manual);
  // opts.notice: aviso del sistema que el gerente eligio mandar por aca (cambio de pedido, feriado...):
  // sale aunque este en "solo recibir", con la pausa de siempre.
  const notice = !!(opts && opts.notice);
  if (!manual && !notice && receiveOnly()) { console.log("WhatsApp vinculado (solo recibir): no se envio a ..." + String(phone).slice(-4)); return false; }
  if (!isConnected()) { console.warn("WhatsApp vinculado: no conectado, no se envio a ..." + String(phone).slice(-4)); return false; }
  const jid = String(phone).endsWith("@g.us") ? String(phone) : jids[String(phone)] || String(phone).replace(/\D/g, "") + "@s.whatsapp.net";
  if (!manual) await sleep(2000 + Math.floor(Math.random() * 3000));
  try {
    const sent = await sock.sendMessage(jid, { text: String(text) });
    return manual ? { id: (sent && sent.key && sent.key.id) || "" } : true;
  } catch (e) {
    console.error("WhatsApp vinculado, envio:", e.message);
    return false;
  }
}

module.exports = { setHistoryReceipts, historyStatus, listLids, phoneOf, init, startLinking, stop, status, isConnected, sendText, addContacts, listContacts, archiveMessage, flushArchive, receiveOnly, setReceiveOnly };
