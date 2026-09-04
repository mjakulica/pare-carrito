# Documento de Análisis del Sistema — Pare Carrito SAS ERP

**Fecha:** 2026-06-15  
**Versión analizada:** Frontend `assets/app.js` v12 + Backend `pare-carrito-sas-server` (Node.js + Express + PostgreSQL)  
**Repositorio:** `https://github.com/mjakulica/pare-carrito.git`  
**Entorno productivo:** VPS `149.50.152.45:5733` (Caddy + Docker Compose)

---

## 1. Resumen Ejecutivo

Pare Carrito SAS ERP es una aplicación web de gestión comercial para un negocio de venta y distribución de frutas, verduras y productos afines. Permite administrar pedidos, clientes, productos, proveedores, compras/gastos, pagos, saldos, caja, vehículos, remitos, facturación y asistencia de empleados.

Es una **Single Page Application (SPA)** desarrollada en JavaScript vanilla, con renderizado de HTML mediante strings y enrutamiento por hash (`/#/ruta`). El estado completo del ERP se almacena en un único documento JSON dentro de PostgreSQL (`app_state.data`), sincronizado con `localStorage` en el cliente y reflejado a tablas relacionales para reportes.

---

## 2. Arquitectura General

```
┌──────────────────────────────────────────────────────────────┐
│                        Navegador / Cliente                    │
│  lucas-pare-carrito-erp/                                      │
│  ├── index.html                                               │
│  ├── assets/app.js       (lógica SPA, ~13.000 líneas)         │
│  ├── assets/styles.css   (estilos responsive)                 │
│  └── assets/logo.png, favicon.png                             │
│                                                               │
│  Estado local: localStorage (STORAGE_KEY, USER_KEY, SYNC_KEY) │
│  Sync opcional: cloud push/pull contra /state                 │
└──────────────────────────┬────────────────────────────────────┘
                           │
                           ▼ HTTP/HTTPS
┌──────────────────────────────────────────────────────────────┐
│                        VPS / Docker Compose                   │
│  Caddy (puerto 80/443)                                        │
│  ├── sirve frontend estático                                  │
│  └── proxy /api/*  →  api:3000                                │
│                                                               │
│  api (pare-carrito-sas-server)                                │
│  ├── Node.js + Express                                        │
│  ├── JWT auth + bcrypt                                        │
│  └── PostgreSQL app_state (JSONB) + espejo relacional         │
└──────────────────────────────────────────────────────────────┘
```

### Tecnologías

| Capa | Tecnología |
|------|------------|
| Frontend | HTML5, CSS3, JavaScript vanilla (sin framework) |
| Backend | Node.js, Express, pg (PostgreSQL) |
| Base de datos | PostgreSQL 16, JSONB para estado operativo |
| Auth | JWT + bcrypt, rate limiting login |
| Facturación | TusFacturasAPP (opcional), `decimal.js` para precisión decimal |
| Deploy | Docker Compose (Caddy + API + PostgreSQL) |

---

## 3. Roles y Permisos

Roles existentes:

- `manager` — Gerente: acceso total.
- `admin` — Administrador: gestión operativa, excepto usuarios y algunos reportes exclusivos de gerente.
- `employee` — Empleado: operaciones diarias (pedidos, compras, vehículos, remitos, horarios).
- `customer` — Cliente: crea pedidos, consulta saldos, lista de precios, mis pedidos, registra transferencias.
- `example` — Cliente de demo: igual que customer pero con datos ficticios (`exampleOnly`).
- `contador` — Contador: accede a saldos, caja, pagos, facturación, transferencias, empleados y proveedores.
- `proveedor` — Proveedor: vinculado a una cuenta de proveedor (`user.providerId`). Ve solo lo asignado a él: Inicio propio, Pedidos (que incluyen sus productos), Dividir Compras (solo lo suyo), Proveedores (su cuenta), Compras/Gastos (selector y movimientos acotados a él), Mis Costos y Configuración.

Permisos personalizados: `state.appSettings.rolePermissions` permite sobreescribir visibilidad de páginas y flags (`pageVisibleForRole`, `roleFlag`).

---

## 4. Mapeo de Páginas, Funcionalidades y Datos

### 4.1 Menú Principal

| Página (Ruta Hash) | Renderizador | Roles | Funcionalidad Principal | Datos Clave | Adaptación Mobile |
|--------------------|--------------|-------|-------------------------|-------------|-------------------|
| `#/dashboard` | `renderDashboard` | Todos | Resumen operativo por rol: admin/gerente (pedidos, caja, saldos, vehículos, gráficos), contador, empleado, cliente. | `state.orders`, `state.caja`, `state.saldos`, `state.purchases`, `state.payments` | Layout en una columna; dashboard admin/gerente con fechas compactas y botones de rango en filas. |
| `#/nuevo-pedido` | `renderNewOrder` | manager, admin, employee, customer, example | Creación de pedidos con productos ordenados por categoría y `sortOrder`. Cálculo automático de subtotal, IVA y total. | `state.products`, `state.clients`, `state.orders`, `state.prices`, `state.preferences` | Productos en lista o grilla compacta; selectores de cliente y unidad adaptados. |
| `#/pedidos` | `renderOrders` | Todos (con filtros) | Listado y edición de pedidos; filtros de fecha Desde/Hasta + botones Hoy, Semana, Mes, etc. Cambio de estado masivo. | `state.orders`, `state.clients` | Tabla con scroll horizontal; filtros compactos. |
| `#/clientes` | `renderClients` | manager, admin | ABM de clientes, saldo, vehículo, zona, facturación, cuentas vinculadas. | `state.clients`, `state.saldos`, `state.vehicles` | Formulario en una columna. |
| `#/productos` | `renderProducts` | manager, admin | ABM de productos, categorías, unidades, IVA, asignación a proveedor/empleado, relaciones de unidades. | `state.products`, `state.providers`, `state.users` | Tablas compactas con scroll. |
| `#/precios` | `renderPrices` | manager, admin | Carga diaria de costo, precio de mercado, margen y precio de lista. | `state.prices`, `state.products`, `state.costRelations` | Inputs en grid de 2 columnas. |
| `#/historiales` | `renderHistories` | manager, admin | Matrices de compras y ventas con una columna por día. | `state.orders`, `state.purchases`, `state.prices` | Tablas con scroll horizontal. |
| `#/rendimiento` | `renderPerformance` | manager | Análisis de gastos pagados, ventas cobradas, saldos, cash profit, company profit, ajustes. | `state.orders`, `state.purchases`, `state.payments`, `state.caja`, `state.performanceAdjustments` | Grids adaptados a 1 columna. |
| `#/compras` | `renderPurchases` | manager, admin, employee | Registro de compras a proveedores y gastos operativos; pagos a proveedores; filtro por proveedor/empleado. | `state.purchases`, `state.providers`, `state.users`, `state.caja`, `state.providerLedger` | Formularios en columna única. |
| `#/dividir` | `renderDividePurchases` | manager, admin, employee | Asignación de productos de pedidos del día a proveedores/empleados; PDF y WhatsApp. | `state.orders`, `state.products` | Checklist de asignados; botones PDF/WhatsApp en fila. |
| `#/vehiculos` | `renderVehicles` | manager, admin, employee | Carga por vehículo y fecha; impresión "Todos" / "Sin dividir"; copia WhatsApp; mover pedidos entre vehículos. | `state.vehicles`, `state.orders` | Board en una columna; order-cards apilados; botones de acción en grid. |
| `#/remitos` | `renderRemitos` | manager, admin, employee | Generación de remitos por cliente/fecha; alerta de notas y compras insuficientes; exportar PDF. | `state.orders`, `state.remitos` | Filtros compactos; tablas con scroll. |
| `#/unidades` | `renderUnits` | manager, admin, employee | Ajuste de productos vendidos por unidad y cobrados por peso; exportar remitos. | `state.orders`, `state.productRelations` | Tablas con scroll. |
| `#/pagos` | `renderPayments` | manager, admin, employee, contador | Registro de cobros (efectivo, transferencia, cheque); comprobantes; asignación a pedidos. | `state.payments`, `state.caja`, `state.saldos`, `state.orders` | Formulario compacto. |
| `#/saldos` | `renderBalances` | Todos | Saldos por cliente, movimientos históricos, IVA acumulado. | `state.saldos`, `state.clients` | Fechas Desde/Hasta en fila; botones de rango en fila de 4. |
| `#/caja` | `renderCaja` | manager, admin, contador | Libro de caja por caja seleccionada; ingresos/egresos; administración de cajas. | `state.caja`, `state.cashBoxes` | Filtros y tablas compactas. |
| `#/empleados` | `renderEmployees` | manager, admin, contador | Listado de empleados, caja asignada, horas, deuda, pagos. | `state.users`, `state.attendance`, `state.employeePayments` | Tablas con scroll. |
| `#/cumplimiento` | `renderCompliance` | manager, admin | **(v12.9.116)** Control diario de cumplimiento: checklist completado por cada empleado (X/11, semaforo y pasos faltantes) y entregas del dia pendientes de rendir (pago o foto del remito). | `state.checklistLog`, `state.users`, `state.orders` | Tarjetas apiladas; selector de dia arriba. |
| `#/horarios` | `renderAttendance` | employee | Registro de asistencia, reintegros y recibo de sueldo del empleado logueado. | `state.attendance`, `state.employeeReimbursements` | Formulario simple. |
| `#/registrar-transferencia` | `renderCustomerTransferRegistration` | customer, example | Clientes registran transferencias con comprobante y pedidos asociados. | `state.clientTransfers`, `state.orders` | Formulario de una columna. |
| `#/comprobar-transferencias` | `renderTransferApprovals` | manager, admin, contador | Aprobación/rechazo de transferencias; impacta pagos, saldos y caja banco. | `state.clientTransfers`, `state.payments`, `state.saldos`, `state.caja` | Tabla con scroll. |
| `#/facturacion` | `renderFacturacion` | manager, admin, contador | Cálculo de períodos de facturación por cliente; emisión/simulación vía TusFacturas. | `state.clients`, `state.billingLog`, `state.orders` | Formularios compactos. |
| `#/mis-pedidos` | `renderCustomerReports` | customer, example | Reporte de compras del cliente por rango de fechas, detalle por producto. | `state.orders` | Filtros de fecha compactos. |
| `#/lista-precios` | `renderCustomerPriceList` | customer, example | Precios ajustados al cliente con desglose de IVA. | `state.products`, `state.clients`, `state.prices` | Lista vertical. |
| `#/proveedores` | `renderProviders` | manager, admin, employee, contador | ABM de proveedores, saldos, movimientos, histórico de precios. | `state.providers`, `state.providerLedger` | Tablas con scroll. |
| `#/usuarios` | `renderUsers` | manager | ABM de usuarios y roles. | `state.users` | Formulario en columna. |
| `#/configuracion` | `renderSettings` | Todos (con alcance distinto) | Datos del negocio, categorías, unidades, orden del menú, permisos de rol, sync cloud, estilo de remito. | `state.appSettings` | Secciones apiladas. |
| `#/backup` | `renderBackup` | manager, admin | Exportar/importar JSON completo, sync con servidor, export/import masivo. | `state` completo | Botones en columna. |

### 4.2 Rutas de Impresión Especiales

| Ruta Hash | Renderizador | Roles | Uso |
|-----------|--------------|-------|-----|
| `#/vehiculos/imprimir/:id` | `renderVehiclePrint` | manager, admin, employee | Vista de impresión de vehículos (usa `printVehicleDirect`). |
| `#/remitos/imprimir/:id` | `renderRemitoPrint` | manager, admin, employee | Impresión de remito individual. |
| `#/remitos/imprimir-hoy` | `renderTodayRemitosPrint` | manager, admin, employee | Impresión de remitos de hoy. |
| `#/dividir/imprimir/:id` | `renderDividePrint` | manager, admin, employee | Vista de impresión de dividir compras (ahora lista sin recuadros). |

