# Sincronización Pare Carrito → Google Sheets

Cuando cargás un **pedido** en sistema.parecarrito.com.ar se agrega una fila en la pestaña
**pedidos** (columna A = fecha, B = cliente, y la cantidad debajo de la columna de cada producto).
Cuando cambiás un **precio de venta** o cargás una **compra**, se actualiza la fila del producto
en la pestaña **precios** (Venta / Costo / Compra Hoy).

Planilla: https://docs.google.com/spreadsheets/d/1VFKMdgNBC1sTkZU3xa6dQvM43S-9Tp2fFDP2v9mwXqI/edit

## 1) Instalar el Apps Script
1. Abrí la planilla → menú **Extensiones → Apps Script**.
2. Borrá lo que haya y pegá el contenido de `Code.gs` (este repo).
3. Arriba de todo, cambiá `SECRET_TOKEN` por un texto largo y secreto (inventalo, ej. 40 caracteres).
4. Guardá (ícono del disquete).

## 2) Publicar como App web
1. **Implementar → Nueva implementación**.
2. Tipo: **App web**.
3. **Ejecutar como: Yo** · **Quién tiene acceso: Cualquiera**.
4. **Implementar** → autorizá los permisos (te va a pedir confirmar tu cuenta).
5. Copiá la **URL de la app web** (termina en `/exec`).

## 3) Configurar el servidor
En el `.env` del servidor (`pare-carrito-sas-server/.env`) agregá:

```
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/XXXXXXXX/exec
GOOGLE_SHEETS_TOKEN=el-mismo-SECRET_TOKEN-que-pusiste-en-el-script
```

Y desplegá (cambió el backend):

```
cd /opt/pare-carrito && ./deploy.sh
```

## Cómo se mapean los productos (para que no se crucen)
- Se compara por **conjunto de palabras normalizado** (ignora mayúsculas, acentos, orden y
  palabras de relleno como "de/por/x"). Ej.: "Jaula de Lechuga Repollada" ↔ "Lechuga Repollada Jaula".
- Para los renombres que no coinciden solos hay una **tabla `OVERRIDES`** en el `Code.gs`
  (ej. `champinon → Champignones`, `lentejas kg → Lenteja por Kg`). Podés agregar más ahí.
- **129 de ~158 productos** mapean automáticamente. Los que **no tienen columna** en el sheet
  (variantes "Unidad/Unidades" nuevas y varias especias) **se omiten** (no se escriben), así
  nunca cae una cantidad en la columna equivocada. Si querés sumarlos, agregá la columna en el
  sheet o una entrada en `OVERRIDES`.

## Notas
- Solo se sincronizan pedidos/precios **nuevos a partir de la activación** (no se cargan para
  atrás los 2400 pedidos históricos).
- Si algo no aparece, en Apps Script → **Ejecuciones** podés ver los POST recibidos y los
  productos que quedaron "sinColumna".
- El token evita que cualquiera escriba en tu planilla; mantenelo secreto.
