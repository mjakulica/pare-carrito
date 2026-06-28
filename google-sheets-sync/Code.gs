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

/**
 * Productos "Unidad/Unidades" que NO tienen columna propia: se cargan en la columna del
 * producto base (Kg) pero con la cantidad + " uni". Clave = nombre del sistema (minuscula,
 * sin acentos). Valor = encabezado del sheet donde va.
 */
var UNIT_OVERRIDES = {
  "morron amarillo unidades": "Morron Amarillo",
  "morron rojo unidades": "Morron Rojo Kg",
  "morron verde unidades": "Morron Verde Kg",
  "manzana roja unidades": "Manzana Roja Kg",
  "manzana verde unidades": "Manzana Verde Kg",
  "pera unidades": "Pera Kg",
  "palta madura unidad": "Palta Madura por Kg",
  "pepino unidad": "Pepino kg",
  "mango unidad": "Mango kg",
  "berenjena unidad": "Berenjena Kg",
  "calabaza unidad": "Calabaza kg",
  "zapallo negro unidad": "Zapallo negro Kg",
  "zapallo amarillo unidades": "Zapallo Amarillo Kg",
  "zanahoria unidad": "Zanahoria por Kg"
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
// Busca una pestania por nombre tolerando mayusculas/acentos/espacios.
function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var direct = ss.getSheetByName(name);
  if (direct) return direct;
  var target = normFlat(name);
  var all = ss.getSheets();
  for (var i = 0; i < all.length; i++) {
    if (normFlat(all[i].getName()) === target) return all[i];
  }
  return null;
}

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

function resolveItemColumn(map, producto) {
  var flat = normFlat(producto);
  if (UNIT_OVERRIDES[flat]) return { col: map[normSet(UNIT_OVERRIDES[flat])], uni: true };
  return { col: map[resolveKey(producto)], uni: false };
}

// Construye {colIndex: valor} para los items de un pedido (aplica "uni", notas y combina).
function buildItemValues(map, items, skipped) {
  var values = {};
  (items || []).forEach(function (it) {
    var res = resolveItemColumn(map, it.producto);
    if (!res.col) { if (skipped) skipped[it.producto] = 1; return; }
    var nota = it.nota ? String(it.nota).trim() : "";
    var val;
    if (res.uni || nota) {
      val = String(it.cantidad);
      if (res.uni) val += " uni";
      if (nota) val += " (" + nota + ")";
    } else {
      val = it.cantidad;
    }
    if (values[res.col] === undefined) values[res.col] = val;
    else values[res.col] = String(values[res.col]) + " + " + String(val);
  });
  return values;
}

// Upsert por numero de pedido: si ya se cargo (guardado en Properties) actualiza esa fila;
// si no, agrega una fila nueva y recuerda en que fila quedo.
function writePedidos(pedidos) {
  var sheet = getSheet(PEDIDOS_SHEET);
  if (!sheet) throw new Error("No se encontro la pestania \"" + PEDIDOS_SHEET + "\".");
  var map = headerColMap(sheet);
  var lastCol = sheet.getLastColumn();
  var props = PropertiesService.getDocumentProperties();
  var skipped = {};
  pedidos.forEach(function (p) {
    var values = buildItemValues(map, p.items, skipped);
    var key = p.numero ? ("pedido_" + p.numero) : "";
    var existingRow = key ? Number(props.getProperty(key) || 0) : 0;
    if (existingRow >= 2 && existingRow <= sheet.getLastRow()) {
      // Actualizar la fila existente (reescribe toda la fila preservando la marca temporal).
      var ts = sheet.getRange(existingRow, COL_TIMESTAMP).getValue() || new Date();
      var cli = p.cliente || sheet.getRange(existingRow, COL_CLIENTE).getValue() || "";
      var row = [];
      for (var i = 0; i < lastCol; i++) row.push("");
      row[COL_TIMESTAMP - 1] = ts;
      row[COL_CLIENTE - 1] = cli;
      Object.keys(values).forEach(function (c) { row[Number(c) - 1] = values[c]; });
      sheet.getRange(existingRow, 1, 1, lastCol).setValues([row]);
    } else {
      var newRow = [];
      for (var j = 0; j < lastCol; j++) newRow.push("");
      newRow[COL_TIMESTAMP - 1] = p.timestamp ? new Date(p.timestamp) : new Date();
      newRow[COL_CLIENTE - 1] = p.cliente || "";
      Object.keys(values).forEach(function (c) { newRow[Number(c) - 1] = values[c]; });
      sheet.appendRow(newRow);
      if (key) props.setProperty(key, String(sheet.getLastRow()));
    }
  });
  return Object.keys(skipped);
}

/** Actualiza Venta y Costo. NO toca "Compra Hoy". */
function writePrecios(precios) {
  var sheet = getSheet(PRECIOS_SHEET);
  if (!sheet) throw new Error("No se encontro la pestania \"" + PRECIOS_SHEET + "\".");
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
 * Escaneo periodico de "Compra Hoy": como esa columna suele ser una FORMULA (trae datos de
 * otra pagina), no sirve un disparador onEdit. Este escaneo compara los valores actuales con
 * los ultimos vistos y, cuando cambian, avisa al sistema para actualizar el costo del producto.
 * Se activa con un disparador POR TIEMPO (correr crearTriggerCompraHoy una vez).
 */
function scanCompraHoy() {
  // Frecuencia segun horario: 7-9am cada 1 min; el resto del dia cada 10 min.
  // (el disparador corre cada 1 min, pero salimos al toque si no toca escanear)
  var now = new Date();
  var h = now.getHours();
  var enVentanaPico = (h >= 7 && h < 9);
  if (!enVentanaPico && (now.getMinutes() % 10 !== 0)) return;
  var sheet = getSheet(PRECIOS_SHEET);
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(normSet);
  var colProducto = headers.indexOf(normSet("Producto")) + 1 || 1;
  var colCompra = headers.indexOf(normSet("Compra Hoy")) + 1;
  if (colCompra <= 0) return;
  var n = lastRow - 1;
  var productos = sheet.getRange(2, colProducto, n, 1).getValues();
  var compras = sheet.getRange(2, colCompra, n, 1).getValues();
  var props = PropertiesService.getDocumentProperties();
  for (var i = 0; i < n; i++) {
    var prod = String(productos[i][0] || "").trim();
    if (!prod) continue;
    var val = Number(compras[i][0]);
    if (!isFinite(val) || val <= 0) continue;
    var key = "ch_" + normSet(prod);
    var prev = props.getProperty(key);
    if (prev === null) { props.setProperty(key, String(val)); continue; } // baseline: no avisa la 1ra vez
    if (Number(prev) === val) continue; // sin cambios
    try {
      UrlFetchApp.fetch(ERP_BASE_URL.replace(/\/+$/, "") + "/external/compra-hoy", {
        method: "post",
        contentType: "application/json",
        headers: { "x-api-key": ERP_API_KEY },
        payload: JSON.stringify({ producto: prod, costo: val }),
        muteHttpExceptions: true
      });
      props.setProperty(key, String(val));
    } catch (err) { console.error(err); }
  }
}

/** Corre esto UNA vez (boton Ejecutar) para crear el disparador por tiempo (cada 1 min;\n *  internamente escanea cada 1 min entre 7-9am y cada 10 min el resto del dia). */
function crearTriggerCompraHoy() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === "onEditCompraHoy" || h === "scanCompraHoy") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("scanCompraHoy").timeBased().everyMinutes(1).create();
}
