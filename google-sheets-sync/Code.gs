/**
 * Pare Carrito <-> Google Sheets
 *
 * Que hace:
 *  - Pedidos nuevos del sistema  -> agrega fila en la pestania "pedidos".
 *  - Cambios de Venta / Costo en el sistema -> actualiza la fila en "precios".
 *  - "Compra Hoy" (que cargas VOS en el sheet) -> avisa al sistema para actualizar
 *    el COSTO del producto (como una compra). El script NO escribe "Compra Hoy".
 *
 * Instalacion: pega esto en Apps Script de tu planilla, completa las constantes,
 * publica como App web, y crea el disparador (ver SETUP.md).
 */

var SECRET_TOKEN = "CAMBIAR_POR_UN_TOKEN_LARGO_Y_SECRETO"; // = GOOGLE_SHEETS_TOKEN del servidor
var PEDIDOS_SHEET = "pedidos";
var PRECIOS_SHEET = "precios";
var COL_TIMESTAMP = 1; // A = Marca temporal
var COL_CLIENTE = 2;   // B = Cliente

// Para que "Compra Hoy" actualice el costo en el sistema:
var ERP_BASE_URL = "https://TU_API_DOMAIN";       // dominio del API del sistema
var ERP_API_KEY  = "LA_EXTERNAL_API_KEY_DEL_SERVIDOR"; // = EXTERNAL_API_KEY del .env

/** Equivalencias sistema -> encabezado del sheet (para nombres que no coinciden). */
var OVERRIDES = {
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

var NOISE = { "por": 1, "x": 1, "de": 1, "del": 1 };

function normFlat(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s\/]/g, " ").replace(/\//g, " ")
    .split(/\s+/).filter(function (w) { return w && !NOISE[w]; })
    .join(" ");
}
function normSet(s) {
  return normFlat(s).split(" ").filter(Boolean).sort().join(" ");
}
function resolveKey(name) {
  var flat = normFlat(name);
  if (OVERRIDES[flat]) return normSet(OVERRIDES[flat]);
  return normSet(name);
}
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Recibe pedidos/precios desde el sistema. */
function doPost(e) {
  var out = { ok: false };
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.token !== SECRET_TOKEN) return json({ ok: false, error: "token invalido" });
    var pedidos = body.pedidos || (body.type === "pedido" ? [body] : []);
    var precios = body.precios || (body.type === "precio" ? [body] : []);
    var skipped = [];
    if (pedidos.length) skipped = writePedidos(pedidos);
    if (precios.length) writePrecios(precios);
    out.ok = true; out.pedidos = pedidos.length; out.precios = precios.length; out.sinColumna = skipped;
  } catch (err) { out.error = String(err); }
  return json(out);
}

function headerColMap(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var k = normSet(headers[i]);
    if (k && map[k] === undefined) map[k] = i + 1;
  }
  return map;
}

function writePedidos(pedidos) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PEDIDOS_SHEET);
  var map = headerColMap(sheet);
  var lastCol = sheet.getLastColumn();
  var skipped = {};
  pedidos.forEach(function (p) {
    var row = [];
    for (var i = 0; i < lastCol; i++) row.push("");
    row[COL_TIMESTAMP - 1] = p.timestamp ? new Date(p.timestamp) : new Date();
    row[COL_CLIENTE - 1] = p.cliente || "";
    (p.items || []).forEach(function (it) {
      var col = map[resolveKey(it.producto)];
      if (col) row[col - 1] = it.cantidad;
      else skipped[it.producto] = 1;
    });
    sheet.appendRow(row);
  });
  return Object.keys(skipped);
}

/** Actualiza Venta y Costo. NO toca "Compra Hoy". */
function writePrecios(precios) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRECIOS_SHEET);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(normSet);
  var colProducto = headers.indexOf(normSet("Producto")) + 1 || 1;
  var colVenta = headers.indexOf(normSet("Venta")) + 1;
  var colCosto = headers.indexOf(normSet("Costo")) + 1;
  var rowByKey = {};
  if (lastRow > 1) {
    var names = sheet.getRange(2, colProducto, lastRow - 1, 1).getValues();
    for (var i = 0; i < names.length; i++) {
      var k = normSet(names[i][0]);
      if (k && rowByKey[k] === undefined) rowByKey[k] = i + 2;
    }
  }
  precios.forEach(function (pr) {
    var key = resolveKey(pr.producto);
    var r = rowByKey[key];
    if (!r) { r = sheet.getLastRow() + 1; sheet.getRange(r, colProducto).setValue(pr.producto); rowByKey[key] = r; }
    if (colVenta > 0 && pr.venta != null) sheet.getRange(r, colVenta).setValue(pr.venta);
    if (colCosto > 0 && pr.costo != null) sheet.getRange(r, colCosto).setValue(pr.costo);
    // "Compra Hoy" NO se escribe: es de entrada manual.
  });
}

/**
 * Disparador al editar: si cambiaste "Compra Hoy" en "precios", manda el valor al
 * sistema para que actualice el COSTO del producto (como una compra).
 * Hay que crear un disparador INSTALABLE (ver SETUP.md o correr crearTriggerCompraHoy una vez).
 */
function onEditCompraHoy(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== PRECIOS_SHEET) return;
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(normSet);
    var colCompra = headers.indexOf(normSet("Compra Hoy")) + 1;
    var colProducto = headers.indexOf(normSet("Producto")) + 1 || 1;
    if (colCompra <= 0 || e.range.getColumn() !== colCompra || e.range.getRow() === 1) return;
    var value = e.range.getValue();
    if (value === "" || value === null) return;
    var producto = sheet.getRange(e.range.getRow(), colProducto).getValue();
    if (!producto) return;
    UrlFetchApp.fetch(ERP_BASE_URL.replace(/\/+$/, "") + "/external/compra-hoy", {
      method: "post",
      contentType: "application/json",
      headers: { "x-api-key": ERP_API_KEY },
      payload: JSON.stringify({ producto: String(producto), costo: Number(value) }),
      muteHttpExceptions: true
    });
  } catch (err) { console.error(err); }
}

/** Corre esto UNA vez (boton Ejecutar) para crear el disparador instalable. */
function crearTriggerCompraHoy() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "onEditCompraHoy") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("onEditCompraHoy").forSpreadsheet(ss).onEdit().create();
}
