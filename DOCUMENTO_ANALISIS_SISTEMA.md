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

### 11.4 Sincronizacion offline

El frontend mantiene una cola local de parches pendientes. Cada parche incluye `operationId`, `baseUpdatedAt` y los registros modificados.

- Si no hay conexion, el cambio queda pendiente y se reintenta al volver internet.
- Si el servidor tiene una version distinta, responde conflicto y el cliente no pisa datos silenciosamente.
- Si se reintenta una operacion ya aplicada, `state_operations.operation_id` evita duplicados.
- El servidor sigue siendo la fuente de verdad.

---

## 12. Ultimo Cambio y Version

**Version operativa:** 12.8.17  
**Fecha:** 2026-06-21  
**Commit GitHub del cambio funcional:** `c4095ad28c73b082d9f450de115946922f9d33e2`  
**Entorno actualizado:** VPS productivo `/opt/pare-carrito` con Docker Compose (`api`, `caddy`, `db`).

### Detalle del ultimo cambio

- La impresion de `Historiales` se genera en un documento temporal propio, en hoja A4 horizontal y con margen minimo.
- Los botones de impresion de compras y ventas imprimen solo el recuadro correspondiente; el boton general imprime solo ambos cuadros de historiales.
- Los botones rapidos de rango de `Historiales` aumentan su tamano minimo para mejorar uso en desktop y mobile.
- En `Facturacion`, admin, gerente y contador pueden editar el IVA que se va a facturar por cliente antes de emitir o simular.
- En `Facturacion`, desmarcar un cliente lo excluye del envio a TusFacturas aunque este dentro de los pendientes del dia/rango.
- El backend `/billing/run` acepta `ivaOverrides` por cliente, recalcula la alicuota efectiva y registra `manualIvaOverride` en `billingLog`.
- En `Proveedores`, `PDF / Imprimir proveedor` genera impresion directa solo del recuadro de cuenta proveedor.
- En `Proveedores`, los movimientos visibles combinan `providerLedger` con compras/pagos asociados en `purchases`, evitando duplicados cuando ya existe asiento de cuenta corriente.
- Verificacion productiva: `Proveedor Generico` tiene `666` compras asociadas en `purchases` y `0` asientos en `providerLedger`; la falta de asientos explicaba que antes no aparecieran movimientos.
- No se registraron credenciales en este documento ni en el historial.

### Backups asociados

- VPS pre-cambio impresion/facturacion/proveedores: dump PostgreSQL, `app_state` y tar de `/opt/pare-carrito` generados con timestamp `20260621_115714`.
- PC pre-cambio impresion/facturacion/proveedores: `auditoria/repo-backup-20260621-1157-pre-print-billing-providers.zip`.
- VPS post-cambio impresion/facturacion/proveedores: dump PostgreSQL, `app_state` y tar de `/opt/pare-carrito` generados con timestamp `20260621_120443`.
- PC post-cambio impresion/facturacion/proveedores: `auditoria/repo-backup-20260621-1206-post-print-billing-providers.zip`.
