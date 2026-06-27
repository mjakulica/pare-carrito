"use strict";

const { config } = require("./config");

// Clasifica el mensaje del cliente y extrae items.
// Devuelve: { intent, items:[{producto,cantidad,unidad,nota}], note }
// intent ∈ "pedido_nuevo" | "agregar" | "cancelar" | "consulta" | "saludo"
async function classifyMessage(text, knownProducts) {
  const fallback = { intent: "consulta", items: [], note: "" };
  if (!config.openrouter.apiKey) {
    console.warn("OPENROUTER_API_KEY vacio: no se puede clasificar.");
    return fallback;
  }
  const productHint = Array.isArray(knownProducts) && knownProducts.length
    ? "Lista de productos validos (usa estos nombres exactos cuando coincidan): " + knownProducts.slice(0, 400).join(", ")
    : "";
  const system = [
    "Sos un asistente de una verduleria mayorista. Analiza el mensaje de un cliente por WhatsApp.",
    "Clasifica la intencion en uno de: pedido_nuevo, agregar, cancelar, consulta, saludo.",
    "- pedido_nuevo: el cliente pasa un pedido completo.",
    "- agregar: pide sumar productos a un pedido ya hecho hoy.",
    "- cancelar: pide sacar/cancelar productos o el pedido.",
    "- consulta: pregunta algo que no es un pedido (precios, horarios, reclamos, etc.).",
    "- saludo: solo saluda o agradece.",
    "Extrae los items mencionados con cantidad y unidad cuando aplique.",
    productHint,
    'Responde SOLO con JSON valido: {"intent":"...","items":[{"producto":"","cantidad":0,"unidad":"","nota":""}],"note":""}'
  ].filter(Boolean).join("\n");

  try {
    const res = await fetch(config.openrouter.apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + config.openrouter.apiKey,
        "HTTP-Referer": "https://parecarrito.app",
        "X-Title": "Pare Carrito Bot"
      },
      body: JSON.stringify({
        model: config.openrouter.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: String(text || "") }
        ]
      })
    });
    if (!res.ok) {
      console.error("OpenRouter error", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return fallback;
    }
    const payload = await res.json().catch(() => ({}));
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
      ? payload.choices[0].message.content
      : "";
    const parsed = JSON.parse(String(content).replace(/```json|```/g, "").trim());
    return {
      intent: parsed.intent || "consulta",
      items: Array.isArray(parsed.items) ? parsed.items : [],
      note: parsed.note || ""
    };
  } catch (error) {
    console.error("classifyMessage error:", error.message);
    return fallback;
  }
}

module.exports = { classifyMessage };