---

## 5. Modelo de Datos

### 5.1 Estado JSON (`app_state.data`)

El ERP guarda el estado operativo en un único JSONB. Los arrays/colecciones principales son:

| Colección | Descripción | Campos Clave |
|-----------|-------------|--------------|
| `users` | Usuarios del ERP | `id`, `username`, `password`, `name`, `role`, `email`, `phone`, `clientId`, `linkedClientIds`, `hourlyRate`, `isActive` |
| `clients` | Clientes | `id`, `name`, `address`, `phone`, `email`, `paymentType`, `priceTier` (`general` / `preferencial` / `con_factura` / `al_costo`), `priceAdjustmentPct`, `shippingFee`, `needsInvoice`, `cuit`, `legalName`, `invoiceType`, `invoiceFrequency`, `vehicleId`, `zone`, `isActive` |
| `products` | Productos | `id`, `name`, `category`, `unitType`, `baseCost`, `salePrice`, `ivaType`, `assignedToType`, `assignedToId`, `allowUnitWeight`, `imageKey` (foto en el servidor), `imageData` (base64, legado), `imageUrl`, `isActive` |
| `vehicles` | Vehículos de reparto | `id`, `name`, `type`, `driverName`, `capacity`, `isActive` |
| `providers` | Proveedores | `id`, `name`, `contactName`, `paymentTerms`, `defaultMargin`, `productsSupplied`, `isActive` |
| `orders` | Pedidos (la foto de rendicion es `deliveryRemitoPhoto.key`, referencia al archivo en el servidor) | `id`, `date`, `clientId`, `deliveryVehicleId`, `status`, `subtotalAmount`, `ivaAmount`, `totalAmount`, `paymentReceived`, `shippingFee`, `shippingIvaRate`, `deliveryRemitoPhoto`, `items[]` (con `notes` por item), `userId`, `createdAt` |
| `purchases` | Compras y gastos (incluye devoluciones a proveedor, con `totalCost` e `items[].quantity` en NEGATIVO) | `id`, `date`, `expenseType` (`purchase` / `provider_return` / `provider_payment` / `product_expense` / `other_expense` / `freight` / `prepared` / `market_price` / `cash_movement`), `providerId`, `providerName`, `totalCost`, `paymentStatus`, `returnOfPurchaseId`, `recordedBy`, `items[]` |
| `payments` | Pagos recibidos | `id`, `date`, `clientId`, `amount`, `method`, `receivedByUserId`, `orderIds`, `transferProofKey` |
| `saldos` | Cuenta corriente cliente | `id`, `date`, `clientId`, `type`, `description`, `amount`, `balance`, `relatedEntityId`, `relatedEntityType` |
| `caja` | Movimientos de caja | `id`, `date`, `type`, `concept`, `amountIngreso`, `amountEgreso`, `cashBoxId`, `relatedEntityId`, `relatedEntityType` |
| `providerLedger` | Cuenta corriente proveedor | movimientos de deuda/pago con proveedores |
| `clientTransfers` | Transferencias de clientes | `id`, `clientId`, `amount`, `status`, `createdByUserId`, `timestamp`, `reviewedBy`, `proofKey` |
| `billingLog` | Facturación | `id`, `clientId`, `clientName`, `invoiceType`, `freq`, `from`, `to`, `total`, `iva`, `neto`, `orders`, `cae`, `numero`, `pdf`, `externalReference`, `partials`, `status`, `detail`, `emittedAt` |
| `attendance` | Asistencia | `id`, `userId`, `date`, `checkIn`, `checkOut`, `hours` |
| `employeePayments` | Pagos a empleados | `id`, `userId`, `date`, `amount`, `concept` |
| `employeeReimbursements` | Reintegros | `id`, `userId`, `date`, `amount`, `concept` |
| `prices` | Histórico de precios | `{[productId]: {cost, marketPrice, marginPct, price, date}}` |
| `costRelations` | Relaciones de costo entre productos | `sourceProductId`, `targetProductId`, `ratio` |
| `productRelations` | Relaciones mayor ↔ menor | `sourceProductId`, `targetProductId`, `ratio` |
| `preferences` | Preferencias cliente/producto | `clientId`, `productId`, `sortOrder` |
| `productAliases`, `clientProductAliases`, `quantityAliases`, `clientQuantityAliases` | Alias para búsquedas rápidas | varios |
| `appSettings` | Configuración general | `categories`, `unitTypes`, `menuOrder`, `rolePermissions`, `receiptStyle`, `businessName`, etc. |
| `cashBoxes` | Cajas | `id`, `name`, `type`, `isActive` |
| `remitos` | Remitos emitidos | `id`, `orderId`, `date`, `items[]`, `total` |
| `vendorLedger` | Compras por vendedor | movimientos |
| `performanceAdjustments` | Ajustes manuales de rendimiento | `id`, `date`, `concept`, `amount` |
| `checklistLog` | **(v12.9.116)** Checklist diario del empleado, persistido y sincronizado (se conservan ~60 dias) | `id`, `dayKey`, `userId`, `userName`, `key`, `at` |
| `ocrCorrections` | **(v12.9.115)** Diccionario editable de correcciones del OCR, aplicado al texto antes del parser | `id`, `from`, `to` |

### 5.2 Espejo Relacional (PostgreSQL)

Cada vez que se guarda `app_state`, el backend regenera tablas relacionales para reportes:

- `clients`, `products`, `orders`, `order_items`, `purchases`, `purchase_items`, `payments`.

Tablas adicionales:

- `users` — usuarios con hash bcrypt.
- `state_history` — últimas 50 versiones de `app_state`.
- `proofs` — archivos de comprobantes subidos.
- `password_resets` — tokens de recuperación.

---

## 6. Flujos Principales

### 6.1 Login y Carga Inicial

1. Usuario ingresa credenciales en `POST /auth/login`.
2. Backend valida con bcrypt y genera JWT (expira según `JWT_EXPIRES`, default 12h).
3. Frontend guarda el usuario en `localStorage` (USER_KEY).
4. Si el usuario tiene sync cloud configurado, intenta `cloudPull()`; si no, carga `loadState()` desde `localStorage`.

### 6.2 Sincronización de Estado

1. Frontend obtiene estado remoto con `GET /state` (roles operativos).
2. Al modificar datos, `saveState()` persiste en `localStorage` (solo manager/admin guardan snapshot completo) y encola el cambio.
3. Roles con snapshot completo (manager/admin/contador) hacen `PUT /state` (full) con `baseUpdatedAt`; los demas (employee/proveedor) hacen `POST /state/patch` (solo el diff coalescido). El POST de patch usa `keepalive`.
4. Backend bloquea la fila `app_state`; en `PUT /state` detecta conflictos (409) por `baseUpdatedAt`; en `/state/patch` aplica el diff por coleccion y una copia mas VIEJA (por `updatedAt`) no pisa una mas nueva.
5. Al guardar, actualiza `updated_at`, `state_history`, espejo relacional, sincroniza usuarios y empuja a Google Sheets (`syncSheetsFromStateDiff`).
6. Merge local vs remoto (`mergeCloudStates`): pedidos y entidades editables (clientes, productos, proveedores, vehiculos, usuarios, cajas, compras) y `prices` se resuelven por "mas nuevo gana" (`updatedAt`; remoto en empate). Toda mutacion de pedido sella `updatedAt` via `recalcOrderTotals`. Ver seccion 12.28.

### 6.3 Ciclo de Pedido

1. **Nuevo pedido**: cliente/empleado selecciona cliente, productos, cantidades y notas.
2. Precios se obtienen de `getAdjustedProductPrice(product, client)` considerando `priceTier`, `priceAdjustmentPct` y listas históricas.
3. `recalcOrderTotals()` calcula subtotal, IVA y total.
4. **Confirmación**: el pedido pasa a estado `pendiente`.
5. **Preparación/entrega**: se actualizan estados; `deliveryVehicleId` asigna vehículo.
6. **Pago**: en `#/pagos` se registra el pago, se asigna a pedidos, se genera saldo y movimiento de caja.
7. **Facturación**: `#/facturacion` agrupa pedidos facturables y emite factura vía TusFacturas (o simulación).

### 6.4 Compras / Gastos

1. En `#/compras` se registra compra a proveedor o gasto operativo.
2. Se guarda en `state.purchases`.
3. Se impacta en caja (`caja`) y/o cuenta corriente proveedor (`providerLedger`).
4. Al registrar una compra del día, `updateOrdersWithNewPrices()` recalcula pedidos del mismo día con los nuevos precios y actualiza saldos/caja asociados.

### 6.5 Transferencias de Clientes

1. Cliente registra transferencia en `#/registrar-transferencia` o envía `POST /transfers`.
2. La transferencia queda en `state.clientTransfers` con `status: "pending"`.
3. Gerente/admin/contador revisa en `#/comprobar-transferencias`.
4. Al aprobarse se generan: pago (`payments`), saldo (`saldos`) e ingreso en caja banco (`caja`).
5. También puede aprobarse/rechazarse vía API externa `POST /external/transfers/:id/:action`.

### 6.6 Facturación Automática

1. Scheduler interno cada 5 minutos. La fecha de última ejecución se persiste en `app_state.data.billingLastRunDate` para sobrevivir reinicios.
2. A las 23:00 hora Argentina verifica clientes con `invoiceFrequency` (`diaria`, `semanal`, `mensual`).
3. Agrupa pedidos facturables (`needsInvoice`) del período y recalcula neto, IVA y total a partir de los ítems agrupados (precio + alícuota + cantidad) usando `decimal.js`.
4. Valida CUIT/CUIL del cliente (longitud, prefijo y dígito verificador) antes de emitir.
5. Consulta los datos oficiales del contribuyente en ARCA a través del endpoint `clientes/afip-info` de TusFacturasAPP (razón social, domicilio, provincia y condición impositiva) y los utiliza en el payload del cliente, con **prioridad de AFIP** sobre lo cargado a mano (de lo manual en la práctica solo se usa el CUIT). Si la consulta no está habilitada o falla, se conservan los datos del ERP como fallback. Los códigos de provincia, `condicion_pago` y `condicion_iva` siguen las tablas oficiales de TusFacturas (ver 12.20).
6. Si el período supera los 130 ítems permitidos por TusFacturas, divide el comprobante en múltiples facturas con `external_reference` idempotente (`PC-{clientId}-{from}-{to}` y sufijo `(X/Y)`).
7. Envía a TusFacturasAPP con timeout de 30s y hasta 3 reintentos con backoff exponencial (o simula si faltan credenciales).
8. Si un comprobante de un período falla, se detiene el procesamiento de ese período para evitar estados inconsistentes; los períodos anteriores exitosos quedan registrados.
9. Registra resultado en `state.billingLog`, incluyendo `cae`, `numero`, `pdf`, `externalReference` y, en caso de división, el array `partials`.

---

## 7. Endpoints del Backend (`pare-carrito-sas-server/src/server.js`)

