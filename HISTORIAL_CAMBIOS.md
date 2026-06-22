# Historial de Cambios — Pare Carrito SAS ERP

## v12.8.26 - Altura desktop acotada del carrito overlay (2026-06-22)

### Frontend / Nuevo Pedido

- En desktop/tablet, el carrito overlay de `Nuevo Pedido` reduce su altura maxima a `min(44vh, 340px)` para mostrar aproximadamente 5 o 6 filas antes del scroll.
- En pantallas intermedias hasta 1060px, el limite queda en `min(46vh, 340px)` para mantener el overlay compacto sin volver a ocupar toda la columna lateral.
- Se mantiene sin cambios el comportamiento mobile del carrito inferior definido en la version anterior.
- Commit funcional desplegado: `8c87e51060dbac59b64cf4cf39d1b97b3ad84769`.
- Verificacion: `git diff --check`.
- Backups VPS: pre-cambio codigo `20260622_192653`; post-cambio codigo `20260622_192913`.
- Backup PC pre-cambio: `auditoria/repo-backup-20260622-precart-desktop-height.zip`.
- Backup PC post-cambio: `auditoria/repo-backup-20260622-postcart-desktop-height.zip`.
- Nota operativa: por bajo espacio disponible en el VPS, este cambio frontend uso backups livianos de codigo y no dump completo de base de datos.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.25 - Overlay desktop y altura mobile del carrito (2026-06-22)

### Frontend / Nuevo Pedido

- En desktop/tablet, el carrito fijo de `Nuevo Pedido` ahora funciona como overlay y ya no reserva una columna lateral permanente, devolviendo ancho al listado de productos.
- Se agrego sombra al overlay del carrito para separarlo visualmente del contenido sin achicar la grilla.
- En mobile, el carrito inferior mantiene scroll interno pero reduce su altura maxima a `min(24vh, 188px)`, para mostrar aproximadamente 4 o 5 filas en vez de 8.
- Se redujo el espacio inferior reservado en mobile para acompañar la nueva altura del carrito.
- Commit funcional desplegado: `10045fad49ab751dcca3b7ce4723595651a2f278`.
- Verificacion: `git diff --check`.
- Backups VPS: pre-cambio codigo `20260622_141520`; post-cambio codigo `20260622_141734`.
- Backup PC pre-cambio: `auditoria/repo-backup-20260622-1415-pre-order-cart-overlay-height.zip`.
- Backup PC post-cambio: `auditoria/repo-backup-20260622-1417-post-order-cart-overlay-height.zip`.
- Nota operativa: el VPS estaba al 100% de disco; se eliminaron solo los archivos fallidos del intento de backup parcial para liberar espacio. No se borraron backups validos.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.24 - Repintado final de Historiales al cargar rango (2026-06-22)

### Frontend / Historiales

- Se corrigio el repintado final de `Historiales` al terminar la carga de un rango.
- `ensureHistoryRangeLoaded` ya no usa `route.base`, porque `route` es local de `render()` y no existe en esa funcion async.
- Ahora verifica la pagina actual con `getRoute().base === "historiales"` antes de llamar a `render()`.
- Esto evita que los datos queden cargados en memoria pero visibles recien al salir y volver a entrar a la pagina.
- Commit funcional desplegado: `429d4b0335a732bfce61d4f4a5edbe761afb6461`.
- Verificacion: `node --check` en frontend y `git diff --check`.
- Backups VPS: pre-cambio `20260622_140706`; post-cambio `20260622_140949`.
- Backup PC pre-cambio: `auditoria/repo-backup-20260622-1407-pre-history-render-route-fix.zip`.
- Backup PC post-cambio: `auditoria/repo-backup-20260622-1410-post-history-render-route-fix.zip`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.23 - Carrito fijo al viewport en Nuevo Pedido (2026-06-22)

### Frontend / Nuevo Pedido

- `pageShell` agrega una clase de ruta (`page-nuevo-pedido`, etc.) para permitir estilos acotados por pagina.
- El carrito de `Nuevo Pedido` deja de depender de `position: sticky` dentro de su contenedor y pasa a `position: fixed` respecto del viewport.
- En desktop/tablet se reserva espacio lateral para el carrito fijo y en mobile se reserva espacio inferior para que no tape productos ni botones.
- El cambio corrige el caso donde el carrito desaparecia al scrollear la grilla de productos porque el contenedor padre terminaba antes del listado.
- Commit funcional desplegado: `39a1c775415e9705798ae90a375ee977c8cea53d`.
- Verificacion: `node --check` en frontend y `git diff --check`.
- Backups VPS: pre-cambio `20260622_135946`; post-cambio `20260622_140250`.
- Backup PC pre-cambio: `auditoria/repo-backup-20260622-1359-pre-order-cart-fixed.zip`.
- Backup PC post-cambio: `auditoria/repo-backup-20260622-1402-post-order-cart-fixed.zip`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.22 - Carrito sticky y Nota compacta en Nuevo Pedido (2026-06-22)

