// Pare Carrito SAS - Facturacion automatica via TusFacturasAPP (AFIP/ARCA)
// Doc: https://developers.tusfacturas.app
// Periodicidad: diaria (cada dia 23:00), semanal (sabados 23:00 con corte
// adicional el ultimo dia del mes), mensual (ultimo dia del mes 23:00).

const Decimal = require("decimal.js");

const TF_URL = "https://www.tusfacturas.app/app/api/v2/facturacion/nuevo";
const TF_AFIP_INFO_URL = "https://www.tusfacturas.app/app/api/v2/clientes/afip-info";
const TF_REGEN_PDF_URL = "https://www.tusfacturas.app/app/api/v2/facturacion/regenerar_pdf";
const TF_ITEMS_PER_INVOICE = 130;
const TF_TIMEOUT_MS = 30000;
const TF_RETRIES = 3;

const PROVINCIA_MAP = {
  "CAPITAL FEDERAL": "1",
  "CABA": "1",
  "BUENOS AIRES": "2",
  "CATAMARCA": "3",
  "CORDOBA": "4",
  "CORRIENTES": "5",
  "ENTRE RIOS": "6",
  "JUJUY": "7",
  "MENDOZA": "8",
  "LA RIOJA": "9",
  "SALTA": "10",
  "SAN JUAN": "11",
  "SAN LUIS": "12",
  "SANTA FE": "13",
  "SANTIAGO DEL ESTERO": "14",
  "TUCUMAN": "15",
  "CHACO": "16",
  "CHUBUT": "17",
  "FORMOSA": "18",
  "MISIONES": "19",
  "NEUQUEN": "20",
  "LA PAMPA": "21",
  "RIO NEGRO": "22",
  "SANTA CRUZ": "23",
  "TIERRA DEL FUEGO": "24"
};

function mapCondicionIva(condicion) {
  const c = String(condicion || "").toUpperCase().trim();
  if (c.includes("RESPONSABLE INSCRIPTO")) return "RI";
  if (c.includes("MONOTRIBUTO")) return "MT";
  if (c.includes("EXENTO")) return "EX";
  if (c.includes("CONSUMIDOR FINAL")) return "CF";
  if (c.includes("NO RESPONSABLE")) return "NR";
  if (c.includes("SUJETO EXENTO")) return "SE";
  return "";
}

function billingConfig(env = process.env) {
  const cfg = {
    apikey: env.TUSFACTURAS_APIKEY || "",
    apitoken: env.TUSFACTURAS_APITOKEN || "",
    usertoken: env.TUSFACTURAS_USERTOKEN || "",
    puntoVenta: env.TUSFACTURAS_PUNTO_VENTA || "1",
    provincia: env.TUSFACTURAS_PROVINCIA || "17",
    rubro: env.TUSFACTURAS_RUBRO || "Frutas y verduras",
    condicionPago: env.TUSFACTURAS_CONDICION_PAGO || "211"
  };
  cfg.enabled = !!(cfg.apikey && cfg.apitoken && cfg.usertoken);
  return cfg;
}

// Hora de Argentina (UTC-3, sin horario de verano)
function nowArt(date = new Date()) {
  const shifted = new Date(date.getTime() - 3 * 3600 * 1000);
  const dateISO = shifted.toISOString().slice(0, 10);
  return {
    dateISO,
    hour: shifted.getUTCHours(),
    weekday: shifted.getUTCDay(), // 6 = sabado
    isLastDayOfMonth: nextDayISO(dateISO).slice(8, 10) === "01"
  };
}

function nextDayISO(iso) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function firstOfMonth(iso) {
  return iso.slice(0, 8) + "01";
}

