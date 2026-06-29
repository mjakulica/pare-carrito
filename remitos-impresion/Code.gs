/**
 * Imprimir Remitos -> un solo PDF horizontal (márgenes 0,59 cm)
 *
 * Pegar este código en el Apps Script DEL ARCHIVO REMITOS (el que tiene la pestaña "Remitos",
 * id 1sJtIXEKSpbPlP_um4A7XI_tM5PioO6PUA3qM9Ni7IOk). Asignar la función `imprimirRemitos`
 * a un botón (Insertar > Dibujo, dibujás el botón, y al guardarlo: ⋮ > Asignar secuencia de
 * comandos > escribís: imprimirRemitos).
 *
 * Lógica: lee la tabla A7:C44 de la pestaña "Datos" del OTRO archivo. La columna C es el nombre
 * de la página (se arrastra hacia abajo si una fila la deja vacía). Una página se imprime si
 * ALGUNA de sus filas tiene contenido en la columna B.
 */

var REMITOS_SPREADSHEET_ID = "1sJtIXEKSpbPlP_um4A7XI_tM5PioO6PUA3qM9Ni7IOk"; // archivo Remitos (con pestañas FC/FL)
var DATOS_SPREADSHEET_ID = "1ne4ycBoH8QXx_rzuB69uS_4X7bFecukiXPqF0w7UHRo";
var DATOS_SHEET = "Datos";
var FILA_DESDE = 7;
var FILA_HASTA = 44;

// Márgenes 0,59 cm -> pulgadas (0,59 / 2,54). Cambialos acá si querés otros.
var MARGEN_PULGADAS = 0.2323;

function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Devuelve la lista de nombres de página a imprimir (en orden de aparición).
function paginasAImprimir() {
  var ss = SpreadsheetApp.openById(DATOS_SPREADSHEET_ID);
  var sh = ss.getSheetByName(DATOS_SHEET);
  if (!sh) throw new Error('No se encontró la pestaña "' + DATOS_SHEET + '" en el archivo de Datos.');
  var n = FILA_HASTA - FILA_DESDE + 1;
  var vals = sh.getRange(FILA_DESDE, 1, n, 3).getValues(); // columnas A, B, C
  var orden = [];
  var conContenido = {};
  var actual = "";
  for (var i = 0; i < vals.length; i++) {
    var b = vals[i][1]; // columna B (contenido)
    var c = String(vals[i][2] || "").trim(); // columna C (nombre de página)
    if (c) { actual = c; if (orden.indexOf(c) < 0) orden.push(c); }
    if (actual && String(b).trim() !== "") conContenido[actual] = true;
  }
  return orden.filter(function (p) { return conContenido[p]; });
}

function imprimirRemitos() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.openById(REMITOS_SPREADSHEET_ID); // archivo Remitos (por ID, no importa donde este el boton)
  var pages = paginasAImprimir();
  if (!pages.length) { ui.alert("No hay páginas con contenido para imprimir."); return; }

  // Mapear nombres de página -> pestañas del archivo Remitos
  var allSheets = ss.getSheets();
  var byName = {};
  allSheets.forEach(function (s) { byName[norm(s.getName())] = s; });
  var toPrint = [];
  var faltan = [];
  pages.forEach(function (p) {
    var s = byName[norm(p)];
    if (s) toPrint.push(s); else faltan.push(p);
  });
  if (!toPrint.length) { ui.alert("No se encontraron las pestañas: " + pages.join(", ")); return; }

  // Guardar estado de visibilidad para restaurarlo después
  var prevHidden = allSheets.map(function (s) { return s.isSheetHidden(); });
  var printIds = {};
  toPrint.forEach(function (s) { printIds[s.getSheetId()] = true; });

  try {
    // La pestaña activa tiene que quedar visible: activamos una de las que se imprimen.
    try { toPrint[0].activate(); } catch (e) {}
    allSheets.forEach(function (s) {
      if (printIds[s.getSheetId()]) { if (s.isSheetHidden()) s.showSheet(); }
      else { if (!s.isSheetHidden()) s.hideSheet(); }
    });
    SpreadsheetApp.flush();

    var blob = exportarPdfLibro(ss.getId());
    var nombre = "Remitos " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm") + ".pdf";
    var file = DriveApp.createFile(blob).setName(nombre);

    var pdfUrl = file.getUrl();
    var info = "Impresas: " + toPrint.map(function (s) { return s.getName(); }).join(", ")
      + (faltan.length ? "  |  No encontradas: " + faltan.join(", ") : "");
    var html = HtmlService.createHtmlOutput(
      '<div style="font-family:Arial,sans-serif;font-size:13px">'
      + '<p>PDF generado. Si no se abrió solo, hacé clic:</p>'
      + '<p><a href="' + pdfUrl + '" target="_blank" rel="noopener">Abrir PDF</a></p>'
      + '<p style="color:#666;font-size:11px">' + info.replace(/[<>]/g, "") + '</p>'
      + '</div>'
      + '<script>window.open(' + JSON.stringify(pdfUrl) + ',"_blank");</script>'
    ).setWidth(380).setHeight(160);
    ui.showModalDialog(html, "Remitos - PDF");
  } finally {
    // Restaurar visibilidad original SIEMPRE (aunque falle algo)
    allSheets.forEach(function (s, idx) {
      if (prevHidden[idx]) { if (!s.isSheetHidden()) s.hideSheet(); }
      else { if (s.isSheetHidden()) s.showSheet(); }
    });
    SpreadsheetApp.flush();
  }
}

// Exporta el LIBRO (solo pestañas visibles) a PDF horizontal con los márgenes pedidos.
function exportarPdfLibro(ssId) {
  var m = MARGEN_PULGADAS;
  var url = "https://docs.google.com/spreadsheets/d/" + ssId + "/export?"
    + "format=pdf"
    + "&portrait=false"        // horizontal
    + "&gridlines=false"       // sin cuadrícula
    + "&printtitle=false"
    + "&sheetnames=false"
    + "&fzr=false"
    + "&top_margin=" + m + "&bottom_margin=" + m + "&left_margin=" + m + "&right_margin=" + m;
  var resp = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() } });
  return resp.getBlob();
}

// Diagnóstico: muestra los nombres EXACTOS de las pestañas del archivo Remitos.
// Corré esta función (botón Ejecutar) y compará con lo que dice la columna C de Datos.
function listarPestanas() {
  var ss = SpreadsheetApp.openById(REMITOS_SPREADSHEET_ID);
  var nombres = ss.getSheets().map(function (s) { return '"' + s.getName() + '"'; });
  SpreadsheetApp.getUi().alert("Pestañas del archivo Remitos (" + nombres.length + "):\n\n" + nombres.join("\n"));
}