### Frontend / Nuevo Pedido

- El carrito de compras de `Nuevo Pedido` queda sticky tambien en el breakpoint intermedio desktop/tablet, para que siga visible al scrollear productos.
- En mobile, el carrito sticky inferior se refuerza con mayor prioridad visual, menor altura maxima y sombra superior.
- En mobile, el campo rapido `Nota` se compacta en ancho y padding manteniendo altura tactil minima.
- Commit funcional desplegado: `47d24ecdac259b8ee22f6de85c231107ec1db38e`.
- Verificacion: `git diff --check`.
- Backups VPS: pre-cambio `20260622_120217`; post-cambio `20260622_120448`.
- Backup PC pre-cambio: `auditoria/repo-backup-20260622-1202-pre-order-cart-sticky-note.zip`.
- Backup PC post-cambio: `auditoria/repo-backup-20260622-1204-post-order-cart-sticky-note.zip`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.21 - Refresco inmediato de Historiales por rango (2026-06-22)

### Frontend / Historiales

- Al cambiar `Desde`, `Hasta` o usar los botones `7 dias`, `30 dias`, `3 meses` y `6 meses`, la pantalla `Historiales` invalida el rango anterior y dispara la carga del nuevo rango inmediatamente.
- Si ya habia una carga del mismo rango en curso, al finalizar tambien se fuerza el repintado de la pagina para evitar tener que salir y volver a entrar.
- El mensaje de carga y los datos quedan sincronizados con el rango seleccionado en la misma pagina.
- Commit funcional desplegado: `37526e6eb11fb239315c3aa02f9afd94a7768d70`.
- Verificacion: `node --check` en frontend y `git diff --check`.
- Backups VPS: pre-cambio `20260622_115526`; post-cambio `20260622_115810`.
- Backup PC pre-cambio: `auditoria/repo-backup-20260622-1155-pre-history-range-refresh.zip`.
- Backup PC post-cambio: `auditoria/repo-backup-20260622-1158-post-history-range-refresh.zip`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.20 - Favoritos historicos, pedidos de empleado y cache de historiales (2026-06-22)

### Frontend / Nuevo Pedido, Pedidos e Historiales

- `Nuevo Pedido` conserva un historial compacto de productos comprados por cliente en `state.preferences`, reconciliado tambien desde pedidos historicos ya cargados.
- Los productos de la ultima compra del cliente muestran `Ultima compra` con cantidad; los productos comprados anteriormente muestran `Favorito`.
- La etiqueta `Nota producto filtrado` se simplifico a `Nota`.
- El selector `Vista` de `Nuevo Pedido` se reemplazo por dos botones iconicos para cuadricula y lista.
- Si el navegador no soporta lazy-load/IntersectionObserver, `Nuevo Pedido` vuelve a cargar todos los productos como antes y no depende del boton `Cargar mas`.
- El rol `employee` ahora ve todos los pedidos del rango seleccionado en la pagina `Pedidos`, no solo los del dia.
- En `Pedidos`, el boton `Eliminar` queda disponible solo para rol gerente; admin conserva anulacion/restauracion segun corresponda.
- `Historiales` agrega cache de matrices por rango/version en backend para acelerar cargas repetidas del mismo rango.
- Los botones rapidos de rango de `Historiales` aumentan su ancho minimo para mejorar lectura.
- Commit funcional desplegado: `5953e66c8ee9ca767f26f6d1a77019c9bea859a9`.
- Verificacion: `node --check` en frontend/backend; `git diff --check`; API en VPS `HEALTH ok` tras rebuild.
- Backups VPS: pre-cambio `20260621_173641`; post-cambio `20260622_060708`.
- Backup PC pre-cambio: `auditoria/repo-backup-20260621-1736-pre-client-history-favorites.zip`.
- Backup PC post-cambio: `auditoria/repo-backup-20260622-0607-post-client-history-favorites.zip`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.19 - Virtualizacion de Nuevo Pedido e historiales agregados (2026-06-21)

### Frontend / Nuevo Pedido, Historiales y mobile

