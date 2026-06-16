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
const { billingConfig, nowArt, computeDueInvoices, runBilling } = require("./billing");

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL || "postgres://parecarrito:parecarrito@localhost:5432/parecarrito";
const JWT_SECRET = process.env.JWT_SECRET || "";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "12h";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "gerente";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "gerente123";
const STATE_HISTORY_KEEP = Number(process.env.STATE_HISTORY_KEEP || 200);

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

async function sendMail(to, subject, html) {
  const transport = getMailTransport();
  if (!transport) {
    console.log("[mail desactivado] Para:", to, "| Asunto:", subject);
    return false;
  }
  try {
    await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html });
    return true;
  } catch (error) {
    console.error("Error enviando mail a", to, ":", error.message);
    return false;
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

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function authenticate(req, res, next) {
  const header = String(req.headers.authorization || "");
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Falta el token. Inicie sesion en /auth/login." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token invalido o vencido. Vuelva a iniciar sesion." });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Permisos insuficientes para esta operacion (requiere: " + roles.join(", ") + ")." });
    }
    next();
  };
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
  if (!username || !password) return res.status(400).json({ error: "Envie usuario y contrasena." });
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
    return res.status(401).json({ error: "Usuario o contrasena incorrectos." });
  }
  loginAttempts.delete(attemptKey);
  if (!user.is_active) {
    return res.status(403).json({ error: "Su cuenta queda pendiente de aprobacion, por favor comunicarse con administracion para empezar a trabajar con nosotros.", pending: true });
  }
  res.json({ token: signToken(user), role: user.role, name: user.name, username: user.username, expiresIn: JWT_EXPIRES });
});

// ---------- Registro de clientes y recuperacion de contrasena ----------
const INVOICE_TYPES = ["Sin Factura", "Factura A", "Factura B"];

app.post("/auth/register", async (req, res) => {
  const b = req.body || {};
  const required = { username: "nombre de usuario", password: "contrasena", localName: "nombre del local", address: "direccion", email: "correo electronico", openingTime: "horario de apertura", maxDeliveryTime: "horario maximo de entrega", phone: "telefono", zone: "zona", invoiceType: "tipo de factura" };
  for (const [key, label] of Object.entries(required)) {
    if (!String(b[key] || "").trim()) return res.status(400).json({ error: "Falta el campo obligatorio: " + label + "." });
  }
  if (!INVOICE_TYPES.includes(b.invoiceType)) return res.status(400).json({ error: "Tipo de factura invalido." });
  const needsInvoice = b.invoiceType !== "Sin Factura";
  if (needsInvoice && !String(b.cuit || "").trim()) return res.status(400).json({ error: "Falta el campo obligatorio: CUIT." });
  if (String(b.password).length < 6) return res.status(400).json({ error: "La contrasena debe tener al menos 6 caracteres." });
  const username = String(b.username).trim().toLowerCase();
  const taken = await pool.query("SELECT 1 FROM users WHERE lower(username) = $1", [username]);
  if (taken.rows.length) return res.status(409).json({ error: "Ese nombre de usuario ya existe. Elija otro." });

  const stateRow = await pool.query("SELECT data FROM app_state WHERE id = 'main'");
  if (!stateRow.rows.length) return res.status(503).json({ error: "El sistema todavia no fue inicializado por el negocio." });
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
  const needsInvoice = b.invoiceType !== "Sin Factura";
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
    `<p>Hola ${client.name},</p><p>Recibimos su registro en Pare Carrito SAS. Su cuenta (usuario <strong>${username}</strong>) queda <strong>pendiente de aprobacion</strong>: administracion la revisara a la brevedad y le avisaremos cuando este activa.</p><p>Ante cualquier consulta, escribanos por WhatsApp al +54 9 387 456 6725.</p>`);
  const admins = await pool.query("SELECT email FROM users WHERE role IN ('manager','admin') AND email <> '' AND is_active = TRUE");
  for (const row of admins.rows) {
    sendMail(row.email, "Nuevo registro de cliente pendiente de aprobacion",
      `<p>Se registro un nuevo cliente:</p><ul><li>Local: <strong>${client.name}</strong></li><li>Usuario: ${username}</li><li>Zona: ${client.zone}</li><li>Telefono: ${client.phone}</li><li>CUIT: ${client.cuit}</li><li>Factura: ${client.invoiceType}</li></ul><p>Para aprobarlo: ingrese al sistema → pagina <strong>Usuarios</strong> → activar la cuenta.</p>`);
  }
  res.status(201).json({ ok: true, pending: true, clientId });
});

