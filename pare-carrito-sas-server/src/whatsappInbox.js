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
// nameOnly: para nombres de agenda ("Vivré Juan"), donde una palabra como "Belgrano" no es la direccion.
function scoreClient(client, text, nameOnly) {
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
  // Dijo un numero de sucursal ("... 2") y este cliente no tiene numero en el nombre: es otro.
  else if (nameOnly && scoreNombre > 0 && dichos.some((w) => /^\d{1,3}$/.test(w))) scoreNombre -= 0.15;
  // Agendado exactamente con el nombre del cliente: gana sobre los parecidos.
  if (nameOnly && words(client.name || "").join(" ") === dichos.join(" ")) scoreNombre += 0.2;
  if (nameOnly) return Math.round(scoreNombre * 100) / 100;
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

function matchClients(clients, text, limit, nameOnly) {
  return (clients || [])
    .filter((c) => c && c.id && c.isActive !== false)
    .map((c) => ({ id: c.id, name: c.name || "", address: c.address || "", score: scoreClient(c, text, nameOnly) }))
    .filter((c) => c.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit || 5);
}

// Hay un candidato claro para preguntarle "¿sos X?": buen puntaje y bien separado del segundo.
function clearCandidate(candidates) {
  const [a, b] = candidates || [];
  if (!a || a.score < 0.8) return null;
  if (b && b.score > a.score - 0.3 + 1e-9) return null;
  return a;
}

// Telefono de agenda a formato de WhatsApp de Argentina (549 + caracteristica + numero):
// "+54 9 387 123-4567", "0387 15 123-4567", "387 4123456"... Devuelve "" si no se puede.
function normalizeArPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) {
    d = d.slice(2);
    if (d.startsWith("9")) d = d.slice(1);
  } else if (d.length > 13) return d; // otro pais: se deja como viene
  if (d.startsWith("0")) d = d.slice(1);
  // "15" del celular despues de la caracteristica (2 a 4 digitos): queda un numero de 10 digitos.
  if (d.length === 12) {
    for (const k of [2, 3, 4]) if (d.slice(k, k + 2) === "15") { d = d.slice(0, k) + d.slice(k + 2); break; }
  }
  return d.length === 10 ? "549" + d : "";
}

// Que contactos de la agenda parecen ser clientes que todavia no tienen ese numero cargado.
function phoneSuggestions(clients, contacts) {
  const tail = (x) => String(x || "").replace(/\D/g, "").slice(-8);
  const ya = new Map();
  (clients || []).forEach((c) => [c && c.phone].concat(c && Array.isArray(c.phones) ? c.phones : []).forEach((ph) => { const t = tail(ph); if (t.length === 8) ya.set(t, c.id); }));
  const vistos = new Set();
  const out = [];
  let yaVinculados = 0;
  let sinParecido = 0;
  for (const k of contacts || []) {
    const phone = normalizeArPhone(k && k.phone);
    if (!phone || vistos.has(phone)) continue;
    vistos.add(phone);
    if (ya.has(tail(phone))) { yaVinculados += 1; continue; }
    const texto = [k.name, k.notify].filter(Boolean).join(" ");
    const candidates = matchClients(clients, texto, 3, true);
    if (!candidates.length || candidates[0].score < 0.5) { sinParecido += 1; continue; }
    const claro = clearCandidate(candidates);
    out.push({ phone, name: String(k.name || ""), notify: String(k.notify || ""), candidates, suggested: claro ? claro.id : "" });
  }
  out.sort((a, b) => (b.suggested ? 1 : 0) - (a.suggested ? 1 : 0) || b.candidates[0].score - a.candidates[0].score);
  return { suggestions: out, yaVinculados, sinParecido };
}

module.exports = { matchClients, clearCandidate, scoreClient, norm, normalizeArPhone, phoneSuggestions };
