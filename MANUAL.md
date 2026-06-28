# Manual — Bot de WhatsApp + Sincronización con Google Sheets

Guía de punta a punta para activar (y desactivar) las dos integraciones.
Comandos pensados para el VPS, en `/opt/pare-carrito`.

---

# PARTE A — Bot de WhatsApp

El bot recibe pedidos por WhatsApp, los carga en el sistema y maneja agregados/cancelaciones.
Corre como un servicio aparte (contenedor `whatsapp-bot`) dentro del mismo proyecto.

## A1. Requisitos en Meta (una sola vez)
Seguí `whatsapp-bot/SETUP_META.md`. Al terminar vas a tener:
- `WHATSAPP_TOKEN` (token permanente del System User)
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN` (lo inventás vos, ej. `pare-carrito-webhook`)
- (opcional) `WHATSAPP_APP_SECRET`

## A2. Cargar la configuración
En el VPS, editá `/opt/pare-carrito/pare-carrito-sas-server/.env` y agregá:
```
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_VERIFY_TOKEN=pare-carrito-webhook
WHATSAPP_APP_SECRET=...
NOTIFY_NUMBERS=549XXXXXXXXXX,549XXXXXXXXXX   # numeros del equipo (avisos del "grupo")
OWNER_NUMBER=549XXXXXXXXXX                   # tu numero (consultas)
OPENROUTER_API_KEY=...                       # para entender los mensajes
EXTERNAL_API_KEY=...                         # ya deberia existir; el bot la usa para hablar con el sistema
```

## A3. Instalar / activar el bot
El servicio ya está declarado en `docker-compose.yml`. Para levantarlo:
```
cd /opt/pare-carrito
git pull                       # traer el codigo (o ./deploy.sh)
cd pare-carrito-sas-server
docker compose up -d --build whatsapp-bot
docker compose ps              # ver que quede "running"
```

## A4. Conectar el webhook en Meta
- URL del webhook: `https://TU_API_DOMAIN/wa/webhook`
- Verify token: el mismo `WHATSAPP_VERIFY_TOKEN`
- Suscribir el campo **messages**.
(El bot ya tiene que estar corriendo — paso A3 — para que Meta lo verifique en verde.)

## A5. Probar
- Mandá un WhatsApp al numero del bot. Si tu numero no es cliente, te llega un aviso a `OWNER_NUMBER`.
- Ver logs en vivo:
```
cd /opt/pare-carrito/pare-carrito-sas-server
docker compose logs -f whatsapp-bot
```

## A6. Desactivar / volver a activar
- **Desactivar (apagar el bot):**
```
cd /opt/pare-carrito/pare-carrito-sas-server
docker compose stop whatsapp-bot
```
  Queda apagado; el resto del sistema sigue funcionando igual.
- **Reactivar:**
```
docker compose start whatsapp-bot
```
- **Desactivar del todo (que no arranque ni al reiniciar el server):**
```
docker compose stop whatsapp-bot && docker compose rm -f whatsapp-bot
```
  Para volver: `docker compose up -d whatsapp-bot`.

> Nota: si dejás vacías las variables `WHATSAPP_*`, el contenedor arranca pero no manda ni recibe
> nada (queda inerte). Igual, la forma recomendada de "apagarlo" es `docker compose stop whatsapp-bot`.

---

# PARTE B — Sincronización con Google Sheets

- Pedidos cargados en el sistema → pestaña **pedidos**.
- Cambios de **Venta/Costo** en el sistema → pestaña **precios**.
- **Compra Hoy** (lo cargás vos en el sheet) → actualiza **costo + precio de venta** del producto
  en el sistema (manteniendo el margen), igual que una compra. El sistema no escribe "Compra Hoy".

## B1. Instalar el Apps Script
1. Abrí la planilla → **Extensiones → Apps Script**.
2. Pegá el contenido de `google-sheets-sync/Code.gs`.
3. Completá las constantes de arriba del script:
   - `SECRET_TOKEN`: texto largo y secreto (el mismo irá en el `.env` como `GOOGLE_SHEETS_TOKEN`).
   - `ERP_BASE_URL`: dominio del API (ej. `https://TU_API_DOMAIN`).
   - `ERP_API_KEY`: la `EXTERNAL_API_KEY` del `.env` del servidor.
4. Guardá (disquete).

## B2. Publicar como App web (sistema → sheet)
1. **Implementar → Nueva implementación → App web**.
2. **Ejecutar como: Yo** · **Acceso: Cualquiera** → **Implementar** → autorizá.
3. Copiá la URL que termina en `/exec`.

