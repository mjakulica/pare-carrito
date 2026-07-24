// Pare Carrito SAS - API autoalojada (Node.js + Express + PostgreSQL)
// Usuarios reales con bcrypt, JWT, permisos por endpoint, espejo relacional
// para reportes pesados en SQL y exportaciones masivas.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { billingConfig, nowArt, computeDueInvoices, runBilling, regeneratePdf } = require("./billing");
const { syncSheetsFromStateDiff, pushPrecio } = require("./sheetsSync");

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL || "postgres://parecarrito:parecarrito@localhost:5432/parecarrito";
const JWT_SECRET = process.env.JWT_SECRET || "";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "12h";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "gerente";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "gerente123";
const STATE_HISTORY_KEEP = Number(process.env.STATE_HISTORY_KEEP || 200);
const MOONSHOT_API_KEY = process.env.MOONSHOT_API_KEY || "";
const MOONSHOT_API_URL = (process.env.MOONSHOT_API_URL || "https://api.moonshot.ai/v1/chat/completions").trim();
const MOONSHOT_MODEL = process.env.MOONSHOT_MODEL || "kimi-k2.7";
const MOONSHOT_VISION_MODEL = process.env.MOONSHOT_VISION_MODEL || "moonshot-v1-32k-vision-preview";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_API_URL = (process.env.OPENROUTER_API_URL || "https://openrouter.ai/api/v1/chat/completions").trim();
const OPENROUTER_VISION_MODEL = process.env.OPENROUTER_VISION_MODEL || "openai/gpt-4o-mini";

if (!JWT_SECRET) {
  console.error("FALTA JWT_SECRET en las variables de entorno. Genere uno con: openssl rand -hex 32");
  process.exit(1);
}

const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");

let mailTransport = null;
function getMailTransport() {
  if (mailTransport !== null) return mailTransport;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    mailTransport = false;
    return mailTransport;
  }
  try {
    const nodemailer = require("nodemailer");
    mailTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  } catch {
    mailTransport = false;
  }
  return mailTransport;
}

function whatsappOff(settings) {
  return !!process.env.WHATSAPP_DISABLED || (settings && settings.whatsappEnabled === false);
}
async function sendMail(to, subject, html, attachments) {
  if (process.env.MAILING_DISABLED) {
    console.log("[mail deshabilitado por MAILING_DISABLED] Para:", to, "| Asunto:", subject);
    return false;
  }
  const transport = getMailTransport();
  if (!transport) {
    console.log("[mail desactivado] Para:", to, "| Asunto:", subject, attachments && attachments.length ? "| Adjuntos: " + attachments.length : "");
    return false;
  }
  try {
    const message = { from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html };
    if (Array.isArray(attachments) && attachments.length) message.attachments = attachments;
    await transport.sendMail(message);
    return true;
  } catch (error) {
    console.error("Error enviando mail a", to, ":", error.message);
    return false;
  }
}

function billingMoney(value) {
  return "$" + Number(value || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildBillingDetailPdf(client, entry, orders) {
  return new Promise((resolve, reject) => {
    let PDFDocument;
    try {
      PDFDocument = require("pdfkit");
    } catch (e) {
      return reject(new Error("pdfkit no instalado: " + e.message));
    }
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text("Pare Carrito SAS", { align: "left" });
    doc.fontSize(12).fillColor("#444").text("Detalle de pedidos facturados");
    doc.moveDown(0.4).fillColor("#000").fontSize(10);
    doc.text(`${client.id || ""} - ${client.name || ""}${client.legalName ? " - " + client.legalName : ""}`);
    if (client.cuit) doc.text("CUIT: " + client.cuit);
    doc.text(`Periodo: ${entry.from} a ${entry.to}  (${orders.length} pedidos)`);
    if (entry.numero) doc.text("Comprobante: " + entry.numero + (entry.cae ? "  CAE " + entry.cae : ""));
    doc.moveDown(0.6);

    orders.forEach((order) => {
      const orderTotal = Number(order.totalAmount || 0);
      const orderIva = Number(order.ivaAmount || 0);
      doc.fontSize(10).fillColor("#17228a").text(`${order.date}  -  Pedido ${order.id}`);
      doc.fillColor("#000").fontSize(9);
      (order.items || []).forEach((item) => {
        const qty = Number(item.quantity || 0);
        const imp = Number(item.totalWithIva != null ? item.totalWithIva : (item.subtotal || 0));
        const name = item.productName + (item.note ? " (" + item.note + ")" : "");
        doc.text(`    ${name}   x${qty}   ${billingMoney(item.unitPrice)}   =   ${billingMoney(imp)}`);
      });
      doc.fillColor("#444").text(`    Total pedido: ${billingMoney(orderTotal)}   (IVA ${billingMoney(orderIva)})`, { align: "right" });
      doc.fillColor("#000").moveDown(0.4);
    });

    doc.moveDown(0.4);
    doc.fontSize(11).text(`Neto: ${billingMoney(entry.neto)}     IVA: ${billingMoney(entry.iva)}     Total: ${billingMoney(entry.total)}`, { align: "right" });
    doc.end();
  });
}

async function fetchPdfAttachment(url, filename) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    return { filename, content: Buffer.from(ab), contentType: "application/pdf" };
  } catch (e) {
    console.warn("No se pudo descargar la factura PDF:", e.message);
    return null;
  }
}

async function emailBillingResults(results) {
  try { const r = await pool.query("SELECT data->'appSettings'->>'mailingEnabled' AS m FROM app_state WHERE id = 'main'"); if (r.rows[0] && r.rows[0].m === "false") { console.log("[mail] facturacion desactivada por configuracion"); return; } } catch (e) { /* ignore */ }
  const entries = (results || []).filter((e) => e && e.status === "ok" && String(e.freq || "") !== "diaria" && e.email);
  if (!entries.length) return;
  const stateRow = await pool.query("SELECT data FROM app_state WHERE id = 'main'");
  const data = stateRow.rows.length ? stateRow.rows[0].data : { clients: [], orders: [] };
  const clientsById = {};
  (data.clients || []).forEach((c) => { clientsById[c.id] = c; });
  const ordersById = {};
  (data.orders || []).forEach((o) => { ordersById[o.id] = o; });
  for (const entry of entries) {
    try {
      const client = clientsById[entry.clientId] || { id: entry.clientId, name: entry.clientName };
      const orders = (entry.orderIds || []).map((id) => ordersById[id]).filter(Boolean);
      const attachments = [];
      try {
        const pdf = await buildBillingDetailPdf(client, entry, orders);
        attachments.push({ filename: `detalle-${entry.clientId}-${entry.from}_${entry.to}.pdf`, content: pdf, contentType: "application/pdf" });
      } catch (e) {
        console.error("No se pudo generar el PDF de detalle:", e.message);
      }
      const facturaUrls = entry.pdf
        ? [entry.pdf]
        : (Array.isArray(entry.partials) ? entry.partials.map((p) => p.pdf).filter(Boolean) : []);
      for (let i = 0; i < facturaUrls.length; i += 1) {
        const att = await fetchPdfAttachment(facturaUrls[i], `factura-${entry.numero || entry.clientId}-${i + 1}.pdf`);
        if (att) attachments.push(att);
      }
      const html = `<p>Hola,</p>
        <p>Adjuntamos el detalle de los pedidos facturados del período <strong>${entry.from}</strong> a <strong>${entry.to}</strong> (${(entry.orderIds || []).length} pedidos) junto con la factura correspondiente.</p>
        <p>Total: <strong>${billingMoney(entry.total)}</strong> (IVA ${billingMoney(entry.iva)}).</p>
        ${facturaUrls.length ? `<p>Factura: <a href="${facturaUrls[0]}">ver PDF</a></p>` : ""}
        <p>Pare Carrito SAS</p>`;
      await sendMail(entry.email, `Factura y detalle de pedidos ${entry.from} - ${entry.to}`, html, attachments);
    } catch (e) {
      console.error("Fallo el envío de detalle de facturación a", entry.email, ":", e.message);
    }
  }
}

const pool = new Pool({ connectionString: DATABASE_URL });
const app = express();
app.use(express.json({ limit: "80mb" }));
app.disable("x-powered-by");

// ---------- CORS ----------
app.use((req, res, next) => {
  res.set("access-control-allow-origin", ALLOWED_ORIGIN);
  res.set("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.set("access-control-allow-headers", "content-type,authorization,x-file-name");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// ---------- Autenticacion / permisos ----------
function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function authenticate(req, res, next) {
  const header = String(req.headers.authorization || "");
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Falta el token. Inicie sesión en /auth/login." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o vencido. Vuelva a iniciar sesión." });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Permisos insuficientes para esta operación (requiere: " + roles.join(", ") + ")." });
    }
    next();
  };
}

function parseImageDataUrl(value) {
  const text = String(value || "");
  const match = text.match(/^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const normalized = match[2].replace(/\s/g, "");
  return {
    mimeType: match[1].toLowerCase(),
    base64: normalized,
    byteLength: Buffer.byteLength(normalized, "base64"),
    dataUrl: "data:" + match[1].toLowerCase() + ";base64," + normalized
  };
}

function sanitizeExternalApiError(detail) {
  const text = String(detail || "").trim();
  if (!text) return "";
  if (/insufficient balance|recharge|billing|suspended/i.test(text)) {
    return "la cuenta no tiene saldo o el plan esta suspendido; revise la facturacion de Moonshot/Kimi.";
  }
  if (/model/i.test(text) && /not|invalid|support|exist|found/i.test(text)) {
    return "el modelo configurado no esta disponible para OCR de imagen.";
  }
  if (/unauthorized|invalid api key|authentication|auth/i.test(text)) {
    return "la API key no fue aceptada por Moonshot/Kimi.";
  }
  if (/rate limit|too many requests/i.test(text)) {
    return "se alcanzo el limite temporal de uso de la API.";
  }
  return text
    .replace(/sk-[A-Za-z0-9._-]+/g, "[redactado]")
    .replace(/ak-[A-Za-z0-9._-]+/g, "[redactado]")
    .replace(/org-[A-Za-z0-9._-]+/g, "[redactado]")
    .slice(0, 240);
}

// ---------- Rutas publicas ----------
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, app: "Pare Carrito SAS", db: "ok", time: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, db: "error", detail: error.message });
  }
});

const loginAttempts = new Map(); // clave: usuario|ip -> { count, blockedUntil }
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

function loginAttemptKey(req, username) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  return String(username).toLowerCase() + "|" + ip;
}

app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Envíe usuario y contraseña." });
  const attemptKey = loginAttemptKey(req, username);
  const attempt = loginAttempts.get(attemptKey);
  if (attempt && attempt.blockedUntil && attempt.blockedUntil > Date.now()) {
    const minutes = Math.ceil((attempt.blockedUntil - Date.now()) / 60000);
    return res.status(429).json({ error: "Demasiados intentos fallidos. Espere " + minutes + " minuto(s) y vuelva a intentar." });
  }
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE (lower(username) = lower($1) OR lower(email) = lower($1))",
    [String(username).trim()]
  );
  const user = rows[0];
  if (!user || !user.password_hash || !(await bcrypt.compare(String(password), user.password_hash))) {
    const previous = loginAttempts.get(attemptKey) || { count: 0 };
    previous.count += 1;
    if (previous.count >= LOGIN_MAX_ATTEMPTS) {
      previous.blockedUntil = Date.now() + LOGIN_BLOCK_MS;
      previous.count = 0;
    }
    loginAttempts.set(attemptKey, previous);
    return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
  }
  loginAttempts.delete(attemptKey);
  if (!user.is_active) {
    return res.status(403).json({ error: "Su cuenta queda pendiente de aprobación, por favor comunicarse con administración para empezar a trabajar con nosotros.", pending: true });
  }
  res.json({ token: signToken(user), role: user.role, name: user.name, username: user.username, expiresIn: JWT_EXPIRES });
});

// ---------- Registro de clientes y recuperación de contraseña ----------
const INVOICE_TYPES = ["Sin Factura", "Factura A", "Factura B"];

