# Endpoints externos del ERP que usa el bot (parte "a")

Estos endpoints están **implementados** en `pare-carrito-sas-server/src/server.js`.
Van protegidos por la `EXTERNAL_API_KEY` (que ya existe en el `.env` del servidor), validando
el header `x-api-key`. Operan sobre el `app_state` (clientes, pedidos) igual que el resto del ERP
y re-espejan a las tablas (`mirrorStateToTables`) en la misma transacción.

> ✅ Implementados. El matcheo de producto por nombre es **heurístico** (alias exacto → nombre
> exacto → sin unidades → coincidencia parcial por primera palabra, eligiendo el nombre más corto).
> Lo que no matchea queda anotado en `notes` del pedido como "Sin matchear: ...". Como los pedidos
> se revisan en el ERP antes del reparto, esto es seguro; aun así conviene mirar los pedidos creados
> por el bot las primeras semanas. Por ejemplo "tomate" puede resolver a "Tomate Cajon" y no a un
> "Tomate ... Kg" si existieran ambos.

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

## Notas de implementac