## B3. Activar el flujo "Compra Hoy" (sheet → sistema)
En Apps Script, seleccioná la función `crearTriggerCompraHoy` y tocá **Ejecutar** una vez
(autorizá permisos). Eso instala el disparador que detecta cuando editás "Compra Hoy".

## B4. Configurar el servidor
En `/opt/pare-carrito/pare-carrito-sas-server/.env`:
```
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/XXXX/exec
GOOGLE_SHEETS_TOKEN=el-mismo-SECRET_TOKEN
EXTERNAL_API_KEY=la-misma-que-pusiste-en-ERP_API_KEY
```
Aplicar:
```
cd /opt/pare-carrito && ./deploy.sh
```

## B5. Probar
- Cargá un pedido en el sistema → fijate que aparezca una fila nueva en **pedidos**.
- Cambiá un precio → fijate que se actualice **Venta** en **precios**.
- Escribí un numero en **Compra Hoy** de un producto → en el sistema el costo y el precio de venta
  de ese producto deberian actualizarse (y volver reflejados en Venta/Costo).
- Diagnóstico: en Apps Script → **Ejecuciones** ves cada llamada y los productos "sinColumna".

## B6. Desactivar / reactivar
- **Apagar sistema → sheet (que el sistema deje de escribir en la planilla):**
  borrá `GOOGLE_SHEETS_WEBHOOK_URL` del `.env` y `./deploy.sh` (o `docker compose up -d api`).
- **Apagar sheet → sistema (que "Compra Hoy" deje de actualizar precios):**
  en Apps Script → ⏰ **Activadores**, borrá el activador de `onEditCompraHoy`.
- **Reactivar:** volvé a poner la URL en el `.env` (y/o corré `crearTriggerCompraHoy`).

---

# PARTE C — Deploy (recordatorio)
1. Desde tu compu: `git push origin master`.
2. En el VPS: `cd /opt/pare-carrito && ./deploy.sh`.
   - Si solo cambió el frontend, alcanza con `git pull` y Ctrl+F5 en el navegador.
   - Si cambió el backend (bot, endpoints, sheets), `deploy.sh` reconstruye los contenedores.

---

# PARTE D — Feriados y aviso masivo a clientes

## Qué hace
- En **Nuevo Pedido** hay un botón **"Feriados"** (roles empleado, admin y gerente).
- **Admin/Gerente**: agregan un feriado (fecha + nombre) y queda **aprobado** al instante, lo que
  **bloquea esa fecha** en el calendario de pedidos (no se pueden cargar pedidos ese día).
- **Empleado**: puede **proponer** un feriado; queda **pendiente** hasta que un admin/gerente lo apruebe.
- El **texto del aviso** se configura en **Configuración** (admin/gerente), con los comodines
  `{fecha}` y `{feriado}`.
- Para avisar a los clientes: en el modal de Feriados, botón **"Avisar a clientes"** (admin/gerente)
  manda el mensaje por WhatsApp a **todos los números de los clientes activos**.

## Requisito: plantilla de Meta (obligatorio para el aviso)
WhatsApp no deja mandar texto libre masivo. Hay que crear una **plantilla** en Meta:
1. Meta Business → WhatsApp Manager → **Plantillas de mensajes → Crear plantilla**.
2. Categoría: **Utility/Utilidad**. Idioma: Español.
3. Cuerpo con UNA variable, ej.: `📢 {{1}}` (el sistema manda el texto ya armado como {{1}}).
4. Esperá la **aprobación** de Meta (suele ser rápido).
5. En el sistema → **Configuración**: poné el **nombre de la plantilla** (ej. `aviso_feriado`).

## Configuración en el servidor (.env)
```
BROADCAST_KEY=una-clave-secreta-compartida   # misma en api y bot (ya esta en docker-compose)
# BOT_BROADCAST_URL ya viene por defecto: http://whatsapp-bot:8090/broadcast
```
El bot tiene que estar activo (PARTE A) para que el aviso salga.

## Sincronización de pedidos editados (Google Sheets)
Además de los pedidos nuevos, ahora **editar un pedido** en el sistema actualiza su fila en la
planilla, y **cancelarlo** vacía sus cantidades. El Apps Script recuerda en qué fila quedó cada
pedido (por su número), así que no hace falta una columna de N° de pedido. Importante: no
reordenes/borres manualmente filas de la pestaña pedidos, porque se pierde esa referencia.