app.post("/auth/register", async (req, res) => {
  const b = req.body || {};
  const required = { username: "nombre de usuario", password: "contraseña", localName: "nombre del local", address: "dirección", email: "correo electrónico", openingTime: "horario de apertura", maxDeliveryTime: "horario máximo de entrega", phone: "teléfono", zone: "zona", invoiceType: "tipo de factura" };
  for (const [key, label] of Object.entries(required)) {
    if (!String(b[key] || "").trim()) return res.status(400).json({ error: "Falta el campo obligatorio: " + label + "." });
  }
  if (!INVOICE_TYPES.includes(b.invoiceType)) return res.status(400).json({ error: "Tipo de factura inválido." });
  const needsInvoice = b.invoiceType !== "Sin Factura";
  if (needsInvoice && !String(b.cuit || "").trim()) return res.status(400).json({ error: "Falta el campo obligatorio: CUIT." });
  if (String(b.password).length < 6) return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
  const username = String(b.username).trim().toLowerCase();
  const taken = await pool.query("SELECT 1 FROM users WHERE lower(username) = $1", [username]);
  if (taken.rows.length) return res.status(409).json({ error: "Ese nombre de usuario ya existe. Elija otro." });

  const stateRow = await pool.query("SELECT data FROM app_state WHERE id = 'main'");
  if (!stateRow.rows.length) return res.status(503).json({ error: "El sistema todavía no fue inicializado por el negocio." });
  const data = stateRow.rows[0].data;
  data.clients = Array.isArray(data.clients) ? data.clients : [];
  data.users = Array.isArray(data.users) ? data.users : [];
  if (data.users.some((u) => String(u.username || "").toLowerCase() === username)) {
    return res.status(409).json({ error: "Ese nombre de usuario ya existe. Elija otro." });
  }
  let nextNum = 1;
  data.clients.forEach((c) => {
    const n = Number(c.id);
    if (Number.isFinite(n) && n >= nextNum) nextNum = n + 1;
  });
  const clientId = String(nextNum).padStart(3, "0");
  const client = {
    id: clientId, name: String(b.localName).trim(), address: String(b.address).trim(), phone: String(b.phone).trim(),
    email: String(b.email).trim(), billingEmail: String(b.billingEmail || "").trim(), contactName: "",
    paymentType: "cuenta_corriente", priceTier: needsInvoice ? "con_factura" : "general", priceAdjustmentPct: 0,
    needsInvoice, cuit: needsInvoice ? String(b.cuit).trim() : "", legalName: String(b.localName).trim(), invoiceType: b.invoiceType,
    invoiceFrequency: "mensual", zone: String(b.zone).trim(), openingTime: String(b.openingTime).trim(),
    maxDeliveryTime: String(b.maxDeliveryTime).trim(), vehicleId: "", isActive: true,
    notes: String(b.notes || "").trim()
  };
  const user = {
    id: "USR-REG-" + Date.now(), name: client.name, username, password: String(b.password), role: "customer",
    clientId, linkedClientIds: [clientId], email: client.email, phone: client.phone,
    isActive: false, pendingApproval: true, registeredAt: new Date().toISOString()
  };
  data.clients.push(client);
  data.users.push(user);
  const clientDb = await pool.connect();
  try {
    await clientDb.query("BEGIN");
    await clientDb.query("UPDATE app_state SET data = $1, updated_at = now(), updated_by = 'registro-web' WHERE id = 'main'", [data]);
    await clientDb.query("INSERT INTO state_history (data, updated_by) VALUES ($1, 'registro-web')", [data]);
    await syncUsersFromState(clientDb, { users: [user] });
    await clientDb.query("COMMIT");
  } catch (error) {
    await clientDb.query("ROLLBACK").catch(() => {});
    console.error("registro:", error);
    return res.status(500).json({ error: "No se pudo completar el registro: " + error.message });
  } finally {
    clientDb.release();
  }
  sendMail(client.email, "Registro recibido - Pare Carrito SAS",
    `<p>Hola ${client.name},</p><p>Recibimos su registro en Pare Carrito SAS. Su cuenta (usuario <strong>${username}</strong>) queda <strong>pendiente de aprobación</strong>: administración la revisara a la brevedad y le avisaremos cuando este activa.</p><p>Ante cualquier consulta, escribanos por WhatsApp al +54 9 387 456 6725.</p>`);
  const admins = await pool.query("SELECT email FROM users WHERE role IN ('manager','admin') AND email <> '' AND is_active = TRUE");
  for (const row of admins.rows) {
    sendMail(row.email, "Nuevo registro de cliente pendiente de aprobación",
      `<p>Se registro un nuevo cliente:</p><ul><li>Local: <strong>${client.name}</strong></li><li>Usuario: ${username}</li><li>Zona: ${client.zone}</li><li>Telefono: ${client.phone}</li><li>CUIT: ${client.cuit}</li><li>Factura: ${client.invoiceType}</li></ul><p>Para aprobarlo: ingrese al sistema → página <strong>Usuarios</strong> → activar la cuenta.</p>`);
  }
  res.status(201).json({ ok: true, pending: true, clientId });
});

app.post("/clients/activation-email", authenticate, requireRole("manager", "admin"), async (req, res) => {
  const to = String((req.body && req.body.email) || "").trim();
  const name = String((req.body && req.body.name) || "").trim();
  if (!to) return res.status(400).json({ error: "Falta el email del cliente." });
  const sent = await sendMail(to, "Cuenta activada - Pare Carrito SAS",
    `<p>Hola ${name || "cliente"},</p><p>Buenas noticias: su cuenta en Pare Carrito SAS ya esta <strong>activada</strong>. Ya puede ingresar y realizarnos su primer pedido.</p><p>Ante cualquier consulta, escribanos por WhatsApp al +54 9 387 456 6725.</p>`);
  return res.json({ ok: true, sent });
});

// Notificacion de bienvenida al crear un usuario desde el ERP (manager/admin)
app.post("/auth/welcome", async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || "").trim();
  if (!email) return res.status(400).json({ error: "Falta el correo electrónico." });
  const name = String(b.name || "").trim();
  const username = String(b.username || "").trim();
  const password = String(b.password || "");
  const isActive = b.isActive === true;
  const link = PUBLIC_URL || "";
  const statusText = isActive
    ? "<p>Su cuenta ya esta <strong>activa</strong> y puede ingresar.</p>"
    : "<p>Su cuenta queda <strong>pendiente de aprobación</strong>: administración la revisara a la brevedad y le avisaremos cuando este activa.</p>";
  const sent = await sendMail(email, "Bienvenido/a a Pare Carrito SAS",
    `<p>Hola ${name || username},</p>` +
    `<p>Le informamos que se creo su usuario en el sistema de Pare Carrito SAS.</p>` +
    `<ul><li><strong>Usuario:</strong> ${escapeHtml(username)}</li><li><strong>Contraseña:</strong> ${escapeHtml(password)}</li></ul>` +
    `${statusText}<p>Para ingresar: <a href="${escapeHtml(link)}">${escapeHtml(link) || "Pare Carrito SAS"}</a></p>` +
    `<p>Ante cualquier consulta, escribanos por WhatsApp al +54 9 387 456 6725.</p>`);
  res.json({ ok: sent });
});

app.post("/auth/recover", async (req, res) => {
  const identifier = String((req.body || {}).usernameOrEmail || "").trim().toLowerCase();
  if (!identifier) return res.status(400).json({ error: "Indique su usuario o correo electrónico." });
  const { rows } = await pool.query("SELECT * FROM users WHERE lower(username) = $1 OR lower(email) = $1", [identifier]);
  const user = rows[0];
  if (user && user.email) {
    const token = crypto.randomBytes(24).toString("hex");
    await pool.query("INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [token, user.id]);
    const link = (PUBLIC_URL || "") + "/#/restablecer/" + token;
    sendMail(user.email, "Recuperar contraseña - Pare Carrito SAS",
      `<p>Hola ${user.name},</p><p>Para crear una nueva contraseña haga clic en este enlace (válido por 1 hora):</p><p><a href="${link}">${link}</a></p><p>Si usted no pidió este cambio, ignore este correo.</p>`);
  }
  res.json({ ok: true, message: "Si el usuario existe y tiene correo registrado, le envíamos las instrucciones." });
});

app.post("/auth/reset", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: "Faltan datos." });
  if (String(password).length < 6) return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
  const { rows } = await pool.query("SELECT * FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > now()", [token]);
  const reset = rows[0];
  if (!reset) return res.status(400).json({ error: "El enlace es inválido o ya venció. Pida uno nuevo desde Me olvidé la contraseña." });
  const hash = await bcrypt.hash(String(password), 10);
  const clientDb = await pool.connect();
  try {
    await clientDb.query("BEGIN");
    await clientDb.query("UPDATE users SET password_hash = $1, password_fingerprint = $2, updated_at = now() WHERE id = $3", [hash, fingerprint(password), reset.user_id]);
    await clientDb.query("UPDATE password_resets SET used = TRUE WHERE token = $1", [token]);
    const stateRow = await clientDb.query("SELECT data FROM app_state WHERE id = 'main' FOR UPDATE");
    if (stateRow.rows.length) {
      const data = stateRow.rows[0].data;
      const stateUser = (data.users || []).find((u) => u.id === reset.user_id);
      if (stateUser) {
        stateUser.password = String(password);
        await clientDb.query("UPDATE app_state SET data = $1, updated_at = now(), updated_by = 'reset-password' WHERE id = 'main'", [data]);
      }
    }
    await clientDb.query("COMMIT");
  } catch (error) {
    await clientDb.query("ROLLBACK").catch(() => {});
    return res.status(500).json({ error: "No se pudo cambiar la contraseña: " + error.message });
  } finally {
    clientDb.release();
  }
  res.json({ ok: true });
});

// ---------- Estado del ERP (sincronización) ----------
const STATE_READ_ROLES = ["manager", "admin", "employee", "contador", "proveedor"];
const SYNC_ROLES = ["manager", "admin", "contador"];
const PATCH_SYNC_ROLES = ["manager", "admin", "employee", "contador", "proveedor"];
const EMPLOYEE_STALE_PATCH_ARRAY_KEYS = new Set([
  "orders", "remitos", "saldos", "purchases", "payments", "caja",
  "providerLedger", "providerPayments", "clientTransfers", "vendorLedger",
  "attendance", "employeePayments", "employeeReimbursements", "performanceAdjustments",
  "replacements", "stockMovements", "cashClosings"
]);
const HISTORY_KEYS = ["productListPriceHistory", "productSalesQuantityHistory", "productPurchaseHistory"];
const ARRAY_PATCH_KEYS = [
  "orders", "deletedOrders", "exampleOrders", "remitos", "saldos", "purchases", "payments", "caja",
  "providerLedger", "providerPayments", "clientTransfers", "vendorLedger",
  "attendance", "employeePayments", "employeeReimbursements", "performanceAdjustments",
  "clients", "products", "providers", "vehicles", "users", "cashBoxes",
  "preferences", "productAliases", "clientProductAliases", "quantityAliases", "clientQuantityAliases",
  "costRelations", "productRelations", "billingLog",
  "replacements", "stockMovements", "cashClosings", "marginSections", "priceAutoLog", "priceAutoSchedule",
  "holidays"
];
const OBJECT_PATCH_KEYS = ["prices", "appSettings"];

function stripHistoryFromState(data) {
  const clean = { ...(data || {}) };
  HISTORY_KEYS.forEach((key) => delete clean[key]);
  return clean;
}

function historyPayloadFromState(data) {
  const source = data || {};
  return {
    listPriceHistory: Array.isArray(source.productListPriceHistory) ? source.productListPriceHistory : [],
    salesQuantityHistory: Array.isArray(source.productSalesQuantityHistory) ? source.productSalesQuantityHistory : [],
    purchaseHistory: Array.isArray(source.productPurchaseHistory) ? source.productPurchaseHistory : []
  };
}

async function upsertProductHistoryState(db, data, updatedBy) {
  const history = historyPayloadFromState(data);
  if (!history.listPriceHistory.length && !history.salesQuantityHistory.length && !history.purchaseHistory.length) return;
  await db.query(
    `INSERT INTO product_history_state (id, list_price_history, sales_quantity_history, purchase_history, updated_at, updated_by)
     VALUES ('main', $1, $2, $3, now(), $4)
     ON CONFLICT (id) DO UPDATE SET
       list_price_history = EXCLUDED.list_price_history,
       sales_quantity_history = EXCLUDED.sales_quantity_history,
       purchase_history = EXCLUDED.purchase_history,
       updated_at = EXCLUDED.updated_at,
       updated_by = EXCLUDED.updated_by`,
    [history.listPriceHistory, history.salesQuantityHistory, history.purchaseHistory, updatedBy]
  );
}

async function loadProductHistoryState(db) {
  const { rows } = await db.query("SELECT list_price_history, sales_quantity_history, purchase_history, updated_at FROM product_history_state WHERE id = 'main'");
  if (!rows.length) return { listPriceHistory: [], salesQuantityHistory: [], purchaseHistory: [], updatedAt: null };
  return {
    listPriceHistory: Array.isArray(rows[0].list_price_history) ? rows[0].list_price_history : [],
    salesQuantityHistory: Array.isArray(rows[0].sales_quantity_history) ? rows[0].sales_quantity_history : [],
    purchaseHistory: Array.isArray(rows[0].purchase_history) ? rows[0].purchase_history : [],
    updatedAt: rows[0].updated_at ? rows[0].updated_at.toISOString() : null
  };
}

function filterHistoryByRange(records, from, to) {
  const start = String(from || "0000-01-01").slice(0, 10);
  const end = String(to || "9999-12-31").slice(0, 10);
  return (Array.isArray(records) ? records : []).filter((record) => {
    const date = String(record && record.date || "").slice(0, 10);
    return date && date >= start && date <= end;
  });
}

function productLookupFromState(data) {
  const map = new Map();
  for (const product of Array.isArray(data && data.products) ? data.products : []) {
    if (product && product.id) map.set(String(product.id), product);
  }
  return map;
}

function ensureHistoryMatrixRow(rows, record, product) {
  const key = String(record.productId || record.productName || "");
  if (!key) return null;
  if (!rows[key]) rows[key] = {
    productId: record.productId || "",
    productName: record.productName || (product ? product.name : key),
    category: product ? product.category : (record.category || "OTROS"),
    unitType: record.unitType || (product ? product.unitType : ""),
    totalQuantity: 0,
    totalAmount: 0,
    days: {}
  };
  return rows[key];
}

function sortHistoryMatrixRows(rows) {
  return Object.values(rows).sort((a, b) => String(a.category || "").localeCompare(String(b.category || "")) || String(a.productName || "").localeCompare(String(b.productName || "")));
}

function buildPurchaseHistoryMatrix(records, productMap) {
  const rows = {};
  for (const record of Array.isArray(records) ? records : []) {
    const date = String(record && record.date || "").slice(0, 10);
    if (!date) continue;
    const product = productMap.get(String(record.productId || ""));
    const row = ensureHistoryMatrixRow(rows, record, product);
    if (!row) continue;
    if (!row.days[date]) row.days[date] = { quantity: 0, amount: 0, price: 0 };
    const quantity = Number(record.quantity || 0);
    const price = Number(record.unitCost || record.price || 0);
    const amount = Number(record.totalCost || quantity * price);
    row.totalQuantity += quantity;
    row.totalAmount += amount;
    row.days[date].quantity += quantity;
    row.days[date].amount += amount;
    row.days[date].price = Math.max(row.days[date].price, price);
  }
  return sortHistoryMatrixRows(rows);
}

