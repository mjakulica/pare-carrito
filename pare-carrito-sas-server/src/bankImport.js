"use strict";

// Lectura de movimientos bancarios (CSV, Excel .xlsx o texto de un PDF ya pasado a filas).
// Devuelve solo los CREDITOS (plata que entro): { fecha, monto, descripcion, cuit, nombre, raw }.
// Sin librerias de afuera: el .xlsx es un zip con XML adentro y se lee con zlib.

const zlib = require("zlib");

// ---- .xlsx minimo: primera hoja, valores de las celdas ----
function unzipEntries(buf) {
  // Busca el "end of central directory" desde el final.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("no es un archivo Excel (.xlsx) válido");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString("utf8");
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.slice(start, start + compSize);
    out[name] = () => (method === 0 ? data : zlib.inflateRawSync(data));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
const xmlDecode = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&");
function colIndex(ref) {
  const letras = String(ref).match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function readXlsx(buf) {
  const z = unzipEntries(buf);
  const shared = [];
  if (z["xl/sharedStrings.xml"]) {
    const xml = z["xl/sharedStrings.xml"]().toString("utf8");
    (xml.match(/<si>[\s\S]*?<\/si>/g) || []).forEach((si) => {
      shared.push(xmlDecode((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<t[^>]*>|<\/t>/g, "")).join("")));
    });
  }
  const hoja = Object.keys(z).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!hoja) throw new Error("el Excel no tiene hojas");
  const xml = z[hoja]().toString("utf8");
  const filas = [];
  (xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []).forEach((row) => {
    const fila = [];
    (row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach((c) => {
      const ref = (c.match(/ r="([A-Z]+\d+)"/) || [])[1];
      const t = (c.match(/ t="(\w+)"/) || [])[1];
      let v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (t === "s" && v != null) v = shared[Number(v)];
      else if (t === "inlineStr") v = xmlDecode(((c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1]) || "");
      else if (v != null) v = xmlDecode(v);
      if (ref) fila[colIndex(ref)] = v == null ? "" : v;
    });
    filas.push(Array.from(fila, (x) => (x == null ? "" : x)));
  });
  return filas;
}

// ---- CSV (coma, punto y coma o tab, con comillas) ----
function readCsv(text) {
  const t = String(text).replace(/^﻿/, "");
  const primera = t.split(/\r?\n/).slice(0, 15).join("\n");
  const sep = [";", "\t", ","].sort((a, b) => primera.split(b).length - primera.split(a).length)[0];
  const filas = [];
  let fila = [], campo = "", comillas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (comillas) {
      if (ch === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else campo += ch;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

// ---- numeros y fechas argentinos ----
function parseMonto(v) {
  if (typeof v === "number") return v;
  let s = String(v || "").replace(/[$\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!s || !/\d/.test(s)) return NaN;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 1.234,56
  else if (/\.\d{1,2}$/.test(s)) s = s.replace(/,/g, ""); // 1,234.56
  else s = s.replace(/[.,](?=\d{3}(\D|$))/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function parseFecha(v) {
  const s = String(v || "").trim();
  if (/^\d{4,5}(\.\d+)?$/.test(s) && Number(s) > 30000 && Number(s) < 80000) { // serie de Excel
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return y + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"); }
  return "";
}
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const CUIT_RE = /\b(20|23|24|25|26|27|30|33|34)-?(\d{8})-?(\d)\b/;

// Palabras de los bancos que no dicen quien pago.
const GENERICAS = /\b(transf(erencia)?s?|transferencia|recibida|recib|credito|cred|de|del|terceros?|inmediata|cta|cuenta|cbu|cvu|alias|pago|pagos|debin|deposito|dep|acreditacion|acred|via|mismo|titular|banco|bco|galicia|brubank|mercado|mp|internet|home|banking|office|ref|nro|n|op|operacion|origen|concepto|varios|var|haberes|interbanking|en|ars|pesos|\$)\b/g;
function nombrePagador(desc) {
  return norm(desc).replace(/[^a-zñ ]/g, " ").replace(GENERICAS, " ").replace(/\s+/g, " ").trim().split(" ").filter((w) => w.length > 1).slice(0, 5).join(" ");
}

// Filas -> creditos. Busca la fila de titulos (fecha + credito/importe/monto) y arma cada movimiento.
function rowsToCredits(filas) {
  let h = -1, cols = null;
  for (let i = 0; i < Math.min(filas.length, 40); i++) {
    const r = filas[i].map(norm);
    const fecha = r.findIndex((x) => /^fecha/.test(x));
    const cred = r.findIndex((x) => /^creditos?$|^credito|^ingresos?|haber/.test(x));
    const imp = r.findIndex((x) => /^(importe|monto|valor)/.test(x));
    if (fecha >= 0 && (cred >= 0 || imp >= 0)) {
      h = i;
      cols = { fecha, cred, imp, deb: r.findIndex((x) => /^debitos?$|^debito|^egresos?|^debe$/.test(x)), saldo: r.findIndex((x) => /^saldo/.test(x)), titulos: filas[i] };
      break;
    }
  }
  if (h < 0) throw new Error("no encontré la fila de títulos (Fecha y Créditos/Importe)");
  const out = [];
  for (let i = h + 1; i < filas.length; i++) {
    const r = filas[i];
    const fecha = parseFecha(r[cols.fecha]);
    if (!fecha) continue;
    let monto = cols.cred >= 0 ? parseMonto(r[cols.cred]) : NaN;
    if (!(monto > 0) && cols.cred < 0 && cols.imp >= 0) monto = parseMonto(r[cols.imp]);
    if (!(monto > 0)) continue; // debitos o vacios
    const textos = r.map((x, k) => (k === cols.fecha || k === cols.cred || k === cols.imp || k === cols.deb || k === cols.saldo ? "" : String(x || "").trim())).filter((x) => x && !/^[\d.,\-\s$]+$/.test(x));
    const descripcion = textos.join(" · ").slice(0, 500);
    const todo = r.map((x) => String(x || "")).join(" ");
    const c = todo.match(CUIT_RE);
    out.push({ fecha, monto: Math.round(monto * 100) / 100, descripcion, cuit: c ? c[1] + c[2] + c[3] : "", nombre: nombrePagador(descripcion), saldo: cols.saldo >= 0 ? parseMonto(r[cols.saldo]) : null });
  }
  return out;
}

function parseBankFile(buf, fileName) {
  const n = String(fileName || "").toLowerCase();
  const esZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  if (/\.xlsx$/.test(n) || esZip) return rowsToCredits(readXlsx(buf));
  if (/\.xls$/.test(n) && !esZip) throw new Error("los .xls viejos no se pueden leer: exportalo como .xlsx o CSV");
  return rowsToCredits(readCsv(buf.toString("utf8").includes("�") ? buf.toString("latin1") : buf.toString("utf8")));
}

module.exports = { parseBankFile, rowsToCredits, readCsv, readXlsx, parseMonto, parseFecha, nombrePagador, CUIT_RE };
