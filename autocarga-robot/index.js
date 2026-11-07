"use strict";

// Equipo de carga automatica en el servidor.
//
// La lectura de los pedidos (alias, unidades, saludos...) vive en la app. En vez de reescribirla en
// el servidor, este contenedor abre la misma app en un navegador sin pantalla, entra como el usuario
// "carga-automatica" y la deja abierta con "Este equipo hace la carga" prendido. La app hace el
// resto (cada minuto revisa la bandeja y carga solo los pedidos limpios). Se prende y apaga desde
// Configuracion (carga automatica y "Usar el equipo del servidor").
//
// El acceso se pide por la red interna con la clave del bot (EXTERNAL_API_KEY): la contraseña se
// genera al azar en cada pedido y no la ve nadie.

const fs = require("fs");
const puppeteer = require("puppeteer-core");

const SITE = process.env.SITE_URL || (process.env.SITE_DOMAIN ? "https://" + process.env.SITE_DOMAIN : "");
const API = (process.env.ERP_BASE_URL || "http://api:3000").replace(/\/$/, "");
const KEY = process.env.ERP_API_KEY || "";
const CHROME = process.env.CHROME_PATH || ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/pw-browsers/chromium"].find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
const REINICIO_HORAS = Number(process.env.RESTART_HOURS || 12);

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function credenciales() {
  const r = await fetch(API + "/external/robot-login", { method: "POST", headers: { "x-api-key": KEY, "content-type": "application/json" }, body: "{}" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("robot-login: " + (j.error || "HTTP " + r.status));
  return j;
}

async function entrar(page) {
  const { username, password } = await credenciales();
  await page.goto(SITE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#login-username", { timeout: 60000 });
  await page.evaluate(([u, p]) => {
    document.querySelector("#login-username").value = u;
    document.querySelector("#login-password").value = p;
    document.querySelector("#login-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }, [username, password]);
  await sleep(6000);
  // Marcar este navegador como el equipo que hace la carga, y como robot.
  await page.evaluate(() => { localStorage.setItem("lpc_auto_inbox_device", "1"); localStorage.setItem("lpc_robot", "1"); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(5000);
  const dentro = await page.evaluate(() => !document.querySelector("#login-username"));
  if (!dentro) throw new Error("no pudo entrar al sistema");
  log("Adentro del sistema como", username);
}

async function sesion() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-first-run", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"]
  });
  const desde = Date.now();
  try {
    const page = await browser.newPage();
    page.on("dialog", (d) => d.accept().catch(() => {})); // avisos de la app: se aceptan
    page.on("pageerror", (e) => log("Error en la página:", e.message));
    await entrar(page);
    // Vigilar: si se cerro la sesion, volver a entrar; reiniciar el navegador cada tanto (memoria).
    while (Date.now() - desde < REINICIO_HORAS * 3600 * 1000) {
      await sleep(60 * 1000);
      if (page.isClosed()) throw new Error("se cerró la página");
      const afuera = await page.evaluate(() => !!document.querySelector("#login-username")).catch(() => true);
      if (afuera) { log("Se cerró la sesión: vuelvo a entrar"); await entrar(page); }
    }
    log("Reinicio programado del navegador");
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  if (!SITE) { log("Falta SITE_DOMAIN o SITE_URL: no arranco."); await sleep(3600 * 1000); return; }
  if (!KEY) { log("Falta EXTERNAL_API_KEY: no arranco."); await sleep(3600 * 1000); return; }
  if (!CHROME) { log("No encuentro Chromium."); await sleep(3600 * 1000); return; }
  log("Equipo de carga automática. Sitio:", SITE, "· Chromium:", CHROME);
  for (;;) {
    try { await sesion(); } catch (e) { log("Problema:", e.message, "- reintento en 1 minuto"); await sleep(60 * 1000); }
  }
}

main();