function buildSalesHistoryMatrix(salesRecords, priceRecords, productMap) {
  const priceByProductDate = {};
  for (const record of Array.isArray(priceRecords) ? priceRecords : []) {
    const date = String(record && record.date || "").slice(0, 10);
    if (record && record.productId && date) priceByProductDate[String(record.productId) + "|" + date] = Number(record.price || 0);
  }
  const rows = {};
  for (const record of Array.isArray(salesRecords) ? salesRecords : []) {
    const date = String(record && record.date || "").slice(0, 10);
    if (!date) continue;
    const product = productMap.get(String(record.productId || ""));
    const row = ensureHistoryMatrixRow(rows, record, product);
    if (!row) continue;
    if (!row.days[date]) row.days[date] = { quantity: 0, amount: 0, price: 0 };
    const quantity = Number(record.quantity || 0);
    const price = Number(record.listPrice || record.price || priceByProductDate[String(record.productId || "") + "|" + date] || 0);
    const amount = quantity * price;
    row.totalQuantity += quantity;
    row.totalAmount += amount;
    row.days[date].quantity += quantity;
    row.days[date].amount += amount;
    row.days[date].price = price;
  }
  return sortHistoryMatrixRows(rows);
}

const historyMatrixCache = new Map();

function rememberHistoryMatrixCache(key, value) {
  historyMatrixCache.set(key, value);
  if (historyMatrixCache.size > 24) {
    const firstKey = historyMatrixCache.keys().next().value;
    if (firstKey) historyMatrixCache.delete(firstKey);
  }
  return value;
}

function patchKeyForItem(key, item) {
  if (!item) return "";
  if (key === "preferences") return String(item.clientId || "") + "|" + String(item.productId || "");
  if (key === "productAliases") return String(item.productId || "") + "|" + String(item.alias || "");
  if (key === "clientProductAliases") return String(item.clientId || "") + "|" + String(item.productId || "") + "|" + String(item.alias || "");
  if (key === "quantityAliases") return String(item.alias || "");
  if (key === "clientQuantityAliases") return String(item.clientId || "") + "|" + String(item.alias || "");
  if (key === "costRelations") return item.id || JSON.stringify([item.sourceProductId, item.targetProductId, item.productId]);
  if (key === "productRelations") return item.id || String(item.retailProductId || "") + "|" + String(item.wholesaleProductId || "");
  if (key === "priceAutoSchedule") return String(item.productId || "");
  return String(item.id || "");
}

function applyArrayPatch(target, key, changes) {
  const current = Array.isArray(target[key]) ? target[key] : [];
  const map = new Map();
  current.forEach((item) => {
    const id = patchKeyForItem(key, item);
    if (id) map.set(id, item);
  });
  (Array.isArray(changes && changes.delete) ? changes.delete : []).forEach((id) => map.delete(String(id)));
  (Array.isArray(changes && changes.upsert) ? changes.upsert : []).forEach((item) => {
    const id = patchKeyForItem(key, item);
    if (!id) return;
    // No dejar que una copia MAS VIEJA pise una MAS NUEVA: si ambas tienen updatedAt y la que
    // llega es anterior a la guardada, se ignora. Evita que un dispositivo con datos
    // desactualizados revierta cambios ya confirmados (ej. precios actualizados por una compra
    // o un item borrado que "reaparece").
    const existing = map.get(id);
    if (existing && existing.updatedAt && item && item.updatedAt && String(item.updatedAt) < String(existing.updatedAt)) return;
    map.set(id, item);
  });
  target[key] = Array.from(map.values());
}

function applyStatePatch(data, patch) {
  const next = stripHistoryFromState(data || {});
  const arrays = patch && patch.arrays && typeof patch.arrays === "object" ? patch.arrays : {};
  ARRAY_PATCH_KEYS.forEach((key) => {
    if (arrays[key]) applyArrayPatch(next, key, arrays[key]);
  });
  const objects = patch && patch.objects && typeof patch.objects === "object" ? patch.objects : {};
  OBJECT_PATCH_KEYS.forEach((key) => {
    if (objects[key] && typeof objects[key] === "object") {
      next[key] = { ...(next[key] || {}), ...objects[key] };
    }
  });
  const scalars = patch && patch.scalars && typeof patch.scalars === "object" ? patch.scalars : {};
  Object.keys(scalars).forEach((key) => {
    if (!HISTORY_KEYS.includes(key)) next[key] = scalars[key];
  });
  return next;
}

function canApplyStaleEmployeePatch(patch) {
  if (!patch || typeof patch !== "object") return false;
  if (patch.objects && Object.keys(patch.objects).length) return false;
  if (patch.scalars && Object.keys(patch.scalars).length) return false;
  const arrays = patch.arrays && typeof patch.arrays === "object" ? patch.arrays : {};
  return Object.keys(arrays).every((key) => {
    if (!EMPLOYEE_STALE_PATCH_ARRAY_KEYS.has(key)) return false;
    const entry = arrays[key] || {};
    return !Array.isArray(entry.delete) || entry.delete.length === 0;
  });
}

app.get("/state", authenticate, requireRole(...STATE_READ_ROLES), async (req, res) => {
  const { rows } = await pool.query("SELECT data, updated_at FROM app_state WHERE id = 'main'");
  if (!rows.length) return res.status(404).json({ error: "Sin datos guardados todavía." });
  res.json({ data: stripHistoryFromState(rows[0].data), updatedAt: rows[0].updated_at.toISOString() });
});

app.get("/product-history", authenticate, requireRole("manager", "admin"), async (req, res) => {
  const history = await loadProductHistoryState(pool);
  if (String(req.query.mode || "") === "matrix") {
    const stateRow = await pool.query("SELECT data, updated_at FROM app_state WHERE id = 'main'");
    const stateUpdatedAt = stateRow.rows[0] && stateRow.rows[0].updated_at ? stateRow.rows[0].updated_at.toISOString() : "";
    const cacheKey = [
      String(req.query.from || ""),
      String(req.query.to || ""),
      String(history.updatedAt || ""),
      stateUpdatedAt
    ].join("|");
    if (historyMatrixCache.has(cacheKey)) return res.json(historyMatrixCache.get(cacheKey));
    const listPriceHistory = filterHistoryByRange(history.listPriceHistory, req.query.from, req.query.to);
    const salesQuantityHistory = filterHistoryByRange(history.salesQuantityHistory, req.query.from, req.query.to);
    const purchaseHistory = filterHistoryByRange(history.purchaseHistory, req.query.from, req.query.to);
    const productMap = productLookupFromState(stateRow.rows[0] ? stateRow.rows[0].data : {});
    return res.json(rememberHistoryMatrixCache(cacheKey, {
      purchaseRows: buildPurchaseHistoryMatrix(purchaseHistory, productMap),
      salesRows: buildSalesHistoryMatrix(salesQuantityHistory, listPriceHistory, productMap),
      updatedAt: history.updatedAt
    }));
  }
  const listPriceHistory = filterHistoryByRange(history.listPriceHistory, req.query.from, req.query.to);
  const salesQuantityHistory = filterHistoryByRange(history.salesQuantityHistory, req.query.from, req.query.to);
  const purchaseHistory = filterHistoryByRange(history.purchaseHistory, req.query.from, req.query.to);
  res.json({
    listPriceHistory,
    salesQuantityHistory,
    purchaseHistory,
    updatedAt: history.updatedAt
  });
});

app.put("/state", authenticate, requireRole(...SYNC_ROLES), async (req, res) => {
  const body = req.body || {};
  if (!body.data || typeof body.data !== "object") {
    return res.status(400).json({ error: "Cuerpo inválido: se espera { data: { ... } }." });
  }
  const clientDb = await pool.connect();
  try {
    await clientDb.query("BEGIN");
    const current = await clientDb.query("SELECT updated_at, data FROM app_state WHERE id = 'main' FOR UPDATE");
    const beforeData = current.rows.length ? current.rows[0].data : {};
    const beforeCounts = {
      orders: Array.isArray(beforeData.orders) ? beforeData.orders.length : 0,
      clients: Array.isArray(beforeData.clients) ? beforeData.clients.length : 0,
      products: Array.isArray(beforeData.products) ? beforeData.products.length : 0
    };
    if (current.rows.length) {
      if (body.baseUpdatedAt === undefined || body.baseUpdatedAt === null) {
        await clientDb.query("ROLLBACK");
        return res.status(409).json({ error: "conflicto: el cliente no tiene la última version. Descargue primero.", updatedAt: current.rows[0].updated_at.toISOString() });
      }
      const storedIso = current.rows[0].updated_at.toISOString();
      if (storedIso !== String(body.baseUpdatedAt)) {
        await clientDb.query("ROLLBACK");
        return res.status(409).json({ error: "conflicto: el servidor tiene una version mas nueva", updatedAt: storedIso });
      }
    }
    await upsertProductHistoryState(clientDb, body.data, req.user.username);
    const cleanData = stripHistoryFromState(body.data);
    const saved = await clientDb.query(
      `INSERT INTO app_state (id, data, updated_at, updated_by) VALUES ('main', $1, now(), $2)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
       RETURNING updated_at`,
      [cleanData, req.user.username]
    );
    await clientDb.query("INSERT INTO state_history (data, updated_by) VALUES ($1, $2)", [cleanData, req.user.username]);
    await clientDb.query(
      "DELETE FROM state_history WHERE id NOT IN (SELECT id FROM state_history ORDER BY id DESC LIMIT $1)",
      [STATE_HISTORY_KEEP]
    );
    await mirrorStateToTables(clientDb, cleanData, beforeData);
    await syncUsersFromState(clientDb, cleanData);
    const afterCounts = {
      orders: Array.isArray(cleanData.orders) ? cleanData.orders.length : 0,
      clients: Array.isArray(cleanData.clients) ? cleanData.clients.length : 0,
      products: Array.isArray(cleanData.products) ? cleanData.products.length : 0
    };
    await clientDb.query(
      "INSERT INTO state_writes (updated_by, orders_before, orders_after, clients_before, clients_after, products_before, products_after, diff_orders) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [req.user.username, beforeCounts.orders, afterCounts.orders, beforeCounts.clients, afterCounts.clients, beforeCounts.products, afterCounts.products, afterCounts.orders - beforeCounts.orders]
    );
    await clientDb.query("COMMIT");
    syncSheetsFromStateDiff(beforeData, cleanData);
    res.json({ ok: true, updatedAt: saved.rows[0].updated_at.toISOString() });
  } catch (error) {
    await clientDb.query("ROLLBACK").catch(() => {});
    console.error("PUT /state:", error);
    res.status(500).json({ error: "No se pudo guardar el estado: " + error.message });
  } finally {
    clientDb.release();
  }
});

app.post("/state/patch", authenticate, requireRole(...PATCH_SYNC_ROLES), async (req, res) => {
  const body = req.body || {};
  if (!body.operationId || !body.patch || typeof body.patch !== "object") {
    return res.status(400).json({ error: "Cuerpo inválido: se espera { operationId, baseUpdatedAt, patch }." });
  }
  const clientDb = await pool.connect();
  try {
    await clientDb.query("BEGIN");
    const existingOp = await clientDb.query("SELECT applied_at FROM state_operations WHERE operation_id = $1", [String(body.operationId)]);
    if (existingOp.rows.length) {
      const current = await clientDb.query("SELECT updated_at FROM app_state WHERE id = 'main'");
      await clientDb.query("COMMIT");
      return res.json({ ok: true, duplicate: true, updatedAt: current.rows[0] ? current.rows[0].updated_at.toISOString() : null });
    }
    const current = await clientDb.query("SELECT updated_at, data FROM app_state WHERE id = 'main' FOR UPDATE");
    if (!current.rows.length) {
      await clientDb.query("ROLLBACK");
      return res.status(404).json({ error: "Sin datos guardados todavía." });
    }
    if (body.baseUpdatedAt === undefined || body.baseUpdatedAt === null) {
      await clientDb.query("ROLLBACK");
      return res.status(409).json({ error: "conflicto: operación sin version base. Descargue primero.", updatedAt: current.rows[0].updated_at.toISOString() });
    }
    const storedIso = current.rows[0].updated_at.toISOString();
    if (storedIso !== String(body.baseUpdatedAt)) {
      const allowEmployeeMerge = req.user.role === "employee" && canApplyStaleEmployeePatch(body.patch);
      if (!allowEmployeeMerge) {
        await clientDb.query("ROLLBACK");
        return res.status(409).json({ error: "conflicto: el servidor tiene una version mas nueva", updatedAt: storedIso });
      }
    }
    const beforeData = current.rows[0].data || {};
    const nextData = applyStatePatch(beforeData, body.patch);
    const saved = await clientDb.query(
      "UPDATE app_state SET data = $1, updated_at = now(), updated_by = $2 WHERE id = 'main' RETURNING updated_at",
      [nextData, req.user.username]
    );
    await clientDb.query("INSERT INTO state_operations (operation_id, operation_type, base_updated_at, applied_by, patch) VALUES ($1,$2,$3,$4,$5)", [String(body.operationId), String(body.operationType || "patch"), body.baseUpdatedAt, req.user.username, body.patch]);
    await clientDb.query("INSERT INTO state_history (data, updated_by) VALUES ($1, $2)", [nextData, req.user.username]);
    await clientDb.query("DELETE FROM state_history WHERE id NOT IN (SELECT id FROM state_history ORDER BY id DESC LIMIT $1)", [STATE_HISTORY_KEEP]);
    await mirrorStateToTables(clientDb, nextData, beforeData);
    await syncUsersFromState(clientDb, nextData);
    await clientDb.query("COMMIT");
    syncSheetsFromStateDiff(beforeData, nextData);
    res.json({ ok: true, updatedAt: saved.rows[0].updated_at.toISOString() });
  } catch (error) {
    await clientDb.query("ROLLBACK").catch(() => {});
    console.error("POST /state/patch:", error);
    res.status(500).json({ error: "No se pudo aplicar la operación: " + error.message });
  } finally {
    clientDb.release();
  }
});

