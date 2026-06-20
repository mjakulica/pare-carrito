# Historial de Cambios — Pare Carrito SAS ERP

## v12.8.15 - Historiales fuera del estado operativo y cola offline (2026-06-20)

### Arquitectura / Sincronizacion

- Se agrego la tabla `product_history_state` para guardar historiales canonicos de productos fuera del `app_state` operativo.
- Se agrego el endpoint `/product-history` para que la pagina `Historiales` cargue solo el rango consultado.
- Se agrego la tabla `state_operations` y el endpoint `/state/patch` para aplicar operaciones chicas con `operationId` idempotente y `baseUpdatedAt`.
- El frontend deja de transportar historiales grandes en cada guardado y usa una cola local de parches pendientes para operar offline y reintentar al volver la conexion.
- La cola pendiente se compacta contra la ultima version conocida del servidor y no pisa el VPS si hay conflicto de version.
- `app_state` queda reducido al estado operativo: clientes, pedidos, pagos, saldos, caja, compras, usuarios y configuracion.
- El backup JSON del servidor incluye tanto `app_state` como `productHistory`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.14 - Guardado robusto con estado grande en navegador (2026-06-20)

### Frontend / Sincronizacion

- Se corrigio un error al editar clientes cuando el estado completo supera la cuota de `localStorage` del navegador.
- Si `localStorage` rechaza el estado grande, el sistema ya no corta el flujo de guardado: continua con la sincronizacion al servidor.
- El modal de edicion puede cerrar correctamente despues de guardar, y los cambios quedan persistidos en el VPS.
- Tambien se protegieron escrituras locales durante descarga/merge de nube, login remoto y restauracion de backups locales.
- Commit funcional desplegado: `651c4026bf2e07a7d0cd75071392844810506736`.
- Backups VPS: pre-fix `20260620_081032`; post-fix `20260620_081211`.
- Backup PC post-fix: `auditoria/repo-backup-20260620-0814-postfix-client-save-quota.zip`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.13 - Recuperacion de pedidos historicos 2026-06-08 a 2026-06-18 (2026-06-19)

### Datos / Pedidos y saldos

- Se reproceso el tramo de pedidos historicos entre `2026-06-08` y `2026-06-18`.
- Se recuperaron 105 pedidos que habian quedado afuera por advertencias de `celdas_sueltas`.
- Se importaron 1.065 items por un total de `$8.306.220`.
- Por cada pedido recuperado se genero su movimiento de saldo tipo `pedido`, y se recalcularon los balances de los 23 clientes afectados.
- No se modificaron caja, pagos, compras ni movimientos de proveedores.
- Quedaron 8 pedidos pendientes sin importar por productos no encontrados: `Jengibre Kg` (7) y `Romero fresco atado` (1).
- Reportes generados: `pedidos_tramo_20260608_18_importados.csv`, `pedidos_tramo_20260608_18_pendientes.csv` y `pedidos_tramo_20260608_18_resumen.json`.
- Backups VPS: pre-import `20260619_225932`; post-import `20260619_231345`.
- Backup PC pre-import: `auditoria/repo-backup-20260619-2259-preimport-pedidos-20260608-18.zip`.
- Backup PC post-import: `auditoria/repo-backup-20260619-2318-postimport-pedidos-20260608-18.zip`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.12 - Conciliacion canonica de historiales de productos (2026-06-19)

### Datos / Historiales

- Se agrego una capa canonica de historiales de productos separada de pedidos, saldos y caja.
- `Hist Ventas` se importo como fuente fiel para precio historico de lista y cantidad vendida por producto/dia.
- `Hist Comp` se importo como fuente fiel para cantidad comprada y precio de compra por producto/dia.
- La pagina `Historiales` ahora prioriza esos historiales canonicos; los pedidos de cada cliente conservan el precio real cobrado en sus items.
- Se cargaron 55.082 registros de precios de lista, 25.475 registros de cantidades vendidas y 15.118 registros de compras historicas.
- La conciliacion no genero impacto financiero: no modifico caja, saldos, pagos, pedidos ni compras transaccionales.
- Se dejaron reportes de productos sin match y valores invalidos en el directorio `comparacion`.
- Commit funcional desplegado: `f4c1808f4d83b7df7d6ee4dce9e7f96bc306b5f0`.
- Backups VPS: pre-conciliacion `20260619_220702` y post-conciliacion `20260619_222149`.
- Backup PC post-conciliacion: `auditoria/repo-backup-20260619-2225-postconciliacion-historiales.zip`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.11 - Importacion de compras Lucas con egreso de caja (2026-06-19)