- `Nuevo Pedido` ahora renderiza productos por lotes de 80 y carga mas al acercarse al final del listado, reduciendo el peso inicial de la pantalla.
- Se agrego un borrador local de pedido para conservar cantidades, notas, precios y unidades aunque el producto no este renderizado por la virtualizacion.
- El carrito mobile queda sticky y compacto para todos los roles; la fila de total muestra `Total` a la izquierda y el importe a la derecha.
- Si el cliente no tiene IVA, el carrito no muestra subtotal; si tiene IVA, muestra subtotal e IVA como detalle.
- Los botones `X` del carrito mobile se redujeron visualmente y las filas del carrito se compactaron al mismo alto.
- El texto de preferencia de producto en `Nuevo Pedido` cambia de `Favorito: ultima unidad` a `ultima compra`.
- La pagina `Historiales` pide al backend matrices agregadas (`mode=matrix`) para compras y ventas, evitando agrupar historiales grandes en el navegador.
- Los botones `7 dias`, `30 dias`, `3 meses` y `6 meses` de `Historiales` tienen ancho minimo legible en mobile y desktop.
- Commit funcional desplegado: `5194050c009ada03336bf010ac99f65fedf77443`.
- Verificacion: `node --check` en frontend/backend; prueba local mobile 375px sin errores de consola ni overflow inicial; API en VPS `HEALTH ok`.
- Backups VPS: pre-cambio `20260621_170034`; post-cambio `20260621_171221`.
- Backup PC pre-cambio: `auditoria/repo-backup-20260621-1700-pre-virtual-history-order.zip`.
- Backup PC post-cambio: `auditoria/repo-backup-20260621-1712-post-virtual-history-order.zip`.
- No se registraron credenciales en documentacion ni reportes.

---

## v12.8.18 - Historiales robustos, mobile y sync cliente (2026-06-21)

### Frontend / Historiales, Nuevo Pedido, mobile y sincronizacion

- En `Historiales`, la carga por rango queda asociada al rango exacto y tiene timeout para no quedar indefinidamente en "Cargando historiales...".
- La impresion de `Historiales` usa una ventana/documento temporal directo para evitar que en mobile se imprima toda la pagina.
- Los botones de rango de `Historiales` y los controles compactos en mobile respetan un area tactil minima de 44px.
- En mobile, las tablas y wrappers hacen scroll horizontal interno sin ensanchar la pagina de `Inicio` ni otros dashboards.
- En `Nuevo Pedido` mobile, el carrito queda sticky, compacto y muestra producto, cantidad, subtotal y quitar en una sola fila.
- El carrito ya no muestra la unidad del producto ni la leyenda de ayuda; si el cliente no tiene IVA, tampoco muestra linea de IVA.
- El boton `Todos` de categorias ahora puede desmarcar todas las categorias sin que el render las vuelva a marcar automaticamente.
- El rol Cliente deja de ejecutar auto-sync completo contra `/state` y `/state/patch`, evitando 403 repetidos.
- Pedidos y transferencias de clientes se envian por endpoints especificos y quedan en una cola local de reintento si no hay conexion.
- El backend agrega `/orders/customer`, valida clientes vinculados y registra pedido, saldo y caja de forma transaccional.
- El backend valida transferencias de cliente contra sus clientes vinculados y evita duplicados en reintentos.
- Commit funcional desplegado: `e7f89bdbeae185e01b95508bff361c0bdcc64e6e`.
- Verificacion: `node --check` en frontend/backend; carga local mobile 375px sin overflow inicial ni controles menores a 44px; API en VPS `HEALTH ok`.
- Backups VPS: pre-cambio `20260621_123029`; post-cambio `20260621_125146`.
- Backup PC pre-cambio: `auditoria/repo-backup-20260621-1230-pre-mobile-history-sync.zip`.
- Backup PC post-cambio: `auditoria/repo-backup-20260621-1252-post-mobile-history-sync.zip`.
- No se registraron credenciales en documentacion ni reportes.

---

## v12.8.17 - Impresion compacta, IVA editable y movimientos de proveedores (2026-06-21)

### Frontend / Historiales, Facturacion y Proveedores

