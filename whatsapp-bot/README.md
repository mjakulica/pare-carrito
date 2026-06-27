# Pare Carrito — Bot de WhatsApp (Cloud API)

Servicio **independiente** del ERP. Recibe mensajes de clientes por WhatsApp, clasifica la
intención con IA (OpenRouter) y actúa sobre el ERP por API.

## Qué hace

- **Pedido nuevo** → lo carga en el ERP (equivale a "pegar pedido de WhatsApp", automático).
- **Agregar** a un pedido de hoy, según la hora:
  - **Antes de 05:30** → se agrega directo, sin avisar.
  - **05:30 – 07:30** → avisa al equipo y **espera confirmación**; si confirman, se agrega.
  - **07:30 – 10:00** → vuelve a consultar al equipo; si confirman, se agrega para una
    **segunda ronda de envíos**.
  - **Después de 10:00** → avisa al cliente que ya no entra y notifica al equipo.
- **Cancelar** → modifica el pedido y avisa al equipo.
- **Consulta** (no es pedido) → te la reenvía a vos (OWNER_NUMBER) y le responde al cliente.

## ⚠️ Limitación importante (Cloud API y grupos)

La **WhatsApp Cloud API oficial no puede enviar mensajes a grupos**. Por eso el "aviso al
grupo" se hace mandando el mensaje a **cada número del equipo** (`NOTIFY_NUMBERS`). La
"confirmación del grupo" = que **cualquiera de esos números responda** `ok P37` (o `no P37`).
Si en el futuro querés un grupo real, hay que usar una librería no oficial (con riesgo de baneo)
o un canal interno (Telegram, etc.).

## Confirmaciones del equipo

Cuando algo queda pendiente, el bot manda a `NOTIFY_NUMBERS` un mensaje con un **código**
(ej. `P37`). Para resolverlo, cualquiera del equipo responde por WhatsApp:
- `ok P37` (o `si` / `confirmar`) → se agrega.
- `no P37` (o `rechazar`) → se descarta y se avisa al cliente.

## Requisitos previos (Meta)

1. Crear una app en **Meta for Developers** con el producto **WhatsApp**.
2. Obtener: **Phone Number ID**, un **token permanente** (System User), y definir un
   **Verify Token** propio.
3. Configurar el **webhook**: URL `https://TU_DOMINIO/webhook`, verify token el mismo del `.env`,
   y suscribir el campo `messages`.
4. (Opcional) Copiar el **App Secret** para validar la firma.

## Configuración

```bash
cp .env.example .env
# completar WHATSAPP_*, NOTIFY_NUMBERS, OWNER_NUMBER, OPENROUTER_API_KEY, ERP_BASE_URL, ERP_API_KEY
npm install
npm start
```

## Pendiente para que funcione end-to-end

Faltan los **endpoints externos en el ERP** (ver `ERP_ENDPOINTS.md`). El bot ya está escrito
contra ese contrato; cuando se implementen en `pare-carrito-sas-server`, queda operativo.

## Deploy sugerido (junto al ERP)

Agregar un servicio al `docker-compose.yml` del servidor (o un compose propio):

```yaml
  whatsapp-bot:
    build: ../whatsapp-bot
    restart: unless-stopped
    env_file: ../whatsapp-bot/.env
    # exponer detras de Caddy en /webhook del dominio del bot
```

Y rutear `https://TU_DOMINIO/webhook` al puerto del bot (8090) desde Caddy.

## Estado

Esqueleto funcional (v0.1): webhook + clasificación IA + reglas de horario + confirmaciones +
notificaciones. Falta: endpoints del ERP, alta de Meta Cloud API, y pruebas con números reales.
No probado contra WhatsApp real todavía.
