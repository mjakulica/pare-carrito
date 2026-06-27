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
Busca el cliente cuyo telefono coincide con `:phone` (solo digitos; compara los ultimos 8 digitos).
- 200 → `{ "client": { "id": "021", "name": "Estacion Belgrano", "needsInvoice": false, "priceTier": "general", "priceAdjustmentPct": 0, "isActive": true } }`
- 200 → `{ "client": null }` si no hay match.

### GET /external/orders/today/:clientId
Pedido de hoy del cliente (o null).
- 200 → `{ "order": { "id": "ORD-...", "date": "...", "status": "pendiente", "totalAmount": 0, "items": [ { "productId": "", "productName": "", "quantity": 0, "unitType": "" } ] } }`
- 200 → `{ "order": null }`.

### POST /external/orders
Crea un pedido nuevo para hoy.
- body: `{ "clientId": "021", "items": [ { "producto": "Tomate", "cantidad": 2, "unidad": "kg", "nota": "" } ], "source": "whatsapp-bot" }`
- Resuelve cada `producto` a un productId (matcher), calcula precio (segun tier/ajuste del cliente) e IVA.
- 200 → `{ "ok": true, "orderId": "ORD-...", "matched": 3, "unmatched": [] }`

### POST /external/orders/:orderId/items
Agrega items a un pedido. `round` = 1 (normal) o 2 (segunda ronda → marca `segundaRonda: true` en cada item).
- body: `{ "items": [ ... ], "round": 1 }`
- 200 → `{ "ok": true, "added": 2, "unmatched": [], "round": 1 }`

### POST /external/orders/:orderId/cancel
Saca items del pedido (o anula todo el pedido si `items` vacio → `status: "anulado"`).
- body: `{ "items": [ ... ] }`
- 200 → `{ "ok": true, "removed": 1 }`  (o `{ "ok": true, "cancelledOrder": true }`)

### GET /external/products/names
Lista de nombres de productos activos (para ayudar a la IA a matchear).
- 200 → `{ "products": ["Tomate Cajon", "Bananas Docena", ...] }`

## Notas de implementación
- El matcher (`findProductByText`) usa: alias exacto (`productAliases`) → nombre exacto → texto sin
  numeros/unidades → coincidencia parcial por primera palabra (elige el nombre mas corto).
- Precio: `prices[productId].price` (o `salePrice`), ajustado por `client.priceAdjustmentPct`.
- IVA: `Number(product.ivaType)` solo si el cliente `needsInvoice`; si no, 0.
- Los items de `round: 2` llevan `segundaRonda: true` para distinguirlos en remitos / "Dividir compras".
- Toda escritura impacta `app_state` y re-espeja a las tablas en la misma transacción (`withStateExt`).