| Método | Ruta | Rol | Descripción |
|--------|------|-----|-------------|
| GET | `/health` | Público | Healthcheck API + DB |
| POST | `/auth/login` | Público | Login con rate limiting |
| POST | `/auth/register` | Público | Registro de cliente pendiente |
| POST | `/auth/recover` | Público | Recuperación de contraseña |
| POST | `/auth/reset` | Público | Restablecer contraseña |
| GET | `/state` | manager, admin, employee, contador | Estado completo JSON |
| PUT | `/state` | manager, admin, employee, contador | Guardar estado completo |
| POST | `/transfers` | customer, example | Registrar transferencia cliente |
| POST | `/proofs` | Cualquier logueado | Subir comprobante |
| POST | `/product-images` | manager, admin, employee | **(v12.9.124)** Sube una foto de producto (JPG/PNG/WEBP, hasta 8 MB) al volumen `uploads` y devuelve su `key`. Queda marcada `public_read = TRUE` |
| GET | `/public/product-image/:key` | **Público (sin auth)** | **(v12.9.124)** Sirve la foto de producto con `Cache-Control: public, max-age=31536000, immutable`. Solo archivos con `public_read = TRUE`: los comprobantes siguen pidiendo login |
| POST | `/ocr/order-image` | manager, admin, employee | OCR de la foto de un pedido manuscrito. Cadena de proveedores (v12.9.112-114): **Google Cloud Vision** (`DOCUMENT_TEXT_DETECTION`, `languageHints` = `GOOGLE_VISION_LANG`, por defecto `es-t-i0-handwrit`) -> OpenRouter -> Moonshot/Kimi; devuelve `{text, provider}` |
| GET | `/proofs/:key` | Cualquier logueado | Descargar comprobante |
| GET | `/reports/sales` | manager, admin | Ventas vs gastos por día |
| GET | `/reports/top-products` | manager, admin | Top productos |
| GET | `/reports/top-clients` | manager, admin | Top clientes |
| GET | `/exports/orders.csv` | manager, admin | CSV de pedidos |
| GET | `/exports/backup.json` | manager | Backup completo JSON |
| GET | `/billing/status` | manager, admin, contador | Vista previa facturación |
| POST | `/billing/run` | manager | Ejecutar facturación manual/simulada |
| GET/POST | `/external/*` | API key (`x-api-key`) | API externa para integraciones (bot de WhatsApp, etc.) |
| POST | `/external/transfers/:id/:action` | API key | Aprobar/rechazar transferencia |
| POST | `/external/compra-hoy` | API key | **Desvinculado**: ya no actualiza precios (Sheets solo control). Reactivable con env `SHEETS_INBOUND_PRICES=on` |
| POST | `/clients/price-increase-notify` | manager, admin | Aviso de suba de precio por WhatsApp a clientes con ese producto |
| POST | `/clients/holiday-broadcast` | manager, admin | Aviso de feriado por WhatsApp (plantilla Meta) |
| GET | `/public/price-list` | **Público (sin auth)** | Lista de precios publica (nombre, precio, IVA+2%, categoria, unidad, mayor/menor, imagen, fecha). Sirve a `/precios` (`precios.html`). Desactivable con `appSettings.publicPriceListEnabled=false` |

Notas:
- Caddy: `handle_path /api/*` -> API; `/precios` reescribe a `precios.html`; `Cache-Control: no-cache, must-revalidate` para `/`, `*.html`, `*.js`, `*.css`.
- Salida sistema -> Google Sheets (`syncSheetsFromStateDiff`, `pushPrecio`) sigue activa; el sentido inverso (planilla -> sistema) esta desactivado.

---

## 8. Despliegue y Mantenimiento

### 8.1 Docker Compose

Servicios:

- `db` — PostgreSQL 16, volumen `pgdata`.
- `api` — Backend Node.js, build local, expone puerto 3000.
- `caddy` — Web server y proxy reverso.

Variables de entorno principales (`.env`):

- `POSTGRES_PASSWORD`, `JWT_SECRET` (obligatorias).
- `ALLOWED_ORIGIN`, `SITE_DOMAIN`, `API_DOMAIN`.
- `ADMIN_USERNAME`, `ADMIN_PASSWORD` (crea usuario manager inicial).
- SMTP opcional.
- `TUSFACTURAS_*` para facturación real.
- `EXTERNAL_API_KEY` para API externa.

### 8.2 Actualización en VPS

El backend se copia dentro de la imagen Docker, por lo que cualquier cambio en `src/server.js` requiere:

```bash
cd /opt/pare-carrito/pare-carrito-sas-server
docker compose build api
docker compose up -d api
```

El frontend es estático; basta copiar los archivos actualizados a `lucas-pare-carrito-erp/` (o desplegar con Caddy desde el repo).

### 8.3 Backups

- **Local**: copia del directorio del proyecto con fecha/hora.
- **GitHub**: commit + push al repo.
- **Servidor**: `GET /exports/backup.json` genera JSON completo descargable.
- **History**: PostgreSQL conserva las ultimas versiones en `state_history` (`STATE_HISTORY_KEEP`, default **30**; antes 200).
- **Backup del deploy (v12.9.99)**: `deploy.sh` hace `pg_dump | gzip -1` EXCLUYENDO los datos de `state_history` y `state_operations` (son historial/idempotencia internos y pueden pesar varios GB por los snapshots completos del estado). Se conserva la estructura, no las filas gigantes -> backup de decenas de MB y de segundos (antes tardaba mucho al comprimir). El contenido de `state_history` no es necesario para restaurar los datos reales.

---

## 9. Consideraciones de Mobile

- Breakpoint principal: `@media (max-width: 760px)`.
- Sidebar se transforma en drawer fijo con overlay.
- Tablas pasan a `display: block` + `overflow-x: auto`.
- Grids colapsan a 1 columna.
- Inputs usan `font-size: 16px` para evitar zoom en iOS.
- En Saldos/Pedidos/Mis Pedidos los filtros de fecha y botones de rango se reorganizan en filas.
- En Dividir Compras y Vehículos la impresión PDF/WhatsApp usa funciones compartidas con desktop y se renderiza como lista sin recuadros.

---

## 10. Puntos de Atención

- El estado completo en un solo JSONB simplifica el desarrollo pero puede crecer; vigilar tamaño y tiempos de sync.
- El control de conflictos (`baseUpdatedAt`) requiere que los usuarios recarguen ante un 409.
- Las contraseñas en `state.users` son texto plano dentro del JSON; el backend las hashea en la tabla `users` al sincronizar.
- La facturación con TusFacturas requiere credenciales válidas; sin ellas opera en modo simulación. Se valida CUIT, se usa precisión decimal (`decimal.js`), se reintentan llamadas con timeout y se soporta división en múltiples comprobantes cuando el período supera 130 ítems.
- Cualquier cambio en `src/server.js` requiere rebuild de la imagen Docker del backend.

---

*Documento generado automáticamente a partir del análisis del código fuente de Pare Carrito SAS ERP.*
---

## 11. Historiales canonicos de productos

Desde la version 12.8.15 el sistema separa la informacion historica de productos de la informacion transaccional de pedidos, saldos y caja tambien a nivel de almacenamiento.

### 11.1 Ventas

La pantalla `Historiales` usa el endpoint `/product-history` como fuente de precio historico de lista por producto/dia y cantidad vendida por producto/dia.

Esto significa que:

- El precio mostrado en `Historiales` para ventas es el precio de lista historico.
- La cantidad mostrada en `Historiales` para ventas es la cantidad total historica vendida por producto/dia.
- Los pedidos de cada cliente conservan su precio real cobrado en `order.items[].unitPrice`, sus subtotales y sus saldos.
- La conciliacion no inventa pedidos ni clientes para cerrar diferencias.

### 11.2 Compras

La pantalla `Historiales` usa `product_history_state.purchase_history` como fuente canonica para cantidad comprada y precio de compra por producto/dia.

Esto significa que:

- Las compras historicas canonicas sirven para analisis de productos, precios y cantidades.
- Los movimientos de caja, pagos, deuda de proveedores y compras transaccionales existentes quedan separados.
- Cualquier reemplazo o reversa de compras con impacto financiero requiere decision explicita y backup previo.

### 11.3 Almacenamiento

Los historiales canonicos viven en la tabla `product_history_state`, fuera del JSON principal `app_state`.

Esto reduce el peso de cada operacion diaria, porque editar clientes, crear pedidos o registrar pagos ya no transporta decenas de miles de registros historicos.

Desde la version 12.8.19, la pantalla `Historiales` solicita `/product-history?mode=matrix`. En ese modo, el backend devuelve filas agregadas por producto/dia para compras y ventas, evitando que el navegador tenga que procesar todo el historial crudo del rango. Desde la version 12.8.20, el backend cachea esas matrices por rango y version de datos para acelerar cargas repetidas sin cambiar la fuente canonica.

### 11.4 Sincronizacion offline

El frontend mantiene una cola local de parches pendientes. Cada parche incluye `operationId`, `baseUpdatedAt` y los registros modificados.

- Si no hay conexion, el cambio queda pendiente y se reintenta al volver internet.
- Si el servidor tiene una version distinta, responde conflicto y el cliente no pisa datos silenciosamente.
- Si se reintenta una operacion ya aplicada, `state_operations.operation_id` evita duplicados.
- El servidor sigue siendo la fuente de verdad.
- El rol Cliente no ejecuta sincronizacion completa contra `/state`; sus escrituras permitidas usan endpoints especificos (`/orders/customer` y `/transfers`) con cola local de reintento.
- `/orders/customer` valida que el cliente del pedido este vinculado al usuario y registra pedido, saldo y caja dentro de una transaccion.
- Desde la version 12.8.42, si hay cambios locales pendientes, la descarga automatica no reemplaza el estado local. La descarga manual fusiona la version del servidor con la version local y reencola las diferencias para subirlas, evitando perdidas por sobrescritura.

---

## 12. Modulos y subsistemas agregados (2026-06-26 a 2026-07-03)

### 12.1 Subsistema de Stock de fraccionados
- Pagina `Stock` con conteo diario por producto, calculo de merma (kg) y sugerencia de compra en bultos. Soporta override por menor, multi-bulto y activar/desactivar producto del calculo.
- Config incluye el peso (kg) por producto. Las compras del dia impactan en el stock disponible y en los faltantes sugeridos. Inicio muestra un grafico de merma en kg por dia.
- Sin conteo previo el estimado es 0 y el primer conteo no genera merma falsa.

### 12.2 Facturacion (TusFacturas)
- Pagina `Facturacion` para clientes que requieren factura: cuentas vinculadas + rango, historial de emisiones con CAE y PDF imprimible, `Ver Pedidos` con remito directo y detalle desplegable.
- El boton PDF regenera la URL del comprobante con el endpoint `regenerar_pdf` de TusFacturas (la URL del alta caduca). Backend: `regeneratePdf` en `billing.js` + `/billing/regenerate-pdf`.
- OCR de imagen de pedido por OpenRouter, con prompt configurable; la API key se toma solo de la env `OPENROUTER_API_KEY`.
- La cantidad de pedidos de cada cliente abre un popup con los pedidos del periodo que acumulan IVA (detalle desplegable, total/IVA por pedido, impresion de remito por pedido y "Imprimir todo" para enviar al cliente).
- Al emitir la factura de clientes semanal/quincenal/mensual (automatica o manual) se envia al correo de facturacion un PDF de detalle de pedidos (generado con `pdfkit` en el servidor) y la factura de TusFacturas adjunta. Funciones backend: `buildBillingDetailPdf`, `fetchPdfAttachment`, `emailBillingResults`; `sendMail` admite adjuntos. Requiere SMTP en `.env`.

### 12.3 Bot de WhatsApp (`whatsapp-bot/`)
- Servicio Node aparte (webhook Cloud API, clasificacion con IA OpenRouter, reglas de horario y confirmacion de equipo, notificaciones). Integrado en docker-compose con ruta `/wa/webhook` en Caddy.
- Endpoints externos del ERP que consume el bot: `/external/clients/by-phone`, `/external/orders/today`, `/external/products/names`, y crear/agregar/cancelar pedido (matcher de productos, precios+IVA por tier, segunda ronda).
- Endpoint `/broadcast` para avisos masivos por plantilla aprobada de Meta (rechaza si `BROADCAST_KEY` esta vacio). Telefonos adicionales por cliente: el bot reconoce cualquiera de los numeros del cliente.

