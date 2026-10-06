// Prueba rapida de la API contra una base vacia: que arranque, cree las tablas y el usuario
// gerente, y que guardar y leer el estado funcione. La corre GitHub Actions antes de desplegar.
// Uso: DATABASE_URL=... JWT_SECRET=... node test/smoke.js
const { spawn } = require("child_process");
const path = require("path");
const assert = require("assert");

const PORT = Number(process.env.SMOKE_PORT || 3999);
const BASE = "http://127.0.0.1:" + PORT;

async function esperarApi() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch(BASE + "/health");
      if (r.ok) return r.json();
    } catch (_) { /* todavia no escucha */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("la API no respondio /health en 20 segundos");
}

async function pedir(metodo, ruta, token, cuerpo) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch (_) { json = texto; }
  return { status: r.status, json };
}

(async () => {
  const api = spawn("node", [path.join(__dirname, "..", "src", "server.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "inherit", "inherit"]
  });
  let fallo = null;
  try {
    const salud = await esperarApi();
    assert.strictEqual(salud.db, "ok", "la base no responde");
    console.log("ok  /health");

    const login = await pedir("POST", "/auth/login", null, { username: "gerente", password: process.env.ADMIN_PASSWORD || "gerente123" });
    assert.strictEqual(login.status, 200, "login del gerente: " + JSON.stringify(login.json));
    const token = login.json.token;
    console.log("ok  login gerente");

    const vacio = await pedir("GET", "/state", token);
    assert.strictEqual(vacio.status, 404, "una base nueva no deberia tener estado");

    const hoy = new Date().toISOString().slice(0, 10);
    const data = {
      clients: [{ id: "C001", name: "Cliente de prueba" }],
      products: [{ id: "P001", name: "Tomate", unit: "kg", price: 1000 }],
      orders: [{ id: "PED-PRUEBA-1", date: hoy, clientId: "C001", items: [{ productId: "P001", quantity: 2, price: 1000 }] }],
      saldos: [], purchases: [], providers: []
    };
    const guardar = await pedir("PUT", "/state", token, { data });
    assert.ok(guardar.status < 300, "PUT /state: " + guardar.status + " " + JSON.stringify(guardar.json));
    console.log("ok  guardar estado");

    const leido = await pedir("GET", "/state?window=full", token);
    assert.strictEqual(leido.status, 200, "GET /state: " + JSON.stringify(leido.json));
    assert.strictEqual(leido.json.data.clients.length, 1, "no volvio el cliente");
    assert.strictEqual(leido.json.data.products.length, 1, "no volvio el producto");
    const pedido = leido.json.data.orders.find((o) => o.id === "PED-PRUEBA-1");
    assert.ok(pedido && pedido.items.length === 1, "no volvio el pedido con sus productos");
    console.log("ok  leer estado (" + leido.json.data.orders.length + " pedido)");

    const sinToken = await pedir("GET", "/state", null);
    assert.strictEqual(sinToken.status, 401, "sin token deberia dar 401");
    console.log("ok  sin token -> 401");
  } catch (error) {
    fallo = error;
  } finally {
    api.kill("SIGTERM");
  }
  if (fallo) {
    console.error("FALLO la prueba de la API: " + fallo.message);
    process.exit(1);
  }
  console.log("Prueba de la API OK");
})();
