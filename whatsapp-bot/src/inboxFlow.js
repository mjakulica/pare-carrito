"use strict";

// Que hace el bot con cada mensaje de un cliente (o de un numero que no esta en Clientes).
//
// Nada se carga solo en el sistema: los pedidos, agregados y cancelaciones van a la bandeja de
// WhatsApp, y una persona los carga desde Nuevo Pedido con el mismo "Pegar pedido como texto".
//
// Numero desconocido: si el mensaje parece un pedido, se le pregunta de que negocio es (nombre y/o
// direccion), se busca el cliente parecido y se le pide que confirme ("¿Sos Vivré, Belgrano 1234?").
// Si no hay uno claro, lo vincula una persona desde la bandeja. Si el mensaje NO parece un pedido
// no se contesta nada: con la coexistencia tambien llegan los mensajes de contactos personales.

const ORDER_INTENTS = new Set(["pedido_nuevo", "agregar", "cancelar"]);
const KIND = { pedido_nuevo: "pedido", agregar: "agregar", cancelar: "cancelar" };

// Fin de palabra a mano: \b no funciona despues de una letra con acento ("Sí").
const SI = /^\s*(s[ií]+|ok|dale|correcto|exacto|as[ií] es|claro|sip|confirmo)(?=$|[\s,.!¡?¿])/i;
const NO = /^\s*(no|nop|negativo|para nada)(?=$|[\s,.!¡?¿])/i;

// channel: por donde llego ("cloud" = API oficial, "linked" = WhatsApp vinculado por QR); la bandeja
// lo guarda para contestar por el mismo lado.
function createInboxFlow({ wa, erp, ai, getProductNames, channel }) {
  async function classify(text) {
    const names = getProductNames ? await getProductNames() : [];
    return ai.classifyMessage(text, names);
  }

  async function toInbox(entry) {
    try {
      return await erp.inbox({ ...entry, channel: channel || "cloud" });
    } catch (e) {
      // Si la bandeja falla, que no se pierda: aviso al equipo con el texto.
      await wa.notifyTeam(`No se pudo guardar en la bandeja un mensaje de ${entry.profileName || entry.phone}: ${e.message}\n"${entry.text}"`);
      return null;
    }
  }

  async function handleKnown({ from, text, profileName, client }) {
    const parsed = await classify(text);
    const nombre = client.name || profileName || "cliente";
    if (parsed.intent === "saludo") {
      await wa.sendText(from, `Hola ${nombre}! Pasame tu pedido cuando quieras.`);
      return "saludo";
    }
    if (!ORDER_INTENTS.has(parsed.intent)) {
      await wa.notifyOwner(`Consulta de ${nombre} (${from}):\n"${text}"`);
      await wa.sendText(from, "Gracias por tu mensaje. Lo derivé a administración y te van a responder a la brevedad.");
      return "consulta";
    }
    let orderId = "";
    if (parsed.intent !== "pedido_nuevo") {
      try { const r = await erp.getTodayOrder(client.id); orderId = r && r.order ? r.order.id : ""; } catch (e) { /* sin pedido */ }
    }
    await toInbox({ phone: from, profileName, clientId: client.id, kind: KIND[parsed.intent], text, items: parsed.items || [], orderId });
    await wa.sendText(from, parsed.intent === "pedido_nuevo"
      ? "¡Recibimos tu pedido! En un rato te confirmamos cuando quede cargado."
      : "¡Recibido! Lo vemos y te confirmamos.");
    return KIND[parsed.intent];
  }

  async function askIdentity(from) {
    await wa.sendText(from, "¡Hola! Recibimos tu mensaje. Este número no está registrado todavía: ¿de qué negocio nos escribís? Pasanos el nombre del local y la dirección, así lo vinculamos.");
  }

  async function handleUnknown({ from, text, profileName }) {
    const st = (await erp.getIdentify(from).catch(() => null)) || {};
    const stage = st.stage || "";

    if (stage === "esperando_datos") {
      const r = await erp.matchClients(text).catch(() => ({ candidates: [] }));
      const candidates = (r && r.candidates) || [];
      const [a, b] = candidates;
      const claro = a && a.score >= 0.8 && !(b && b.score > a.score - 0.3 + 1e-9) ? a : null;
      if (claro) {
        await erp.setIdentify(from, { stage: "confirmando", candidateId: claro.id });
        await wa.sendText(from, `¿Sos ${claro.name}${claro.address ? " (" + claro.address + ")" : ""}? Respondé SI o NO.`);
        return "pregunta_confirmacion";
      }
      await toInbox({ phone: from, profileName, kind: "identificar", text, candidates });
      await erp.setIdentify(from, { stage: "personal" });
      await wa.sendText(from, "¡Gracias! Lo revisamos y te confirmamos en un rato.");
      return "al_personal";
    }

    if (stage === "confirmando") {
      if (SI.test(text)) {
        const r = await erp.linkPhone(st.candidateId, from);
        await wa.sendText(from, `¡Listo, ${r && r.name ? r.name : "gracias"}! Ya registramos este número. Tu pedido lo estamos cargando y te confirmamos.`);
        return "vinculado";
      }
      if (NO.test(text)) {
        await toInbox({ phone: from, profileName, kind: "identificar", text: "Dijo que NO es el cliente que le propusimos. Escribió: " + text });
        await erp.setIdentify(from, { stage: "personal" });
        await wa.sendText(from, "Ok, gracias. Lo revisamos y te confirmamos en un rato.");
        return "al_personal";
      }
      await wa.sendText(from, "Perdón, no entendí. Respondé SI o NO, por favor.");
      return "repregunta";
    }

    // Sin conversacion abierta (o esperando al personal): solo se guarda lo que parece un pedido.
    const parsed = await classify(text);
    if (!ORDER_INTENTS.has(parsed.intent)) return "ignorado";
    await toInbox({ phone: from, profileName, kind: KIND[parsed.intent], text, items: parsed.items || [] });
    if (stage === "personal") return "guardado_esperando_personal";
    await erp.setIdentify(from, { stage: "esperando_datos" });
    await askIdentity(from);
    return "pregunta_negocio";
  }

  return { handleKnown, handleUnknown };
}

module.exports = { createInboxFlow };