### 12.4 Sincronizacion con Google Sheets (Apps Script)
- Webhook de Apps Script (`google-sheets-sync/Code.gs`) que recibe diffs del backend: pedidos nuevos/editados/cancelados a la pestania `pedidos` (upsert por numero, recuerda fila en Properties) y precios/costo a la pestania `precios` (mapeo por nombre normalizado + overrides, busca la fila de encabezados sin asumir fila 1).
- `Compra Hoy` es de ENTRADA: el sheet no la escribe; se observa por escaneo periodico (soporta formulas) con frecuencia escalonada por franjas horarias. Al cambiar, actualiza el costo del producto y recalcula el precio de venta manteniendo el margen (endpoint `/external/compra-hoy`). El sistema solo escribe Venta y Costo.
- `mirrorStateToTables` reconstruye solo las tablas que cambiaron para acelerar los guardados chicos. El acceso del web app debe ser "Cualquiera" y republicarse como "Nueva version". La celda de cliente en los pedidos se escribe como "NNN) Nombre" (numero + nombre). Modelo: `client.paymentDay` (dia/plazo de pago); coleccion `state.replacements` (recambios/reposiciones); appSettings de dunning (`dunningEnabled`, `dunningWhatsappMessage`, `dunningMailMessage`, `dunningWhatsappTemplate`).

### 12.5 Feriados
- Recuadro de feriados (boton en Nuevo Pedido) con alta y aprobacion: el empleado propone, admin/gerente aprueban. Bloquea la fecha en el calendario y permite avisar por WhatsApp a los clientes activos. El texto del aviso es configurable.

### 12.6 Parser de pedidos y Dividir compras
- Parser de `Pegar pedido de WhatsApp`: separa items pegados, convierte gramos a kg, no toma partes del nombre como nota, prioriza alias/favoritos, interpreta envases como unidad, `pimiento`->`morron`, `molido`->`en polvo`, `un poquito`->0,2, `x <unidad>` como unidad, sin cantidad -> 1, y descarta matches debiles (ej. `nuez moscada` no cae en `Pera`). Se guarda el texto interpretado por pedido.
- Dividir compras: agrupa por nombre de producto normalizado (evita duplicados y colisiones por id), muestra total por producto en pantalla, PDF y WhatsApp, formatea numeros de cliente sin ceros y cantidades enteras, y el export de WhatsApp respeta el toggle `Agrupado por cliente`.

### 12.7 Impresion y Remitos
- El texto interno de los documentos imprimibles es 11px (titulos sin cambios). Los remitos usan interlineado minimo legible.
- Scripts de Apps Script en `remitos-impresion/` para imprimir a PDF horizontal (margenes 0.59cm) las paginas con contenido segun la tabla `Datos A7:C44`, con apertura automatica del PDF.

### 12.8 Facturacion: detalle de pedidos y envio automatico (v12.9.4)
- En Facturacion, la cantidad de pedidos de cada cliente abre un popup con los pedidos que acumulan IVA (detalle desplegable, imprimir remito por pedido, "Imprimir todo").
- Al emitir la factura de clientes semanal/quincenal/mensual (automatica o manual) se envia al correo de facturacion un PDF con el detalle de los pedidos (generado con `pdfkit` en el servidor) y la factura de TusFacturas adjunta. Funciones backend: `buildBillingDetailPdf`, `fetchPdfAttachment`, `emailBillingResults`; `sendMail` admite adjuntos.

### 12.9 Recordatorios de pago (dunning) (v12.9.13)
- Scheduler diario a las 8am en el backend (`runDunning` en server.js, patron de `startBillingScheduler`). Segun el plazo del cliente (`paymentType`/`paymentDay`: contado/contra_factura=diario, dia de semana/semanal=7, 10/15/20 dias, mensual=30) envia WhatsApp diario por plantilla al vencer el plazo sin pago, y correo al cliente (billingEmail) + gerente a partir de 3 dias de mora. Textos y plantilla configurables en Configuracion (`dunningEnabled`, `dunningWhatsappMessage`, `dunningMailMessage`, `dunningWhatsappTemplate`).

### 12.10 Pedir recambio / reposicion (v12.9.13, v12.9.15)
- Boton "Pedir recambio" en Pedidos y Mis Pedidos: popup con pedidos de los ultimos 3 dias, seleccion de productos con `+`, cantidad (<= la del pedido), foto obligatoria (camara o galeria) y "Reponer en: proximo pedido / manana". Se guarda en `state.replacements`.
- Panel "Productos de reposicion pendientes" (foto ampliable con click) y cartel "Prod reposicion" en Inicio (staff). Genera un pedido de reposicion con items a $0 y nota "(reposicion)" (manana=dia siguiente; proximo=se adjunta al proximo pedido del cliente), visible en Dividir Compras y en el remito sin tocar precio ni saldo.

### 12.11 Rol Proveedor (v12.9.14, v12.9.15)
- Rol `proveedor` vinculado a una cuenta de proveedor via `user.providerId` (form de Usuarios). Backend: incluido en STATE_READ_ROLES/PATCH_SYNC_ROLES y en el CHECK de la tabla users.
- Ve solo lo asignado a el (los productos con `assignedTo = provider:PROV-XXX`): Inicio propio (estado de cuenta con la empresa, productos asignados, items de hoy, recambios pendientes), Pedidos (solo los que incluyen sus productos), Dividir Compras (solo lo suyo, con export; sin selector ni reasignacion), Proveedores (su cuenta), Compras/Gastos (selector de productos y movimientos acotados a el), "Mis Costos" (carga costo + precio de mercado de sus productos, sin tocar precio de venta) y Configuracion. Tambien ve los recambios de sus productos con la foto adjunta.

### 12.12 Feriados en Configuracion y plazo de pago del cliente (v12.9.13)
- Boton "Gestionar feriados" en Configuracion (abre el modal de alta/aprobacion existente).
- Campo `client.paymentDay` (dia de semana / 10-15-20 dias / mensual) visible cuando el tipo de pago del cliente es semanal o cuenta corriente.

### 12.13 Otros cambios operativos y de UX (v12.9.5 a v12.9.12)
- Aviso por WhatsApp al agregar/quitar productos de un pedido (plantilla configurable, endpoint `/clients/order-change-notify`).
- Compras/Gastos: tipo "Flete", adjuntar comprobante (imagen comprimida) y "Ver comprobante" en el detalle; usuario + horario en el detalle de movimientos (tambien en Pagos).
- Vehiculos: sumatoria en 3 columnas + N de cliente; "Sin Dividir" sin total. Remitos PDF: franja gris cada 2da fila + boton mobile identico a desktop. Nuevo pedido: fecha por defecto = dia siguiente despues de las 10am. Vehiculos/Unidades: fecha hoy por defecto; faltantes en lista. Orden de productos agrupa variantes. Botón para eliminar productos inactivos. Cliente en la sync de Sheets como "NNN) Nombre".

### 12.15 Precios: importar pegando y actualizar pedidos del dia (v12.9.22 a v12.9.25)
- En `Precios`, importar precios pegando una tabla (Venta y Costo): match tolerante por nombre normalizado que ignora "por"/"x" y unidades (ej. "zanahoria por kg" -> Zanahoria Kg), evitando los productos que no vienen en la lista.
- Al actualizar precios, los pedidos del MISMO dia se recalculan con el nuevo precio (funcion `updateOrdersWithNewPrices`): antes quedaban con el precio que tenian al cargarse.

### 12.16 Stock: grupos / equivalencias y conciliacion en Compras (v12.9.26 a v12.9.28)
- Seccion "Grupos / equivalencias" en `Stock` (gerente/admin): agrupa productos que son lo mismo contado distinto, con un factor en kg por unidad de cada variante (berenjena unidad 0,4kg; calabaza unidad 2kg; manzana/pera unidad 0,25kg y bandeja 4kg; etc.). Regla especial del tomate: un producto "se compra entero" (cajon, kg por unidad) y otro es "bulto para armar el resto" (jaula, kg por bulto). La parte entera de cada pedido del cajon se compra entera; las fracciones (medios cajones) + los kg de los demas miembros se arman desde jaulas, redondeando para arriba. Funciones: `getStockGroups`, `stockGroupComputation`, `renderStockGroupsPanel`, `openStockGroupsModal`. Config en `appSettings.stockGroups`.
- Conteo unico: los miembros de un grupo (y el producto "se compra entero") ya no figuran como filas individuales en Stock ni en la grilla de falta; se cuentan una sola vez a nivel de grupo (`getGroupHiddenProductIds`). El bulto no se oculta porque es lo que se sugiere comprar.
- Conciliacion en Compras/Gastos: la grilla de "falta" muestra la sugerencia por grupo (cajones enteros + jaulas/cajas), neta de lo ya comprado, en vez de sobre-sugerir por producto.
- Conteo por grupo en kg (v12.9.32): el panel de grupos permite contar el stock fisico del grupo en kg (una fila por grupo) y ese stock descuenta la sugerencia de compra (reduce el pool de bulto, no los enteros). Los conteos se guardan con productId sintetico "GRPKG:<id>".
- La grilla de falta se agrupa por PRODUCTO (no por producto+unidad): un mismo producto con la unidad escrita distinta en dos pedidos (ej. "unidad" vs "atado") se suma en una sola tarjeta con la unidad canonica.

### 12.17 Parser: alias ignora conectores (v12.9.29)
- El match por alias ignora los conectores "de/del/la/el". El parser quita el "de" del texto pegado ("cebolla de verdeo" -> "cebolla verdeo"), asi que un alias con "de" nunca matcheaba; ahora si (ej. "1 atado de cebolla de verdeo" carga Verdeo, no Cebolla Bolsa).

### 12.18 Rol Proveedor: refinamientos (v12.9.20 a v12.9.31)
- Compras/Gastos renombrado a "Venta de hoy" para el proveedor; sin Vendedor/Registrar; Caja Salida segun estado; no ve el campo Vendedor (se dejo de renderizar porque `updateKind` lo re-mostraba).
- Pedidos: no ve nombre de cliente/precios/total (solo cantidades). En el detalle por producto de cada pedido solo se muestran los productos asignados al proveedor. Se agrego "Pedidos por producto (hoy)" (desglose por cliente estilo Dividir) y "Compra por dia" (una fila por dia con el total al costo del proveedor -de Mis Precios-, expandible al detalle producto x costo = total, con el mismo formato que la pagina Proveedores). Respeta el rango de fechas.
- Dividir Compras: el recuadro "Agrupado por cliente" no muestra el nombre del cliente, solo el numero.

### 12.19 Unidades: enviar quita el recuadro (v12.9.29)
- Al presionar Enviar en unidades pendientes se quita el recuadro de ese pedido/producto (igual que Omitir), sin recargar la pantalla; si la tarjeta queda sin lineas se saca entera. Se registra en `ui.omittedUnitLines`.

### 12.20 Facturacion TusFacturas: correccion de codigos y condicion de IVA (v12.9.30)
- Codigos de provincia corregidos a la tabla oficial de TusFacturas (estaban corridos: Salta salia como Jujuy y el default salia como Salta). Ahora Salta=17, Jujuy=10, Buenos Aires=2, CABA=1, con normalizacion de acentos y alias de CABA/Capital Federal (`normalizeProvinceKey`).
- `condicion_pago` por defecto = "205" (Cuenta corriente); antes "211" (Tarjeta de credito). Verificar que la env `TUSFACTURAS_CONDICION_PAGO` no fuerce 211.
- Codigos de `condicion_iva` validos: Exento="E" (antes "EX", invalido), Monotributo="M" (antes "MT"). Prioridad: AFIP por CUIT, luego el campo manual del cliente (respaldo), luego default por tipo de factura.
- Nuevo campo "Condicion IVA" en el formulario de cliente (`client.condicionIva`: ""=automatica/AFIP, CF, RI, M, E) como respaldo. NOTA: TusFacturas no actualiza la condicion de IVA de un cliente ya existente; hay que corregirlo una vez en su panel.

