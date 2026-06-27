"use strict";

function parseHM(value, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!m) return fallback;
  return Number(m[1]) * 60 + Number(m[2]);
}

const config = {
  port: Number(process.env.PORT || 8090),
  tz: process.env.TZ || "America/Argentina/Salta",
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "pare-carrito-webhook",
    appSecret: process.env.WHATSAPP_APP_SECRET || "",
    apiVersion: process.env.WHATSAPP_API_VERSION || "v21.0"
  },
  notifyNumbers: String(process.env.NOTIFY_NUMBERS || "")
    .split(",")
    .map((n) => n.replace(/[^\d]/g, ""))
    .filter(Boolean),
  ownerNumber: String(process.env.OWNER_NUMBER || "").replace(/[^\d]/g, ""),
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    apiUrl: (process.env.OPENROUTER_API_URL || "https://openrouter.ai/api/v1/chat/completions").trim(),
    model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini"
  },
  erp: {
    baseUrl: String(process.env.ERP_BASE_URL || "").replace(/\/+$/, ""),
    apiKey: process.env.ERP_API_KEY || ""
  },
  schedule: {
    // minutos desde medianoche
    addDirectBefore: parseHM(process.env.ADD_DIRECT_BEFORE, 5 * 60 + 30),
    addConfirm1Until: parseHM(process.env.ADD_CONFIRM1_UNTIL, 7 * 60 + 30),
    addConfirm2Until: parseHM(process.env.ADD_CONFIRM2_UNTIL, 10 * 60)
  }
};

module.exports = { config };
