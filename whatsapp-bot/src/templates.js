"use strict";

// El token vive en el bot. Nunca se devuelve al ERP ni se usa en URLs de paginación.
const FIELDS = "id,name,language,category,status,components,rejected_reason,parameter_format";
const EDITABLE = new Set(["APPROVED", "REJECTED", "PAUSED"]);
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }

function validateDraft(input) {
  const d = {};
  for (const k of ["name", "language", "category", "body", "sample", "footer"]) d[k] = String(input[k] || "").trim();
  if (!/^[a-z0-9_]{1,512}$/.test(d.name)) fail(400, "El nombre solo admite minúsculas, números y guiones bajos.");
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(d.language)) fail(400, "Idioma inválido (por ejemplo es o es_AR).");
  if (!["UTILITY", "MARKETING"].includes(d.category)) fail(400, "Elegí Utilidad o Marketing.");
  const vars = d.body.match(/\{\{[^{}]*\}\}/g) || [];
  const fixed = d.body.replace("{{1}}", "");
  if (d.body.length > 1024 || vars.length !== 1 || vars[0] !== "{{1}}" || /[{}]/.test(fixed) || fixed.trim().length < 15 || d.body.startsWith("{{1}}") || d.body.endsWith("{{1}}")) {
    fail(400, "El cuerpo debe tener hasta 1024 caracteres, una sola variable {{1}} y texto fijo antes y después de ella.");
  }
  if (!d.sample || d.sample.length > 1000 || /[{}\r\n\t]/.test(d.sample)) fail(400, "Ingresá un ejemplo ficticio de hasta 1000 caracteres, sin variables ni saltos de línea.");
  if (d.footer.length > 60 || /[{}\r\n]/.test(d.footer)) fail(400, "El pie admite hasta 60 caracteres, sin variables ni saltos de línea.");
  return d;
}

function present(t) {
  const cs = Array.isArray(t.components) ? t.components : [];
  const body = cs.find(c => c.type === "BODY") || {};
  const footer = cs.find(c => c.type === "FOOTER") || {};
  const vars = String(body.text || "").match(/\{\{[^{}]*\}\}/g) || [];
  const supported = cs.filter(c => c.type === "BODY").length === 1 && cs.filter(c => c.type === "FOOTER").length <= 1 &&
    cs.every(c => c.type === "BODY" || c.type === "FOOTER") && vars.length === 1 && vars[0] === "{{1}}" &&
    (!t.parameter_format || t.parameter_format === "POSITIONAL") && ["UTILITY", "MARKETING"].includes(t.category);
  const canEdit = supported && EDITABLE.has(t.status);
  return {
    id: String(t.id), name: t.name, language: t.language, category: t.category, status: t.status,
    body: String(body.text || ""), footer: String(footer.text || ""),
    sample: String(body.example?.body_text?.[0]?.[0] || ""), rejectedReason: String(t.rejected_reason || ""),
    canEdit, canChangeCategory: canEdit && t.status === "REJECTED",
    readOnlyReason: !supported ? "Esta plantilla usa componentes o variables que este editor no admite. Editala en WhatsApp Manager para conservarlos." :
      !EDITABLE.has(t.status) ? "Meta solo permite editar plantillas aprobadas, rechazadas o pausadas. Consultá el estado más adelante." : ""
  };
}