// ---------- Pedidos envíados por clientes ----------
function parseLinkedClientIds(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

function nextStateId(prefix, records) {
  const suffix = Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex");
  const id = prefix + "-" + suffix;
  return (Array.isArray(records) && records.some((item) => item && item.id === id)) ? prefix + "-" + suffix + "-2" : id;
}

app.post("/orders/customer", authenticate, requireRole("customer"), async (req, res) => {
  const body = req.body || {};
  if (!body.order || typeof body.order !== "object") {
    return res.status(400).json({ error: "Cuerpo inválido: se espera { order: { ... } }." });
  }
  const clientDb = await pool.connect();
  try {
    await clientDb.query("BEGIN");
    const userRow = await clientDb.query("SELECT client_id, linked_client_ids FROM users WHERE id = $1 OR username = $2 LIMIT 1", [req.user.sub, req.user.username]);
    const userRecord = userRow.rows[0] || {};
    const allowedClientIds = new Set([String(userRecord.client_id || ""), ...parseLinkedClientIds(userRecord.linked_client_ids)].filter(Boolean));
    const orderClientId = String(body.order.clientId || "");
    if (!allowedClientIds.has(orderClientId)) {
      await clientDb.query("ROLLBACK");
      return res.status(403).json({ error: "El cliente del pedido no esta vinculado a este usuario." });
    }
    const row = await clientDb.query("SELECT data FROM app_state WHERE id = 'main' FOR UPDATE");
    if (!row.rows.length) {
      await clientDb.query("ROLLBACK");
      return res.status(404).json({ error: "Sin datos." });
    }
    const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
    const data = row.rows[0].data || {};
    data.orders = Array.isArray(data.orders) ? data.orders : [];
    data.saldos = Array.isArray(data.saldos) ? data.saldos : [];
    data.caja = Array.isArray(data.caja) ? data.caja : [];
    const order = {
      ...body.order,
      id: body.order.id || nextStateId("ORD", data.orders),
      userId: req.user.sub,
      clientId: orderClientId,
      exampleOnly: false,
      status: body.order.status || "pendiente",
      paymentReceived: num(body.order.paymentReceived),
      paymentStatus: body.order.paymentStatus || "pending",
      createdAt: body.order.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (data.orders.some((existing) => existing && existing.id === order.id)) {
      await clientDb.query("COMMIT");
      return res.json({ ok: true, duplicate: true, order });
    }
    const client = (Array.isArray(data.clients) ? data.clients : []).find((item) => item && String(item.id) === orderClientId);
    data.orders.push(order);
    const total = num(order.totalAmount);
    const balance = data.saldos.filter((entry) => entry && String(entry.clientId) === orderClientId).reduce((sum, entry) => sum + num(entry.amount), 0) + total;
    data.saldos.push({
      id: nextStateId("SAL", data.saldos),
      date: order.date || new Date().toISOString().slice(0, 10),
      clientId: orderClientId,
      type: "pedido",
      description: "Pedido " + order.id,
      amount: total,
      balance,
      relatedEntityId: order.id,
      relatedEntityType: "order",
      paymentMethod: "",
      notes: "Deuda generada por pedido."
    });
    data.caja.push({
      id: nextStateId("TRX", data.caja),
      date: order.date || new Date().toISOString().slice(0, 10),
      timestamp: new Date().toISOString(),
      type: "order_created",
      concept: "Pedido creado - " + (client ? client.name : orderClientId) + " - " + order.id,
      relatedEntityId: order.id,
      relatedEntityType: "order",
      expectedAmount: total,
      amountIngreso: 0,
      amountEgreso: 0,
      balance: data.caja.reduce((sum, entry) => sum + num(entry.amountIngreso) - num(entry.amountEgreso), 0),
      cashBoxId: "",
      cashBoxName: "",
      paymentMethod: "",
      paymentStatus: "pending",
      recordedBy: req.user.name || req.user.username,
      userRole: req.user.role,
      transferProofFile: "",
      notes: "Registro de accountability. No suma caja hasta cobrar."
    });
    const saved = await clientDb.query("UPDATE app_state SET data = $1, updated_at = now(), updated_by = $2 WHERE id = 'main' RETURNING updated_at", [data, req.user.username]);
    await clientDb.query("INSERT INTO state_history (data, updated_by) VALUES ($1, $2)", [data, req.user.username]);
    await clientDb.query("DELETE FROM state_history WHERE id NOT IN (SELECT id FROM state_history ORDER BY id DESC LIMIT $1)", [STATE_HISTORY_KEEP]);
    await mirrorStateToTables(clientDb, data);
    await clientDb.query("COMMIT");
    res.json({ ok: true, order, updatedAt: saved.rows[0].updated_at.toISOString() });
  } catch (error) {
    await clientDb.query("ROLLBACK").catch(() => {});
    console.error("POST /orders/customer:", error);
    res.status(500).json({ error: "No se pudo guardar el pedido: " + error.message });
  } finally {
    clientDb.release();
  }
});

// ---------- Transferencias envíadas por clientes ----------
app.post("/transfers", authenticate, requireRole("customer", "example"), async (req, res) => {
  const body = req.body || {};
  if (!body.transfer || typeof body.transfer !== "object") {
    return res.status(400).json({ error: "Cuerpo inválido: se espera { transfer: { ... } }." });
  }
  const clientDb = await pool.connect();
  try {
    await clientDb.query("BEGIN");
    if (req.user.role === "customer") {
      const userRow = await clientDb.query("SELECT client_id, linked_client_ids FROM users WHERE id = $1 OR username = $2 LIMIT 1", [req.user.sub, req.user.username]);
      const userRecord = userRow.rows[0] || {};
      const allowedClientIds = new Set([String(userRecord.client_id || ""), ...parseLinkedClientIds(userRecord.linked_client_ids)].filter(Boolean));
      const transferClientIds = (Array.isArray(body.transfer.clientIds) ? body.transfer.clientIds : [body.transfer.clientId]).filter(Boolean).map(String);
      if (!transferClientIds.length || transferClientIds.some((id) => !allowedClientIds.has(id))) {
        await clientDb.query("ROLLBACK");
        return res.status(403).json({ error: "La transferencia contiene clientes no vinculados a este usuario." });
      }
    }
    const row = await clientDb.query("SELECT data FROM app_state WHERE id = 'main' FOR UPDATE");
    if (!row.rows.length) {
      await clientDb.query("ROLLBACK");
      return res.status(404).json({ error: "Sin datos." });
    }
    const data = row.rows[0].data;
    const transfer = {
      ...body.transfer,
      id: body.transfer.id || "TRF-" + Date.now(),
      status: "pending",
      createdByUserId: req.user.sub,
      createdByName: req.user.name || req.user.username,
      timestamp: new Date().toISOString()
    };
    data.clientTransfers = data.clientTransfers || [];
    if (data.clientTransfers.some((existing) => existing && existing.id === transfer.id)) {
      await clientDb.query("COMMIT");
      return res.json({ ok: true, duplicate: true, transfer });
    }
    data.clientTransfers.push(transfer);
    await clientDb.query("UPDATE app_state SET data = $1, updated_at = now(), updated_by = $2 WHERE id = 'main'", [data, req.user.username]);
    await clientDb.query("COMMIT");
    res.json({ ok: true, transfer });
  } catch (error) {
    await clientDb.query("ROLLBACK").catch(() => {});
    console.error("POST /transfers:", error);
    res.status(500).json({ error: "No se pudo guardar la transferencia: " + error.message });
  } finally {
    clientDb.release();
  }
});

async function visionOcrRequest(url, apiKey, model, image, prompt, extraHeaders) {
  const response = await fetch(url, {
    method: "POST",
    headers: Object.assign({ "content-type": "application/json", authorization: "Bearer " + apiKey }, extraHeaders || {}),
    body: JSON.stringify({
      model: model,
      temperature: 0,
      max_tokens: 1600,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: image.dataUrl } }
          ]
        }
      ]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload && (payload.error && (payload.error.message || payload.error) || payload.message);
    throw new Error(sanitizeExternalApiError(detail) || ("HTTP " + response.status));
  }
  const text = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? String(payload.choices[0].message.content || "").trim()
    : "";
  if (!text) throw new Error("sin texto interpretable");
  return text;
}

app.post("/ocr/order-image", authenticate, requireRole("manager", "admin", "employee"), async (req, res) => {
  if (!OPENROUTER_API_KEY && !MOONSHOT_API_KEY) {
    return res.status(503).json({ error: "OCR por IA no configurado (falta OPENROUTER_API_KEY o MOONSHOT_API_KEY)." });
  }
  const image = parseImageDataUrl(req.body && req.body.imageData);
  if (!image) return res.status(400).json({ error: "Envíe una imagen PNG, JPG o WEBP en base64." });
  if (image.byteLength > 8 * 1024 * 1024) return res.status(413).json({ error: "La imagen supera el máximo de 8 MB." });
  const prompt = (req.body && typeof req.body.prompt === "string" && req.body.prompt.trim())
    ? req.body.prompt.trim()
    : "transcribe el texto de esta imagen, es un pedido de frutas y verduras";
  const errors = [];
  if (OPENROUTER_API_KEY) {
    try {
      const text = await visionOcrRequest(OPENROUTER_API_URL, OPENROUTER_API_KEY, OPENROUTER_VISION_MODEL, image, prompt, { "HTTP-Referer": "https://parecarrito.app", "X-Title": "Pare Carrito" });
      return res.json({ text });
    } catch (error) {
      errors.push("OpenRouter: " + error.message);
    }
  }
  if (MOONSHOT_API_KEY) {
    try {
      const text = await visionOcrRequest(MOONSHOT_API_URL, MOONSHOT_API_KEY, MOONSHOT_VISION_MODEL, image, prompt);
      return res.json({ text });
    } catch (error) {
      errors.push("Kimi: " + error.message);
    }
  }
  return res.status(502).json({ error: "No se pudo interpretar la imagen. " + errors.join(" | ") });
});

// Espejo relacional: refresco transaccional completo (estados chicos, robustez maxima)
async function mirrorStateToTables(db, data, beforeData) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  // Solo reconstruye las tablas cuya seccion del estado cambio (evita reescribir miles de filas
  // en cada guardado chico). Si no se pasa beforeData, reconstruye todo (comportamiento previo).
  const changed = (key) => !beforeData || JSON.stringify(beforeData[key]) !== JSON.stringify(data[key]);
  const skipClients = !changed("clients");
  const skipProducts = !changed("products");
  const skipOrders = !changed("orders");
  const skipPurchases = !changed("purchases");
  const skipPayments = !changed("payments");
  if (!skipClients) await db.query("DELETE FROM clients");
  if (!skipProducts) await db.query("DELETE FROM products");
  if (!skipOrders) { await db.query("DELETE FROM order_items"); await db.query("DELETE FROM orders"); }
  if (!skipPurchases) { await db.query("DELETE FROM purchase_items"); await db.query("DELETE FROM purchases"); }
  if (!skipPayments) await db.query("DELETE FROM payments");
  for (const c of skipClients ? [] : (Array.isArray(data.clients) ? data.clients : [])) {
    if (!c || !c.id) continue;
    await db.query(
      "INSERT INTO clients (id, name, address, phone, payment_type, price_tier, vehicle_id, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING",
      [c.id, c.name || "", c.address || "", c.phone || "", c.paymentType || "", c.priceTier || "", c.vehicleId || "", c.isActive !== false]
    );
  }
  for (const p of skipProducts ? [] : (Array.isArray(data.products) ? data.products : [])) {
    if (!p || !p.id) continue;
    await db.query(
      "INSERT INTO products (id, name, category, unit_type, base_cost, sale_price, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING",
      [p.id, p.name || "", p.category || "", p.unitType || "", num(p.baseCost), num(p.salePrice), p.isActive !== false]
    );
  }
  for (const o of skipOrders ? [] : (Array.isArray(data.orders) ? data.orders : [])) {
    if (!o || !o.id || !o.date) continue;
    await db.query(
      "INSERT INTO orders (id, date, client_id, vehicle_id, status, subtotal, iva, total, payment_received, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING",
      [o.id, o.date, o.clientId || "", o.deliveryVehicleId || "", o.status || "", num(o.subtotalAmount), num(o.ivaAmount), num(o.totalAmount), num(o.paymentReceived), o.userId || "", o.createdAt ? new Date(o.createdAt) : null]
    );
    let fallback = 0;
    for (const it of Array.isArray(o.items) ? o.items : []) {
      if (!it) continue;
      fallback += 1;
      await db.query(
        "INSERT INTO order_items (order_id, item_id, product_id, product_name, unit_type, quantity, unit_price, subtotal) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
        [o.id, it.id || "it-" + fallback, it.productId || "", it.productName || "", it.unitType || "", num(it.quantity), num(it.unitPrice), num(it.subtotal)]
      );
    }
  }
  for (const p of skipPurchases ? [] : (Array.isArray(data.purchases) ? data.purchases : [])) {
    if (!p || !p.id || !p.date) continue;
    await db.query(
      "INSERT INTO purchases (id, date, expense_type, provider_id, provider_name, total_cost, payment_status, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING",
      [p.id, p.date, p.expenseType || "", p.providerId || "", p.providerName || "", num(p.totalCost), p.paymentStatus || "", p.recordedBy || ""]
    );
    let position = 0;
    for (const it of Array.isArray(p.items) ? p.items : []) {
      if (!it) continue;
      position += 1;
      await db.query(
        "INSERT INTO purchase_items (purchase_id, position, product_id, product_name, quantity, unit_cost, total_cost) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
        [p.id, position, it.productId || "", it.productName || "", num(it.quantity), num(it.unitCost), num(it.totalCost)]
      );
    }
  }
  for (const pay of skipPayments ? [] : (Array.isArray(data.payments) ? data.payments : [])) {
    if (!pay || !pay.id) continue;
    await db.query(
      "INSERT INTO payments (id, date, client_id, amount, method, received_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
      [pay.id, pay.date || null, pay.clientId || "", num(pay.amount), pay.method || "", pay.receivedByUserId || ""]
    );
  }
}