function endOfMonthISO(iso) {
  const d = new Date(iso.slice(0, 8) + "01T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function ddmmyyyy(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function normalizeFrequency(value) {
  const v = String(value || "").toLowerCase();
  if (v.startsWith("diari")) return "diaria";
  if (v.startsWith("seman")) return "semanal";
  if (v.startsWith("mensu")) return "mensual";
  return "mensual";
}

// --- Precision decimal (BILL-001) ---

function d(n) {
  return new Decimal(n == null ? 0 : n);
}

function round2(n) {
  return d(n).toDecimalPlaces(2).toNumber();
}

function sumDecimals(values) {
  return values.reduce((acc, val) => acc.plus(d(val)), d(0));
}

// --- Validacion CUIT/CUIL (BILL-002) ---

function cleanCuit(value) {
  return String(value || "").replace(/\D/g, "");
}

function validateCuit(value) {
  const cuit = cleanCuit(value);
  if (cuit.length !== 11) return { ok: false, reason: "El CUIT debe tener 11 digitos" };
  const prefix = cuit.slice(0, 2);
  if (!["20", "23", "24", "27", "30", "33", "34"].includes(prefix)) {
    return { ok: false, reason: "Prefijo de CUIT/CUIL invalido" };
  }
  const base = cuit.slice(0, 10);
  const check = cuit.slice(10, 11);
  const multipliers = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(base[i]) * multipliers[i];
  const mod = 11 - (sum % 11);
  const expected = mod === 11 ? "0" : mod === 10 ? "9" : String(mod);
  if (check !== expected) return { ok: false, reason: "Digito verificador de CUIT incorrecto" };
  return { ok: true, cuit };
}

// --- Utilidades de facturacion ---

function lastCutFor(state, clientId) {
  let last = "";
  for (const log of state.billingLog || []) {
    if (log.clientId === clientId && ["ok", "simulada"].includes(log.status) && log.to > last) last = log.to;
  }
  return last;
}

function buildGroupedItems(orders) {
  const items = new Map();
  for (const order of orders) {
    for (const it of order.items || []) {
      const productId = String(it.productId || "");
      const unitPrice = round2(it.unitPrice || 0);
      const ivaRate = round2(it.ivaRate || 0);
      const key = `${productId}|${unitPrice}|${ivaRate}`;
      const prev = items.get(key) || {
        descripcion: it.productName || "Producto",
        cantidad: d(0),
        precio: d(unitPrice),
        alicuota: d(ivaRate),
        codigo: productId
      };
      prev.cantidad = prev.cantidad.plus(d(it.quantity || 0));
      items.set(key, prev);
    }
  }
  return Array.from(items.values()).map((it) => ({
    descripcion: it.descripcion,
    cantidad: it.cantidad,
    precio: it.precio,
    alicuota: it.alicuota,
    codigo: it.codigo,
    // subtotal sin iva = precio * cantidad
    neto: it.precio.times(it.cantidad),
    iva: it.precio.times(it.cantidad).times(it.alicuota).dividedBy(100)
  }));
}

function buildPeriod(state, client, freq, from, to) {
  if (from > to) return null;
  const orders = (state.orders || []).filter((o) =>
    o.clientId === client.id && o.date >= from && o.date <= to && !["cancelado", "anulado"].includes(o.status));
  const grouped = buildGroupedItems(orders);
  const neto = sumDecimals(grouped.map((it) => it.neto));
  const iva = sumDecimals(grouped.map((it) => it.iva));
  const total = neto.plus(iva);
  return {
    clientId: client.id,
    client,
    freq,
    from,
    to,
    total: round2(total),
    iva: round2(iva),
    neto: round2(neto),
    items: grouped,
    orders: orders.length,
    orderIds: orders.map((o) => o.id)
  };
}

function applyManualIvaOverride(invoice, ivaAmount) {
  if (!invoice || ivaAmount == null || ivaAmount === "") return invoice;
  const manualIva = d(ivaAmount);
  if (manualIva.isNegative()) return invoice;
  const neto = d(invoice.neto || 0);
  const rate = neto.isZero() ? d(0) : manualIva.times(100).dividedBy(neto);
  const items = (invoice.items || []).map((item) => {
    const itemNeto = d(item.neto || d(item.precio || 0).times(item.cantidad || 0));
    return {
      ...item,
      alicuota: rate,
      iva: itemNeto.times(rate).dividedBy(100)
    };
  });
  const iva = sumDecimals(items.map((item) => item.iva));
  return {
    ...invoice,
    items,
    iva: round2(iva),
    total: round2(neto.plus(iva)),
    manualIvaOverride: round2(manualIva)
  };
}

// Devuelve la lista de facturas a emitir "ahora" segun la hora ART
function computeDueInvoices(state, art, force = false) {
  if (!force && art.hour < 23) return [];
  const due = [];
  for (const client of state.clients || []) {
    if (!client || client.isActive === false || !client.needsInvoice) continue;
    if (!["Factura A", "Factura B"].includes(client.invoiceType)) continue;
    const freq = normalizeFrequency(client.invoiceFrequency);
    const lastCut = lastCutFor(state, client.id);
    if (lastCut >= art.dateISO) continue; // ya facturado hasta hoy
    let trigger = false;
    if (freq === "diaria") trigger = true;
    else if (freq === "mensual") trigger = art.isLastDayOfMonth;
    else if (freq === "semanal") trigger = art.weekday === 6 || art.isLastDayOfMonth;
    if (!trigger && !force) continue;
    let from;
    if (freq === "diaria") from = art.dateISO;
    else if (lastCut) from = nextDayISO(lastCut);
    else from = firstOfMonth(art.dateISO);
    // corte de fin de mes para semanales: el periodo nunca cruza meses
    if (from < firstOfMonth(art.dateISO)) {
      // quedo un resto del mes anterior sin facturar: facturar ese resto primero
      const prevEnd = endOfMonthISO(from);
      due.push(buildPeriod(state, client, freq, from, prevEnd));
      from = nextDayISO(prevEnd);
    }
    due.push(buildPeriod(state, client, freq, from, art.dateISO));
  }
  return due.filter((d) => d && d.total > 0);
}

// --- Construccion de payload (BILL-004, BILL-005, BILL-007) ---

function buildInvoicePayload(invoice, cfg, options = {}) {
  const client = invoice.client;
  const email = String(client.billingEmail || client.email || "").trim();
  const cuitValidation = validateCuit(client.cuit);
  if (!cuitValidation.ok) {
    throw new Error(`CUIT invalido para cliente ${client.id}: ${cuitValidation.reason}`);
  }

  const contributor = options.contributorData || {};
  const razonSocial = contributor.razonSocial || client.legalName || client.name || "";
  const domicilio = contributor.domicilio || client.address || "-";
  const provinciaCodigo = PROVINCIA_MAP[String(contributor.provinciaTexto || "").toUpperCase().trim()] || cfg.provincia;
  const condicionIva = contributor.condicionIva || (client.invoiceType === "Factura A" ? "RI" : "CF");

  const batchNumber = options.batchNumber || 1;
  const batchTotal = options.batchTotal || 1;
  const batchItems = options.items || invoice.items;

  const detalle = batchItems.map((it) => ({
    cantidad: String(round2(it.cantidad)),
    afecta_stock: "N",
    bonificacion_porcentaje: "0",
    producto: {
      descripcion: String(it.descripcion || "Producto").slice(0, 255),
      codigo: String(it.codigo || ""),
      precio_unitario_sin_iva: String(round2(it.precio)),
      alicuota: String(round2(it.alicuota)),
      impuestos_internos_alicuota: 0,
      unidad_medida: "7",
      unidad_bulto: 1
    }
  }));

  const suffix = batchTotal > 1 ? ` (${batchNumber}/${batchTotal})` : "";
  const externalReference = `PC-${invoice.clientId}-${invoice.from}-${invoice.to}${suffix}`;

  return {
    apikey: cfg.apikey,
    apitoken: cfg.apitoken,
    usertoken: cfg.usertoken,
    cliente: {
      documento_tipo: "CUIT",
      documento_nro: cuitValidation.cuit,
      razon_social: String(razonSocial).slice(0, 255),
      email,
      domicilio: String(domicilio).slice(0, 255),
      provincia: provinciaCodigo,
      envia_por_mail: email ? "S" : "N",
      condicion_pago: cfg.condicionPago,
      condicion_iva: condicionIva,
      // No enviamos 'codigo' para evitar conflictos cuando el cliente ya existe en
      // TusFacturas con otro codigo interno. La API identifica al cliente por CUIT.
      rg5329: "N"
    },
    comprobante: {
      fecha: ddmmyyyy(invoice.to),
      tipo: client.invoiceType.toUpperCase(),
      operacion: "V",
      idioma: 1,
      punto_venta: cfg.puntoVenta,
      moneda: "PES",
      cotizacion: 1,
      vencimiento: ddmmyyyy(invoice.to),
      periodo_facturado_desde: ddmmyyyy(invoice.from),
      periodo_facturado_hasta: ddmmyyyy(invoice.to),
      rubro: cfg.rubro,
      rubro_grupo_contable: cfg.rubro,
      detalle,
      bonificacion: "0",
      leyenda_gral: "Periodo facturado: " + ddmmyyyy(invoice.from) + " al " + ddmmyyyy(invoice.to) + suffix,
      external_reference: externalReference,
      total: String(round2(sumDecimals(batchItems.map((it) => it.neto.plus(it.iva)))))
    }
  };
}

function splitPeriodIntoInvoices(invoice) {
  const items = invoice.items || [];
  if (items.length <= TF_ITEMS_PER_INVOICE) return [{ ...invoice }];
  const batches = [];
  for (let i = 0; i < items.length; i += TF_ITEMS_PER_INVOICE) {
    batches.push(items.slice(i, i + TF_ITEMS_PER_INVOICE));
  }
  return batches.map((batch, idx) => ({
    ...invoice,
    items: batch,
    batchNumber: idx + 1,
    batchTotal: batches.length,
    partialTotal: round2(sumDecimals(batch.map((it) => it.neto.plus(it.iva)))),
    partialIva: round2(sumDecimals(batch.map((it) => it.iva)))
  }));
}

// --- Llamada a TusFacturas con timeout y reintentos (BILL-003) ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, fetchImpl = fetch) {
  let lastError;
  for (let attempt = 1; attempt <= TF_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TF_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (error.name === "AbortError") lastError = new Error("Timeout al contactar TusFacturas");
      if (attempt < TF_RETRIES) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
        console.warn(`[TusFacturas] intento ${attempt} fallido, reintentando en ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

async function fetchContributorData(cuit, cfg, fetchImpl = fetch) {
  try {
    const response = await fetchWithRetry(TF_AFIP_INFO_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apikey: cfg.apikey,
        apitoken: cfg.apitoken,
        usertoken: cfg.usertoken,
        cliente: {
          documento_tipo: "CUIT",
          documento_nro: cleanCuit(cuit)
        }
      })
    }, fetchImpl);
    const body = await response.json().catch(() => ({ error: "S" }));
    if (body.error === "N") {
      return {
        razonSocial: body.razon_social || "",
        domicilio: body.direccion || "",
        provinciaTexto: body.provincia || "",
        condicionIva: mapCondicionIva(body.condicion_impositiva)
      };
    }
  } catch (error) {
    console.warn("[TusFacturas afip-info] no se pudo obtener datos del contribuyente:", error.message);
  }
  return null;
}

async function emitInvoice(invoice, cfg, fetchImpl = fetch) {
  const contributorData = cfg.enabled
    ? await fetchContributorData(invoice.client.cuit, cfg, fetchImpl)
    : null;
  const payload = buildInvoicePayload(invoice, cfg, {
    items: invoice.items,
    batchNumber: invoice.batchNumber,
    batchTotal: invoice.batchTotal,
    contributorData
  });
  console.log("[TusFacturas payload] cliente:", JSON.stringify(payload.cliente));
  console.log("[TusFacturas payload] comprobante:", JSON.stringify(payload.comprobante));
  const response = await fetchWithRetry(TF_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }, fetchImpl);
  const body = await response.json().catch(() => ({ error: "S", errores: ["respuesta invalida de TusFacturas"] }));
  if (body.error === "S") {
    return { ok: false, errors: (body.errores || []).filter(Boolean) };
  }
  return {
    ok: true,
    cae: body.cae || "",
    numero: body.comprobante_nro || "",
    tipo: body.comprobante_tipo || "",
    pdf: body.comprobante_pdf_url || "",
    rta: body.rta || "",
    externalReference: payload.comprobante.external_reference
  };
}

async function emitPeriodInvoices(invoice, cfg, fetchImpl = fetch) {
  const parts = splitPeriodIntoInvoices(invoice);
  const results = [];
  for (const part of parts) {
    const result = await emitInvoice(part, cfg, fetchImpl);
    results.push(result);
    if (!result.ok) {
      // BILL-006: rollback/compensacion. Si una parte falla, detenemos el resto del periodo.
      return { ok: false, results, stoppedAt: part.batchNumber || 1 };
    }
  }
  return { ok: true, results };
}

function buildBillingEntry(invoice, emittedAt, periodResult, simulate, cfg) {
  const base = {
    clientId: invoice.clientId,
    clientName: invoice.client.name,
    invoiceType: invoice.client.invoiceType,
    freq: invoice.freq,
    from: invoice.from,
    to: invoice.to,
    total: invoice.total,
    iva: invoice.iva,
    neto: invoice.neto,
    manualIvaOverride: invoice.manualIvaOverride == null ? null : invoice.manualIvaOverride,
    orders: invoice.orders,
    orderIds: Array.isArray(invoice.orderIds) ? invoice.orderIds : [],
    email: String((invoice.client && (invoice.client.billingEmail || invoice.client.email)) || "").trim(),
    emittedAt: emittedAt.toISOString()
  };
  if (simulate) {
    return {
      ...base,
      status: "simulada",
      detail: cfg.enabled ? "simulacion manual" : "credenciales de TusFacturas no configuradas"
    };
  }
  if (!periodResult.ok) {
    const failed = periodResult.results.find((r) => !r.ok);
    return {
      ...base,
      status: "error",
      detail: failed ? failed.errors.join(" | ") : "fallo parcial en comprobantes del periodo",
      partials: periodResult.results.map((r) => ({
        ok: r.ok,
        numero: r.numero || "",
        cae: r.cae || "",
        externalReference: r.externalReference || ""
      }))
    };
  }
  if (periodResult.results.length === 1) {
    const r = periodResult.results[0];
    return {
      ...base,
      status: "ok",
      cae: r.cae,
      numero: r.numero,
      pdf: r.pdf,
      detail: r.rta,
      externalReference: r.externalReference
    };
  }
  return {
    ...base,
    status: "ok",
    detail: `Periodo dividido en ${periodResult.results.length} comprobantes`,
    partials: periodResult.results.map((r) => ({
      numero: r.numero,
      cae: r.cae,
      pdf: r.pdf,
      externalReference: r.externalReference
    }))
  };
}

// Corre la facturacion sobre el estado central, registra resultados en billingLog
// Retorna { ran, simulate, count, results, lastRunDate }
async function runBilling({ pool, force = false, simulate = false, onlyClientId = "", onlyClientIds = null, ivaOverrides = null, fetchImpl = fetch, now = new Date(), lastRunDate = "" }) {
  const cfg = billingConfig();
  if (!cfg.enabled) simulate = true;
  const stateRow = await pool.query("SELECT data FROM app_state WHERE id = 'main'");
  if (!stateRow.rows.length) return { ran: false, reason: "sin estado" };
  const data = stateRow.rows[0].data;
  data.billingLog = Array.isArray(data.billingLog) ? data.billingLog : [];
  const art = nowArt(now);
  let due = computeDueInvoices(data, art, force);
  const selectedClientIds = Array.isArray(onlyClientIds)
    ? new Set(onlyClientIds.map((id) => String(id || "").trim()).filter(Boolean))
    : new Set();
  if (onlyClientId) selectedClientIds.add(String(onlyClientId || "").trim());
  if (selectedClientIds.size) due = due.filter((d) => selectedClientIds.has(d.clientId));
  const manualIvaByClient = ivaOverrides && typeof ivaOverrides === "object" ? ivaOverrides : {};
  due = due.map((invoice) => Object.prototype.hasOwnProperty.call(manualIvaByClient, invoice.clientId)
    ? applyManualIvaOverride(invoice, manualIvaByClient[invoice.clientId])
    : invoice);

  const results = [];
  const emittedAt = new Date();
  let newLastRunDate = lastRunDate;

  for (const invoice of due) {
    let periodResult = { ok: true, results: [] };
    if (!simulate) {
      try {
        periodResult = await emitPeriodInvoices(invoice, cfg, fetchImpl);
      } catch (error) {
        periodResult = { ok: false, results: [{ ok: false, errors: [error.message] }] };
      }
    }

    const entry = buildBillingEntry(invoice, emittedAt, periodResult, simulate, cfg);
    entry.id = `FAC-${Date.now()}-${invoice.clientId}${periodResult.results.length > 1 ? "-M" : ""}`;
    data.billingLog.push(entry);
    results.push(entry);

    // BILL-006: si falla un periodo, detenemos el batch para evitar estado inconsistente.
    if (!simulate && !periodResult.ok) {
      break;
    }

    // Actualizamos la fecha de ultima ejecucion solo si se proceso al menos un periodo correctamente.
    newLastRunDate = art.dateISO;
  }

  if (results.length) {
    await pool.query("UPDATE app_state SET data = $1, updated_at = now(), updated_by = 'facturacion-automatica' WHERE id = 'main'", [data]);
  }
  return { ran: true, simulate, count: results.length, results, lastRunDate: newLastRunDate };
}

// Regenera el PDF de un comprobante ya emitido y devuelve una URL fresca (la del alta caduca).
// numeroCompleto puede venir como "00003-00000022" (punto_venta-numero) o solo el numero.
async function regeneratePdf(cfg, { tipo, operacion, numeroCompleto, puntoVenta, numero }, fetchImpl = fetch) {
  let pv = puntoVenta;
  let nro = numero;
  if (numeroCompleto && (pv == null || nro == null)) {
    const parts = String(numeroCompleto).split("-");
    if (parts.length === 2) { pv = parts[0]; nro = parts[1]; }
    else { nro = numeroCompleto; }
  }
  if (pv == null) pv = cfg.puntoVenta || "1";
  pv = parseInt(String(pv).replace(/\D/g, ""), 10);
  nro = parseInt(String(nro).replace(/\D/g, ""), 10);
  const tComp = String(tipo || "").trim().toUpperCase();
  if (!tComp || !Number.isFinite(pv) || !Number.isFinite(nro)) {
    throw new Error("Faltan datos para regenerar (tipo / punto de venta / numero).");
  }
  const payload = {
    usertoken: cfg.usertoken,
    apikey: cfg.apikey,
    apitoken: cfg.apitoken,
    comprobante: { tipo: tComp, operacion: operacion || "V", punto_venta: String(pv), numero: String(nro) }
  };
  const response = await fetchWithRetry(TF_REGEN_PDF_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }, fetchImpl);
  const body = await response.json().catch(() => ({}));
  if (body.error && String(body.error).toUpperCase() !== "N") {
    throw new Error((body.errores || ["Error de TusFacturas al regenerar PDF"]).filter(Boolean).join(" | "));
  }
  return body.comprobante_pdf_url || "";
}

module.exports = {
  billingConfig,
  nowArt,
  computeDueInvoices,
  buildInvoicePayload,
  emitInvoice,
  emitPeriodInvoices,
  runBilling,
  fetchContributorData,
  endOfMonthISO,
  nextDayISO,
  validateCuit,
  cleanCuit,
  regeneratePdf
};
