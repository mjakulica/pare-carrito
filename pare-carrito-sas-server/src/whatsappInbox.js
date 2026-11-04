"use strict";

// Identificacion de un numero de WhatsApp que no esta en Clientes: el que escribe dice el nombre del
// local y/o la direccion ("vivre bar, belgrano 1234") y se busca el cliente parecido (en el sistema
// puede figurar como "Vivré").

const STOP = new Set(["de", "del", "la", "las", "el", "los", "y", "en", "al", "soy", "somos", "es", "un", "una", "local", "negocio",
  "hola", "buen", "buenas", "buenos", "dias", "tardes", "noches", "nombre", "direccion", "calle", "av", "avenida", "nro", "numero", "n", "esquina", "barrio", "b"]);

function norm(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function words(text) {
  return norm(text).split(" ").filter((w) => w && !STOP.has(w));
}

// Distancia de edicion chica (palabras mal escritas: "vibre" / "vivre").
function close(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    diff += 1;
    if (diff > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

// Puntaje: nombre (hasta 1) + direccion (0.85 con calle y numero, 0.25 solo la calle).
function scoreClient(client, text) {
  const dichos = words(text);
  if (!dichos.length) return 0;
  const nombre = words(client.name || "").concat(words(client.businessName || client.razonSocial || "")).filter((w) => !/^\d+$/.test(w));
  let scoreNombre = 0;
  if (nombre.length) {
    const hits = nombre.filter((w) => dichos.some((d) => d === w || close(d, w) || (w.length >= 5 && d.startsWith(w)) || (d.length >= 5 && w.startsWith(d)))).length;
    scoreNombre = hits / nombre.length;
    // Que lo dicho tenga palabras de mas ("bar") no resta: suele agregar el rubro.
  }
  // Numeros del nombre ("Estacion Buenos Aires 2"): si los dice suma, si no los dice resta.
  const numerosNombre = words(client.name || "").filter((w) => /^\d+$/.test(w));
  if (numerosNombre.length && scoreNombre > 0) scoreNombre += numerosNombre.every((n) => dichos.includes(n)) ? 0.15 : -0.15;
  const dir = words(client.address || "");
  let scoreDir = 0;
  if (dir.length) {
    const numerosDir = dir.filter((w) => /^\d+$/.test(w));
    const callesDir = dir.filter((w) => !/^\d+$/.test(w) && w.length >= 3);
    const numeroOk = numerosDir.some((n) => dichos.includes(n));
    const calleOk = callesDir.some((c) => dichos.some((d) => d === c || close(d, c)));
    if (calleOk && numeroOk) scoreDir = 0.85;
    else if (calleOk) scoreDir = 0.25;
  }
  return Math.round((scoreNombre + scoreDir) * 100) / 100;
}

function matchClients(clients, text, limit) {
  return (clients || [])
    .filter((c) => c && c.id && c.isActive !== false)
    .map((c) => ({ id: c.id, name: c.name || "", address: c.address || "", score: scoreClient(c, text) }))
    .filter((c) => c.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit || 5);
}

// Hay un candidato claro para preguntarle "¿sos X?": buen puntaje y bien separado del segundo.
function clearCandidate(candidates) {
  const [a, b] = candidates || [];
  if (!a || a.score < 0.8) return null;
  if (b && b.score > a.score - 0.3) return null;
  return a;
}

module.exports = { matchClients, clearCandidate, scoreClient, norm };