### 12.21 Compras: costo unitario y aviso de suba (v12.9.33)
- Compras/Gastos: "Unid. calculo" solo para mayoristas con relacion minorista; costo unitario con separador de miles (xxx.xxx); boton de ultimo costo por producto (pega el costo guardado); advertencia si el costo es >30% mayor al guardado.
- Aviso de suba automatico: al guardar una compra con costo >30% mayor, el bot envia WhatsApp (plantilla aprobada) a los clientes con ese producto en pedidos de hoy, con el precio de venta de cada cliente (viejo vs nuevo). Endpoint `/clients/price-increase-notify`. Config: `priceIncreaseMessage`, `priceIncreaseTemplateName`, `priceIncreaseTemplateLang`.

### 12.22 Impresion: zebra y compatibilidad, y ajustes de fila de Compras (v12.9.34, v12.9.35)
- Se fuerza `print-color-adjust: exact` (con bloque `@media print` para mobile) para que el fondo gris (zebra) de los remitos salga al imprimir/exportar, no solo en el popup "Ver".
- Fix impresion en Android: la ventana de impresion movil ya no se auto-cierra (dejaba la hoja en blanco / cancelaba el dialogo); muestra el contenido, intenta imprimir y ofrece un boton "Imprimir / Guardar PDF" de respaldo.
- Compras/Gastos: la fila de cada producto quedo en una sola linea; labels "cant", "costo u.", "$ mercado"; boton de ultimo costo como columna propia; la advertencia de suba >30% paso a ser un popup (confirm) en desktop y mobile (Aceptar mantiene el costo, Cancelar lo borra).

### 12.23 Compras/Unidades: layout, vistas y movimientos (v12.9.36, v12.9.37)
- Compras/Gastos: el Total se muestra arriba de "Agregar producto" (debajo del ultimo producto); "Favoritos del proveedor" se movio abajo del recuadro Productos (arriba de "Favoritos del vendedor"); el recuadro Productos tiene toggle cuadricula/lista (iconos como Nuevo Pedido, estado `ui.purchaseProductView`), con vista lista compacta en fila.
- Unidades: toggle cuadricula/lista (`ui.unitsProductView`) en "Notas de productos de hoy", "Productos por unidades pendientes" y "Productos sin compra o compra insuficiente".
- Fixes: rol proveedor podia no guardar el egreso (lectura de campo Vendedor inexistente) y el boton grilla del panel de faltantes no alternaba; ambos corregidos. Caja: dropdown 30/60/120/Todos (`ui.cajaLimit`). Compras: hora junto al usuario en la tabla de movimientos.
- Boton de ultimo costo: label "ultimo" arriba y solo el monto sin decimales ni espacio ($1.234) en el boton.

### 12.24 Sesion, fechas y auto-actualizacion (v12.9.38, v12.9.39)
- Reajuste de fechas al cambiar de dia (si el sistema queda abierto): al cambiar el dia se llevan a hoy los filtros operativos (Pedidos, Proveedores, Remitos, Unidades, Vehiculos, Rendimiento/Analisis, Historiales y el "Hasta" de Saldos y Facturacion). No se toca el "Desde" de Saldos ni Facturacion. Control por `ui.lastActiveDay` evaluado en cada render.
- Auto-actualizacion sin borrar cache: compara el Last-Modified/ETag de `app.js` (HEAD sin cache) a horas fijas (4,5,6,7,8,10,12 y luego cada 4h) y al volver a la pestania. Si hay version nueva, recarga sola con cache-bust si la pestania esta oculta o el usuario inactivo >2 min; si esta usando activamente, muestra un banner "Actualizar ahora". Solo aplica a deploys posteriores a que el usuario cargue la version con el detector.
- Cierre de sesion por inactividad de 4 horas.
- Login: toggle "ver contraseña" como icono sin marco dentro del input.

### 12.25 Cierre de caja de empleados (v12.9.40)
- Empleado (Horarios): recuadro "Cierre de caja" con los pedidos de hoy (marca los cobrados en efectivo; default = los con pago registrado; popup para registrar el que falte), "Hoy cobre en efectivo" y "Mi caja al cierre" con sus diferencias. Al guardar ajusta la caja del empleado al monto real (ajuste de caja por la diferencia). Caja esperada = cierre del dia anterior - gastos/reintegros de hoy + cobros de hoy. Historial con 30/60/120/todos.
- Gerente/Admin: en Empleados y Caja, recuadro "Cierres de caja (empleados)" con los ultimos cierres, diferencias de cobro y de caja por empleado activo (30/60/120/todos).
- Datos: coleccion `state.cashClosings` {id,userId,userName,date,expectedCollected,actualCollected,collectDiff,expectedCash,actualCash,cashDiff,orderIds,createdAt}. Estados UI: `ui.cashClosingLimit`, `ui.cashClosingAdminLimit`, `ui.ccChecked`/`ui.ccCheckedDate`.

### 12.26 Motor de precios dinamicos (v12.9.47)
- Motor client-side (app.js) que ajusta el margen segun el exceso del cambio de costo de cada producto sobre una canasta interna (mediana del cambio % de costos, ventana configurable). Subas comprimen margen (aplican de una); bajas expanden margen y bajan el precio en pasos del 30% con agenda de recalculo cada 14 dias; zona neutral recupera hacia el margen normal. Funciones: getMarginSection, getPriceAutoSettings, computeBasketIndexPct, computeTargetMargin, computeStepPrice, applyCostChange, runScheduledRepricing (corre al cargar para gerente/admin, guard `appSettings.priceAutoLastRun`).
- Modo `appSettings.priceAuto.mode`: off (comportamiento historico) / simulation (loguea sin aplicar) / on. Secciones `state.marginSections` (min/normal/max). Producto: `marginSectionId`, `priceAutoExempt`, `isBasketReference`. Log `state.priceAutoLog` (180 dias) y agenda `state.priceAutoSchedule`.
- Hooks: updateProductCostsFromPurchase y applyCostRelations ("Mantener") pasan por applyCostChange; edicion manual en Precios gana y se loguea; endpoint Compra Hoy marca `pendingReprice`.
- UI: panel en Configuracion (gerente), columnas Seccion/Auto en Precios, pagina "Ajustes de precios" (log + revertir + agenda).

### 12.27 Alineacion de dunning/recambio/feriados + interruptores (v12.9.48 a v12.9.51)
- Dunning (server): estado por cliente persistido (`dunningState` en app_state: dueDate, daysWithoutPayment, lastWhatsappDate, emailSent). Dia esperado por tipo de pago (contado/contra factura = pedido ese dia; semanal/cuenta corriente = dia de semana, cuenta corriente sin dia no se molesta; N dias/mensual = ultimo pago o primer saldo + N). WhatsApp 1/dia, correo de mora UNA sola vez al 3er dia; asunto configurable (`dunningMailSubject`).
- Recambio: "proximo pedido" genera pedido SEPARADO a $0 (nota "[REC-id]" para idempotencia); validacion qty <= pedida; materializacion "manana" cuando llega la fecha y al cargar; pagina propia "Reposiciones" (ruta `reposiciones`, gerente/admin/empleado) con tabla y Eliminar; el banner lleva ahi.
- Feriados: boton "Gestionar feriados" en Configuracion (id `config-holidays-btn`).
- Interruptores en Configuracion (gerente, todos default activados): `mailingEnabled` (corta correos de facturacion y mora; kill-switch env `MAILING_DISABLED`), `whatsappEnabled` (corta WhatsApp automaticos: mora, cambio de pedido, suba de precio, feriados; kill-switch env `WHATSAPP_DISABLED`), `billingEnabled` (pausa la facturacion automatica; la manual sigue).
- Config: paneles "Orden del sidebar", "Productos con leyenda kg", "Aviso de feriados" y "Permisos y sidebar por rol" con scroll (alto maximo).

### 12.14 Modelo de datos agregado
- `client.paymentDay`; coleccion `state.replacements` (recambios/reposiciones); `user.providerId` (vinculo del rol proveedor); appSettings: dunning (`dunningEnabled`, `dunningWhatsappMessage`, `dunningMailMessage`, `dunningWhatsappTemplate`) y aviso de cambios (`orderChangeNotifyEnabled`, `orderChangeMessage`, `orderChangeTemplateName`); `purchase.proofFile` (comprobante), tipo de gasto `freight`. appSettings: `mailingEnabled`, `whatsappEnabled`, `billingEnabled` (interruptores, default true), `dunningMailSubject`. Estado server (top-level en app_state, fuera del data sincronizado): `dunningState`, `dunningLastRunDate`.
- `appSettings.stockGroups` (grupos/equivalencias de stock: `{id,name,members:[{productId,factorKg}],wholeProductId,wholeKg,bulkProductId,bulkKg}`); `client.condicionIva` (respaldo de condicion frente al IVA para facturacion); `ui.omittedUnitLines` (lineas de Unidades enviadas/ocultas); appSettings de aviso de suba (`priceIncreaseMessage`, `priceIncreaseTemplateName`, `priceIncreaseTemplateLang`). Estados de UI (no persistidos): `ui.purchaseProductView` / `ui.unitsProductView` (vista cuadricula/lista), `ui.cajaLimit` (30/60/120/todos), `ui.lastActiveDay` (reajuste de fechas por cambio de dia). Cliente: `client.condicionIva`.

### 12.28 Sincronizacion robusta y anti-perdida de datos (v12.9.62 a v12.9.92)
- Sello de `updatedAt`: `recalcOrderTotals` (punto unico de toda mutacion de pedido: alta/baja de items, cambio de cantidad, actualizacion de precios por compra, borrado en Unidades) sella `order.updatedAt`. Tambien se sella al editar clientes/productos/proveedores/vehiculos/cajas y en cada escritura de precio.
- Merge por "mas nuevo gana": el merge local vs servidor (`mergeCloudStates`) usa `unionByKeyPreferNewest` (por `updatedAt`, remoto gana en empate) para pedidos, clientes, productos, proveedores, vehiculos, usuarios, cajas y compras; y para `prices` un merge por producto con `updatedAt`. Antes ganaba SIEMPRE la copia local -> un dispositivo con snapshot viejo revertia datos (tipico despues de un deploy). Los datos "seed" (ejemplo) ya no pisan datos reales en una carga fresca.
- Guard del servidor: al aplicar un patch, una copia con `updatedAt` anterior no puede pisar una mas nueva.
- Envio confiable: el egreso del empleado/proveedor espera confirmacion antes de cerrar; al volver a la app o abrirla se empujan los pendientes antes de descargar; el POST de patch usa `keepalive` (se completa aunque se bloquee el celular / se cierre la pagina).
- Cache: Caddy envia `Cache-Control: no-cache, must-revalidate` para `/`, `*.html`, `*.js`, `*.css` (los deploy se aplican al recargar, sin Ctrl+F5); bump del query `?v=`. Antes los dispositivos quedaban con frontend viejo (que no sellaba `updatedAt`).
- Sidebar mobile con `100dvh` + safe-area (el boton Salir y los items siempre alcanzables).

### 12.29 Claves de sincronizacion por patch (backend) (v12.9.67, v12.9.68)
- El backend descartaba en el merge de patches las colecciones que no estaban en `ARRAY_PATCH_KEYS`, por lo que los cierres de caja de un empleado (y stockMovements, replacements, marginSections, priceAutoLog, priceAutoSchedule, holidays) no llegaban al servidor. Se agregaron todas. `priceAutoSchedule` se mergea por `productId`. Paridad verificada front/back (36 claves).

### 12.30 Facturacion, WhatsApp e Inicio del cliente (v12.9.52 a v12.9.55)
- TusFacturas: prioridad a los datos de AFIP (solo el CUIT se toma de lo cargado a mano); `condicion_pago` forzado a "205" (cuenta corriente).
- Interruptores de mailing / WhatsApp / facturacion (Configuracion, gerente).
- Inicio del rol cliente: banner de feriados proximos.
- Hibrido offline: el pedido del cliente y la compra del proveedor fallan-rapido (avisan si no salieron); el resto usa indicador + advertencia.

