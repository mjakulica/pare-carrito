(function (root) {
  "use strict";
  const escape = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const labels = { APPROVED: "Aprobada", PENDING: "En revisión", REJECTED: "Rechazada", PAUSED: "Pausada", DISABLED: "Deshabilitada", IN_APPEAL: "En apelación", PENDING_DELETION: "Pendiente de eliminación" };
  const blank = () => ({ name: "", language: "es", category: "UTILITY", body: "Pare Carrito: {{1}} Ante cualquier duda respondé este mensaje.", sample: "", footer: "" });
  const model = { account: null, templates: [], selected: "", draft: blank(), busy: false, error: "", notice: "", dirty: false };
  let host, request;
  function selected() { return model.templates.find(t => t.id === model.selected); }
  function select(id) {
    model.selected = id;
    const t = selected();
    model.draft = t ? { name: t.name, language: t.language, category: t.category, body: t.body, sample: t.sample, footer: t.footer } : blank();
    model.dirty = false;
  }
  function preview() {
    if (!host || !host.isConnected) return;
    host.querySelector("[data-wa-preview]").textContent = model.draft.body.replace("{{1}}", model.draft.sample || "[ejemplo de la variable]");
    host.querySelector("[data-wa-footer-preview]").textContent = model.draft.footer;
    host.querySelector("[data-wa-counter]").textContent = model.draft.body.length + "/1024";
  }
  function render() {
    if (!host || !host.isConnected) return;
    const t = selected();
    const locked = model.busy || !model.account || (t && !t.canEdit);
    const disabled = locked ? "disabled" : "";
    host.innerHTML = `<div class="page-actions" style="justify-content:space-between;align-items:center">
      <h2 class="page-title" style="font-size:18px;margin:0">Plantillas de WhatsApp</h2>
      <button type="button" class="btn small ghost" data-wa-refresh ${model.busy ? "disabled" : ""}>${model.busy ? "Consultando…" : "Consultar Meta"}</button>
    </div>
    <p class="muted">Creá y editá el texto fijo de los mensajes. Meta decide su aprobación y categoría. Los cambios se envían solo al pulsar el botón de envío.</p>
    ${model.account ? `<p><strong>Cuenta: ${escape(model.account.name)}</strong> · WABA ${escape(model.account.id)}</p>` : `<p class="muted">Consultá Meta para cargar la cuenta configurada en el servidor y sus plantillas.</p>`}
    ${model.error ? `<div class="alert warn" role="alert">${escape(model.error)}</div>` : ""}
    ${model.notice ? `<p role="status">${escape(model.notice)}</p>` : ""}
    <div class="form-grid">
      <div class="field span-3"><label for="wa-template-select">Plantilla existente</label><select id="wa-template-select" ${model.busy ? "disabled" : ""}>
        <option value="">Nueva plantilla</option>${model.templates.map(x => `<option value="${escape(x.id)}" ${x.id === model.selected ? "selected" : ""}>${escape(x.name)} · ${escape(x.language)} · ${escape(labels[x.status] || x.status)}</option>`).join("")}</select></div>
      <div class="field"><label>&nbsp;</label><button type="button" class="btn ghost" data-wa-new ${model.busy ? "disabled" : ""}>Nueva plantilla</button></div>
    </div>
    ${t ? `<p><strong>Estado en Meta: ${escape(labels[t.status] || t.status)}</strong> · ${escape(t.category === "UTILITY" ? "Utilidad" : t.category === "MARKETING" ? "Marketing" : t.category)}</p>
      ${t.rejectedReason && t.rejectedReason !== "NONE" ? `<div class="alert warn">Motivo informado por Meta: ${escape(t.rejectedReason)}</div>` : ""}
      ${t.readOnlyReason ? `<p class="muted">${escape(t.readOnlyReason)}</p>` : ""}` : ""}
    <form data-wa-template-form>
      <div class="form-grid">
        <div class="field span-2"><label for="wa-template-name">Nombre</label><input id="wa-template-name" name="name" value="${escape(model.draft.name)}" pattern="[a-z0-9_]+" maxlength="512" required ${t ? "readonly" : ""} ${disabled} placeholder="ej: pedido_modificado" /></div>
        <div class="field"><label for="wa-template-language">Idioma</label><input id="wa-template-language" name="language" value="${escape(model.draft.language)}" pattern="[a-z]{2,3}(_[A-Z]{2})?" required ${t ? "readonly" : ""} ${disabled} placeholder="es" /></div>
        <div class="field"><label for="wa-template-category">Categoría</label><select id="wa-template-category" name="category" ${locked || (t && !t.canChangeCategory) ? "disabled" : ""}>
          <option value="UTILITY" ${model.draft.category === "UTILITY" ? "selected" : ""}>Utilidad</option><option value="MARKETING" ${model.draft.category === "MARKETING" ? "selected" : ""}>Marketing</option>
          ${!["UTILITY", "MARKETING"].includes(model.draft.category) ? `<option selected>${escape(model.draft.category)}</option>` : ""}</select></div>
        <div class="field span-4"><label for="wa-template-body">Texto fijo y variable</label><textarea id="wa-template-body" name="body" rows="5" maxlength="1024" required ${disabled}>${escape(model.draft.body)}</textarea><span class="muted" data-wa-counter></span>
          <span class="muted">Usá una sola variable {{1}}, con texto fijo antes y después. El sistema coloca ahí el detalle del aviso.</span></div>
        <div class="field span-4"><label for="wa-template-sample">Ejemplo de {{1}} para la revisión</label><input id="wa-template-sample" name="sample" maxlength="1000" value="${escape(model.draft.sample)}" required ${disabled} placeholder="Ejemplo ficticio: agregamos dos cajones de tomate al pedido." /><span class="muted">Usá datos ficticios. Este ejemplo no se envía a clientes.</span></div>
        <div class="field span-4"><label for="wa-template-footer">Pie de mensaje (opcional)</label><input id="wa-template-footer" name="footer" maxlength="60" value="${escape(model.draft.footer)}" ${disabled} /></div>
      </div>
      <h3 style="font-size:15px">Vista previa con el ejemplo</h3><div style="background:#edf7ef;border:1px solid #c7dfce;border-radius:12px;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere"><div data-wa-preview></div><small class="muted" data-wa-footer-preview></small></div>
      <p class="muted">${t ? "Meta puede limitar la frecuencia de edición. El nombre y el idioma no se pueden cambiar; para otra combinación creá una plantilla nueva. La categoría solo se puede cambiar aquí si la plantilla está rechazada; en otros estados creá una nueva con otro nombre." : "La plantilla se creará en la cuenta indicada arriba. Elegí Utilidad para avisos sobre pedidos, pagos o entregas; Marketing para promociones."}</p>
      <button class="btn primary" type="submit" ${disabled}>${model.busy ? "Procesando…" : t ? "Enviar cambios a Meta" : "Crear y enviar a Meta"}</button>
      <p class="muted">Para usar una plantilla nueva en los avisos del ERP, cargá su nombre en el campo correspondiente de Configuración.</p>
    </form>`;
    preview();
    host.querySelector("[data-wa-refresh]").addEventListener("click", load);
    host.querySelector("[data-wa-new]").addEventListener("click", () => { select(""); model.error = ""; model.notice = ""; render(); });
    host.querySelector("#wa-template-select").addEventListener("change", e => { select(e.target.value); model.error = ""; model.notice = ""; render(); });
    host.querySelector("form").addEventListener("input", e => {
      if (!Object.hasOwn(model.draft, e.target.name)) return;
      model.draft[e.target.name] = e.target.value; model.dirty = true; preview();
    });
    host.querySelector("form").addEventListener("change", e => {
      if (Object.hasOwn(model.draft, e.target.name)) { model.draft[e.target.name] = e.target.value; model.dirty = true; preview(); }
    });
    host.querySelector("form").addEventListener("submit", save);
  }
  async function api(path, body) {
    const r = await request("/whatsapp/templates" + path, body ? { method: "POST", body: JSON.stringify(body) } : { method: "GET" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo consultar Meta (HTTP " + r.status + ").");
    return j;
  }
  async function fetchList() {
    const j = await api("");
    if (model.account && model.account.id !== j.account.id) { select(""); model.notice = "Cambió la cuenta de WhatsApp. Revisá la cuenta antes de enviar cambios."; }
    model.account = j.account; model.templates = j.templates;
    if (model.selected && !model.dirty) {
      if (selected()) select(model.selected); else select("");
    }
  }
  async function load() {
    if (model.busy) return;
    model.busy = true; model.error = ""; render();
    try { await fetchList(); } catch (e) { model.error = e.message; }
    finally { model.busy = false; render(); }
  }
  async function save(e) {
    e.preventDefault();
    if (model.busy || !model.account || (selected() && !selected().canEdit)) return;
    model.busy = true; model.error = ""; model.notice = ""; render();
    try {
      const j = await api(model.selected ? "/" + encodeURIComponent(model.selected) : "", { ...model.draft, accountId: model.account.id });
      model.notice = "Meta recibió la solicitud. Consultá el estado antes de usar la plantilla.";
      model.dirty = false;
      // No se reintenta la escritura si falla la consulta posterior: podría duplicar una creación.
      try { model.selected = j.id || model.selected; await fetchList(); }
      catch (error) { model.notice += " No se pudo actualizar la lista: " + error.message; }
    } catch (error) { model.error = error.message; }
    finally { model.busy = false; render(); }
  }
  root.WhatsAppTemplates = {
    html: () => '<section id="wa-template-manager" class="panel" aria-label="Administrar plantillas de WhatsApp"></section>',
    mount: options => { host = document.getElementById("wa-template-manager"); request = options.request; render(); }
  };
})(window);
