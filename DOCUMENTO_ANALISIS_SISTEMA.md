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
| `clients` | Clientes | `id`, `name`, `address`, `phone`, `email`, `paymentType`, `priceTier`, `priceAdjustmentPct`, `needsInvoice`, `cuit`, `legalName`, `invoiceType`, `invoiceFrequency`, `vehicleId`, `zone`, `isActive` |
| `products` | Productos | `id`, `name`, `category`, `unitType`, `baseCost`, `salePrice`, `ivaType`, `assignedToType`, `assignedToId`, `isActive` |
| `vehicles` | Vehículos de reparto | `id`, `name`, `type`, `driverName`, `capacity`, `isActive` |
| `providers` | Proveedores | `id`, `name`, `contactName`, `paymentTerms`, `defaultMargin`, `productsSupplied`, `isActive` |
| `orders` | Pedidos | `id`, `date`, `clientId`, `deliveryVehicleId`, `status`, `subtotalAmount`, `ivaAmount`, `totalAmount`, `paymentReceived`, `items[]`, `userId`, `createdAt` |
| `purchases` | Compras y gastos | `id`, `date`, `expenseType`, `providerId`, `providerName`, `totalCost`, `paymentStatus`, `recordedBy`, `items[]` |
| `payments` | Pagos recibidos | `id`, `date`, `clientId`, `amount`, `method`, `receivedByUserId`, `orderIds` |
| `saldos` | Cuenta corriente cliente | `id`, `date`, `clientId`, `type`, `description`, `amount`, `balance`, `relatedEntityId`, `relatedEntityType` |
| `caja` | Movimientos de caja | `id`, `date`, `type`, `concept`, `amountIngreso`, `amountEgreso`, `cashBoxId`, `relatedEntityId`, `relatedEntityType` |
| `providerLedger` | Cuenta corriente proveedor | movimientos de deuda/pago con proveedores |
| `clientTransfers` | Transferencias de clientes | `id`, `clientId`, `amount`, `status`, `createdByUserId`, `timestamp`, `reviewedBy` |
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
2. Al modificar datos, `saveState()` persiste en `localStorage`.
3. Si sync cloud está activo, `cloudPush()` envía `PUT /state` con `baseUpdatedAt`.
4. Backend bloquea la fila `app_state`; detecta conflictos (409) si `baseUpdatedAt` no coincide.
5. Al guardar, actualiza `updated_at`, `state_history`, espejo relacional y sincroniza usuarios.

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
5. Consulta los datos oficiales del contribuyente en ARCA a través del endpoint `clientes/afip-info` de TusFacturasAPP (razón social, domicilio, provincia y condición impositiva) y los utiliza en el payload del cliente. Si la consulta no está habilitada o falla, se conservan los datos del ERP como fallback.
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
| GET | `/proofs/:key` | Cualquier logueado | Descargar comprobante |
| GET | `/reports/sales` | manager, admin | Ventas vs gastos por día |
| GET | `/reports/top-products` | manager, admin | Top productos |
| GET | `/reports/top-clients` | manager, admin | Top clientes |
| GET | `/exports/orders.csv` | manager, admin | CSV de pedidos |
| GET | `/exports/backup.json` | manager | Backup completo JSON |
| GET | `/billing/status` | manager, admin, contador | Vista previa facturación |
| POST | `/billing/run` | manager | Ejecutar facturación manual/simulada |
| GET/POST | `/external/*` | API key (`x-api-key`) | API externa para integraciones |
| POST | `/external/transfers/:id/:action` | API key | Aprobar/rechazar transferencia |

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
- **History**: PostgreSQL conserva las últimas 50 versiones en `state_history`.

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

## 12. Modulos y subsistemas agregados (2026-06-26 a 2026-07-01)

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

### 12.14 Modelo de datos agregado
- `client.paymentDay`; coleccion `state.replacements` (recambios/reposiciones); `user.providerId` (vinculo del rol proveedor); appSettings: dunning (`dunningEnabled`, `dunningWhatsappMessage`, `dunningMailMessage`, `dunningWhatsappTemplate`) y aviso de cambios (`orderChangeNotifyEnabled`, `orderChangeMessage`, `orderChangeTemplateName`); `purchase.proofFile` (comprobante), tipo de gasto `freight`.

---

## 13. Ultimo Cambio y Version

**Version operativa:** 12.9.22
**Fecha:** 2026-06-30
**Commit GitHub del cambio funcional:** `7fc43f2`
**Entorno actualizado:** VPS productivo `/opt/pare-carrito` con frontend estatico y API Docker Compose saludable.

### Detalle del ultimo cambio

- Parser: match por palabra completa (no substring), "Palta 1kg" -> Palta Madura Kg, bonus por unidad en el nombre (`e73afc6`). Dividir: agrupa resolviendo producto por nombre (suma Menta sin productId) (`e73afc6`). Orden de productos agrupa variantes (`e73afc6`). Sheets: cantidades decimales como numero sin "uni" (`64e272c`).
- (Previo) Parser: resolver que no pela palabras discriminantes (tomate cherry), "N kg y medio" -> N,5, zuccini -> zukini (`44d5398`). Dividir: suma por unidad canonica (Huevos Maple, Remolacha atado) y "agrupado por cliente" en 3 columnas a 10px (`d8522fb`). Vehiculos: sin hoja vacia inicial, N de orden arriba y total al final, 3 columnas a 10px (`5618a29`). Sheets: cliente como "NNN) Nombre" (`602c7c6`).
- (Previo) Facturacion: popup de pedidos que acumulan IVA con impresion de remitos y "Imprimir todo", y envio automatico por correo (PDF de detalle + factura de TusFacturas) a clientes semanal/quincenal/mensual. Commits `9bac557`, `5e00f18`.
- (Previo) Correcciones del parser de pedidos para casos reales (#19/#30/#48): cantidad por defecto 1, `un poquito`->0,2, `pimiento`->`morron`, `aji molido`->`en polvo`, `queso de cabra` por nombre completo, `x <unidad>` como unidad y descarte de matches debiles. Commit `e579ded`.
- Remitos con interlineado minimo legible. Commit `78be0a0`.
- Dividir compras: agrupado por nombre (fusiona duplicados, separa los que se perdian), total por producto en pantalla/PDF/WhatsApp, numeros de cliente sin ceros y cantidades enteras, y export de WhatsApp respetando el toggle de cliente. Commit `adaee20`.
- Estos cambios son de frontend (`assets/app.js`); el deploy de frontend no requiere rebuild de la API (solo `git pull` en el VPS). Los cambios de backend/billing previos (`4f73e53`) si requieren `./deploy.sh`.
- No se registraron credenciales en este documento ni en el historial.

### Backups asociados

- PC post-cambio: `auditoria/repo-backup-20260624-post-sync-parser-merge.zip`.
- VPS pre-deploy: `pare-carrito-code-pre-sync-parser-merge-retry_20260624_104900.tar.gz`.
- VPS post-deploy: `pare-carrito-code-post-sync-parser-merge_20260624_104900.tar.gz`.
