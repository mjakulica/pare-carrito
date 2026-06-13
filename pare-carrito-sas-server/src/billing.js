// Pare Carrito SAS - Facturacion automatica via TusFacturasAPP (AFIP/ARCA)
// Doc: https://developers.tusfacturas.app
// Periodicidad: diaria (cada dia 23:00), semanal (sabados 23:00 con corte
// adicional el ultimo dia del mes), mensual (ultimo dia del mes 23:00).

const TF_URL = "https://www.tusfacturas.app/app/api/v2/facturacion/nuevo";

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

function ddmmyyyy(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function normalizeFrequency(value) {
  const v = String(value || "").toLowerCase();
  if (v.startsWith("diari")) return "diaria";
  if (v.startsWith("seman")) return "semanal";
  if (v.startsWith("mensu")) return "mensual";
  return "mensual";
}

function lastCutFor(state, clientId) {
  let last = "";
  for (const log of state.billingLog || []) {
    if (log.clientId === clientId && ["ok", "simulada"].includes(log.status) && log.to > last) last = log.to;
  }
  return last;
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

function endOfMonthISO(iso) {
  const d = new Date(iso.slice(0, 8) + "01T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function buildPeriod(state, client, freq, from, to) {
  if (from > to) return null;
  const orders = (state.orders || []).filter((o) =>
    o.clientId === client.id && o.date >= from && o.date <= to && !["cancelado", "anulado"].includes(o.status));
  let total = 0;
  let iva = 0;
  const items = new Map();
  for (const order of orders) {
    total += Number(order.totalAmount || 0);
    iva += Number(order.ivaAmount || 0);
    for (const it of order.items || []) {
      const key = it.productId + "|" + Number(it.unitPrice || 0) + "|" + Number(it.ivaRate || 0);
      const prev = items.get(key) || { descripcion: it.productName, cantidad: 0, precio: Number(it.unitPrice || 0), alicuota: Number(it.ivaRate || 0), codigo: it.productId };
      prev.cantidad += Number(it.quantity || 0);
      items.set(key, prev);
    }
  }
  return { clientId: client.id, client, freq, from, to, total: round2(total), iva: round2(iva), items: Array.from(items.values()), orders: orders.length };
}

function buildInvoicePayload(invoice, cfg) {
  const client = invoice.client;
  const email = String(client.billingEmail || client.email || "").trim();
  let detalle;
  if (invoice.items.length > 0 && invoice.items.length <= 130) {
    detalle = invoice.items.map((it) => ({
      cantidad: String(round2(it.cantidad)),
      afecta_stock: "N",
      bonificacion_porcentaje: "0",
      producto: {
        descripcion: String(it.descripcion || "Producto").slice(0, 255),
        codigo: String(it.codigo || ""),
        precio_unitario_sin_iva: String(round2(it.precio)),
        alicuota: String(it.alicuota || 0),
        impuestos_internos_alicuota: 0,
        unidad_medida: "7",
        unidad_bulto: 1
      }
    }));
  } else {
    const neto = round2(invoice.total - invoice.iva);
    const alicuota = invoice.iva > 0 ? round2((invoice.iva / neto) * 100) : 0;
    detalle = [{
      cantidad: "1",
      afecta_stock: "N",
      bonificacion_porcentaje: "0",
      producto: {
        descripcion: "Insumos frescos - periodo " + ddmmyyyy(invoice.from) + " al " + ddmmyyyy(invoice.to),
        codigo: "PERIODO",
        precio_unitario_sin_iva: String(neto),
        alicuota: String(alicuota),
        impuestos_internos_alicuota: 0,
        unidad_medida: "7",
        unidad_bulto: 1
      }
    }];
  }
  return {
    apikey: cfg.apikey,
    apitoken: cfg.apitoken,
    usertoken: cfg.usertoken,
    cliente: {
      documento_tipo: "CUIT",
      documento_nro: String(client.cuit || "").replace(/\D/g, ""),
      razon_social: String(client.legalName || client.name || "").slice(0, 255),
      email,
      domicilio: String(client.address || "-").slice(0, 255),
      provincia: cfg.provincia,
      envia_por_mail: email ? "S" : "N",
      condicion_pago: cfg.condicionPago,
      condicion_iva: client.invoiceType === "Factura A" ? "RI" : "CF",
      codigo: String(client.id),
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
      leyenda_gral: "Periodo facturado: " + ddmmyyyy(invoice.from) + " al " + ddmmyyyy(invoice.to),
      external_reference: "PC-" + invoice.clientId + "-" + invoice.to,
      total: String(round2(invoice.total))
    }
  };
}

async function emitInvoice(invoice, cfg, fetchImpl = fetch) {
  const payload = buildInvoicePayload(invoice, cfg);
  console.log("[TusFacturas payload] cliente:", JSON.stringify(payload.cliente));
  console.log("[TusFacturas payload] comprobante:", JSON.stringify(payload.comprobante));
  const response = await fetchImpl(TF_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
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
    rta: body.rta || ""
  };
}

// Corre la facturacion sobre el estado central, registra resultados en billingLog
async function runBilling({ pool, force = false, simulate = false, onlyClientId = "", fetchImpl = fetch, now = new Date() }) {
  const cfg = billingConfig();
  if (!cfg.enabled) simulate = true;
  const stateRow = await pool.query("SELECT data FROM app_state WHERE id = 'main'");
  if (!stateRow.rows.length) return { ran: false, reason: "sin estado" };
  const data = stateRow.rows[0].data;
  data.billingLog = Array.isArray(data.billingLog) ? data.billingLog : [];
  const art = nowArt(now);
  let due = computeDueInvoices(data, art, force);
  if (onlyClientId) due = due.filter((d) => d.clientId === onlyClientId);
  const results = [];
  for (const invoice of due) {
    const entry = {
      id: "FAC-" + Date.now() + "-" + invoice.clientId,
      clientId: invoice.clientId,
      clientName: invoice.client.name,
      invoiceType: invoice.client.invoiceType,
      freq: invoice.freq,
      from: invoice.from,
      to: invoice.to,
      total: invoice.total,
      iva: invoice.iva,
      orders: invoice.orders,
      emittedAt: new Date().toISOString()
    };
    if (simulate) {
      entry.status = "simulada";
      entry.detail = cfg.enabled ? "simulacion manual" : "credenciales de TusFacturas no configuradas";
    } else {
      try {
        const result = await emitInvoice(invoice, cfg, fetchImpl);
        if (result.ok) {
          entry.status = "ok";
          entry.cae = result.cae;
          entry.numero = result.numero;
          entry.pdf = result.pdf;
          entry.detail = result.rta;
        } else {
          entry.status = "error";
          entry.detail = result.errors.join(" | ");
        }
      } catch (error) {
        entry.status = "error";
        entry.detail = error.message;
      }
    }
    data.billingLog.push(entry);
    results.push(entry);
  }
  if (results.length) {
    await pool.query("UPDATE app_state SET data = $1, updated_at = now(), updated_by = 'facturacion-automatica' WHERE id = 'main'", [data]);
  }
  return { ran: true, simulate, count: results.length, results };
}

module.exports = { billingConfig, nowArt, computeDueInvoices, buildInvoicePayload, emitInvoice, runBilling, endOfMonthISO, nextDayISO };
