# Checklist de deploy

## 1) Subir el código (desde tu PC, en C:\Users\mauri\pare-carrito)
```
git push origin master
```
(Hay varios commits nuevos: bot de WhatsApp, endpoints externos, sync con Google Sheets,
arreglos del parser, multi-telefono, feriados + aviso, etc.)

## 2) Completar el .env del servidor (en el VPS: /opt/pare-carrito/pare-carrito-sas-server/.env)
Agregá/confirmá lo que vayas a usar:

### Google Sheets (sync de pedidos y precios)
```
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/XXXX/exec
GOOGLE_SHEETS_TOKEN=<el mismo SECRET_TOKEN del Code.gs>
```

### Bot de WhatsApp
```
WHATSAPP_TOKEN=<token permanente de Meta>
WHATSAPP_PHONE_NUMBER_ID=<de Meta>
WHATSAPP_VERIFY_TOKEN=pare-carrito-webhook
WHATSAPP_APP_SECRET=<de Meta, opcional>
NOTIFY_NUMBERS=549XXXXXXXXXX,549XXXXXXXXXX
OWNER_NUMBER=549XXXXXXXXXX
OPENROUTER_API_KEY=<tu key>
EXTERNAL_API_KEY=<ya deberia existir; la usa el bot y los endpoints>
```

### Aviso masivo de feriados (plantilla)
```
BROADCAST_KEY=<una clave secreta larga, inventala>
# BOT_BROADCAST_URL ya tiene default http://whatsapp-bot:8090/broadcast (no hace falta tocar)
```

## 3) Desplegar (en el VPS)
```
cd /opt/pare-carrito && ./deploy.sh
```
Esto hace backup de la DB, `git pull`, y como cambió el backend reconstruye los contenedores
(api + whatsapp-bot + caddy) con `docker compose up -d --build`.

Verificá que levantaron:
```
cd /opt/pare-carrito/pare-carrito-sas-server && docker compose ps
```

## 4) Configurar lo externo (una sola vez)
- **Google Sheets**: pegar `google-sheets-sync/Code.gs` en la planilla, completar SECRET_TOKEN +
  ERP_BASE_URL + ERP_API_KEY, publicar como App web, copiar la URL a `GOOGLE_SHEETS_WEBHOOK_URL`,
  y correr `crearTriggerCompraHoy` (ver google-sheets-sync/SETUP.md).
- **WhatsApp (Meta)**: alta de la app + token + webhook a `https://TU_API_DOMAIN/wa/webhook`
  (ver whatsapp-bot/SETUP_META.md).
- **Plantilla de feriados**: crear y aprobar la plantilla en Meta, poner su nombre en
  Configuración del sistema.

## 5) Probar
- Cargar un pedido → ver que aparezca en la pestaña pedidos del Sheets.
- Editar/cancelar ese pedido → ver que se actualice/vacíe la fila.
- Cambiar un precio o un "Compra Hoy" → ver que se reflejen Venta/Costo.
- Bot: escribir al numero; feriado: botón "Avisar a clientes" (necesita plantilla aprobada).

## Notas
- Lo que se sincroniza es a partir de la activación (no carga el histórico).
- No reordenes/borres filas a mano en la pestaña pedidos.
- Si querés apagar el bot: `docker compose stop whatsapp-bot`.