### 12.31 Stock: control al finalizar el dia, registro y cobertura (v12.9.65, v12.9.66, v12.9.71)
- El conteo de stock es de CIERRE de dia = apertura del dia siguiente: `getStockEstimated` acumula desde el dia siguiente al ultimo conteo; la sugerencia usa el arrastre del cierre de ayer; la merma compara el cierre esperado (apertura + compras - ventas de hoy) contra lo contado. Mismo criterio en grupos/equivalencias.
- "Registro de conteos de stock por dia" en la pagina Stock (fecha, producto/grupo, cantidad, usuario; con filtro).
- Unidades: al enviar una linea se marca `item.unitAdjusted` persistente (desaparece para todos). Un producto por unidades se oculta de "pendientes" solo si el stock del dia (conteo + compras) cubre la demanda COMPLETA (producto sin faltante, o grupo con `netPool <= 0`).

### 12.32 Precios: fuente de verdad y fecha real (v12.9.72, v12.9.80, v12.9.93)
- Desvinculada la planilla -> sistema: el endpoint `/external/compra-hoy` ya NO sobreescribe precios (Sheets queda como control; reactivable con env `SHEETS_INBOUND_PRICES=on`). El sistema es la unica fuente de verdad; el sentido sistema -> planilla se mantiene.
- La actualizacion de precio por compra ya no se revierte (merge de `prices` por `updatedAt`).
- Fecha de "ultima actualizacion" real: `rec.date` solo cambia si el costo/precio cambia de verdad; la fecha mostrada = la mas reciente entre el ultimo cambio de precio y la ultima compra directa del producto (sin fallback a "hoy"). Aplica a la lista del rol cliente y a la publica.

### 12.33 Remitos: recalculo y frescura (v12.9.79, v12.9.81, v12.9.82)
- Aviso de frescura de datos en Remitos (hace cuanto se sincronizo + cambios sin enviar) con boton "Actualizar datos ahora".
- Boton "Recalcular precios de un dia" (gerente/admin): reprecia los pedidos de la fecha segun el costo de las compras de ese dia (ceil(costo x (1+margen)) x (1+ajuste% cliente), IVA por item) y actualiza saldos.
- Boton "Exportar PDF remitos de ese dia" (fecha puntual).

### 12.34 Sistema de impresion (v12.9.73, v12.9.86-88, REVERTIDO en v12.9.94)
- Checklist "Generar Imprimibles" arma UN solo documento con los 4 imprimibles (saltos de pagina) (v12.9.73, sigue vigente).
- IMPORTANTE: los cambios de impresion de v12.9.86-88 (iframe con dimensiones reales, columnas "estilo diario" con `printColumnsHtml`, cierre automatico de pestaña) se REVIRTIERON en **v12.9.94** por un problema de impresion que no se pudo resolver. Las funciones `printHtmlDocument`, `printDocumentStyles`, `renderDivideClientList`, `renderDivideProductList` volvieron al estado de v12.9.82 (iframe original, columnas con `column-count`). El resto (lista de precios, cache, fecha de precios) se mantuvo.

### 12.35 Checklist operativo del empleado (Inicio) (v12.9.63)
- Recuadro "Checklist del dia" (11 lineas). Un click ejecuta la accion y marca/tacha: Stock, Generar Imprimibles, Miriam/Mario/Chicho (copian clipboard de WhatsApp + abren wa.me), Compras, Unidades, Vehiculos, Imprimibles Vehiculos+Remitos, Pagos, Horario. Se reinicia a las 04:00.

### 12.36 Editar gastos cargados (v12.9.70)
- Boton "Editar" en Compras/Gastos: edita datos basicos (fecha, monto, caja, notas) y ajusta el egreso en Caja / la deuda del proveedor. No toca el detalle de productos ni recalcula stock/costos. Empleado/proveedor editan los suyos; gerente/admin todos (pagos a proveedor se anulan y recargan). Anti-duplicado de egreso identico en menos de un minuto.

### 12.37 Lista de precios publica (`/precios`) (v12.9.84 a v12.9.93)
- Pagina publica sin login `precios.html` servida por Caddy (`rewrite /precios /precios.html`), respaldada por el endpoint `GET /public/price-list` (sin auth).
- Formato del rol cliente: al ingresar elige Sin IVA / Con IVA (no cambiable adentro); filtro Por Mayor / Por Menor (por unidad); vista Cuadricula / Lista; chips de categorias select/deselect; buscador; imagenes reales del producto (con fallback); fecha de ultima actualizacion por producto; auto-refresh.
- "Con IVA": IVA real del producto (10,5% o 21%) + 2% de gastos bancarios (multiplicativo), mostrando solo el precio final (sin discriminar). Desactivable con `appSettings.publicPriceListEnabled = false`.

### 12.38 Parser: correcciones (v12.9.62, v12.9.64, v12.9.75)
- Sin notas basura; "maple"/"mapple" -> unidad bandeja; fracciones con espacio ("1/ 2" -> 1/2); fraccion sin unidad prefiere variante Kg (ej. "1/2 morron" -> Kg); decimales con punto ("1.5 k" -> 1,5); el punto separa tokens ("1doc." -> docena, sin match espureo); se ignoran cortesias en notas ("por favor", "gracias").
- Nuevo pedido: cambiar de cliente ya no borra el pedido; no se autoselecciona cliente por solapamiento de palabras.
- (v12.9.95) "banana unidad" ya no matchea "Anana": si el nombre-base coincide exacto, matchea ese producto aunque la unidad no exista; el match difuso por levenshtein exige misma primera letra (evita "anana"~"banana", "granada"~"naranja").

### 12.39 Facturacion: emision manual completa y correcciones (v12.9.96 a v12.9.105)
- external_reference (v12.9.96): al dividir en tandas, el sufijo " (1/2)" invalidaba la referencia (espacios/parentesis/barra). Se usa sufijo seguro "-N-M" y se sanea a [A-Za-z0-9_-].
- Boton "Emitir manual" en Facturacion (gerente/admin/contador): modal para emitir la factura de un cliente eligiendo fecha del comprobante, periodo desde/hasta, VENCIMIENTO (no anterior a hoy; AFIP lo rechaza), CONCEPTO (1 productos / 2 servicios / 3 ambos) y MONTO total editable con IVA (10,5/21) y neto en vivo.
  - Si se edita el monto, se emite un comprobante de UN renglon ("Productos y servicios") por ese importe (`applyAmountOverride`) => no se divide en tandas.
  - PUNTO DE VENTA editable (se envia con ceros a la izquierda, ej. 00004).
  - USERTOKEN por punto de venta: campo opcional en el modal, o configuracion persistente en .env por PDV: `TUSFACTURAS_PV<N>_USERTOKEN` (+ opcional `_APIKEY` / `_APITOKEN`), o el JSON `TUSFACTURAS_PV_CREDS`. Prioridad: modal > .env por PDV > cuenta por defecto. (apikey/apitoken suelen ser de la cuenta; el usertoken puede diferir por PDV.)
  - INDEPENDIENTE de "due" (v12.9.105): la emision manual arma la factura del cliente para el periodo elegido con `buildPeriod`, sin depender del calendario ni de si ya se facturo (permite re-emitir; el confirm es el resguardo contra duplicados AFIP).
- Backend: `buildInvoicePayload`/`runBilling`/`/billing/run` aceptan `overrides` (fecha, vencimiento, periodo, concepto, puntoVenta, credenciales, customNeto/customAlicuota) y `manual`.
- Historial de emisiones con selector 30 / 60 / 120 / Todas (`ui.billingLogLimit`).

### 12.40 Reversion de impresion (v12.9.94)
- Ver 12.34: las funciones de impresion volvieron al estado de v12.9.82. `deploy.sh` y `deploy-vps.sh` quedaron marcados como ejecutables (100755) para evitar "Permission denied" tras `git pull`.

### 12.41 Ids globalmente unicos, alias borrables y parser "banana" (v12.9.106 a v12.9.108)
- **Fix critico de ids (v12.9.106):** `nextProductId` generaba `"PROD-" + (products.length + 1)` y solo verificaba colisiones contra los productos cargados en ESE dispositivo. Con estado local incompleto o con huecos por borrados, dos dispositivos podian crear productos distintos con el mismo id y el merge por id se quedaba con uno solo (el otro "desaparecia" de Productos, aunque seguia referenciado en compras/Dividir por `productId`/`productName`). Ahora los ids de **producto y proveedor** son globalmente unicos (`PROD-`/`PROV-` + tiempo en base36 + aleatorio) con verificacion de colision. No recupera productos ya perdidos: hay que volver a crearlos.
- **Borrar alias (v12.9.107):** el modal "Ver alias" (Nuevo Pedido) solo permitia agregar. Se agrego boton de borrado (gerente/admin) en "Todos los alias cargados", para alias generales (`productAliases`) y por cliente (`clientProductAliases`). Origen del caso "banana -> Anana": un alias corrupto, probablemente heredado de la colision de ids.
- **Parser (v12.9.108):** guarda de primera letra en `parsedBaseEquivalent`, de modo que "banana" ya no matchea el producto activo "Anana" por equivalencia de nombre-base. Complementa el fix de v12.9.95 (levenshtein con misma primera letra).

### 12.42 Precio "Al Costo" y cargo de "Envio" por cliente (v12.9.109, v12.9.110)
- **Tier `al_costo`:** nuevo valor de `client.priceTier` (junto a `general` / `preferencial` / `con_factura`). El precio base del item pasa a ser el **costo** del producto (`state.prices[id].cost`, con fallback a `product.baseCost`) en lugar del precio de lista, y sobre el se aplica el `priceAdjustmentPct` del cliente.
- **Cargo de envio:** campo `client.shippingFee` ($ fijo; 0 = sin envio). Al crear el pedido el importe se **sella** en `order.shippingFee` (no se toma del cliente al re-renderizar) y aparece como renglon "Envio" en el remito.
- **IVA del envio (v12.9.110):** si el cliente factura (`priceTier === "con_factura"` o `needsInvoice`), el envio lleva **IVA 10,5%**; la tasa aplicada se sella en `order.shippingIvaRate` (0 si el cliente no factura). El total del pedido pasa a ser `subtotal + IVA de items + IVA del envio + envio`.
- **Backend (`billing.js`):** `buildGroupedItems` agrega el renglon "Envio" (codigo `ENVIO`, cantidad 1, alicuota `order.shippingIvaRate` con default 10,5) a la factura AFIP/TusFacturas.

### 12.43 OCR de fotos de pedidos: proveedores y diccionario de correcciones (v12.9.112 a v12.9.115)
- `POST /ocr/order-image` (gerente/admin/empleado) transcribe la foto de un pedido manuscrito. La cadena de proveedores se prueba en orden y gana el primero que responde:
  1. **Google Cloud Vision** (v12.9.113, proveedor principal): `POST /v1/images:annotate` con `DOCUMENT_TEXT_DETECTION`, autenticado por API key (`GOOGLE_VISION_API_KEY`), leyendo `fullTextAnnotation.text`. Elegido por su mejor desempeno con **manuscrito**.
  2. OpenRouter (`OPENROUTER_VISION_MODEL`, por defecto `openai/gpt-4o-mini`).
  3. Moonshot/Kimi (`MOONSHOT_VISION_MODEL`).
  La respuesta incluye `provider` para saber cual respondio. El endpoint devuelve 503 solo si no hay ninguna de las tres claves.