// Usuarios del ERP -> usuarios reales con hash bcrypt (la gestion sigue en la página Usuarios)
async function syncUsersFromState(db, data) {
  for (const u of Array.isArray(data.users) ? data.users : []) {
    if (!u || !u.id || !u.username || !u.password) continue;
    const fp = fingerprint(u.password);
    const existing = await db.query("SELECT password_fingerprint FROM users WHERE id = $1", [u.id]);
    const needsHash = !existing.rows.length || existing.rows[0].password_fingerprint !== fp;
    const hash = needsHash ? await bcrypt.hash(String(u.password), 10) : null;
    await db.query(
      `INSERT INTO users (id, username, name, email, role, password_hash, password_fingerprint, client_id, linked_client_ids, is_active, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username, name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role,
         password_hash = COALESCE($11, users.password_hash),
         password_fingerprint = CASE WHEN $11 IS NULL THEN users.password_fingerprint ELSE EXCLUDED.password_fingerprint END,
         client_id = EXCLUDED.client_id, linked_client_ids = EXCLUDED.linked_client_ids,
         is_active = EXCLUDED.is_active, updated_at = now()`,
      [u.id, u.username, u.name || "", u.email || "", u.role || "employee", hash || "", fp, u.clientId || null, JSON.stringify(u.linkedClientIds || []), u.isActive !== false, hash]
    );
  }
}

// ---------- Comprobantes (archivos en disco) ----------
app.post("/proofs", authenticate, express.raw({ type: "*/*", limit: "25mb" }), async (req, res) => {
  const fileName = String(req.headers["x-file-name"] || "comprobante").replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = Date.now() + "-" + crypto.randomBytes(4).toString("hex") + "-" + fileName;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, key), req.body);
  await pool.query("INSERT INTO proofs (key, content_type, uploaded_by) VALUES ($1,$2,$3)", [key, req.headers["content-type"] || "application/octet-stream", req.user.username]);
  res.status(201).json({ ok: true, key });
});