- La impresion de `Historiales` usa documento temporal propio, hoja A4 horizontal y margenes minimos.
- Los botones de impresion de compras y ventas imprimen solo el recuadro correspondiente; el boton general imprime solo ambos cuadros de historiales.
- Los botones rapidos de rango en `Historiales` tienen un tamano minimo mayor para mejorar usabilidad.
- En `Facturacion`, admin, gerente y contador pueden editar el IVA a facturar por cliente antes de emitir/simular.
- En `Facturacion`, los clientes desmarcados quedan fuera del envio a TusFacturas.
- El backend `/billing/run` acepta `ivaOverrides` por cliente y registra `manualIvaOverride` en el log.
- En `Proveedores`, `PDF / Imprimir proveedor` imprime solo la cuenta del proveedor/rango seleccionado.
- En `Proveedores`, los movimientos ahora combinan cuenta corriente de proveedor con compras/pagos asociados en `purchases`, evitando duplicados cuando ya existe asiento en `providerLedger`.
- Commit funcional desplegado: `c4095ad28c73b082d9f450de115946922f9d33e2`.
- Verificacion VPS: API `HEALTH=200`; `Proveedor Generico` tiene `666` compras asociadas en `purchases` y `0` asientos en `providerLedger`, por eso antes no se mostraban movimientos.
- Backups VPS: pre-cambio `20260621_115714`; post-cambio `20260621_120443`.
- Backup PC pre-cambio: `auditoria/repo-backup-20260621-1157-pre-print-billing-providers.zip`.
- Backup PC post-cambio: `auditoria/repo-backup-20260621-1206-post-print-billing-providers.zip`.
- No se registraron credenciales en documentacion ni reportes.

---

## v12.8.16 - Refresco de historiales, seleccion de facturacion y ajustes de inicio (2026-06-20)

### Frontend / Historiales, pedidos, inicio y facturacion

- La pagina `Historiales` ya no muestra "Sin datos" mientras espera la carga del rango: muestra carga y refresca al recibir `/product-history`.
- Se agregaron accesos rapidos `7 dias`, `30 dias`, `3 meses` y `6 meses` para modificar `Desde/Hasta`.
- Se agregaron botones de impresion directa para imprimir compras y ventas juntas o cada recuadro por separado.
- En `Dividir Compras`, los botones de WhatsApp ahora muestran solo el icono con `Todos` y `Seleccionado`.
- En `Facturacion`, admin, gerente y contador pueden seleccionar clientes con checkbox, seleccionar/deseleccionar todos y emitir/simular solo los seleccionados.
- En `Inicio`, las tendencias de admin/gerente excluyen dias sin pedidos de todos los graficos.
- En `Inicio`, los recuadros de comprobantes pendientes y usuarios inactivos se compactaron al tamano de botones de accion.
- En `Nuevo Pedido`, al seleccionar cliente se recalculan precios y preferencias al instante.
- El selector de cliente permite volver a hacer click para desplegar opciones sin tener que borrar con X.
- Commit funcional desplegado: `072685ac3f38c14797b33dc83303f095dab8978d`.
- Backups VPS: pre-cambio `20260620_143543`; post-cambio `20260620_144815`.
- Backup PC pre-cambio: `auditoria/repo-backup-20260620-1436-pre-ui-historiales-facturacion.zip`.
- Backup PC post-cambio: `auditoria/repo-backup-20260620-1450-post-ui-historiales-facturacion.zip`.
- No se registraron credenciales en documentacion ni reportes.

---

## v12.8.15 - Historiales fuera del estado operativo y cola offline (2026-06-20)

### Arquitectura / Sincronizacion

- Se agrego la tabla `product_history_state` para guardar historiales canonicos de productos fuera del `app_state` operativo.
- Se agrego el endpoint `/product-history` para que la pagina `Historiales` cargue solo el rango consultado.
- Se agrego la tabla `state_operations` y el endpoint `/state/patch` para aplicar operaciones chicas con `operationId` idempotente y `baseUpdatedAt`.
- El frontend deja de transportar historiales grandes en cada guardado y usa una cola local de parches pendientes para operar offline y reintentar al volver la conexion.
- La cola pendiente se compacta contra la ultima version conocida del servidor y no pisa el VPS si hay conflicto de version.
- `app_state` queda reducido al estado operativo: clientes, pedidos, pagos, saldos, caja, compras, usuarios y configuracion.
- El backup JSON del servidor incluye tanto `app_state` como `productHistory`.
- Commit funcional desplegado: `53874e2243af24753304a6745d742f2c3108a73a`.
- Migracion verificada en VPS: `app_state` bajo a `15.639.270` bytes en PostgreSQL y el endpoint `/state` devuelve `14.371.885` bytes sin claves de historiales.
- Conteos migrados a `product_history_state`: precios de lista `55.082`, cantidades vendidas `25.475`, compras `15.118`.
- Backups VPS: pre-migracion `20260620_093128`; post-migracion `20260620_094729`.
- Backup PC pre-migracion: `auditoria/repo-backup-20260620-0931-premigracion-historiales-offline.zip`.
- Backup PC post-migracion: `auditoria/repo-backup-20260620-0955-postmigracion-historiales-offline.zip`.
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