function createTemplateService({ token, wabaId, apiVersion = "v26.0", fetchImpl = fetch }) {
  async function graph(node, { method = "GET", query = {}, body } = {}) {
    if (!token) fail(503, "Falta WHATSAPP_TOKEN en el bot.");
    if (!/^\d+$/.test(wabaId || "")) fail(503, "Configurá WHATSAPP_BUSINESS_ACCOUNT_ID (WABA ID) en el .env y recreá el bot. El token necesita whatsapp_business_management.");
    if (!/^v\d+\.\d+$/.test(apiVersion)) fail(503, "WHATSAPP_MANAGEMENT_API_VERSION inválida.");
    const url = new URL(`https://graph.facebook.com/${apiVersion}/${node}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    let response;
    try {
      response = await fetchImpl(url, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    } catch (_) { fail(502, "No se pudo conectar con Meta. Consultá el estado antes de reintentar un envío."); }
    const j = await response.json().catch(() => null);
    if (!response.ok || !j || j.error) {
      const detail = String(j?.error?.error_user_msg || j?.error?.message || "Respuesta inválida de Meta").split(token).join("[oculto]").slice(0, 800);
      fail(502, "Meta: " + detail + (j?.error?.code ? ` (código ${j.error.code})` : ""));
    }
    return j;
  }
  async function allTemplates() {
    const templates = [];
    let after = "";
    const seen = new Set();
    for (let page = 0; page < 20; page++) {
      const j = await graph(`${wabaId}/message_templates`, { query: { fields: FIELDS, limit: "100", ...(after ? { after } : {}) } });
      if (!Array.isArray(j.data)) fail(502, "Meta no devolvió una lista de plantillas válida.");
      templates.push(...j.data.map(present));
      if (!j.paging?.next) return templates;
      after = j.paging?.cursors?.after;
      if (!after || typeof after !== "string" || after.length > 4096 || seen.has(after)) fail(502, "Meta devolvió una paginación inválida.");
      seen.add(after);
    }
    fail(502, "La cuenta tiene demasiadas páginas de plantillas para cargarla completa.");
  }
  function checkAccount(input) {
    if (String(input.accountId || "") !== wabaId) fail(409, "La cuenta de WhatsApp cambió. Consultá Meta de nuevo antes de enviar cambios.");
  }
  function components(d) {
    return [{ type: "BODY", text: d.body, example: { body_text: [[d.sample]] } }, ...(d.footer ? [{ type: "FOOTER", text: d.footer }] : [])];
  }
  return {
    async list() {
      const account = await graph(wabaId, { query: { fields: "id,name" } });
      return { account: { id: String(account.id), name: String(account.name || "") }, templates: await allTemplates() };
    },
    async create(input) {
      checkAccount(input);
      const d = validateDraft(input);
      const j = await graph(`${wabaId}/message_templates`, { method: "POST", body: {
        name: d.name, language: d.language, category: d.category, parameter_format: "POSITIONAL", components: components(d)
      } });
      return { id: String(j.id || ""), status: j.status || "", category: j.category || d.category };
    },
    async update(id, input) {
      if (!/^\d+$/.test(id)) fail(400, "ID de plantilla inválido.");
      checkAccount(input);
      const d = validateDraft(input);
      // La pertenencia se verifica contra la WABA configurada; no se permite editar un ID arbitrario.
      const current = (await allTemplates()).find(t => t.id === id);
      if (!current) fail(404, "La plantilla no pertenece a la cuenta de WhatsApp configurada.");
      if (!current.canEdit) fail(409, current.readOnlyReason);
      if (d.name !== current.name || d.language !== current.language) fail(400, "Meta no permite cambiar el nombre ni el idioma de una plantilla existente.");
      if (d.category !== current.category && !current.canChangeCategory) fail(409, "Meta solo permite cambiar la categoría desde este editor cuando la plantilla está rechazada.");
      await graph(id, { method: "POST", body: { components: components(d), ...(d.category !== current.category ? { category: d.category } : {}) } });
      return { id };
    }
  };
}

function createTemplateRouter({ service, broadcastKey }) {
  const router = require("express").Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!broadcastKey || req.get("x-broadcast-key") !== broadcastKey) return res.status(401).json({ error: "No autorizado." });
    next();
  });
  const handle = fn => async (req, res) => {
    try { res.json({ ok: true, ...await fn(req) }); }
    catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : "No se pudieron gestionar las plantillas." }); }
  };
  router.get("/", handle(() => service.list()));
  router.post("/", handle(req => service.create(req.body || {})));
  router.post("/:id", handle(req => service.update(req.params.id, req.body || {})));
  return router;
}
module.exports = { createTemplateService, createTemplateRouter, validateDraft, present };
