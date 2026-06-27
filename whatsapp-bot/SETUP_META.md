# Alta en Meta — WhatsApp Cloud API (paso a paso)

Guía para conectar el bot de Pare Carrito con la API oficial de WhatsApp (Cloud API).
Necesitás una cuenta de Facebook y una **Meta Business** (Business Manager).

---

## 0) Antes de empezar
- Tené a mano un **número de teléfono** para WhatsApp Business que **no** esté usándose en la app
  de WhatsApp normal (o que puedas migrar). Para las pruebas, Meta te da un número de test gratis.
- Para producción real (mandar a clientes que no te escribieron primero) hay que **agregar un
  método de pago** y verificar el negocio. Para responder a quien te escribe, el número de test alcanza.

---

## 1) Crear la app
1. Entrá a https://developers.facebook.com → **My Apps** → **Create App**.
2. Tipo de app: elegí **Business**.
3. Ponele un nombre (ej. "Pare Carrito Bot") y asociala a tu **Meta Business**.
4. En el panel de la app: **Add Product** → buscá **WhatsApp** → **Set up**.

## 2) Obtener Phone Number ID y WABA ID
1. En el menú izquierdo: **WhatsApp → API Setup** (o "Getting Started").
2. Vas a ver un **número de prueba**. Anotá:
   - **Phone number ID** → va en `WHATSAPP_PHONE_NUMBER_ID`.
   - **WhatsApp Business Account ID (WABA ID)** → guardalo por las dudas.
3. (Más adelante, para usar tu número real) en esa misma pantalla: **Add phone number** y agregá
   el método de pago.

## 3) Crear el token PERMANENTE (System User)
El token que aparece en "API Setup" es **temporal (24 hs)**. Para producción se usa uno permanente:
1. Andá a **Business Settings** (https://business.facebook.com/settings) con tu Meta Business.
2. En el menú: **Users → System users** → **Add** → creá un system user (rol **Admin**).
3. Con el system user creado, **Add Assets** → **Apps** → elegí tu app → activá **Full control**
   (o al menos "Manage app"). Asigná también la **WhatsApp Account** (WABA) al system user.
4. Click en **Generate new token** → elegí tu **app**.
   - **Token expiration: Never**.
   - **Permisos:** marcá `whatsapp_business_messaging` y `whatsapp_business_management`.
5. **Copiá el token** (se muestra una sola vez) → va en `WHATSAPP_TOKEN`.

## 4) Configurar el Webhook
1. En la app: **WhatsApp → Configuration** (sección **Webhook**).
2. **Callback URL:** `https://TU_API_DOMAIN/wa/webhook`
   (reemplazá `TU_API_DOMAIN` por el dominio de tu API; Caddy enruta `/wa/*` al bot).
3. **Verify token:** poné exactamente lo mismo que tengas en `WHATSAPP_VERIFY_TOKEN`
   (por defecto `pare-carrito-webhook`).
4. Click **Verify and save**. Meta hace un GET a tu webhook; si el bot está corriendo y el
   verify token coincide, queda en verde. (El bot ya tiene que estar desplegado — ver paso 6.)
5. En **Webhook fields**, suscribí el campo **messages** (es el que trae los mensajes entrantes).

## 5) (Opcional pero recomendado) App Secret para validar firma
1. **App Settings → Basic** → copiá el **App Secret** → va en `WHATSAPP_APP_SECRET`.
2. Con eso, el bot valida la firma `X-Hub-Signature-256` de cada webhook (más seguro).

---

## 6) Completar el .env del servidor y desplegar
En el VPS, en `pare-carrito-sas-server/.env`, agregá/confirmá:

```
WHATSAPP_TOKEN=<token permanente del paso 3>
WHATSAPP_PHONE_NUMBER_ID=<del paso 2>
WHATSAPP_VERIFY_TOKEN=pare-carrito-webhook
WHATSAPP_APP_SECRET=<del paso 5, opcional>
NOTIFY_NUMBERS=549XXXXXXXXXX,549XXXXXXXXXX   # numeros del equipo (sin +, con cod pais 549)
OWNER_NUMBER=549XXXXXXXXXX                   # tu numero
OPENROUTER_API_KEY=<tu key de OpenRouter>
EXTERNAL_API_KEY=<la que ya usa el ERP>      # el bot la usa para hablarle a la API
```

Formato de números (Argentina): código de país **54** + **9** + característica sin 0 +
número sin 15. Ej.: Salta 387 1234567 → `5493871234567`.

Deploy:
```
cd /opt/pare-carrito && ./deploy.sh
```

## 7) Probar
1. Desde tu WhatsApp personal, mandá un mensaje al **número de WhatsApp Business** (o, en modo test,
   agregá tu número como "destinatario de prueba" en API Setup).
2. Como tu número personal probablemente **no** es un cliente del ERP, el bot va a avisarte a vos
   (OWNER_NUMBER) que "un número no reconocido" escribió. Eso confirma que el flujo anda.
3. Para probar un pedido real: cargá tu número de WhatsApp en la **ficha de un cliente** del ERP
   (campo teléfono) y mandá "pasame 2 cajones de tomate y 1 de banana".
4. Revisá los logs del bot: `docker compose logs -f whatsapp-bot`.

---

## Notas / límites
- **Ventana de 24 hs:** fuera de las 24 hs del último mensaje del cliente, WhatsApp solo deja
  enviar **plantillas (templates)** aprobadas, no texto libre. Para responder a quien te escribió
  hace poco no hay problema; para iniciar conversación hay que usar templates.
- **Grupos:** la Cloud API **no** postea en grupos. El "aviso al grupo" del bot se hace a los
  números de `NOTIFY_NUMBERS` (ver README).
- **Costos:** Meta cobra por conversación según país; las conversaciones de servicio iniciadas por
  el cliente suelen tener cuota gratis mensual. Revisá el pricing vigente en Meta.
