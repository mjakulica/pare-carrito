# Historial de Cambios — Pare Carrito SAS ERP

## v12.8.3 — Merge con origin/master (2026-06-17)

### Backend / Frontend

- Se integraron los cambios de `origin/master` (auth/welcome, anulaciones de pagos/egresos/caja, banner de usuarios inactivos, ajustes en registro).
- Se re-aplicaron los fixes locales:
  - Scheduler persistente de facturación (`BILL-008`).
  - Formulario de cliente permitiendo Factura A/B sin depender de `priceTier` `con_factura` (`CLIENT-001`).

---

## v12.8.2 — Script de deployment seguro para VPS (2026-06-17)

### DevOps / Deployment

- **DEPLOY-001 — Script `deploy-vps.sh`**
  - Se agregó `deploy-vps.sh` en la raíz del repositorio.
  - Realiza backup previo de PostgreSQL, código fuente y `app_state`.
  - Ejecuta `git pull`, `npm ci` y `docker compose up -d --build`.
  - Verifica que el API responda antes de finalizar.
  - Muestra logs del contenedor al terminar.

### Backup local

- Se generó backup local del repositorio en `C:\Users\mauri\backups-pare-carrito\`.

---

## v12.8.1 — Consulta de datos del contribuyente en ARCA (2026-06-16)

### Backend / Facturación (`pare-carrito-sas-server/src/billing.js`)

- **BILL-009 — Obtener datos del cliente desde ARCA**
  - Antes de emitir un comprobante, se consulta el endpoint `POST /app/api/v2/clientes/afip-info` de TusFacturas.app.
  - Se obtienen de ARCA: razón social, domicilio, provincia y condición impositiva.
  - Los datos oficiales se usan en el payload del cliente, con fallback a los datos del ERP si la consulta falla o no está habilitada.
  - Se mapea la condición impositiva de ARCA a los códigos de TusFacturas (`RI`, `MT`, `EX`, `CF`, `NR`, `SE`).
  - Se mapea el nombre de provincia de ARCA al código numérico requerido por la API de facturación.

### Frontend / Clientes (`lucas-pare-carrito-erp/assets/app.js`)

- **CLIENT-001 — Permitir factura A/B sin depender de `priceTier` `con_factura`**
  - El formulario de edición de cliente ya no fuerza `invoiceType = Sin Factura` ni `needsInvoice = false` cuando el `priceTier` no es `con_factura`.
  - El usuario puede seleccionar manualmente el tipo de factura y el sistema lo respeta.

---

## v12.8 — Correcciones de facturación TusFacturasAPP (2026-06-16)

### Backend / Facturación (`pare-carrito-sas-server/src/billing.js`)

- **BILL-001 — Precisión decimal robusta**
  - Se reemplazó el redondeo con `Math.round(n * 100) / 100` por `decimal.js` en todos los cálculos de facturación, eliminando errores de punto flotante en totales, netos e IVA.

- **BILL-002 — Validación de CUIT/CUIL**
  - Se agregó validación de formato (11 dígitos), prefijo válido y dígito verificador antes de emitir cualquier comprobante.
  - La facturación falla con mensaje claro si el cliente tiene un CUIT inválido.

- **BILL-003 — Timeout y reintentos**
  - Las llamadas a `https://www.tusfacturas.app/app/api/v2/facturacion/nuevo` ahora usan `AbortController` con timeout de 30 segundos.
  - Se implementó política de 3 reintentos con backoff exponencial (hasta 8 segundos).

- **BILL-004 — `external_reference` idempotente**
  - El campo `external_reference` ahora es determinista: `PC-{clientId}-{from}-{to}`.
  - En comprobantes divididos se agrega sufijo `(X/Y)`.

- **BILL-005 — Soporte para más de 130 ítems**
  - Cuando un período supera el límite de 130 ítems de TusFacturas, se divide automáticamente en múltiples comprobantes.
  - Cada comprobante parcial conserva su propio total, IVA y `external_reference`.

- **BILL-006 — Rollback/compensación ante fallos**
  - Si un comprobante de un período falla, se detiene el procesamiento de ese período.
  - Solo se registran en `billingLog` los períodos completamente exitosos; el resto del batch se cancela para evitar estados inconsistentes.

- **BILL-007 — Cálculo de IVA desde ítems**
  - El neto, IVA y total del período se recalculan desde los ítems agrupados (producto + precio unitario + alícuota + cantidad) en lugar de sumar los totales de las órdenes.

- **BILL-008 — Scheduler persistente**
  - La fecha de última ejecución (`billingLastRunDate`) se lee y guarda en `app_state.data.billingLastRunDate`.
  - Esto evita ejecuciones duplicadas o perdidas ante reinicios del contenedor.

### Dependencias

- Se agregó `decimal.js` como dependencia de producción para operaciones monetarias exactas.

### Documentación

- Se actualizó `DOCUMENTO_ANALISIS_SISTEMA.md` reflejando las mejoras en el flujo de facturación automática, los campos de `billingLog` y la dependencia `decimal.js`.

---

## v12.7 y anteriores

Ver `DOCUMENTO_ANALISIS_SISTEMA.md` para el detalle de funcionalidades hasta la versión `v12.7`.