### Datos / Compras y caja

- Se importo el archivo `Lucas Pare Carrito - Compras Hoy (1).csv` como historico de compras y gastos pagados por Lucas.
- Se crearon 94 compras de productos con 2.994 items y 193 gastos identificados.
- Cada registro importado genero su egreso correspondiente en `Efectivo - Lucas`, por un total de $75.632.839.
- El bloque actual del 2026-06-19 cerro contra `G1`: $423.050 en productos y $109.500 en gastos, total $532.550.
- Se dejaron sin importar 186 renglones con dudas por productos/gastos no identificados o datos insuficientes; quedaron reportados en `lucas_compras_con_dudas_preview.csv`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.10 - Importacion historica de compras a proveedores (2026-06-19)

### Datos / Compras

- Se proceso `Pedidos a proveedores - Compras Hoy (1).csv` para reconstruir compras de productos con proveedor generico.
- Se importaron 572 compras agrupadas entre `2022-08-03` y `2026-06-19`.
- Se importaron 9.516 items de compra por un total de `$223.832.194,60`.
- Se creo el proveedor `Proveedor Generico` (`PROV-GENERICO`) para estas compras historicas.
- Las compras se registraron como `paymentStatus = paid` y no generaron movimientos de caja ni deuda de proveedor, para no alterar saldos financieros actuales.
- Se excluyeron 197 lineas dudosas por producto no encontrado o precio faltante.
- El detalle por cliente de la planilla se uso solo para validar cantidades y no se guardo en las compras.
- Los movimientos quedaron marcados con `importSource = compras_proveedores_csv_20260619`.
- Backups VPS: pre-import `20260619_203505` y post-import `20260619_203518` con codigo, dump PostgreSQL y `app_state`.
- Reportes generados: `compras_productos_importables_preview.csv`, `compras_productos_con_dudas_preview.csv` y `compras_importables_resumen_preview.csv`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.9 - Fecha visible en puntos de tendencias (2026-06-19)

### Frontend / Inicio

- En los graficos de `Tendencias` de la pagina de inicio para roles gerente y admin, cada punto ahora muestra fecha y valor al pasar el mouse.
- El tooltip accesible de cada punto incluye dia de semana, fecha completa y valor.
- En mobile, los puntos pueden recibir foco/tap para mostrar la misma etiqueta de fecha y valor.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.8 - Rango historico visible en saldos (2026-06-19)

### Frontend / Saldos

- Se corrigio el rango inicial de la pantalla `Saldos` para que `Desde` tome la primera fecha real de movimientos de cuenta corriente.
- El detalle `Ver movimientos` ahora incluye por defecto los pagos historicos importados de Lucas, en lugar de quedar limitado a la fecha del dia.
- Se permite dejar `Desde` vacio para consultar todo el historial disponible.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.7 - Impacto de rendicion Lucas en saldos de clientes (2026-06-19)

### Datos / Pagos y saldos

- Se actualizaron los cobros de clientes de `Lucas Pare Carrito - Rendición.csv` para que descuenten saldo de cuenta corriente.
- Se mantuvo el mismo rango validado de pedidos historicos: `2025-11-03` a `2026-06-17`.
- Se generaron 2.276 saldos de pedidos historicos por `$169.822.370` cuando no existian como movimientos de cuenta corriente.
- Se registraron 1.298 pagos de clientes recibidos por Lucas por `$164.045.260` en `payments`.
- Se generaron 1.298 movimientos de saldo tipo `pago` por `-$164.045.260`, relacionados con esos pagos.
- No se importaron pagos de clientes no encontrados; dentro del rango hubo 0 exclusiones por cliente inexistente.
- Los pagos quedaron marcados con `importSource = rendicion_lucas_saldos_20260619` y los saldos de pedidos historicos con `importSource = historial_csv_saldos_20260619`.
- Backups VPS: pre-import `20260619_111439` y post-import `20260619_111448` con codigo, dump PostgreSQL y `app_state`.
- Reporte generado: `rendicion_lucas_saldos_por_cliente.csv`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.6 - Importacion rendicion efectivo Lucas (2026-06-19)

