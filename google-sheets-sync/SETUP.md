# Sincronización Pare Carrito ⇄ Google Sheets

**Del sistema al sheet:**
- Cargás un **pedido** → se agrega una fila en **pedidos** (A = fecha, B = cliente, y la cantidad
  debajo de la columna de cada producto).
- Cambiás **precio de venta** o **costo** → se actualiza la fila del producto en **precios**
  (columnas **Venta** y **Costo**).

**Del sheet al sistema:**
- Lo que cargás en la columna **Compra Hoy** (de la pestaña precios) actualiza el **costo de
  compra** del producto en el sistema, igual que una compra/gasto. El script **no escribe**
  "Compra Hoy": solo la observa.

Planilla: https://docs.google.com/spreadsheets/d/1VFKMdgNBC1sTkZU3xa6dQvM43S-9Tp2fFDP2v9mwXqI/edit

## 1) Instalar el Apps Script
1. Planilla → **Extensiones → Apps Script**. Pegá `Code.gs` (este repo).
2. Completá las constantes de arriba:
   - `SECRET_TOKEN`: un texto largo y secreto (el mismo irá en `GOOGLE_SHEETS_TOKEN`).
   - `ERP_BASE_URL`: el dominio del API del sistema (ej. `https://api.tudominio`).
   - `ERP_API_KEY`: la `EXTERNAL_API_KEY` del `.env` del servidor.
3. Guardá.

## 2) Publicar como App web (sistema → sheet)
1. **Implementar → Nueva implementación → App web**.
2. **Ejecutar como: Yo** · **Acceso: Cualquiera** → **Implementar** → autorizá.
3. Copiá la URL (`/exec`).

## 3) Crear el disparador de "Compra Hoy" (sheet → sistema)
1. En Apps Script, abrí la función `crearTriggerCompraHoy` y tocá **Ejecutar** una vez
   (autorizá permisos). Eso crea el disparador instalable que detecta ediciones.
   - (Alternativa manual: ⏰ **Activadores → Añadir activador** → función `onEditCompraHoy`,
     fuente "Desde la hoja de cálculo", tipo "Al editar".)

## 4) Configurar el servidor
En `pare-carrito-sas-server/.env`:
```
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/XXXX/exec
GOOGLE_SHEETS_TOKEN=el-mismo-SECRET_TOKEN
EXTERNAL_API_KEY=la-misma-que-pusiste-en-ERP_API_KEY-del-script
```
Deploy (cambió el backend): `cd /opt/pare-carrito && ./deploy.sh`

## Mapeo de productos (para que no se crucen)
- Se compara por **conjunto de palabras normalizado** (ignora mayúsculas, acentos, orden y
  "de/por/x"). Más una **tabla `OVERRIDES`** editable para renombres
  (ej. `champinon → Champignones`, `lentejas kg → Lenteja por Kg`).
- **129 de ~158** productos mapean solos. Los que no tienen columna (variantes "Unidad/Unidades"
  nuevas y varias especias) **se omiten** (no se escriben), para que nunca caiga una cantidad en
  la columna equivocada. La misma tabla se usa en los dos sentidos.

## Notas
- Solo sincroniza lo **nuevo desde la activación** (no carga para atrás el histórico).
- "Compra Hoy" actualiza **cost** y **market price** del producto (el efecto de una compra sobre
  el precio); no genera un movimiento de caja (no hay cantidad, solo precio).
- En Apps Script → **Ejecuciones** ves los POST recibidos/enviados y los productos "sinColumna".