app.get("/proofs/:key", authenticate, async (req, res) => {
  const key = String(req.params.key).replace(/[^a-zA-Z0-9._-]/g, "_");
  const { rows } = await pool.query("SELECT content_type FROM proofs WHERE key = $1", [key]);
  const file = path.join(UPLOAD_DIR, key);
  if (!rows.length || !fs.existsSync(file)) return res.status(404).json({ error: "Comprobante no encontrado." });
  res.set("content-type", rows[0].content_type || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

// ---------- Reportes pesados en SQL (gerente y admin) ----------
const REPORT_ROLES = ["manager", "admin"];

app.get("/reports/sales", authenticate, requireRole(...REPORT_ROLES), async (req, res) => {
  const from = req.query.from || "1900-01-01";
  const to = req.query.to || "2999-12-31";
  const { rows } = await pool.query(
    `SELECT o.date::text AS date,
            COUNT(DISTINCT o.id)::int AS orders,
            COALESCE(SUM(o.total), 0)::float AS sales,
            COALESCE((SELECT SUM(p.total_cost) FROM purchases p WHERE p.date = o.date AND p.expense_type NOT IN ('market_price','prepared','cash_movement')), 0)::float AS expenses
     FROM orders o
     WHERE o.date BETWEEN $1 AND $2 AND o.status NOT IN ('cancelado','anulado')
     GROUP BY o.date ORDER BY o.date`,
    [from, to]
  );
  res.json({ from, to, days: rows.map((r) => ({ ...r, result: r.sales - r.expenses })) });
});

app.get("/reports/top-products", authenticate, requireRole(...REPORT_ROLES), async (req, res) => {
  const from = req.query.from || "1900-01-01";
  const to = req.query.to || "2999-12-31";
  const limit = Math.min(100, Number(req.query.limit || 25));
  const { rows } = await pool.query(
    `SELECT oi.product_id, oi.product_name, oi.unit_type,
            SUM(oi.quantity)::float AS quantity,
            SUM(oi.subtotal)::float AS revenue,
            COUNT(DISTINCT oi.order_id)::int AS orders
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.date BETWEEN $1 AND $2 AND o.status NOT IN ('cancelado','anulado')
     GROUP BY oi.product_id, oi.product_name, oi.unit_type
     ORDER BY revenue DESC LIMIT $3`,
    [from, to, limit]
  );
  res.json({ from, to, products: rows });
});

app.get("/reports/top-clients", authenticate, requireRole(...REPORT_ROLES), async (req, res) => {
  const from = req.query.from || "1900-01-01";
  const to = req.query.to || "2999-12-31";
  const { rows } = await pool.query(
    `SELECT o.client_id, COALESCE(c.name, o.client_id) AS client_name,
            COUNT(o.id)::int AS orders, SUM(o.total)::float AS total
     FROM orders o LEFT JOIN clients c ON c.id = o.client_id
     WHERE o.date BETWEEN $1 AND $2 AND o.status NOT IN ('cancelado','anulado')
     GROUP BY o.client_id, c.name ORDER BY total DESC LIMIT 100`,
    [from, to]
  );
  res.json({ from, to, clients: rows });
});

// ---------- Exportaciones masivas ----------
function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n;]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

app.get("/exports/orders.csv", authenticate, requireRole(...REPORT_ROLES), async (req, res) => {
  const from = req.query.from || "1900-01-01";
  const to = req.query.to || "2999-12-31";
  const { rows } = await pool.query(
    `SELECT o.id, o.date::text, COALESCE(c.name, o.client_id) AS client, o.status,
            oi.product_name, oi.quantity::float, oi.unit_type, oi.unit_price::float, oi.subtotal::float, o.total::float
     FROM orders o LEFT JOIN clients c ON c.id = o.client_id
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.date BETWEEN $1 AND $2
     ORDER BY o.date, o.id`,
    [from, to]
  );
  res.set("content-type", "text/csv; charset=utf-8");
  res.set("content-disposition", `attachment; filename="pedidos-${from}-a-${to}.csv"`);
  const header = "pedido,fecha,cliente,estado,producto,cantidad,unidad,precio_unitario,subtotal,total_pedido\n";
  res.send(header + rows.map((r) => [r.id, r.date, r.client, r.status, r.product_name, r.quantity, r.unit_type, r.unit_price, r.subtotal, r.total].map(csvCell).join(",")).join("\n"));
});

app.get("/exports/backup.json", authenticate, requireRole("manager"), async (req, res) => {
  const { rows } = await pool.query("SELECT data, updated_at FROM app_state WHERE id = 'main'");
  if (!rows.length) return res.status(404).json({ error: "Sin datos guardados todavía." });
  const history = await loadProductHistoryState(pool);
  res.set("content-disposition", `attachment; filename="pare-carrito-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    exportedAt: new Date().toISOString(),
    updatedAt: rows[0].updated_at,
    data: rows[0].data,
    productHistory: {
      listPriceHistory: history.listPriceHistory,
      salesQuantityHistory: history.salesQuantityHistory,
      purchaseHistory: history.purchaseHistory,
      updatedAt: history.updatedAt
    }
  });
});

// ---------- Facturación automática (TusFacturasAPP) ----------
app.get("/billing/status", authenticate, requireRole("manager", "admin", "contador"), async (req, res) => {
  const cfg = billingConfig();
  const stateRow = await pool.query("SELECT data FROM app_state WHERE id = 'main'");
  const data = stateRow.rows.length ? stateRow.rows[0].data : { clients: [], orders: [], billingLog: [] };
  const art = nowArt();
  const preview = computeDueInvoices(data, art, true).map((d) => ({ clientId: d.clientId, clientName: d.client.name, freq: d.freq, from: d.from, to: d.to, total: d.total, iva: d.iva, orders: d.orders }));
  res.json({
    enabled: cfg.enabled,
    puntoVenta: cfg.puntoVenta,
    horaArgentina: art,
    pendientes: preview,
    log: (data.billingLog || []).slice(-50).reverse()
  });
});

app.post("/billing/run", authenticate, requireRole("manager", "admin", "contador"), async (req, res) => {
  const body = req.body || {};
  try {
    const clientIds = Array.isArray(body.clientIds)
      ? body.clientIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    const ivaOverrides = body.ivaOverrides && typeof body.ivaOverrides === "object" ? body.ivaOverrides : {};
    const result = await runBilling({ pool, force: true, simulate: body.simulate === true, onlyClientId: String(body.clientId || ""), onlyClientIds: clientIds, ivaOverrides });
    try { await emailBillingResults(result.results); } catch (e) { console.error("emailBillingResults:", e.message); }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Fallo la facturacion: " + error.message });
  }
});

// ---------- API externa para sistemas de terceros ----------
// Autenticacion: header  x-api-key: <EXTERNAL_API_KEY>  (definido en .env)
function externalAuth(req, res, next) {
  const key = process.env.EXTERNAL_API_KEY || "";
  if (!key) return res.status(503).json({ error: "API externa deshabilitada: configure EXTERNAL_API_KEY en el .env." });
  if (String(req.headers["x-api-key"] || "") !== key) return res.status(401).json({ error: "x-api-key inválida." });
  next();
}

async function loadStateData() {
  const row = await pool.query("SELECT data, updated_at FROM app_state WHERE id = 'main'");
  if (!row.rows.length) return null;
  return { data: row.rows[0].data, updatedAt: row.rows[0].updated_at.toISOString() };
}

function clientBalanceFromState(data, clientId) {
  return (data.saldos || []).filter((e) => e.clientId === clientId).reduce((sum, e) => sum + Number(e.amount || 0), 0);
}

// ---------- Lista de precios PUBLICA (sin login) ----------
// Devuelve nombre + precio de lista (general) + IVA de los productos activos. Se mantiene al dia
// sola porque lee el estado actual. La columna "con IVA" usa la tasa real del producto, salvo el
// 10,5% que se calcula al 12% (buffer para venta con factura).
function publicIvaSurcharge(ivaType) {
  // Recargo total para la lista "con IVA": IVA real del producto (10,5% o 21%) MAS un 2% extra
  // por gastos bancarios (multiplicativo sobre el precio con IVA). No se discrimina en la pagina.
  const s = String(ivaType == null ? "10.5" : ivaType).toLowerCase().replace(",", ".");
  let rate;
  if (s === "exento" || s === "no_gravado") rate = 0;
  else { const n = parseFloat(s); rate = Number.isFinite(n) ? n : 10.5; }
  const factor = (1 + rate / 100) * 1.02;
  return Math.round((factor - 1) * 10000) / 100; // porcentaje con 2 decimales
}
function publicIvaLabel(ivaType) {
  const s = String(ivaType == null ? "10.5" : ivaType).toLowerCase().replace(",", ".");
  if (s === "exento" || s === "no_gravado") return "Exento";
  const n = parseFloat(s);
  const rate = Number.isFinite(n) ? n : 10.5;
  return (rate === 10.5 ? 12 : rate).toString().replace(".", ",") + "%";
}
app.get("/public/price-list", async (req, res) => {
  const stored = await loadStateData();
  if (!stored) return res.json({ businessName: "Pare Carrito", updatedAt: null, items: [] });
  const d = stored.data || {};
  const settings = d.appSettings || {};
  if (settings.publicPriceListEnabled === false) return res.status(404).json({ error: "Lista no disponible." });
  const prices = d.prices || {};
  // Unidades marcadas como "por mayor" (jaula, cajon, bolsa, etc.) segun la config del sistema.
  const DEF_UNITS = [
    { name: "kg", wholesale: false }, { name: "docena", wholesale: false }, { name: "jaula", wholesale: true },
    { name: "cajon", wholesale: true }, { name: "bolsa", wholesale: true }, { name: "unidad", wholesale: false },
    { name: "maple", wholesale: false }, { name: "ristra", wholesale: false }, { name: "cabeza", wholesale: false },
    { name: "bandeja", wholesale: false }, { name: "atado", wholesale: false }
  ];
  const unitCfg = Array.isArray((d.appSettings || {}).unitTypes) && d.appSettings.unitTypes.length ? d.appSettings.unitTypes : DEF_UNITS;
  const wholesaleSet = new Set(unitCfg.filter((u) => u && u.wholesale).map((u) => String(u.name || "").toLowerCase()));
  const categoryRank = (c) => ({ FRUTAS: 1, VERDURAS: 2, HUEVOS: 3, OTROS: 4 }[String(c || "").toUpperCase()] || 99);
  const items = (d.products || [])
    .filter((p) => p && p.isActive !== false)
    .map((p) => {
      const rec = prices[p.id] || {};
      const price = Number(rec.price || p.salePrice || 0);
      const unitType = String(p.unitType || "");
      // Imagen: misma que en el sistema. imageUrl "./assets/..." -> "/assets/..." (ruta absoluta
      // servida por Caddy). Si el producto tiene imagen propia (imageData), se manda esa.
      let image = null;
      if (p.imageUrl) image = String(p.imageUrl).replace(/^\.\//, "/");
      else if (p.imageData) image = p.imageData;
      return {
        name: p.name,
        category: (p.category || "OTROS").toUpperCase(),
        unitType,
        wholesale: wholesaleSet.has(unitType.toLowerCase()),
        price,
        ivaSurcharge: publicIvaSurcharge(p.ivaType),
        ivaLabel: publicIvaLabel(p.ivaType),
        image,
        date: rec.date || null
      };
    })
    .filter((it) => it.price > 0)
    .sort((a, b) => (categoryRank(a.category) - categoryRank(b.category)) || String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)));
  const categories = [];
  items.forEach((it) => { if (!categories.includes(it.category)) categories.push(it.category); });
  res.set("Cache-Control", "public, max-age=120");
  res.json({ businessName: "Pare Carrito", updatedAt: stored.updatedAt, categories, items });
});

app.get("/external/summary", externalAuth, async (req, res) => {
  const stored = await loadStateData();
  if (!stored) return res.status(404).json({ error: "Sin datos." });
  const d = stored.data;
  const today = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const todays = (d.orders || []).filter((o) => o.date === today && !["cancelado", "anulado"].includes(o.status));
  const balances = (d.clients || []).map((c) => ({ clientId: c.id, name: c.name, balance: clientBalanceFromState(d, c.id) }));
  const providerDebt = {};
  for (const e of d.providerLedger || []) providerDebt[e.providerId] = (providerDebt[e.providerId] || 0) + Number(e.amount || 0);
  const caja = (d.caja || []).reduce((sum, e) => sum + Number(e.amountIngreso || 0) - Number(e.amountEgreso || 0), 0);
  res.json({
    updatedAt: stored.updatedAt,
    pedidosHoy: todays.length,
    ventasHoy: todays.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0),
    cajaTotal: caja,
    saldosClientes: balances.reduce((sum, b) => sum + Math.max(0, b.balance), 0),
    deudaProveedores: Object.values(providerDebt).reduce((sum, v) => sum + Math.max(0, v), 0),
    transferenciasPendientes: (d.clientTransfers || []).filter((t) => t.status === "pending").length
  });
});

app.get("/external/balances", externalAuth, async (req, res) => {
  const stored = await loadStateData();
  if (!stored) return res.status(404).json({ error: "Sin datos." });
  const d = stored.data;
  res.json({ updatedAt: stored.updatedAt, balances: (d.clients || []).map((c) => ({ clientId: c.id, name: c.name, cuit: c.cuit || "", balance: clientBalanceFromState(d, c.id) })) });
});

app.get("/external/cash", externalAuth, async (req, res) => {
  const stored = await loadStateData();
  if (!stored) return res.status(404).json({ error: "Sin datos." });
  const d = stored.data;
  const byBox = {};
  for (const e of d.caja || []) {
    const box = e.cashBoxId || "cash-general";
    byBox[box] = (byBox[box] || 0) + Number(e.amountIngreso || 0) - Number(e.amountEgreso || 0);
  }
  res.json({ updatedAt: stored.updatedAt, cajas: byBox, movimientos: (d.caja || []).slice(-200) });
});

app.get("/external/providers", externalAuth, async (req, res) => {
  const stored = await loadStateData();
  if (!stored) return res.status(404).json({ error: "Sin datos." });
  const d = stored.data;
  const debt = {};
  for (const e of d.providerLedger || []) debt[e.providerId] = (debt[e.providerId] || 0) + Number(e.amount || 0);
  res.json({ updatedAt: stored.updatedAt, providers: (d.providers || []).map((p) => ({ id: p.id, name: p.name, phone: p.phone || "", isActive: p.isActive !== false, balance: debt[p.id] || 0 })) });
});

app.get("/external/transfers", externalAuth, async (req, res) => {
  const stored = await loadStateData();
  if (!stored) return res.status(404).json({ error: "Sin datos." });
  res.json({ updatedAt: stored.updatedAt, transfers: stored.data.clientTransfers || [] });
});

app.get("/external/payments", externalAuth, async (req, res) => {
  const stored = await loadStateData();
  if (!stored) return res.status(404).json({ error: "Sin datos." });
  const from = String(req.query.from || "0000-01-01");
  const to = String(req.query.to || "9999-12-31");
  res.json({ updatedAt: stored.updatedAt, payments: (stored.data.payments || []).filter((p) => String(p.date || "") >= from && String(p.date || "") <= to) });
});

app.get("/external/performance", externalAuth, async (req, res) => {
  const from = String(req.query.from || "1900-01-01");
  const to = String(req.query.to || "2999-12-31");
  const { rows } = await pool.query(
    `SELECT o.date::text AS date, COUNT(DISTINCT o.id)::int AS orders, COALESCE(SUM(o.total), 0)::float AS sales,
            COALESCE((SELECT SUM(p.total_cost) FROM purchases p WHERE p.date = o.date AND p.expense_type NOT IN ('market_price','prepared','cash_movement')), 0)::float AS expenses
     FROM orders o WHERE o.date BETWEEN $1 AND $2 AND o.status NOT IN ('cancelado','anulado')
     GROUP BY o.date ORDER BY o.date`,
    [from, to]
  );
  res.json({ from, to, days: rows.map((r) => ({ ...r, result: r.sales - r.expenses })) });
});

app.post("/external/transfers/:id/:action", externalAuth, async (req, res) => {
  const action = req.params.action;
  if (!["approve", "reject"].includes(action)) return res.status(400).json({ error: "Accion inválida (approve|reject)." });
  const clientDb = await pool.connect();
  try {
    await clientDb.query("BEGIN");
    const row = await clientDb.query("SELECT data FROM app_state WHERE id = 'main' FOR UPDATE");
    if (!row.rows.length) {
      await clientDb.query("ROLLBACK");
      return res.status(404).json({ error: "Sin datos." });
    }
    const data = row.rows[0].data;
    const transfer = (data.clientTransfers || []).find((t) => t.id === req.params.id);
    if (!transfer || transfer.status !== "pending") {
      await clientDb.query("ROLLBACK");
      return res.status(404).json({ error: "Transferencia no encontrada o ya revisada." });
    }
    transfer.reviewedBy = "API externa";
    transfer.reviewedAt = new Date().toISOString();
    if (action === "reject") {
      transfer.status = "rejected";
    } else {
      transfer.status = "accepted";
      const today = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
      const payment = { id: "PAY-EXT-" + Date.now(), date: today, clientId: transfer.clientId, amount: Number(transfer.amount || 0), method: "transferencia", receivedByUserId: "external-api", notes: "Transferencia aprobada vía API externa - " + transfer.id };
      data.payments = data.payments || [];
      data.payments.push(payment);
      const lastBalance = clientBalanceFromState(data, transfer.clientId);
      data.saldos = data.saldos || [];
      data.saldos.push({ id: "SAL-EXT-" + Date.now(), date: today, clientId: transfer.clientId, type: "pago", description: "Pago transferencia (API externa) " + transfer.id, amount: -payment.amount, balance: lastBalance - payment.amount, relatedEntityId: payment.id, relatedEntityType: "payment" });
      data.caja = data.caja || [];
      data.caja.push({ id: "CAJ-EXT-" + Date.now(), date: today, type: "payment", concept: "Pago transferencia (API externa) - " + transfer.id, amountIngreso: payment.amount, amountEgreso: 0, cashBoxId: "cash-banco", relatedEntityId: payment.id, relatedEntityType: "payment" });
    }
    await clientDb.query("UPDATE app_state SET data = $1, updated_at = now(), updated_by = 'api-externa' WHERE id = 'main'", [data]);
    await clientDb.query("COMMIT");
    res.json({ ok: true, id: transfer.id, status: transfer.status });
  } catch (error) {
    await clientDb.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: error.message });
  } finally {
    clientDb.release();
  }
});

// ---------- API externa: pedidos por WhatsApp (bot) ----------
function normTxt(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const UNIT_WORDS = /\b(kg|kilo|kilos|docena|cajon|unidad|unid|uni|atado|bolsa|jaula|caja|paquete|paq)\b/g;

// Busca un producto activo que coincida con el texto del cliente.
function findProductByText(data, text) {
  const products = (data.products || []).filter((p) => p.isActive !== false);
  const qRaw = normTxt(text);
  if (!qRaw) return null;
  // 1) alias exacto (sobre texto crudo: hay alias que incluyen unidades, ej. "pepino uni")
  for (const a of data.productAliases || []) {
    if (normTxt(a.alias) === qRaw) {
      const p = products.find((x) => x.id === a.productId);
      if (p) return p;
    }
  }
  // 2) nombre exacto
  let best = products.find((p) => normTxt(p.name) === qRaw);
  if (best) return best;
  // 3) limpiar numeros y unidades sueltas (ej. "2 kg tomate" -> "tomate")
  const q = qRaw.replace(/\b\d+([.,]\d+)?\b/g, " ").replace(UNIT_WORDS, " ").replace(/\s+/g, " ").trim();
  if (!q) return null;
  best = products.find((p) => normTxt(p.name).replace(UNIT_WORDS, " ").replace(/\s+/g, " ").trim() === q);
  if (best) return best;
  // 4) coincidencia parcial: el nombre empieza con lo pedido, o comparten la primera palabra
  const first = q.split(" ")[0];
  const cands = products.filter((p) => {
    const n = normTxt(p.name);
    const nNoUnit = n.replace(UNIT_WORDS, " ").replace(/\s+/g, " ").trim();
    return nNoUnit.startsWith(q) || q.startsWith(nNoUnit) || (first && n.split(" ")[0] === first);
  });
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) {
    cands.sort((a, b) => a.name.length - b.name.length);
    return cands[0];
  }
  return null;
}

function productUnitPrice(data, product, client) {
  const priced = (data.prices && data.prices[product.id]) || null;
  let base = Number((priced && priced.price) || product.salePrice || 0);
  const adj = Number((client && client.priceAdjustmentPct) || 0);
  if (adj) base = base * (1 + adj / 100);
  return Math.round(base * 100) / 100;
}

function newItemIdExt() {
  return "ITEM-" + Math.random().toString(36).slice(2, 9).toUpperCase();
}

function buildOrderItemExt(data, product, qty, note, client, round) {
  const unitPrice = productUnitPrice(data, product, client);
  const quantity = Number(qty) || 0;
  const needsInvoice = !!(client && client.needsInvoice);
  const ivaRate = needsInvoice ? Number(product.ivaType) || 0 : 0;
  const subtotal = Math.round(unitPrice * quantity * 100) / 100;
  const ivaAmount = Math.round(subtotal * ivaRate) / 100;
  const item = {
    id: newItemIdExt(),
    productId: product.id,
    productName: product.name,
    unitType: product.unitType || "",
    quantity,
    unitPrice,
    subtotal,
    ivaRate,
    ivaAmount,
    totalWithIva: Math.round((subtotal + ivaAmount) * 100) / 100,
    note: note || "",
    assignedToId: product.assignedToId || "",
    assignedToType: product.assignedToType || "",
    assignedProviderId: ""
  };
  if (Number(round) === 2) item.segundaRonda = true;
  return item;
}

function recomputeOrderTotalsExt(order) {
  const items = order.items || [];
  order.subtotalAmount = Math.round(items.reduce((s, i) => s + Number(i.subtotal || 0), 0) * 100) / 100;
  order.ivaAmount = Math.round(items.reduce((s, i) => s + Number(i.ivaAmount || 0), 0) * 100) / 100;
  order.totalAmount = Math.round((order.subtotalAmount + order.ivaAmount) * 100) / 100;
  order.updatedAt = new Date().toISOString();
}

function genOrderIdExt(data, dateISO) {
  const compact = dateISO.replace(/-/g, "");
  let n = (data.orders || []).filter((o) => o.date === dateISO).length + 1;
  let id;
  do {
    id = "ORD-" + compact + "-" + String(n).padStart(3, "0");
    n++;
  } while ((data.orders || []).some((o) => o.id === id));
  return id;
}

// Ejecuta un update transaccional sobre app_state y re-espeja a las tablas.
async function withStateExt(updater) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const row = await db.query("SELECT data FROM app_state WHERE id = 'main' FOR UPDATE");
    if (!row.rows.length) {
      await db.query("ROLLBACK");
      return { error: "Sin datos.", status: 404 };
    }
    const data = row.rows[0].data;
    const result = await updater(data);
    if (result && result.error) {
      await db.query("ROLLBACK");
      return result;
    }
    await db.query("UPDATE app_state SET data = $1, updated_at = now(), updated_by = 'whatsapp-bot' WHERE id = 'main'", [data]);
    await mirrorStateToTables(db, data);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    return { error: error.message, status: 500 };
  } finally {
    db.release();
  }
}

app.get("/external/clients/by-phone/:phone", externalAuth, async (req, res) => {
  const stored = await loadStateData();
  if (!stored) return res.status(404).json({ error: "Sin datos." });
  const digits = String(req.params.phone || "").replace(/\D/g, "");
  const tail = digits.slice(-8);
  const client = (stored.data.clients || []).find((c) => {
    const candidates = [c.phone].concat(Array.isArray(c.phones) ? c.phones : []);
    return candidates.some((ph) => {
      const cd = String(ph || "").replace(/\D/g, "");
      return cd && (cd === digits || (tail && cd.slice(-8) === tail));
    });
  });
  if (!client) return res.json({ client: null });
  res.json({
    client: {
      id: client.id,
      name: client.name,
      needsInvoice: !!client.needsInvoice,
      priceTier: client.priceTier || "general",
      priceAdjustmentPct: Number(client.priceAdjustmentPct || 0),
      isActive: client.isActive !== false
    }
  });
});

app.get("/external/orders/today/:clientId", externalAuth, async (req, res) => {
  const stored = await loadStateData();
  if (!stored) return res.status(404).json({ error: "Sin datos." });
  const today = nowArt().dateISO;
  const order = (stored.data.orders || []).find(
    (o) => o.clientId === req.params.clientId && o.date === today && !["cancelado", "anulado"].includes(o.status) && !o.exampleOnly
  );
  if (!order) return res.json({ order: null });
  res.json({
    order: {
      id: order.id,
      date: order.date,
      status: order.status,
      totalAmount: order.totalAmount,
      items: (order.items || []).map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity, unitType: i.unitType }))
    }
  });
});

app.get("/external/products/names", externalAuth, async (req, res) => {
  const stored = await loadStateData();
  if (!stored) return res.status(404).json({ error: "Sin datos." });
  res.json({ products: (stored.data.products || []).filter((p) => p.isActive !== false).map((p) => p.name) });
});

app.post("/external/orders", externalAuth, async (req, res) => {
  const { clientId, items, source } = req.body || {};
  if (!clientId || !Array.isArray(items)) return res.status(400).json({ error: "clientId e items son requeridos." });
  const out = await withStateExt((data) => {
    const client = (data.clients || []).find((c) => c.id === clientId);
    if (!client) return { error: "Cliente no encontrado.", status: 404 };
    const built = [];
    const unmatched = [];
    for (const it of items) {
      const p = findProductByText(data, it.producto || it.productName || "");
      if (!p) {
        unmatched.push(it.producto || it.productName || "");
        continue;
      }
      built.push(buildOrderItemExt(data, p, it.cantidad != null ? it.cantidad : it.quantity, it.nota || it.note, client, 1));
    }
    const today = nowArt().dateISO;
    const order = {
      id: genOrderIdExt(data, today),
      date: today,
      clientId,
      userId: "whatsapp-bot",
      status: "pendiente",
      items: built,
      notes: (source ? "[" + source + "] " : "") + (unmatched.length ? "Sin matchear: " + unmatched.join(", ") : ""),
      priceTier: client.priceTier || "general",
      priceAdjustmentPct: Number(client.priceAdjustmentPct || 0),
      deliveryVehicleId: client.vehicleId || "",
      exampleOnly: false,
      paymentStatus: "pending",
      paymentReceived: 0,
      remitoPrinted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    recomputeOrderTotalsExt(order);
    data.orders = data.orders || [];
    data.orders.push(order);
    return { ok: true, orderId: order.id, matched: built.length, unmatched };
  });
  if (out.error) return res.status(out.status || 500).json({ error: out.error });
  res.json(out);
});

app.post("/external/orders/:orderId/items", externalAuth, async (req, res) => {
  const { items, round } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: "items son requeridos." });
  const out = await withStateExt((data) => {
    const order = (data.orders || []).find((o) => o.id === req.params.orderId);
    if (!order) return { error: "Pedido no encontrado.", status: 404 };
    const client = (data.clients || []).find((c) => c.id === order.clientId) || {};
    const unmatched = [];
    let added = 0;
    order.items = order.items || [];
    for (const it of items) {
      const p = findProductByText(data, it.producto || it.productName || "");
      if (!p) {
        unmatched.push(it.producto || it.productName || "");
        continue;
      }
      order.items.push(buildOrderItemExt(data, p, it.cantidad != null ? it.cantidad : it.quantity, it.nota || it.note, client, Number(round) === 2 ? 2 : 1));
      added++;
    }
    recomputeOrderTotalsExt(order);
    return { ok: true, added, unmatched, round: Number(round) === 2 ? 2 : 1 };
  });
  if (out.error) return res.status(out.status || 500).json({ error: out.error });
  res.json(out);
});

app.post("/external/orders/:orderId/cancel", externalAuth, async (req, res) => {
  const items = Array.isArray((req.body || {}).items) ? req.body.items : [];
  const out = await withStateExt((data) => {
    const order = (data.orders || []).find((o) => o.id === req.params.orderId);
    if (!order) return { error: "Pedido no encontrado.", status: 404 };
    if (!items.length) {
      order.status = "anulado";
      order.updatedAt = new Date().toISOString();
      return { ok: true, cancelledOrder: true };
    }
    const before = (order.items || []).length;
    const targets = items.map((it) => normTxt(it.producto || it.productName || "")).filter(Boolean);
    order.items = (order.items || []).filter((i) => {
      const n = normTxt(i.productName);
      return !targets.some((t) => n === t || n.includes(t) || t.includes(n.split(" ")[0]));
    });
    recomputeOrderTotalsExt(order);
    return { ok: true, removed: before - order.items.length };
  });
  if (out.error) return res.status(out.status || 500).json({ error: out.error });
  res.json(out);
});


// ---------- Sheets -> ERP: "Compra Hoy" actualiza el costo del producto ----------
const SHEET_NOISE = new Set(["por", "x", "de", "del"]);
function sheetNormFlat(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s\/]/g, " ").replace(/\//g, " ")
    .split(/\s+/).filter((w) => w && !SHEET_NOISE.has(w)).join(" ");
}
function sheetNormSet(s) {
  return sheetNormFlat(s).split(" ").filter(Boolean).sort().join(" ");
}
// erp (nombre normalizado plano) -> encabezado del sheet. Igual que en el Apps Script.
const SHEET_OVERRIDES = {
  "champinon": "Champignones",
  "albahaca seca kg": "Albahaca seca",
  "laurel atado": "Laurel",
  "tanjarina jaula": "Tanjarina",
  "quinoa kg": "Quinoa",
  "nabos atado": "Nabos",
  "maracuya unidad": "Maracuya",
  "hongos pino kg": "Hongos de Pino",
  "esparragos kg": "Esparragos",
  "repollos brucelas kg": "Repollos de Brucelas",
  "habas kg": "Habas",
  "garbanzo kg": "Garbanzo",
  "lentejas kg": "Lenteja por Kg",
  "oregano kg": "Oregano",
  "uva rosa kg": "Uva Rosa",
  "zapallo amarillo": "Zapallo Amarillo Kg",
  "lechuga mantecosa": "Lechuga Mantecosa unidad",
  "papines": "Papines por kg"
};
function matchProductBySheetName(data, sheetName) {
  const target = sheetNormSet(sheetName);
  if (!target) return null;
  const active = (data.products || []).filter((p) => p.isActive !== false);
  let p = active.find((pr) => sheetNormSet(pr.name) === target);
  if (p) return p;
  for (const erpFlat in SHEET_OVERRIDES) {
    if (sheetNormSet(SHEET_OVERRIDES[erpFlat]) === target) {
      const prod = active.find((pr) => sheetNormFlat(pr.name) === erpFlat);
      if (prod) return prod;
    }
  }
  return null;
}

// El valor de "Compra Hoy" del sheet actualiza el costo del producto (cost + marketPrice),
// igual que el efecto de una compra/gasto sobre el precio del producto.
app.post("/external/compra-hoy", externalAuth, async (req, res) => {
  // DESVINCULADO: la planilla de Google Sheets ya NO actualiza los precios del sistema.
  // Desde ahora el sistema es la unica fuente de verdad de precios (una compra/gasto define el
  // costo/precio) y solo el sistema actualiza la planilla (salida via syncSheetsFromStateDiff /
  // pushPrecio). La planilla queda como control. Para reactivar el sentido planilla->sistema,
  // setear SHEETS_INBOUND_PRICES=on en el entorno.
  if (String(process.env.SHEETS_INBOUND_PRICES || "").toLowerCase() !== "on") {
    return res.json({ ok: true, skipped: "sheets->sistema desactivado: la planilla ya no actualiza precios" });
  }
  const body = req.body || {};
  const value = Number(body.costo != null ? body.costo : body.compraHoy);
  if (!body.producto || !Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ error: "Se espera { producto, costo }." });
  }
  const out = await withStateExt((data) => {
    const product = matchProductBySheetName(data, body.producto);
    if (!product) return { error: "Producto no encontrado: " + body.producto, status: 404 };
    data.prices = data.prices || {};
    const rec = data.prices[product.id] || { productId: product.id, price: Number(product.salePrice || 0), cost: Number(product.baseCost || 0), marketPrice: 0, marginPct: 25 };
    const calcMargin = (c, pr) => { c = Number(c || 0); pr = Number(pr || 0); return c ? ((pr - c) / c) * 100 : 0; };
    const round1 = (v) => Math.round(Number(v || 0) * 10) / 10;
    // Mantener el margen del producto y recalcular el precio de venta, igual que una compra.
    const margin = Number.isFinite(Number(rec.marginPct)) ? Number(rec.marginPct) : calcMargin(rec.cost, rec.price);
    rec.cost = value;
    rec.marketPrice = value;
    rec.marginPct = round1(margin);
    rec.price = Math.ceil(value * (1 + margin / 100));
    rec.date = new Date().toISOString().slice(0, 10);
    // El precio final lo define el motor de precios en el frontend (modo simulacion/activado).
    // Se deja un precio provisional con el margen vigente y se marca pendingReprice para que
    // el frontend lo recalcule al cargar (bajo modo "off" el resultado es el mismo).
    rec.pendingReprice = true;
    data.prices[product.id] = rec;
    product.baseCost = rec.cost;
    product.salePrice = rec.price;
    return { ok: true, productId: product.id, productName: product.name, cost: rec.cost, venta: rec.price };
  });
  if (out.error) return res.status(out.status || 500).json({ error: out.error });
  // Reflejar el Costo actualizado en el sheet (NO toca la columna Compra Hoy).
  pushPrecio(out.productName, out.venta, out.cost);
  res.json(out);
});

// Aviso de feriado: junta los telefonos de clientes activos y los manda por el bot (plantilla).
app.post("/clients/holiday-broadcast", authenticate, requireRole("manager", "admin"), async (req, res) => {
  const botUrl = process.env.BOT_BROADCAST_URL || "";
  const botKey = process.env.BROADCAST_KEY || "";
  if (!botUrl) return res.status(503).json({ error: "Aviso por WhatsApp no configurado (BOT_BROADCAST_URL)." });
  const stored = await loadStateData();
  if (!stored) return res.status(404).json({ error: "Sin datos." });
  const d = stored.data || {};
  const settings = d.appSettings || {};
  if (whatsappOff(settings)) return res.json({ ok: true, skipped: "whatsapp desactivado" });
  const templateName = settings.holidayTemplateName || "";
  if (!templateName) return res.status(400).json({ error: "Configura el nombre de la plantilla de Meta en Configuracion." });
  const lang = settings.holidayTemplateLang || "es";
  const date = String((req.body || {}).date || "");
  const name = String((req.body || {}).name || "");
  let msg = settings.holidayMessage || "Te recordamos que el {fecha} ({feriado}) no hay reparto por feriado.";
  msg = msg.replace(/{fecha}/g, date).replace(/{feriado}/g, name);
  const numbers = [];
  (d.clients || []).filter((c) => c.isActive !== false).forEach((c) => {
    [c.phone].concat(Array.isArray(c.phones) ? c.phones : []).forEach((ph) => {
      const cd = String(ph || "").replace(/\D/g, "");
      if (cd) numbers.push(cd);
    });
  });
  const unique = Array.from(new Set(numbers));
  if (!unique.length) return res.json({ ok: true, sent: 0, failed: 0, note: "No hay numeros cargados." });
  try {
    const r = await fetch(botUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-broadcast-key": botKey },
      body: JSON.stringify({ numbers: unique, templateName, lang, params: [msg] })
    });
    const payload = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: payload.error || "El bot no pudo enviar." });
    res.json({ ok: true, sent: payload.sent || 0, failed: payload.failed || 0, total: unique.length });
  } catch (error) {
    res.status(502).json({ error: "No se pudo contactar al bot: " + error.message });
  }
});

// Aviso al cliente cuando se agrega/quita un producto de su pedido (plantilla editable en Configuracion).
app.post("/clients/order-change-notify", authenticate, async (req, res) => {
  const botUrl = process.env.BOT_BROADCAST_URL || "";
  const botKey = process.env.BROADCAST_KEY || "";
  if (!botUrl) return res.status(503).json({ error: "Aviso por WhatsApp no configurado (BOT_BROADCAST_URL)." });
  const stored = await loadStateData();
  if (!stored) return res.status(404).json({ error: "Sin datos." });
  const d = stored.data || {};
  const settings = d.appSettings || {};
  if (whatsappOff(settings)) return res.json({ ok: true, skipped: "whatsapp desactivado" });
  if (!settings.orderChangeNotifyEnabled) return res.json({ ok: true, skipped: "deshabilitado" });
  const templateName = settings.orderChangeTemplateName || "";
  if (!templateName) return res.status(400).json({ error: "Configura la plantilla de aviso de cambios en Configuracion." });
  const lang = settings.orderChangeTemplateLang || "es";
  const clientId = String((req.body || {}).clientId || "");
  const detail = String((req.body || {}).detail || "");
  const client = (d.clients || []).find((c) => c.id === clientId);
  if (!client) return res.status(404).json({ error: "Cliente no encontrado." });
  const phone = String(client.phone || (Array.isArray(client.phones) ? client.phones[0] : "") || "").replace(/\D/g, "");
  if (!phone) return res.json({ ok: true, sent: 0, note: "El cliente no tiene celular principal." });
  let msg = settings.orderChangeMessage || "Hola {cliente}, actualizamos tu pedido de hoy: {detalle}. Cualquier cosa avisanos.";
  msg = msg.replace(/{cliente}/g, client.name || "").replace(/{detalle}/g, detail);
  try {
    const r = await fetch(botUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-broadcast-key": botKey },
      body: JSON.stringify({ numbers: [phone], templateName, lang, params: [msg] })
    });
    const payload = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: payload.error || "El bot no pudo enviar." });
    res.json({ ok: true, sent: payload.sent || 0, failed: payload.failed || 0 });
  } catch (error) {
    res.status(502).json({ error: "No se pudo contactar al bot: " + error.message });
  }
});

// Aviso de suba de precio: manda WhatsApp (plantilla aprobada) a los clientes indicados con
// su propio precio anterior/nuevo. El frontend arma "notices" con clientId + precios ya calculados.
app.post("/clients/price-increase-notify", authenticate, async (req, res) => {
  const botUrl = process.env.BOT_BROADCAST_URL || "";
  const botKey = process.env.BROADCAST_KEY || "";
  if (!botUrl) return res.status(503).json({ error: "Aviso por WhatsApp no configurado (BOT_BROADCAST_URL)." });
  const stored = await loadStateData();
  if (!stored) return res.status(404).json({ error: "Sin datos." });
  const d = stored.data || {};
  const settings = d.appSettings || {};
  if (whatsappOff(settings)) return res.json({ ok: true, skipped: "whatsapp desactivado" });
  const templateName = settings.priceIncreaseTemplateName || "";
  if (!templateName) return res.status(400).json({ error: "Configura la plantilla de aviso de suba en Configuracion." });
  const lang = settings.priceIncreaseTemplateLang || "es";
  const tpl = settings.priceIncreaseMessage || "El producto {producto} tuvo una suba de un {porcentaje}%, paso de valer {precioAnterior} a valer {precioNuevo}, si se desea cancelar la compra avisar, de caso contrario no hace falta contestar, gracias";
  const money = (v) => "$" + Number(v || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const clients = d.clients || [];
  const notices = Array.isArray((req.body || {}).notices) ? req.body.notices : [];
  let sent = 0;
  let failed = 0;
  for (const n of notices) {
    const client = clients.find((c) => c.id === String(n.clientId));
    if (!client) continue;
    const phone = String(client.phone || (Array.isArray(client.phones) ? client.phones[0] : "") || "").replace(/\D/g, "");
    if (!phone) continue;
    const msg = tpl
      .replace(/{producto}/g, String(n.productName || ""))
      .replace(/{porcentaje}/g, String(n.pct != null ? n.pct : ""))
      .replace(/{precioAnterior}/g, money(n.oldPrice))
      .replace(/{precioNuevo}/g, money(n.newPrice));
    try {
      const r = await fetch(botUrl, { method: "POST", headers: { "content-type": "application/json", "x-broadcast-key": botKey }, body: JSON.stringify({ numbers: [phone], templateName, lang, params: [msg] }) });
      if (r.ok) sent += 1; else failed += 1;
    } catch (e) { failed += 1; }
  }
  res.json({ ok: true, sent, failed });
});

// Regenera (URL fresca) el PDF de una factura ya emitida en TusFacturas. La URL del alta caduca.
app.post("/billing/regenerate-pdf", authenticate, requireRole("manager", "admin", "contador"), async (req, res) => {
  const cfg = billingConfig();
  if (!cfg.enabled) return res.status(503).json({ error: "TusFacturas no esta configurado en el servidor." });
  const body = req.body || {};
  const tComp = String(body.tipo || body.invoiceType || "").trim();
  const numero = String(body.numero || "").trim();
  if (!tComp || !numero) return res.status(400).json({ error: "Se espera { invoiceType (o tipo), numero }." });
  try {
    const url = await regeneratePdf(cfg, { tipo: tComp, operacion: "V", numeroCompleto: numero });
    if (!url) return res.status(502).json({ error: "TusFacturas no devolvio un PDF." });
    res.json({ ok: true, url });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

async function loadBillingLastRunDate() {
  try {
    const { rows } = await pool.query("SELECT data->>'billingLastRunDate' AS d FROM app_state WHERE id = 'main'");
    return rows[0]?.d || "";
  } catch (error) {
    console.warn("No se pudo cargar billingLastRunDate:", error.message);
    return "";
  }
}

async function saveBillingLastRunDate(value) {
  if (!value) return;
  try {
    await pool.query("UPDATE app_state SET data = jsonb_set(COALESCE(data, '{}'), '{billingLastRunDate}', to_jsonb($1::text)), updated_at = now(), updated_by = 'facturacion-automatica' WHERE id = 'main'", [value]);
  } catch (error) {
    console.warn("No se pudo guardar billingLastRunDate:", error.message);
  }
}

let billingLastRunDate = "";
async function initBillingScheduler() {
  billingLastRunDate = await loadBillingLastRunDate();
  startBillingScheduler();
}

function startBillingScheduler() {
  setInterval(async () => {
    try {
      const art = nowArt();
      if (art.hour >= 23 && billingLastRunDate !== art.dateISO) {
        const bcfg = await pool.query("SELECT data->'appSettings'->>'billingEnabled' AS b FROM app_state WHERE id = 'main'").catch(() => ({ rows: [] }));
        if (bcfg.rows[0] && bcfg.rows[0].b === "false") { return; }
        const result = await runBilling({ pool, lastRunDate: billingLastRunDate });
        try { await emailBillingResults(result.results); } catch (e) { console.error("emailBillingResults:", e.message); }
        if (result.lastRunDate) {
          billingLastRunDate = result.lastRunDate;
          await saveBillingLastRunDate(billingLastRunDate);
        }
        if (result.count) console.log("Facturación automática:", result.count, "comprobante(s) procesado(s)", result.simulate ? "(simulada)" : "");
      }
    } catch (error) {
      console.error("Facturación automática falló:", error.message);
    }
  }, 5 * 60 * 1000);
}

// ---------- Recordatorios de pago (dunning) ----------
async function runDunning({ pool, now = new Date() }) {
  const botUrl = process.env.BOT_BROADCAST_URL || "";
  const botKey = process.env.BROADCAST_KEY || "";
  const stateRow = await pool.query("SELECT data FROM app_state WHERE id = 'main'");
  if (!stateRow.rows.length) return { ran: false };
  const d = stateRow.rows[0].data || {};
  const settings = d.appSettings || {};
  if (!settings.dunningEnabled) return { ran: false, reason: "deshabilitado" };
  const art = nowArt(now);
  const today = art.dateISO;
  const addN = (iso, n) => { const x = new Date(iso + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const addMonthClamp = (iso) => { const x = new Date(iso + "T12:00:00"); const dd = x.getDate(); x.setMonth(x.getMonth() + 1); if (x.getDate() < dd) x.setDate(0); return x.toISOString().slice(0, 10); };
  const yesterday = addN(today, -1);
  const clients = d.clients || [];
  const payments = (d.payments || []).filter((p) => p && p.status !== "anulado");
  const saldos = d.saldos || [];
  const orders = d.orders || [];
  const balanceOf = (cid) => saldos.filter((s) => s.clientId === cid).reduce((a, s) => a + Number(s.amount || 0), 0);
  const paymentDatesOf = (cid) => {
    const set = new Set();
    payments.filter((p) => p.clientId === cid).forEach((p) => set.add(String(p.date || "")));
    saldos.filter((s) => s.clientId === cid && s.type === "pago").forEach((s) => set.add(String(s.date || "")));
    return set;
  };
  const lastPayOf = (cid) => { const arr = [...paymentDatesOf(cid)].filter(Boolean).sort(); return arr.length ? arr[arr.length - 1] : ""; };
  const firstDebtOf = (cid) => (saldos.filter((s) => s.clientId === cid).map((s) => String(s.date || "")).sort()[0]) || today;
  const hasPaymentOnOrAfter = (cid, dateISO) => [...paymentDatesOf(cid)].some((dt) => dt && dt >= dateISO);
  const pagoEn = (cid, dateISO) => paymentDatesOf(cid).has(dateISO);
  const managerEmail = ((d.users || []).find((u) => u && u.role === "manager" && u.email) || {}).email || process.env.MANAGER_EMAIL || "";
  const isoWeekday = (iso) => { const g = new Date(iso + "T12:00:00").getDay(); return g === 0 ? 7 : g; };
  const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
  const expectedDueFor = (c) => {
    const anchor = lastPayOf(c.id) || firstDebtOf(c.id);
    const t = c.paymentType;
    if (t === "dias_10") return addN(anchor, 10);
    if (t === "dias_15") return addN(anchor, 15);
    if (t === "dias_20") return addN(anchor, 20);
    if (t === "mensual") return addMonthClamp(anchor);
    return "";
  };
  const isExpectedDay = (c, dateISO) => {
    const t = c.paymentType;
    if (t === "contado" || t === "contra_factura") return orders.some((o) => o && o.clientId === c.id && o.date === dateISO && !["anulado", "cancelado"].includes(o.status));
    if (t === "semanal" || t === "cuenta_corriente") { const pd = Number(c.paymentDay || 0); if (!pd) return false; return isoWeekday(dateISO) === pd; }
    if (["dias_10", "dias_15", "dias_20", "mensual"].includes(t)) return expectedDueFor(c) === dateISO;
    return false;
  };
  const money = (v) => "$" + Number(v || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const waTpl = settings.dunningWhatsappMessage || "Hola {cliente}, ayer no registramos el pago correspondiente, su saldo es {saldo} por favor regularizar su deuda";
  const mailTpl = settings.dunningMailMessage || "El cliente {cliente} tiene una demora de pago de {diassinpago} y su saldo es {saldo}.";
  const mailSubject = settings.dunningMailSubject || "Demora de pago: {cliente}";
  const templateName = settings.dunningWhatsappTemplate || "";
  const lang = settings.dunningWhatsappLang || "es";
  const dunningState = await loadDunningState();
  let waSent = 0;
  let mailsSent = 0;
  for (const c of clients) {
    try {
      if (!c || c.isActive === false) continue;
      const bal = balanceOf(c.id);
      if (bal <= 0) { delete dunningState[c.id]; continue; }
      let st = dunningState[c.id];
      // Si pago en o despues del dia esperado registrado, se sale de mora.
      if (st && st.dueDate && hasPaymentOnOrAfter(c.id, st.dueDate)) { delete dunningState[c.id]; st = null; }
      if (!st) {
        // Inicio de mora: ayer era dia esperado y no pago.
        if (isExpectedDay(c, yesterday) && !pagoEn(c.id, yesterday)) {
          st = dunningState[c.id] = { dueDate: yesterday, daysWithoutPayment: 1, lastWhatsappDate: "", emailSent: false };
        } else continue;
      } else {
        st.daysWithoutPayment = Math.max(1, daysBetween(st.dueDate, today));
      }
      const phone = String(c.phone || (Array.isArray(c.phones) ? c.phones[0] : "") || "").replace(/\D/g, "");
      // WhatsApp: una vez por dia.
      if (botUrl && templateName && phone && st.lastWhatsappDate !== today && !whatsappOff(settings)) {
        const msg = waTpl.replace(/{cliente}/g, c.name || "").replace(/{saldo}/g, money(bal));
        try {
          await fetch(botUrl, { method: "POST", headers: { "content-type": "application/json", "x-broadcast-key": botKey }, body: JSON.stringify({ numbers: [phone], templateName, lang, params: [msg] }) });
          st.lastWhatsappDate = today; waSent += 1;
        } catch (e) { console.error("dunning whatsapp:", e.message); }
      }
      // Correo: UNA sola vez al llegar a 3 dias de mora.
      if (st.daysWithoutPayment >= 3 && !st.emailSent && settings.mailingEnabled !== false) {
        const to = [c.billingEmail || c.email, managerEmail].filter(Boolean).join(",");
        if (to) {
          const subj = mailSubject.replace(/{cliente}/g, c.name || "");
          const mail = mailTpl.replace(/{cliente}/g, c.name || "").replace(/{diassinpago}/g, String(st.daysWithoutPayment) + " dias").replace(/{saldo}/g, money(bal));
          try { await sendMail(to, subj, "<p>" + mail + "</p>"); st.emailSent = true; mailsSent += 1; } catch (e) { console.error("dunning mail:", e.message); }
        }
      }
    } catch (e) { console.error("dunning cliente:", e.message); }
  }
  await saveDunningState(dunningState);
  return { ran: true, waSent, mailsSent };
}

async function loadDunningState() {
  try { const { rows } = await pool.query("SELECT data->'dunningState' AS s FROM app_state WHERE id = 'main'"); return (rows[0] && rows[0].s) || {}; }
  catch (e) { console.warn("No se pudo cargar dunningState:", e.message); return {}; }
}
async function saveDunningState(obj) {
  try { await pool.query("UPDATE app_state SET data = jsonb_set(COALESCE(data, '{}'), '{dunningState}', $1::jsonb) WHERE id = 'main'", [JSON.stringify(obj || {})]); }
  catch (e) { console.warn("No se pudo guardar dunningState:", e.message); }
}

let dunningLastRunDate = "";
async function loadDunningLastRunDate() {
  try { const { rows } = await pool.query("SELECT data->>'dunningLastRunDate' AS d FROM app_state WHERE id = 'main'"); return rows[0]?.d || ""; }
  catch (e) { console.warn("No se pudo cargar dunningLastRunDate:", e.message); return ""; }
}
async function saveDunningLastRunDate(value) {
  if (!value) return;
  try { await pool.query("UPDATE app_state SET data = jsonb_set(COALESCE(data, '{}'), '{dunningLastRunDate}', to_jsonb($1::text)) WHERE id = 'main'", [value]); }
  catch (e) { console.warn("No se pudo guardar dunningLastRunDate:", e.message); }
}
async function initDunningScheduler() {
  dunningLastRunDate = await loadDunningLastRunDate();
  startDunningScheduler();
}
function startDunningScheduler() {
  setInterval(async () => {
    try {
      const art = nowArt();
      if (art.hour >= 8 && dunningLastRunDate !== art.dateISO) {
        const r = await runDunning({ pool });
        dunningLastRunDate = art.dateISO;
        await saveDunningLastRunDate(dunningLastRunDate);
        if (r && (r.waSent || r.mailsSent)) console.log("Dunning:", r.waSent, "whatsapp,", r.mailsSent, "correos");
      }
    } catch (e) { console.error("Dunning fallo:", e.message); }
  }, 5 * 60 * 1000);
}

app.use((req, res) => res.status(404).json({ error: "Ruta no encontrada." }));

// ---------- Arranque: esquema + usuario administrador inicial ----------
async function bootstrap() {
  const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  await pool.query(schema);
  try {
    await pool.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check");
    await pool.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('manager','admin','employee','customer','contador','example','proveedor'))");
  } catch (error) {
    console.warn("No se pudo actualizar la restriccion de roles:", error.message);
  }
  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  if (!rows[0].count) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await pool.query(
      "INSERT INTO users (id, username, name, role, password_hash, password_fingerprint) VALUES ('USR-000', $1, 'Gerente', 'manager', $2, $3)",
      [ADMIN_USERNAME, hash, fingerprint(ADMIN_PASSWORD)]
    );
    console.log("Usuario administrador inicial creado:", ADMIN_USERNAME);
  }
}

if (require.main === module) {
  bootstrap()
    .then(() => {
      initBillingScheduler();
      initDunningScheduler();
      return app.listen(PORT, () => console.log("Pare Carrito SAS API escuchando en puerto " + PORT));
    })
    .catch((error) => {
      console.error("No se pudo iniciar:", error);
      process.exit(1);
    });
}

module.exports = { app, bootstrap, pool };
