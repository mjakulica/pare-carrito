# Historial de Cambios — Pare Carrito SAS ERP

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

### Backend / Scheduler (`pare-carrito-sas-server/src/server.js`)

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