app.post("/auth/recover", async (req, res) => {
  const identifier = String((req.body || {}).usernameOrEmail || "").trim().toLowerCase();
  if (!identifier) return res.status(400).json({ error: "Indique su usuario o correo electronico." });
  const { rows } = await pool.query("SELECT * FROM users WHERE lower(username) = $1 OR lower(email) = $1", [identifier]);
  const user = rows[0];
  if (user && user.email) {
    const token = crypto.randomBytes(24).toString("hex");
    await pool.query("INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [token, user.id]);
    const link = (PUBLIC_URL || "") + "/#/restablecer/" + token;
    sendMail(user.email, "Recuperar contrasena - Pare Carrito SAS",
      `<p>Hola ${user.name},</p><p>Para crear una nueva contrasena haga clic en este enlace (valido por 1 hora):</p><p><a href="${link}">${link}</a></p><p>Si usted no pidio este cambio, ignore este correo.</p>`);
  }
  res.json({ ok: true, message: "Si el usuario existe y tiene correo registrado, le enviamos las instrucciones." });
});

app.post("/auth/reset", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: "Faltan datos." });
  if (String(password).length < 6) return res.status(400).json({ error: "La contrasena debe tener al menos 6 caracteres." });
  const { rows } = await pool.query("SELECT * FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > now()", [token]);
  const reset = rows[0];
  if (!reset) return res.status(400).json({ error: "El enlace es invalido o ya vencio. Pida uno nuevo desde Me olvide la contrasena." });
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
    return res.status(500).json({ error: "No se pudo cambiar la contrasena: " + error.message });
  } finally {
    clientDb.release();
  }
  res.json({ ok: true });
});

// ---------- Estado del ERP (sincronizacion) ----------
const SYNC_ROLES = ["manager", "admin", "employee", "contador"];

app.get("/state", authenticate, requireRole(...SYNC_ROLES), async (req, res) => {
  const { rows } = await pool.query("SELECT data, updated_at FROM app_state WHERE id = 'main'");
  if (!rows.length) return res.status(404).json({ error: "Sin datos guardados todavia." });
  res.json({ data: rows[0].data, updatedAt: rows[0].updated_at.toISOString() });
});

app.put("/state", authenticate, requireRole(...SYNC_ROLES), async (req, res) => {
  const body = req.body || {};
  if (!body.data || typeof body.data !== "object") {
    return res.status(400).json({ error: "Cuerpo invalido: se espera { data: { ... } }." });
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
        return res.status(409).json({ error: "conflicto: el cliente no tiene la ultima version. Descargue primero.", updatedAt: current.rows[0].updated_at.toISOString() });
      }
      const storedIso = current.rows[0].updated_at.toISOString();
      if (storedIso !== String(body.baseUpdatedAt)) {
        await clientDb.query("ROLLBACK");
        return res.status(409).json({ error: "conflicto: el servidor tiene una version mas nueva", updatedAt: storedIso });
      }
    }
    const saved = await clientDb.query(
      `INSERT INTO app_state (id, data, updated_at, updated_by) VALUES ('main', $1, now(), $2)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
       RETURNING updated_at`,
      [body.data, req.user.username]
    );
    await clientDb.query("INSERT INTO state_history (data, updated_by) VALUES ($1, $2)", [body.data, req.user.username]);
    await clientDb.query(
      "DELETE FROM state_history WHERE id NOT IN (SELECT id FROM state_history ORDER BY id DESC LIMIT $1)",
      [STATE_HISTORY_KEEP]
    );
    await mirrorStateToTables(clientDb, body.data);
    await syncUsersFromState(clientDb, body.data);
    const afterCounts = {
      orders: Array.isArray(body.data.orders) ? body.data.orders.length : 0,
      clients: Array.isArray(body.data.clients) ? body.data.clients.length : 0,
      products: Array.isArray(body.data.products) ? body.data.products.length : 0
    };
    await clientDb.query(
      "INSERT INTO state_writes (updated_by, orders_before, orders_after, clients_before, clients_after, products_before, products_after, diff_orders) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [req.user.username, beforeCounts.orders, afterCounts.orders, beforeCounts.clients, afterCounts.clients, beforeCounts.products, afterCounts.products, afterCounts.orders - beforeCounts.orders]
    );
    await clientDb.query("COMMIT");
    res.json({ ok: true, updatedAt: saved.rows[0].updated_at.toISOString() });
  } catch (error) {
    await clientDb.query("ROLLBACK").catch(() => {});
    console.error("PUT /state:", error);
    res.status(500).json({ error: "No se pudo guardar el estado: " + error.message });
  } finally {
    clientDb.release();
  }
});