- **Hint de caligrafia (v12.9.114):** `GOOGLE_VISION_LANG` por defecto `es-t-i0-handwrit` (`languageHints`); vacio = deteccion automatica.
- **Historial del proveedor:** v12.9.112 habia puesto NVIDIA Nemotron OCR v2 como principal; se **reemplazo** por Google Vision en v12.9.113.
- **Diccionario de correcciones (v12.9.115):** `state.ocrCorrections` (`{id, from, to}`), editable desde Configuracion -> "Prompt de IA (lectura de imagen)" -> "Correcciones de lectura (OCR)" (gerente/admin). Los reemplazos se aplican al texto de la foto **antes** de la limpieza por vocabulario y del parser, con limite de palabra (no reemplaza dentro de otra palabra) y sin distinguir mayusculas. Clave sincronizada (`ARRAY_PATCH_KEYS` / `PATCH_ARRAY_KEYS`).
- Variables nuevas en `.env.example`: `GOOGLE_VISION_API_KEY`, `GOOGLE_VISION_URL`, `GOOGLE_VISION_LANG`, `OPENROUTER_API_KEY`, `OPENROUTER_VISION_MODEL`, `MOONSHOT_API_KEY`, `MOONSHOT_VISION_MODEL`.

### 12.44 Cumplimiento de empleados y rendicion de entregas (v12.9.116)
- **Checklist persistido:** el checklist diario del empleado (11 pasos, ver 12.35) dejo de ser local (`ui.employeeChecklist`) y pasa a `state.checklistLog` (`{id, dayKey, userId, userName, key, at}`), sincronizado y con retencion de ~60 dias. El panel de Inicio y el boton "Reiniciar" leen/escriben en el log.
- **Pagina "Cumplimiento"** (`#/cumplimiento`, gerente/admin): para el dia elegido (`ui.complianceDate`) muestra por empleado activo cuantos pasos completo (X/11), cuales faltan y un semaforo (verde = todo, amarillo = parcial, rojo = nada).
- **Rendicion de entregas:** todo pedido "entregado" debe quedar rendido, con pago cargado O con foto del remito firmado (`orderIsSettled`: `paid` / `paymentReceived > 0` / foto). Modal "Rendir entrega" desde la fila de Pedidos: lleva a cargar el pago o permite subir/reemplazar/quitar la foto, guardada comprimida en `order.deliveryRemitoPhoto` (base64, ~1100px, calidad 0,6). No bloquea la entrega; los pendientes se listan en "Cumplimiento — Entregas del dia (X/Y rendidas)".
- Backend: `checklistLog` agregado a las claves de sincronizacion por patch.

### 12.45 Dividir Compras: pedidos puntuales, dia y notas (v12.9.111, v12.9.117, v12.9.118)
- **Seleccion de pedidos puntuales (v12.9.111):** ademas del dia completo, se pueden tildar pedidos concretos (`ui.divideSelectedOrders`, helper `getDivideSelectedOrderIds`) para ver su division fuera del horario habitual. Alcanza a pantalla, PDF y texto de WhatsApp; la fecha del titulo sale de `getDivideContextDate()` (la de los pedidos elegidos) y no de "hoy".
- **Picker (v12.9.117):** cada fila muestra "ORD-... · numero - nombre de cliente · fecha · N item(s)" y se agrego un selector "Dia de los pedidos" (`ui.divideCandidateDate`, HOY por defecto), en lugar de la ventana fija ayer/+3 dias. Los ya tildados se conservan aunque sean de otro dia.
- **Notas por item (v12.9.118):** las notas del item ahora tambien salen en la vista "Agrupado por producto" (`divideNotesText`), entre parentesis y sin la palabra "nota" (ej. `35) 2 (maduro)`), en pantalla, PDF y WhatsApp. En "Agrupado por cliente" y en los PDF de Vehiculos ya se mostraban.

### 12.46 Nuevo Pedido: borrador de WhatsApp y alta de producto (v12.9.118, v12.9.119)
- **Boton "Nuevo producto" (v12.9.118):** junto a "Ver alias" / "Subir imagen"; abre `openProductForm` y al guardar deja el producto disponible sin salir de la pagina.
- **Borrador persistente (v12.9.119):** el texto pegado en "Pegar pedido de WhatsApp" se guarda en `ui.orderWhatsappDraft` (en cada tecla y al leer una imagen por OCR) y el textarea se renderiza con ese valor, de modo que sobrevive a cualquier `render()` — antes se vaciaba al vincular alias o abrir "Ver alias". Se limpia solo al crear el pedido.

### 12.47 Proveedores: saldo real, devoluciones y carga por proveedor (v12.9.123)

**Saldo de proveedor (fix de un saldo mas BAJO que el real).** Dos causas, las dos corregidas:
- Al anular un "Pago a Proveedor", `annulPurchase` revertia la caja pero no el movimiento negativo que el pago habia dejado en `providerLedger`: la deuda quedaba descontada por un pago inexistente. Ahora la anulacion compensa ese movimiento (`provider_payment_annul`) y marca el pago como `anulado`.
- El saldo salia solo de `providerLedger`, mientras que el resumen de cuenta (`getProviderMovements`) tambien lista compras en cuenta corriente sin movimiento asociado (importaciones, API externa / bot). `getProviderDebtMap()` calcula ahora, en UNA pasada para todos los proveedores, `providerLedger` + esas compras en cuenta corriente huerfanas (excluyendo las anuladas); `getProviderBalance(id, mapa)` y `getProviderBalances()` lo consumen.
- En el resumen de cuenta los movimientos que vienen de una compra muestran "-" en la columna Saldo (no tienen snapshot), en vez de "$0".

**Devolucion a proveedor (`expenseType: "provider_return"`, ids `DEV-...`).** Nuevo tipo de egreso en Compras y Gastos:
- Se elige proveedor y, opcionalmente, la compra original (`returnOfPurchaseId`); al elegirla se cargan sus productos con el costo al que se compraron (`loadPurchaseLinesFromSource`).
- "Como se compensa" reutiliza `paymentStatus`: `account_current` baja la deuda (movimiento `devolucion` negativo en `providerLedger`) y `paid` genera un INGRESO en la caja elegida.
- Se guarda como egreso NEGATIVO (`totalCost` y `items[].quantity` en negativo), de modo que toda metrica que ya suma compras la resta sin cambios adicionales: gastos por dia del dashboard, `getPerformanceSummary` / `getPerformanceExpenseRows`, historial de compras por producto y `getPurchasedQuantities`.
- Stock: `recordStockPurchaseMovements` acepta cantidades negativas para este tipo y registra el movimiento como `compra` en negativo (`stockComprasBetween` lo neutraliza), incluida la relacion mayorista -> minorista.
- Anulacion: devuelve la deuda o saca de la caja la plata que habia entrado. La edicion basica de importe esta bloqueada para devoluciones (como para los pagos a proveedor), para no invertir el signo del movimiento.

**Compras y Gastos - "Cargar productos".** Con un proveedor (o empleado) elegido, carga una fila por cada producto asignado (`productsSupplied` / `assignedTo*`) con el ultimo costo (`getStoredProductCost`) y la cantidad que falta comprar hoy; primero los pendientes, sin duplicar los ya cargados (`purchaseProductsForAssignee`, `loadPurchaseLinesForAssignee`).

### 12.48 Peso del estado y arranque (v12.9.123)
- **Causa de la lentitud:** el estado viaja y se guarda como UN solo JSON, y adentro lleva imagenes en base64 (`products[].imageData`, `orders[].deliveryRemitoPhoto.data`, comprobantes de egresos, pagos y transferencias). El texto (pedidos, saldos, caja) comprime bien con el gzip de Caddy; el base64 no. Por eso el peso lo dominan las imagenes, no el historico.
- `saveState()` hacia `JSON.stringify` de TODO el estado en cada mutacion. Ahora el snapshot local se agenda (`scheduleLocalStateSnapshot`, 1,5 s) y se fuerza con `flushLocalStateSnapshot()` antes de leerlo, al ocultar la pestania (`visibilitychange`) y al cerrar (`beforeunload` / `pagehide`).
- Backup: panel "Peso de los datos" (`measureStateWeight`) con el peso por seccion y el detalle de cuanto son imagenes; boton "Optimizar fotos de producto" (`recompressDataUrl` a 400px) y "Borrar fotos de remito viejas" (mas de 60 dias). Las fotos nuevas de producto se comprimen a 400px (antes 700px).
- Fix de fondo (HECHO en v12.9.124, ver 12.50): las fotos de producto salieron del JSON de estado y se guardan como archivo en el servidor. Quedan adentro del estado las fotos de remito entregado y los comprobantes de egresos, pagos y transferencias, que se pueden mover igual mas adelante.

### 12.49 Dividir Compras: unidades y formato de cantidad (v12.9.123)
- `divideItemUnit()` devuelve "" para los productos `allowUnitWeight` (por unidad, cobrados por peso): en Dividir la cantidad son unidades y mostrar su `unitType` ("kg") confundia. Los remitos no usan esta funcion, asi que ahi el kg se sigue mostrando siempre.
- `divideQtyLabel(cantidad, unidad)` arma la etiqueta sin espacios sobrantes y con el formato de `formatDivideQty`: enteros sin decimal ("1", no "1,0") y coma solo cuando hace falta ("1,5"). Se usa en la tabla de asignacion, en las vistas por producto y por cliente, en el PDF y en el texto de WhatsApp.

### 12.50 Fotos de producto fuera del estado (v12.9.124)

Es el fix de fondo que quedaba pendiente en 12.48: el arranque bajaba las fotos en base64 dentro del JSON de estado, en cada dispositivo y cada vez.

- **Modelo:** `product.imageKey` guarda la referencia al archivo en el servidor. `imageData` (base64) queda como legado y sigue funcionando; `productThumb()` resuelve en este orden: `imageKey` -> `imageData` -> `imageUrl` -> placeholder SVG.
- **Backend:** `POST /product-images` guarda el archivo en `UPLOAD_DIR` (volumen Docker `uploads`, el mismo de los comprobantes) e inserta la fila en `proofs` con la columna nueva `public_read = TRUE`. `GET /public/product-image/:key` la sirve sin login y con cache inmutable, solo para filas publicas; los comprobantes de pagos y transferencias siguen con `GET /proofs/:key` autenticado.
- **Frontend:** `uploadProductImage(dataUrl)` sube los bytes (no base64) con el content-type real. Al guardar un producto con foto se sube sola; si falla o no hay servidor, la foto queda en `imageData` y no se pierde nada.
- **Migracion:** Backup -> "Peso de los datos" -> "Mover fotos de producto al servidor" recomprime a 400px, sube y limpia `imageData` de cada producto, informando cuantas quedaron pendientes. El panel muestra cuantas fotos estan en el servidor y cuantas siguen en el estado.
- **Lista publica:** `/public/price-list` devuelve `/api/public/product-image/<clave>` cuando el producto tiene `imageKey` (antes mandaba el base64 completo en la respuesta).
- **Nota operativa:** al reemplazar la foto de un producto, el archivo anterior queda en el volumen (no se borra, para no romper dispositivos que todavia no sincronizaron). El volumen `uploads` deberia entrar en el backup del VPS.
- **Deploy:** requiere `./deploy.sh` (server.js, schema.sql y docker-compose.yml). La columna `public_read` se crea sola al arrancar.

### 12.51 Correccion de despliegue: variables de Google Vision (v12.9.124)
- `docker-compose.yml` no le pasaba a la API las variables `GOOGLE_VISION_API_KEY` / `GOOGLE_VISION_URL` / `GOOGLE_VISION_LANG` que `server.js` lee desde v12.9.113: estaban documentadas en `.env.example` pero no llegaban al contenedor, asi que el OCR con Google Vision no podia activarse en produccion. Ya se pasan.

### 12.52 Todos los adjuntos fuera del estado (v12.9.125)

Completa 12.50: ningun archivo subido queda ya en base64 adentro del JSON de estado.

| Coleccion | Campo viejo (base64, legado) | Campo nuevo (referencia) | Ruta |
|---|---|---|---|
| `purchases` | `proofFile` | `proofKey` | `/proofs` (privado) |
| `payments` | `transferProofFile` | `transferProofKey` | `/proofs` (privado) |
| `clientTransfers` | `proofFile` | `proofKey` | `/proofs` (privado) |
| `orders` | `deliveryRemitoPhoto.data` | `deliveryRemitoPhoto.key` | `/proofs` (privado) |
| `replacements` | `items[].photo` | `items[].photoKey` | `/proofs` (privado) |
| `products` | `imageData` | `imageKey` | `/public/product-image` (publico) |