### Datos / Caja

- Se proceso `Lucas Pare Carrito - Rendición.csv` y se importo solo el rango coincidente con pedidos historicos: `2025-11-03` a `2026-06-17`.
- Se importaron 1.298 ingresos de clientes a `Efectivo - Lucas` por un total de `$164.045.260`.
- Se importaron 19 movimientos `Jose -> Lucas` por `$9.146.690`, representados como egreso en `Efectivo - Jose Luis` e ingreso en `Efectivo - Lucas`.
- Total neto agregado a caja Lucas por la rendicion: `$173.191.950`.
- Se excluyeron pagos de clientes no encontrados; dentro del rango importado no hubo exclusiones por cliente inexistente.
- Los movimientos se registraron con `importSource = rendicion_lucas_20260619`.
- Backups VPS: pre-import `20260619_073230` y post-import `20260619_073423` con codigo, dump PostgreSQL y `app_state`.
- Backup PC: `auditoria/import_rendicion_lucas_20260619_preimport` y `auditoria/import_rendicion_lucas_20260619_postimport`.
- Reportes generados: `rendicion_importados_rango_historico.csv`, `rendicion_excluidos_rango_historico.csv`, `rendicion_dudas.csv`, `rendicion_pagos_clientes_parseados.csv` y `rendicion_movimientos_jose_lucas_parseados.csv`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.5 - Importacion historial de pedidos CSV (2026-06-19)

### Datos / Pedidos historicos

- Se proceso el archivo `Sin arreglar - Historial.csv` con historial de 7 meses, desde `2025-11-03` hasta `2026-06-17`.
- Se importaron al VPS productivo 2.276 pedidos historicos validados, con 19.830 items, marcados con `importSource = historial_csv_20260619`.
- Los pedidos importados quedaron como `entregado`, `paymentStatus = paid` y `paymentReceived = totalAmount` para no generar deuda pendiente ni movimientos de caja/pagos inexistentes.
- Se dejaron fuera de la importacion 1.075 pedidos con dudas por productos no existentes en catalogo, celdas sueltas sin cantidad/precio, totales faltantes, clientes no encontrados o diferencias de total relevantes.
- Backups VPS: pre-import `20260619_070300` y post-import `20260619_070625` con codigo, dump PostgreSQL y `app_state`.
- Backup PC: `auditoria/import_historial_20260619_preimport` y `auditoria/import_historial_20260619_postimport`.
- Reportes generados: `pedidos_con_dudas_validacion.csv`, `productos_csv_no_encontrados.csv`, `clientes_csv_no_encontrados.csv`, `pedidos_importados_resumen.csv` y `pedidos_importados_ids.csv`.
- No se registraron credenciales en documentacion ni reportes.

---

## v12.8.4 - Deploy productivo en VPS (2026-06-19)

### DevOps / Deployment

- Se desplego en el VPS productivo el commit `273b4b360a7c4df019582ec8996ff2de62efc9be` de `master`.
- Se sincronizaron `pare-carrito-sas-server` y `lucas-pare-carrito-erp` sobre `/opt/pare-carrito`, preservando `.env`, backups internos y assets de productos.
- Se reconstruyo el contenedor `api` con Docker Compose y quedaron activos `api`, `caddy` y `db`.
- Verificacion posterior: `https://sistema.parecarrito.com.ar/`, `https://sistema.parecarrito.com.ar/api/health` y `https://api.parecarrito.com.ar/health` respondieron HTTP 200.
- Backups generados en VPS: pre-deploy `20260619_061708`, post-sync `20260619_061822`, post-deploy `20260619_062344` y post-documentacion `20260619_062949`.
- Backup generado en PC: `backups-repo/repo-backup-20260619-063020-final`.
- No se registraron credenciales en documentacion ni historial.

---
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