// ---------- Transferencias enviadas por clientes ----------
app.post("/transfers", authenticate, requireRole("customer", "example"), async (req, res) => {
  const body = req.body || {};
  if (!body.transfer || typeof body.transfer !== "object") {
    return res.status(400).json({ error: "Cuerpo invalido: se espera { transfer: { ... } }." });
  }
  const clientDb = await pool.connect();
  try {
    await clientDb.query("BEGIN");
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

// Espejo relacional: refresco transaccional completo (estados chicos, robustez maxima)
async function mirrorStateToTables(db, data) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  await db.query("DELETE FROM order_items");
  await db.query("DELETE FROM orders");
  await db.query("DELETE FROM purchase_items");
  await db.query("DELETE FROM purchases");
  await db.query("DELETE FROM payments");
  await db.query("DELETE FROM clients");
  await db.query("DELETE FROM products");
  for (const c of Array.isArray(data.clients) ? data.clients : []) {
    if (!c || !c.id) continue;
    await db.query(
      "INSERT INTO clients (id, name, address, phone, payment_type, price_tier, vehicle_id, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING",
      [c.id, c.name || "", c.address || "", c.phone || "", c.paymentType || "", c.priceTier || "", c.vehicleId || "", c.isActive !== false]
    );
  }
  for (const p of Array.isArray(data.products) ? data.products : []) {
    if (!p || !p.id) continue;
    await db.query(
      "INSERT INTO products (id, name, category, unit_type, base_cost, sale_price, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING",
      [p.id, p.name || "", p.category || "", p.unitType || "", num(p.baseCost), num(p.salePrice), p.isActive !== false]
    );
  }
  for (const o of Array.isArray(data.orders) ? data.orders : []) {
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
  for (const p of Array.isArray(data.purchases) ? data.purchases : []) {
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
  for (const pay of Array.isArray(data.payments) ? data.payments : []) {
    if (!pay || !pay.id) continue;
    await db.query(
      "INSERT INTO payments (id, date, client_id, amount, method, received_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
      [pay.id, pay.date || null, pay.clientId || "", num(pay.amount), pay.method || "", pay.receivedByUserId || ""]
    );
  }
}

// Usuarios del ERP -> usuarios reales con hash bcrypt (la gestion sigue en la pagina Usuarios)
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
  if (!rows.length) return res.status(404).json({ error: "Sin datos guardados todavia." });
  res.set("content-disposition", `attachment; filename="pare-carrito-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exportedAt: new Date().toISOString(), updatedAt: rows[0].updated_at, data: rows[0].data });
});

// ---------- Facturacion automatica (TusFacturasAPP) ----------
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

app.post("/billing/run", authenticate, requireRole("manager"), async (req, res) => {
  const body = req.body || {};
  try {
    const result = await runBilling({ pool, force: true, simulate: body.simulate === true, onlyClientId: String(body.clientId || "") });
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
  if (String(req.headers["x-api-key"] || "") !== key) return res.status(401).json({ error: "x-api-key invalida." });
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
  if (!["approve", "reject"].includes(action)) return res.status(400).json({ error: "Accion invalida (approve|reject)." });
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
      const payment = { id: "PAY-EXT-" + Date.now(), date: today, clientId: transfer.clientId, amount: Number(transfer.amount || 0), method: "transferencia", receivedByUserId: "external-api", notes: "Transferencia aprobada via API externa - " + transfer.id };
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

let billingLastRunDate = "";
function startBillingScheduler() {
  setInterval(async () => {
    try {
      const art = nowArt();
      if (art.hour >= 23 && billingLastRunDate !== art.dateISO) {
        billingLastRunDate = art.dateISO;
        const result = await runBilling({ pool });
        if (result.count) console.log("Facturacion automatica:", result.count, "comprobante(s) procesado(s)", result.simulate ? "(simulada)" : "");
      }
    } catch (error) {
      console.error("Facturacion automatica fallo:", error.message);
    }
  }, 5 * 60 * 1000);
}

app.use((req, res) => res.status(404).json({ error: "Ruta no encontrada." }));

// ---------- Arranque: esquema + usuario administrador inicial ----------
async function bootstrap() {
  const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  await pool.query(schema);
  try {
    await pool.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check");
    await pool.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('manager','admin','employee','customer','contador','example'))");
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
      startBillingScheduler();
      return app.listen(PORT, () => console.log("Pare Carrito SAS API escuchando en puerto " + PORT));
    })
    .catch((error) => {
      console.error("No se pudo iniciar:", error);
      process.exit(1);
    });
}

module.exports = { app, bootstrap, pool };