- **Helpers:** `uploadPrivateFile(dataUrl, nombre)` sube los bytes a `POST /proofs` y devuelve la clave; `proofObjectUrl(key)` descarga con login y cachea una URL temporal (`Map` por clave); `proofImageTag(key, dataUrl, attrs)` dibuja el `<img>` (con `data-proof-key` cuando hay que resolverlo) y `bindProofImages()` los resuelve al final de cada `render()`; `openProofViewer(key, dataUrl, titulo)` abre el visor (imagen o PDF) con descarga.
- **Compatibilidad:** todos los campos viejos en base64 se siguen leyendo y mostrando. La migracion es opcional y reintentable.
- **Migracion:** `pendingAttachments()` arma el inventario de lo que sigue adentro del estado (con como leerlo, como escribir la clave y como limpiarlo) y `migrateAttachmentsToServer()` lo sube todo. Boton "Mover todos los archivos al servidor" en Backup -> "Peso de los datos". Lo que falla queda intacto para reintentar.
- **Sin cambios de backend:** usa el `POST /proofs` / `GET /proofs/:key` que ya existian.
- **Operacion:** el volumen Docker `uploads` pasa a ser critico para el backup del VPS (estos archivos ya no viajan en el `pg_dump` del estado). Limitacion preexistente: `GET /proofs/:key` sirve el archivo a cualquier usuario logueado que conozca la clave; las claves no son adivinables, pero si se quiere control por rol hay que agregarlo en el endpoint.

### 12.53 Analisis de ganancia real (v12.9.120)
- Nueva pagina "Ganancias" (gerente/admin, `renderProfit`): ganancia por producto y por cliente en un rango de fechas, con cantidad/pedidos, ventas, costo, ganancia y margen % (semaforo), mas tarjetas de total.
- `computeProfitAnalysis(desde, hasta)` valua cada item vendido con el COSTO REAL del dia de la compra (`getDayPurchaseCosts`, con fallback al costo guardado del producto). Estado del rango en `ui.profitFrom` / `ui.profitTo`, con atajos "Ult. 30 dias" y "Este mes".
- Nota de v12.9.123: las devoluciones a proveedor quedaron EXCLUIDAS de `getDayPurchaseCosts` y de `getProductLastPriceUpdate` (y del `EXCL_P` del backend). Una devolucion no es una senal de precio: si entrara, pisaria el costo del dia usado por esta pagina y por el repricing de Remitos. Si sigue restando en las cantidades compradas y en los gastos, que es lo correcto.

### 12.54 Alias: alta de producto desde el pop-up (v12.9.121)
- En el pop-up de productos no reconocidos (Nuevo Pedido) se agrego "Agregar producto nuevo", que abre el alta de producto sin salir de la pantalla. Complementa el boton "Nuevo producto" de v12.9.118.

### 12.55 Super usuario: cliente padre con saldos consolidados (v12.9.122)
- Nuevo campo `client.parentClientId` (un nivel): un cliente "hijo" apunta a su "padre". Se elige en la ficha del cliente ("Cliente padre (consolida saldos)").
- Helpers: `getChildClientIds(padre)`, `getClientGroupIds(clienteId)`, `getClientGroupBalance(clienteId)` e `isParentClient(clienteId)`.
- El usuario del cliente padre ve los saldos consolidados del grupo y puede operar por cada cuenta hija: `getCustomerVisibleClientIds` se expande con el grupo.

### 12.56 Vista rapida: estado por ventana de fechas (v12.9.126)

El cuello de botella despues de sacar las imagenes era el TEXTO historico: pedidos 61% del estado (la mitad del total son `items[]`), compras 13%, saldos 12%, caja 10%.

- **`buildWindowedState(data, preset)`** recorta por fecha las 21 colecciones transaccionales (`WINDOW_COLLECTIONS`) segun el preset, y agrega filas de **apertura** (`__opening: true`) con el acumulado anterior al corte: una por cliente en `saldos`, una por caja en `caja` y una por proveedor en `providerLedger`. Como el codigo del cliente calcula esos saldos sumando el array, **el resultado es identico** sin cambiar una sola funcion de calculo. Los pedidos y compras anteriores a `itemsOrders`/`itemsPurchases` dias viajan con `items: []` + `itemsCount` + `__itemsStripped`.
- **Presets** (`STATE_WINDOW_PRESETS`, env `STATE_WINDOW_PRESET`, por defecto `liviano`): liviano 2,29 MB / equilibrado 3,82 MB / conservador 6,76 MB, sobre un estado de prueba de 32,45 MB. `GET /state?window=full` devuelve todo.
- **`mergeWindowedState(stored, incoming)`** protege el historial en `PUT /state`: conserva las filas que quedaron afuera de la ventana del cliente y recupera de lo guardado los `items[]` que no viajaron. Tambien quita las filas de apertura (`stripOpeningRows`), que son un resumen y nunca datos reales.
- **`applyArrayPatch`** ignora los borrados de filas anteriores a `MAX_WINDOW_DAYS` (150 dias) en las colecciones con ventana: ningun dispositivo con vista rapida las tiene cargadas, asi que un borrado ahi solo puede venir de un desfasaje. El upsert de filas viejas sigue permitido.
- **Cliente:** `stateWindow` guarda lo que informa el servidor; `isWindowedState()` / `windowCutoff()` alimentan el aviso azul y `loadFullHistory()` baja todo (`?window=full`). La guarda `localStateIsNewerOrRicher` se saltea con payload de ventana (compara cantidad de filas y bloquearia la sincronizacion para siempre). El backup avisa antes de exportar una vista recortada.
- **Medicion:** 32,45 MB -> 2,29 MB de JSON; 1580 KB -> 131 KB por la red (gzip); carga estimada en 4G lento 12,6 s -> 0,8 s.

---

---

## 13. Ultimo Cambio y Version

**Version operativa:** 12.9.126
**Fecha:** 2026-09-04
**Rama:** `master` (repositorio `mjakulica/pare-carrito`)
**Entorno:** VPS productivo `/opt/pare-carrito` con frontend estatico servido por Caddy y API Docker Compose. Frontend `sistema.parecarrito.com.ar`, API en `/api`, lista de precios publica en `/precios`.

### Cambios que venian de master (v12.9.120 a v12.9.122)

Ver secciones 12.53 a 12.55: pagina "Ganancias" (ganancia real por producto y cliente), boton "Agregar producto nuevo" en el pop-up de alias, y super usuario (cliente padre con saldos consolidados). Se numeraron 120-122 en paralelo a los cambios de esta rama, que quedaron renumerados 123-125.

### Detalle del ultimo cambio (v12.9.126)

- Vista rapida: el servidor manda una ventana de dias en vez del historial completo (32,45 MB -> 2,29 MB; 1580 KB -> 131 KB por la red), con filas de apertura para que los saldos sigan siendo exactos. El historial completo queda en el servidor y se pide con un boton. **Requiere `./deploy.sh`.**

### Cambios de v12.9.125

- Todo lo que se sube (comprobantes de egresos, pagos y transferencias, fotos de remito y de recambio) sale del JSON de estado y se guarda como archivo en el servidor, igual que las fotos de producto en v12.9.124. Lo nuevo se sube solo; lo viejo se migra con un boton en Backup. Solo frontend (`git pull`).

### Cambios de v12.9.124

- Las fotos de producto salen del JSON de estado: se guardan como archivo en el servidor (`product.imageKey`) y se sirven publicas y cacheadas. Las nuevas se suben solas; las que ya estaban se migran desde Backup con un boton.
- `docker-compose.yml` ahora le pasa a la API las variables de Google Vision.
- **Requiere `./deploy.sh`** + `git pull`.

### Cambios de v12.9.123

- Proveedores: el saldo ya no queda por debajo del real (anulacion de pagos + compras en cuenta corriente sin movimiento en el ledger).
- Nuevo tipo de egreso "Devolución a proveedor", que descuenta deuda o devuelve plata a la caja y resta en todas las metricas y en el stock.
- Compras y Gastos: boton "Cargar productos" para traer todos los productos de un proveedor y editar costo y cantidad de una vez.
- Dividir Compras: los enteros se muestran sin ",0" y los productos por unidad ya no dicen "kg".
- Arranque y respuesta: snapshot local diferido, panel de peso de datos y herramientas para bajar el peso de las imagenes.
- Solo frontend: `git pull`.

### Rango de cambios recientes documentados (v12.9.106 a v12.9.123)

Ver tambien 12.47 y 12.48 (v12.9.123: saldo de proveedores, devoluciones, carga por proveedor, peso del estado).

Resumen por tema del rango v12.9.106-119 (secciones 12.41 a 12.46):
- **Datos / sincronizacion (v12.9.106):** ids de producto y proveedor globalmente unicos; corrige la desaparicion de productos en el merge entre dispositivos.
- **Alias y parser (v12.9.107, v12.9.108):** alias borrables desde "Ver alias"; guarda de primera letra en el match por nombre-base ("banana" ya no cae en "Anana").
- **Clientes y facturacion (v12.9.109, v12.9.110):** tier de precio "Al Costo"; cargo de "Envio" sellado en el pedido, con IVA 10,5% si el cliente factura y renglon "Envio" en la factura AFIP.
- **OCR (v12.9.112 a v12.9.115):** Google Cloud Vision como proveedor principal (con hint de caligrafia) y respaldos OpenRouter/Moonshot; diccionario editable de correcciones de lectura (`state.ocrCorrections`).
- **Operacion diaria (v12.9.116):** checklist del empleado persistido y sincronizado (`state.checklistLog`), nueva pagina "Cumplimiento" y rendicion de entregas con foto de remito comprimida.
- **Dividir Compras (v12.9.111, v12.9.117, v12.9.118):** eleccion de pedidos puntuales con selector de dia y numero de cliente; notas por item en la vista por producto.
- **Nuevo Pedido (v12.9.118, v12.9.119):** boton "Nuevo producto" y borrador de WhatsApp que sobrevive al re-render.

### Rango anterior (v12.9.52 a v12.9.105)

Ver secciones 12.28 a 12.40. Resumen:
- Impresion: los cambios de v12.9.86-88 se REVIRTIERON a v12.9.82 en v12.9.94.
- Parser: "banana unidad" ya no matchea "Anana" (v12.9.95).
- Facturacion (v12.9.96-105): fix de external_reference al dividir en tandas; emision manual con fecha/periodo/vencimiento/concepto/monto editables, punto de venta y usertoken por PDV, e independiente de "due"; selector 30/60/120/Todas en el historial.
- Backup (v12.9.99): `pg_dump` excluye `state_history`/`state_operations` + `gzip -1`; retencion 200->30.
- Ops: `deploy.sh` marcado ejecutable (100755).
- Sincronizacion robusta, stock, precios (fuente de verdad y fecha real), checklist del empleado, editar gastos y lista de precios publica `/precios`: ver 12.28 a 12.38.

### Deploy

- Frontend (`assets/app.js`, `styles.css`, `index.html`, `precios.html`): `git pull` en el VPS (Caddy sirve estatico; con `Cache-Control: no-cache` el cambio se aplica al recargar). Conviene Ctrl+F5 la primera vez.
- Backend (`pare-carrito-sas-server/`, incluido `Caddyfile`, `server.js`, `billing.js`): `./deploy.sh` (rebuild de contenedores).
- Cambios recientes que **requieren `./deploy.sh`**: v12.9.110 (renglon "Envio" en `billing.js`), v12.9.112-115 (OCR: `server.js` + nuevas variables de entorno) y v12.9.116 (clave de sync `checklistLog`). El resto del rango es solo frontend.
- No se registran credenciales en este documento ni en el historial.
