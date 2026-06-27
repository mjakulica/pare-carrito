# Endpoints externos que el bot necesita en el ERP (parte "a")

Estos endpoints hay que **agregarlos al servidor** `pare-carrito-sas-server/src/server.js`.
Van protegidos por la `EXTERNAL_API_KEY` (que ya existe en el `.env` del servidor), validando
el header `x-api-key`. Operan sobre el `app_state` (clientes, pedidos) igual que el resto del ERP.

> Todavia NO existen: hay que implementarlos. Acá queda el contrato que espera el bot
> (`src/erp.js`). Cuando los implementemos, el bot funciona end-to-end.

## Autenticación
Todos requieren: `x-api-key: <EXTERNAL_API_KEY>`. Si no coincide → 401.

## Endpoints

### GET /external/clients/by-phone/:phone
Busca el cliente cuyo telefono coincide con `:phone` (solo digitos).
- 200 → `{ "client": { "id": "021", "name": "Estacion Belgrano", "needsInvoice": false } }`
- 200 → `{ "client": null }` si no hay match.

### GET /external/orders/today/:clientId
Pedido de hoy del cliente (o null).
- 200 → `{ "order": { "id": "ORD-...", "items": [ ... ] } }` o `{ "order": null }`.

### POST /external/orders
Crea un pedido nuevo para hoy.
- body: `{ "clientId": "021", "items": [ { "producto": "Tomate", "cantidad": 2, "unidad": "kg", "nota": "" } ], "source": "whatsapp-bot" }`
- Debe resolver cada `producto` a un productId del catalogo (reusar el matcher del parser de
  WhatsApp que ya existe en el front/servidor), calcular precios, y crear el pedido.
- 200 → `{ "ok": true, "orderId": "ORD-..." }`

### POST /external/orders/:orderId/items
Agrega items a un pedido. `round` = 1 (normal) o 2 (segunda ronda de envios).
- body: `{ "items": [ ... ], "round": 1 }`
- 200 → `{ "ok": true }`

### POST /external/orders/:orderId/cancel
Saca items del pedido (o cancela todo si `items` vacio).
- body: `{ "items": [ ... ] }`
- 200 → `{ "ok": true }`

### GET /external/products/names
Lista de nombres de productos activos (para ayudar a la IA a matchear).
- 200 → `{ "products": ["Tomate Perita Kg", "Bananas Docena", ...] }`

## Notas de implementación
- Reutilizar la logica de matcheo de productos del parser de WhatsApp (`findProductForParsedLine`)
  para convertir `producto` (texto) → productId. Idealmente exponerla en el servidor o
  replicarla.
- Marcar los items de `round: 2` con un flag (ej. `item.segundaRonda = true`) para que en
  "Dividir compras" / remitos se vean como segunda ronda.
- Cada cambio debe impactar el `app_state` y re-mirror a las tablas, igual que el resto.
