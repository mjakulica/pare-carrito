# Historial de Cambios — Pare Carrito SAS ERP

## v12.9.97 - Facturacion: emision manual con vencimiento + selector de historial (2026-07-31)

### Facturacion (gerente/admin/contador)
- Nuevo boton "Emitir manual": abre un modal para emitir la factura de un cliente eligiendo fecha del comprobante, periodo desde/hasta, VENCIMIENTO para el pago y concepto (Productos / Servicios / Productos y servicios). Pensado para re-emitir casos que fallaron o que necesitan vencimiento futuro (AFIP rechaza vencimiento anterior a hoy). Se valida que el vencimiento no sea anterior a hoy.
- Backend: buildInvoicePayload acepta overrides (fecha, vencimiento, periodo, concepto); runBilling y /billing/run los propagan (body.overrides). El concepto solo se envia si se especifica.
- El historial de emisiones ahora tiene selector 30 / 60 / 120 / Todas (ui.billingLogLimit).
- REQUIERE ./deploy.sh (backend) + git pull (frontend).

---

## v12.9.96 - Facturacion: external_reference invalida al dividir en tandas (2026-07-31)

### Facturacion (TusFacturas)
- Sintoma: facturas de clientes con muchos items (ej. Factury) fallaban con "La external reference enviada, posee caracteres no validos" y "Error al crear al cliente. No se podra generar el comprobante".
- Causa: cuando la factura supera el maximo de items por comprobante se divide en tandas y se agrega el sufijo " (1/2)" a la external_reference. Los espacios, parentesis y barra de ese sufijo no son validos para TusFacturas.
- Fix: la external_reference usa un sufijo seguro ("-1-2") y se sanea a [A-Za-z0-9_-]. La leyenda del comprobante mantiene el texto legible " (1/2)".
- REQUIERE ./deploy.sh. Despues del deploy, reintentar la facturacion de los clientes que quedaron en Error.

---

## v12.9.95 - Parser: "banana unidad" ya no matchea Anana (2026-07-27)

### Parser de WhatsApp (Nuevo Pedido)
- "Banana unidad" (o cualquier producto cuya unidad tipeada no exista como variante) ya no cae en un producto parecido por error (ej. Anana, distancia 1 de "banana"). Ahora, si el nombre-base coincide exactamente, matchea ese producto aunque la unidad no coincida (elige la variante mas adecuada), en vez de pasar al match difuso.
- El match difuso por levenshtein ahora exige misma primera letra: evita falsos positivos como "anana"~"banana" o "granada"~"naranja".
- Nota: el caso "3doc. naranjas" -> 0,1 ya estaba resuelto en el codigo actual (fix del punto, v12.9.75). Si sigue apareciendo es por una version vieja cacheada en el dispositivo: entrar con Ctrl+F5 (o aplicar el fix de cache v12.9.83 con deploy).
- Solo frontend (git pull).

---

## v12.9.94 - Revertir impresion a v12.9.82 (2026-07-27)

- Se revirtieron SOLO las funciones de impresion (printHtmlDocument, printDocumentStyles, renderDivideClientList, renderDivideProductList) al estado exacto de v12.9.82, por un error de impresion posterior que no se pudo resolver. Se elimino el helper printColumnsHtml y el auto-cierre de pestaña.
- Se mantienen intactos: lista de precios publica, fix de cache (Caddy), y la fecha real de ultima actualizacion de precios (v12.9.93).
- Solo frontend (git pull).

---

## v12.9.93 - Fecha de ultima actualizacion de precio real (2026-07-13)

### Precios (lista cliente y lista publica)
- Sintoma: figuraba que TODOS los productos se actualizaron hoy, aunque muchos no se compraron ni cambiaron de precio.
- Causa: applyCostChange ponia rec.date = hoy SIEMPRE (aunque el costo/precio no cambiaran; se dispara tambien por reprocesos y relaciones de costo), y la vista usaba "hoy" como fallback.
- Fix:
  - rec.date solo se actualiza si el costo o el precio CAMBIAN de verdad.
  - La fecha mostrada = la mas reciente entre el ultimo cambio de precio (rec.date) y la ultima COMPRA DIRECTA del producto. Si nunca cambio ni se compro, muestra "—" (ya no "hoy").
  - Aplica a la lista de precios del rol cliente y a la lista publica (/precios), en grilla y lista.
- Frontend (app.js + precios.html) con git pull; el endpoint publico requiere ./deploy.sh.

---

## v12.9.92 - Lista de precios publica: IVA solo se elige al ingresar (2026-07-13)

### Lista de precios publica (/precios)
- Se quito el boton Sin IVA / Con IVA de adentro de la pagina: la opcion se elige solo al ingresar (pantalla inicial) y para cambiarla hay que volver a entrar. Evita cambiarla sin querer.
- Se borro la leyenda "Con IVA: se suma el IVA..." de la pantalla inicial.
- Solo frontend (git pull).

---

## v12.9.91 - Lista de precios publica: con IVA = IVA real + 2% gastos bancarios (2026-07-13)

### Lista de precios publica (/precios)
- El precio "con IVA" ahora aplica el IVA REAL del producto (10,5% o 21%) y encima un 2% extra por gastos bancarios (multiplicativo), mostrando solo el precio final (sin discriminar). Ej: 10,5% -> recargo total 12,71%; 21% -> 23,42%; exento -> 2%.
- REQUIERE ./deploy.sh (cambio en el endpoint). precios.html (nota aclaratoria) es frontend.

---

## v12.9.90 - Lista de precios publica: fecha por producto + con IVA sin desglose (2026-07-13)

### Lista de precios publica (/precios)
- Cada producto muestra la fecha de ultima actualizacion ("Ult. act: dd/mm/aaaa"), igual que la lista de precios del rol cliente (usa el date del precio; si no hay, el dia actual).
- En modo "Con IVA" ya no se muestra el precio sin IVA ni el % de IVA: solo el precio final.
- Solo frontend (git pull).

---

## v12.9.89 - Lista de precios publica: imagenes reales de los productos (2026-07-13)

### Lista de precios publica (/precios)
- Cada producto ahora muestra su imagen real (la misma del sistema, /assets/product-images/...), en vista Cuadricula y Lista. Si un producto no tiene imagen o no carga, cae al placeholder de color con iniciales.
- Endpoint /public/price-list: agrega el campo image (imageUrl del producto pasado a ruta absoluta, o imageData propio si tuviera).
- REQUIERE ./deploy.sh (endpoint backend). precios.html es frontend.

---

## v12.9.88 - Impresion: columnas estilo diario + pestaña que se cierra sola (2026-07-13)

### Dividir Compras (PDF)
- "Agrupado por cliente" y "Agrupado por producto" ahora se acomodan en 3 columnas "estilo diario": la columna 1 se llena de arriba a abajo, luego la 2 y la 3 (un item abajo del otro), en vez de la grilla que dejaba huecos y arrancaba todo en la misma fila.
- Se arma con reparto manual en 3 columnas (no column-count): se renderiza IGUAL en pantalla y al imprimir, es rapido (sin balanceo) y ningun item se corta en el salto de pagina.

### Impresion (todos los PDF que abren pestaña, ej. mobile)
- La pestaña de impresion ahora se cierra sola al terminar de imprimir o al cancelar (evento afterprint).

Solo frontend (git pull).

---

## v12.9.87 - Impresion en columnas: grid en vez de column-count (2026-07-13)

### Impresion en 3 columnas (Dividir Compras, Vehiculos, resumen por producto)
- Sintoma: en mobile el formato de la pestaña no coincidia con el archivo impreso (las columnas se perdian o cambiaban), y en desktop la generacion del PDF tardaba varios minutos.
- Causa: se usaba CSS column-count, que el navegador respeta en pantalla pero NO de forma confiable al imprimir (sobre todo en mobile) y que, al paginar, obliga a balancear columnas entre paginas -> lento e inconsistente.
- Fix: las 3 columnas ahora se arman con CSS grid (repeat(3, 1fr)), que se renderiza IGUAL en pantalla y en el impreso, en mobile y desktop, y sin el costo de balanceo -> rapido y consistente. Aplica a "Agrupado por cliente" y "por producto" de Dividir Compras, y a Vehiculos.
- Solo frontend (git pull).

---

## v12.9.86 - Fix impresion desktop: columnas y "Guardar PDF" que se colgaba (2026-07-13)

### Impresion (Dividir Compras y demas PDF por iframe)
- Sintoma: en desktop, al exportar el PDF seleccionado de Dividir Compras, los clientes agrupados salian uno debajo del otro (sin las 3 columnas) aunque la vista previa se veia bien, y al "Guardar como PDF" se colgaba y no terminaba.
- Causa: la impresion usaba un iframe oculto de 0x0 px. Chrome, con un iframe sin dimensiones reales, aplasta las columnas CSS al imprimir y traba el guardado del PDF.
- Fix: el iframe de impresion ahora tiene dimensiones reales (~A4) pero fuera de pantalla, y se elimina RECIEN despues de imprimir/guardar (evento onafterprint, con fallback tardio) en vez de a los 500ms. Asi las columnas se respetan y el "Guardar como PDF" no se corta.
- Solo frontend (git pull).

---

## v12.9.85 - Lista de precios publica: formato cliente (mayor/menor, grilla/lista, categorias) (2026-07-13)

### Lista de precios publica (/precios)
- Ahora con el mismo formato que ve el rol cliente: filtro Por Mayor / Por Menor (segun la unidad del producto), vista Cuadricula / Lista, y chips de categorias para seleccionar/deseleccionar (con "Todos"). Ademas del gate inicial Sin/Con IVA y buscador.
- En vista Lista los productos se agrupan por categoria. Cada producto muestra una etiqueta Mayor/Menor.
- Endpoint /public/price-list ampliado: devuelve category, unitType, wholesale (bool segun appSettings.unitTypes), ivaLabel y la lista de categorias.
- REQUIERE ./deploy.sh (endpoint backend). precios.html es frontend.

---

## v12.9.84 - Lista de precios publica (sin login) con toggle IVA (2026-07-13)

### Lista de precios publica
- Nuevo endpoint publico (sin autenticacion) GET /public/price-list: devuelve nombre + precio de lista (general) + recargo de IVA de los productos activos. Se mantiene al dia solo porque lee el estado actual.
- Nueva pagina publica en /precios (precios.html): al entrar pregunta "Ver precios SIN IVA" o "CON IVA". Muestra la lista alfabetica con buscador, fecha de ultima actualizacion y auto-refresh cada 5 min. Mobile-first, ideal para compartir por WhatsApp.
- "Con IVA": suma el IVA real de cada producto, salvo el 10,5% que se calcula al 12% (buffer para venta con factura). Los de 21% quedan al 21%.
- Se puede desactivar con appSettings.publicPriceListEnabled = false.
- Caddy: /precios sirve precios.html.
- REQUIERE ./deploy.sh (endpoint nuevo en el backend + Caddyfile). La pagina precios.html es frontend.

---

## v12.9.83 - Fix cache: los dispositivos quedaban con frontend viejo (2026-07-13)

### Infra / cache del frontend
- Sintoma probable del bug de Unidades (cambio de cantidad de frutilla que no se actualizaba, X que no borraba del remito): el dispositivo del empleado corria una version VIEJA del frontend cacheada. Esa version no sellaba updatedAt, por lo que sus cambios perdian en el merge de sincronizacion contra otra copia.
- Causa: index.html referenciaba app.js/styles.css con un query fijo (?v=20260626-safety) que no cambiaba en cada deploy, y Caddy no enviaba Cache-Control, por lo que el navegador servia el archivo cacheado hasta un Ctrl+F5.
- Fix:
  - Caddy ahora manda Cache-Control: no-cache, must-revalidate para /, *.html, *.js y *.css -> el navegador revalida contra el servidor en cada carga (ETag) y aplica el deploy al recargar, sin Ctrl+F5.
  - Se bumpeo el query de cache-busting a ?v=20260723-sync para forzar la actualizacion en los dispositivos que ya tenian cache vieja.
- REQUIERE ./deploy.sh (cambia el Caddyfile, que esta bajo pare-carrito-sas-server/).

---

## v12.9.82 - Remitos: exportar PDF de un dia puntual (2026-07-13)

### Remitos (gerente/admin)
- En el panel "Recalcular precios de un dia" se agrego el boton "Exportar PDF remitos de ese dia": arma un solo documento con todos los remitos (no anulados) de la fecha elegida, listo para imprimir/guardar como PDF. Antes solo existia "remitos de hoy" o imprimir pedido por pedido.
- Solo frontend (git pull).

---

## v12.9.81 - Remitos: boton "Recalcular precios de un dia" (2026-07-13)

### Remitos (gerente/admin)
- Nuevo panel "Recalcular precios de un dia": se elige una fecha y el sistema reprecia los pedidos (no anulados) de ese dia segun el costo de las COMPRAS de ese mismo dia.
- Formula (motor en off): precio de lista = ceil(costo x (1 + margen del producto)); precio al cliente = lista x (1 + ajuste% del cliente). Mantiene la tasa de IVA de cada item y recalcula el IVA. Solo toca items cuyo producto tuvo compra ese dia.
- Actualiza los totales del pedido y el saldo del cliente (updateOrderAccounting), y sella updatedAt.
- Pensado para corregir dias en que una compra no habia actualizado los precios de los remitos. Verificado contra el recalculo offline del 18/07 y 20/07 (numeros identicos).
- Solo frontend (git pull).

---

## v12.9.80 - Fix: el precio actualizado por una compra se revertia en la pagina Precios (2026-07-13)

### Precios / sincronizacion
- Sintoma: tras una compra/gasto, el remito salia con el precio nuevo (queda congelado dentro del pedido) pero la pagina Precios seguia mostrando el costo/precio viejo.
- Causa: state.prices se fusionaba con "local gana siempre" por clave. El pedido esta protegido por updatedAt, pero prices no tenia timestamp, asi que una copia vieja (tipicamente el gerente, que hace push del estado completo) revertia el precio actualizado por la compra.
- Fix: cada escritura de precio (compra via applyCostChange, precio de mercado, edicion manual) sella updatedAt, y el merge de prices pasa a "gana el mas nuevo por producto" (remoto en empate o si el local no tiene timestamp).
- Los patches de objetos ya viajaban como diff (solo claves cambiadas), asi que no requiere cambio de backend. Solo frontend (git pull).

---

## v12.9.79 - Remitos: aviso de frescura de datos antes de imprimir (2026-07-13)

### Remitos
- Nuevo aviso arriba de la pagina Remitos que muestra hace cuanto se sincronizaron los datos de este dispositivo y advierte si hay cambios propios sin enviar.
- Si la ultima sincronizacion tiene 5 minutos o mas (o hay cambios sin enviar) el aviso se muestra en amarillo; si esta fresco, en verde.
- Boton "Actualizar datos ahora": primero empuja lo pendiente de este dispositivo y despues descarga la ultima version del servidor. Recomendado antes de imprimir si alguien acaba de cargar algo desde otro celular.
- Limitacion honesta indicada en el aviso: no puede saber si OTRO dispositivo tiene cambios sin enviar (eso vive en ese telefono); por eso se ofrece actualizar antes de imprimir.
- Solo frontend (git pull).

---

## v12.9.78 - Envio de cambios con keepalive (celular bloqueado al instante) (2026-07-13)

### Cola de sincronizacion
- El POST de /state/patch ahora usa keepalive cuando el patch entra en el limite del estandar (64KB): el navegador COMPLETA el envio aunque la pagina se congele, pase a segundo plano o se cierre. Cubre el caso de guardar un egreso y bloquear el celular al instante sin reabrir la app.
- Si el patch supera ese limite, se envia de forma normal (y queda en cola para reintento).
- Solo frontend (git pull).

---

## v12.9.77 - Sincronizacion mas confiable en mobile (2026-07-13)

### Cola de sincronizacion
- Aclaracion de como funciona: la cola guarda UN patch coalescido (el diff completo contra el ultimo estado sincronizado), persistido en localStorage. Varios cambios pendientes viajan juntos en un mismo envio; no se pierden ni se mandan a medias.
- Refuerzos:
  - El EMPLEADO ahora espera la confirmacion del envio al guardar un egreso (antes solo lo hacia el proveedor). El cambio sale mientras la app esta en primer plano y, si falla, avisa en el momento.
  - Al VOLVER a la app (celular bloqueado / cambio de pestania) primero se empuja lo pendiente y recien despues se descarga. Antes solo se descargaba y lo pendiente dependia de un camino indirecto.
  - Al ABRIR la app, si quedo algo pendiente de una sesion anterior, se envia de inmediato.
- Solo frontend (git pull).

---

## v12.9.76 - Fix: cambios revertidos (remitos con precios viejos / item que reaparece) (2026-07-13)

### Causa raiz
- Varias mutaciones de pedido NO sellaban order.updatedAt: updateOrdersWithNewPrices (precios tras una compra), removeProductFromOrders, updateUnitWeightGroup y el borrado de un item en Unidades. Como el merge de sincronizacion resuelve por timestamp, esos cambios quedaban "empatados" con la copia previa y una version vieja de otro dispositivo los revertia.
- Sintomas: el remito se imprimia con precios anteriores a la ultima compra, y un producto borrado con la X en Unidades volvia a aparecer.
- NO era la cola offline / localStorage.

### Fix
- Frontend: recalcOrderTotals (punto unico por el que pasan todas las mutaciones de pedido) ahora sella order.updatedAt.
- Backend: al aplicar un patch, una copia mas vieja ya no puede pisar una mas nueva (si ambas tienen updatedAt y la entrante es anterior, se ignora). Evita que un dispositivo desactualizado revierta cambios ya confirmados.
- El backend REQUIERE ./deploy.sh; el frontend va con git pull.

---

## v12.9.75 - Parser: decimales con punto y abreviatura "doc." (2026-07-13)

### Parser de WhatsApp (Nuevo Pedido)
- Decimales con punto: "Cherry 1.5 k" y "Zuccini 1.5kg" se leian como 1 kg porque el punto separaba el numero ("1 5"). Ahora "1.5" se interpreta como 1,5 -> Tomate Cherry Kg 1,5 y Zukini Kg 1,5.
- Abreviatura con punto: "2doc. pomelo", "1doc. Limones", "1doc. Bananas" (y las variantes sin espacio "1doc.Limones") quedaban pegadas en un solo token, lo que provocaba cantidades erroneas (0,1 docena) y matches equivocados (aparecia Banana donde no correspondia). Ahora cualquier punto separa tokens -> Pomelo Docena 2, Limon Docena 1, Bananas Docena 1.
- Notas: se ignoran las palabras de cortesia ("por favor", "porfa", "gracias"): "Palta 2 kg lindas por favor" queda con la nota util "lindas".
- Verificado con los tres pedidos reportados. Solo frontend (git pull).

---

## v12.9.74 - Sidebar mobile: boton Salir y items siempre accesibles (2026-07-13)

### Sidebar (mobile)
- En Chrome mobile la sidebar usaba 100vh, que incluye el area detras de la barra inferior del navegador, por lo que el footer (boton "Salir de la cuenta") y a veces otros items quedaban tapados e inalcanzables.
- Fix: la sidebar mobile ahora usa 100dvh (altura visible real), con overflow scrollable y padding inferior (+ safe-area) para que el ultimo boton nunca quede pegado a la barra del navegador. La lista de navegacion scrollea y el footer queda siempre visible.
- Solo frontend (git pull).

---

## v12.9.73 - Checklist empleado: "Generar Imprimibles" en un solo archivo (2026-07-13)

### Inicio (empleado) - Generar Imprimibles
- Antes generaba 4 archivos de impresion uno tras otro (colgaba el celular y no imprimia). Ahora arma UN solo documento con los 4 imprimibles separados por salto de pagina (Dividir "Todos menos Miriam" + Dividir "Antonia" + Dividir "Miriam" + Vehiculos "Sin dividir"): una sola ventana de impresion.
- La impresion por separado en Dividir Compras y en Vehiculos no cambia (se refactorizo el cuerpo del documento de dividir a buildDivideDocumentBody; printDivideDocument y printVehicleDirect siguen igual).
- Solo frontend (git pull).

---

## v12.9.72 - Precios: desvincular planilla->sistema (Sheets solo como control) (2026-07-13)

### Precios / Google Sheets
- BUG: los precios del sistema no se actualizaban tras una compra/gasto porque la planilla (via Apps Script) posteaba "Compra Hoy" a POST /external/compra-hoy y SOBREESCRIBIA el costo/precio del producto con el valor del sheet.
- Fix: se desvinculo el sentido planilla->sistema. El endpoint /external/compra-hoy ahora NO modifica precios (responde skipped). El sistema es la unica fuente de verdad de precios: una compra/gasto define el costo/precio.
- El sentido sistema->planilla se mantiene intacto: syncSheetsFromStateDiff sigue empujando los cambios de venta/costo a la planilla en cada guardado (/state y /state/patch). La planilla queda como control.
- Para reactivar planilla->sistema (si alguna vez se necesita): env SHEETS_INBOUND_PRICES=on.
- REQUIERE ./deploy.sh (cambio de backend).

---

## v12.9.71 - Stock: control al finalizar el dia (conteo = apertura de maniana) (2026-07-13)

### Stock - nuevo modelo de conteo
- El conteo de stock ahora se interpreta como el CIERRE del dia: queda guardado como stock de APERTURA del dia siguiente.
- getStockEstimated (apertura de hoy) acumula compras/ventas desde el dia SIGUIENTE al ultimo conteo, para no volver a sumar las del propio dia del conteo (que ya estan reflejadas en el numero contado).
- La sugerencia de compra usa como stock de la manana el estimado (arrastre del cierre de ayer), no el conteo de hoy.
- La merma se calcula comparando el CIERRE esperado (apertura + compras de hoy - ventas de hoy) contra lo contado.
- Mismo criterio para los Grupos / equivalencias (conteo en kg).
- Verificado con simulacion (apertura/cierre/merma/arrastre con huecos de dias). Solo frontend (git pull).

---

## v12.9.70 - Seed no pisa datos reales + anti-duplicado de compra (2026-07-13)

### Sincronizacion (datos por defecto)
- Refuerzo del fix anterior: si el estado local es el "seed" (los datos de ejemplo con los que viene el sistema, sin datos operativos reales), en el merge NO se inyectan esos defaults sobre el servidor; se usa el remoto tal cual. Esto evita que en una carga fresca (post-deploy, incognito, cache limpio) los clientes/productos/proveedores por defecto reemplacen a los reales.

### Compras (proveedor) - anti doble carga
- El boton "Guardar egreso" no deshabilitaba durante el envio del proveedor (await de sincronizacion), por lo que un segundo toque cargaba el mismo egreso 2 veces. Ahora: se bloquea un egreso identico (mismo tipo, proveedor, total, items y usuario) cargado hace menos de un minuto, y se deshabilita el boton mientras se procesa.

---

## v12.9.69 - Fix critico: deploy revertia proveedores/clientes/productos (2026-07-13)

### Sincronizacion (merge local vs servidor)
- BUG CRITICO: en el merge de estado (mergeCloudStates), las entidades clientes, productos, proveedores, vehiculos, usuarios y cajas se unian con "unionByKey", que ante un mismo id hace ganar SIEMPRE a la copia local. Un navegador con snapshot viejo (situacion tipica despues de un deploy de backend, cuando todos recargan/reconectan a la vez) revertia esas entidades a su version vieja y las volvia a pushear al servidor -> "se desconfiguraban" proveedores, datos de clientes y algunos productos.
- Fix: esas colecciones (mas "purchases") ahora usan "unionByKeyPreferNewest" por updatedAt: ante un mismo id gana la version mas nueva; sin updatedAt gana el REMOTO (el servidor es autoritativo). Se preservan las entidades nuevas creadas offline (ids que solo existen local).
- Se estampa updatedAt al guardar clientes, productos, proveedores, vehiculos y cajas, para que una edicion reciente gane sobre una copia remota vieja.
- La base NO se borra en el deploy (volumen pgdata persistente); el problema era 100% del merge en el navegador.
- Solo frontend: se aplica con git pull.

---

## v12.9.68 - Sync: feriados + editar gastos cargados (2026-07-13)

### Compras/Gastos
- Nuevo boton "Editar" en la lista de gastos: permite corregir datos basicos de un gasto ya cargado (fecha, monto total, caja, notas), ajustando el egreso en Caja o la deuda del proveedor (cuenta corriente). No modifica el detalle de productos ni recalcula stock/costos. Empleado y proveedor editan los gastos que cargaron; gerente/admin editan todos. Los pagos a proveedor no se editan (se anulan y recargan).

### Sincronizacion (revision del bug de patch)
- Se reviso toda coleccion de estado que sincroniza por patch. Se detecto que "holidays" (feriados) no estaba en las listas de patch: un feriado cargado por un rol que sincroniza solo por patch (empleado/proveedor/contador) no llegaba al servidor. Se agrego "holidays" a PATCH_ARRAY_KEYS (front) y ARRAY_PATCH_KEYS (server).
- Verificado: el resto de las colecciones (36) coinciden entre front y back; no quedan otras diferencias.
- REQUIERE ./deploy.sh (cambio de backend).

---

## v12.9.67 - Backend sync: cierres de caja y otros arrays de patch (2026-07-13)

### Sincronizacion (servidor)
- BUG: el rol empleado (y proveedor/contador) sincroniza solo por "patch". El backend descartaba en el merge las colecciones que no estaban en su whitelist ARRAY_PATCH_KEYS, por lo que los CIERRES DE CAJA cargados por un empleado nunca llegaban al servidor: no se veian al recargar ni para otros usuarios (solo quedaban en memoria de esa sesion).
- Fix: se agregaron al ARRAY_PATCH_KEYS del servidor: cashClosings, stockMovements, replacements, marginSections, priceAutoLog y priceAutoSchedule.
- priceAutoSchedule se mergea por productId (no por id).
- Se habilito a empleados a enviar cashClosings, stockMovements y replacements tambien en patches con base algo desactualizada (stale).
- REQUIERE ./deploy.sh (cambio de backend).

---

## v12.9.66 - Stock: registro de conteos por dia + cobertura por demanda completa (2026-07-13)

### Stock
- Nuevo recuadro "Registro de conteos de stock por dia" en la pagina Stock: lista, con filtro Desde/Hasta, cada conteo cargado (fecha, producto o grupo, stock cargado y usuario). Usa los conteos ya persistidos (stockMovements).

### Unidades - ocultar pendientes (ajuste)
- Un producto por unidades ahora se oculta de "pendientes" SOLO cuando el stock del dia (conteo cargado hoy + compras del dia) cubre la demanda COMPLETA: producto individual sin faltante, o grupo/equivalencia con netPool <= 0. Ya no se oculta ante una compra parcial.

---

## v12.9.65 - Unidades: enviar persiste para todos + ocultar por stock/compra mayorista (2026-07-13)

### Unidades - "Productos por unidades pendientes"
- Al presionar enviar (actualizar cantidad) de una linea, ahora se marca el item como ajustado de forma PERSISTENTE (item.unitAdjusted, se sincroniza): desaparece para todos los usuarios, no solo en la sesion actual. Antes quedaba visible al entrar con otro usuario.
- Un producto por unidades deja de figurar como pendiente si ya hay certeza de stock:
  (a) se conto el stock del producto hoy, (b) se le imputo una compra por mayor hoy (via relaciones minorista<-mayorista), o (c) pertenece a un grupo/equivalencia (conteo en kg) que fue contado hoy o que recibio una compra por mayor hoy.
- Aplica tanto al recuadro como a la advertencia previa al exportar remitos.

---

## v12.9.64 - Parser: fraccion sin unidad -> Kg; typo "mapple" (2026-07-13)

### Parser de WhatsApp (Nuevo Pedido)
- Fraccion sin unidad explicita (ej "1/2 de morron rojo", "1/2 de morron verde"): media unidad no tiene sentido, ahora toma la variante por Kg si el producto la tiene -> "Morron Rojo Kg 0,5", "Morron Verde Kg 0,5". Antes tomaba la variante Unidades.
- "mapple" (con doble p, typo de "maple") tambien se interpreta como unidad "bandeja".

---

## v12.9.63 - Checklist operativo del empleado + PDF dividir solo N cliente (2026-07-13)

### Inicio (rol empleado) - Checklist del dia
- Nuevo recuadro "Checklist del dia" con un click por accion (ejecuta y marca/tacha la linea):
  - Stock / Compras / Unidades / Vehiculos / Pagos / Horario y cierre de caja -> abren la pagina.
  - Generar Imprimibles -> genera de corrido 4 PDF: Dividir Compras "Todos menos Miriam", Dividir "Antonia", Dividir "Miriam" y Vehiculos "Sin dividir".
  - Miriam / Mario / Chicho -> copian el clipboard de WhatsApp del proveedor (Seleccionado) y abren el chat wa.me correspondiente.
  - Imprimibles Vehiculos y Remitos -> genera el PDF de Vehiculos "Todos" y el PDF de "Remitos de hoy".
- El checklist se reinicia (todo desmarcado) automaticamente a las 04:00 (dia operativo 04:00 a 04:00). Boton "Reiniciar" manual.

### Dividir Compras
- En el PDF, el bloque "Agrupado por cliente" muestra solo el numero de cliente (sin nombre), igual que el clipboard de WhatsApp.

### Unidades (verificado, ya activo)
- Al enviar/actualizar la cantidad de una linea en "Productos por unidades pendientes", la linea desaparece; si la tarjeta del producto queda sin lineas, se elimina la tarjeta.

---

## v12.9.62 - Parser (notas/maple/fracciones) y cambio de cliente sin borrar pedido (2026-07-04)

### Parser de WhatsApp (Nuevo Pedido)
- Ya no genera notas basura: palabras de unidad (atado, planta, bolsa, "x fardo x 12", etc.) y palabras que ya forman parte del nombre del producto (ej. "roja" en Manzana Roja, "soja" en Brotes de Soja) no quedan como nota. Se mantienen las notas utiles (ej. "grandes", "para ensalada").
- "maple" se interpreta como unidad "bandeja": "1 maple manzana roja deliciosa" -> Manzana Roja Bandeja; "1 maple de pera" -> Pera Bandeja.
- Fracciones con espacio como "1/ 2 docena" se leen como 1/2 (0,5) en vez de romperse.

### Nuevo pedido
- Cambiar de cliente ya NO borra el pedido cargado (ni el texto pegado): se conserva y se reprecia para el nuevo cliente. Antes, al cambiar de cliente se vaciaba todo.
- La autodeteccion de cliente desde el texto pegado ya no se dispara por solapamiento de palabras del pedido (ej. "de" -> "Del Milagro"). Solo detecta con senales explicitas: linea "pedido para X", linea de cliente ("006"), o numero + nombre.

---

## v12.9.61 - Fix cantidad de recambio (2026-07-04)

- La cantidad a recambiar (input numerico) se leia con parseAmount, que borra el punto decimal (lo toma como separador de miles): 0,4 se convertia en 4 y aparecia "La cantidad de recambio no puede superar la del pedido" aunque no se superara. Ahora se lee con punto decimal correcto.

---

## v12.9.60 - Recambio por pedido + confirmacion logout proveedor (2026-07-04)

- Pedidos (manager/admin/employee): boton de "Pedir recambio" en cada fila de pedido, que abre el modal de recambio con ese pedido ya seleccionado y sus productos listos para marcar.
- El cierre de sesion por inactividad (4 h) ya aplica a TODOS los roles, incluido proveedor (la logica no filtra por rol). Sin cambios necesarios.

---

## v12.9.59 - Proveedores: compra/gasto agrega producto a lo que vende (2026-07-04)

- Al registrar una compra o gasto de producto a un proveedor con un producto que no estaba en sus "Productos que vende", el producto se agrega automaticamente (lo hacia rememberProviderProducts) y aparece en el recuadro "Precios de <proveedor> (lo que vende)". Ademas, el precio efectivo por proveedor ahora considera tambien los gastos de producto (no solo las compras) para mostrar precio y fecha. Se evita agregar productId vacio.

---

## v12.9.58 - Proveedores: recuadro de precios del proveedor para empleado (2026-07-04)

- El rol empleado ahora tambien ve, al seleccionar un proveedor en Proveedores, el recuadro "Precios de <proveedor> (lo que vende)" con Producto, Precio y Ultima actualizacion (antes solo gerente/admin).

---

## v12.9.57 - Modales mas faciles de cerrar en mobile (2026-07-04)

- Todos los popups/modales ahora tienen alto maximo (92vh) con el cuerpo scrolleable y la cabecera (boton Cerrar) y el pie (Cancelar/Guardar) fijos y siempre visibles, incluso en modales largos. Antes, en mobile, esos botones podian quedar fuera de pantalla.
- Se cierra tocando el fondo oscuro afuera del cuadro. Tap targets mas grandes en mobile.

---

## v12.9.56 - Prioridad de precio por proveedor (2026-07-04)

- El precio mostrado por proveedor (buscador de producto y panel del proveedor en Proveedores) prioriza la ULTIMA modificacion; en caso de empate de fecha, gana el precio de la ultima COMPRA sobre el de "Mis Precios". Si no hay compra, se usa Mis Precios; si no hay ninguno, "-".

---

## v12.9.55 - Precios por proveedor (2026-07-04)

- Nuevo: precio por proveedor por producto (`provider.productPrices[pid] = {cost, marketPrice, date}`), sincronizado con el proveedor.
- Mis Precios (proveedor): dos secciones - arriba los productos ASIGNADOS a el, abajo los que vende pero todavia no le asignaron (los seleccionados como "Productos que vende"). Columna "Ultima modif." con la fecha. Al guardar, si el producto esta asignado tambien actualiza el precio global (afecta ventas).
- Proveedores (gerente/admin): recuadro "Precios de <proveedor>" con producto, precio y ultima actualizacion.
- Proveedores (empleado/admin/gerente): buscador de producto que muestra todos los proveedores que lo venden, su precio y la fecha de ultima actualizacion (prioriza el precio declarado en Mis Precios; si no, el ultimo costo de compra).

---

## v12.9.54 - Facturacion cuenta corriente forzada + aviso de feriado al cliente (2026-07-04)

- Facturacion: TODAS las facturas enviadas a TusFacturas van con `condicion_pago` = "205" (Cuenta corriente) forzado en el payload, sin depender de la variable de entorno.
- Cliente (Inicio): si hay un feriado aprobado en los proximos 7 dias, aparece un recuadro "El Mercado permanecera cerrado el dia DD/MM, no vamos a operar ese dia. Faltan X dias" (X = dias desde hoy; "Es hoy" / "Falta 1 dia" segun corresponda).

---

## v12.9.53 - Sincronizacion: envio confirmado + indicador de pendientes (2026-07-04)

- Pedido de cliente y compra de proveedor ahora confirman contra el servidor al enviarse (fail-fast): si hay internet, avisan "enviado"; si no, avisan claramente "SIN CONEXION: todavia no se envio, quedo pendiente" en vez de decir "guardado" en silencio.
- Indicador visible arriba de "N cambio(s) sin enviar al sistema" cuando la cola offline tiene items (cualquier rol).
- Al presionar Salir con cambios pendientes, pide confirmacion; ademas, aviso del navegador (beforeunload) si se intenta cerrar la pestania con pendientes.
- El resto de acciones (empleados en la calle) mantienen la cola offline resiliente, ahora con el indicador para que nunca sea silencioso.

---

## v12.9.52 - Fix: sincronizacion del rol proveedor (2026-07-04)

- El rol proveedor cargaba compras/gastos y precios pero NO se sincronizaban al servidor: quedaban solo en su localStorage y no aparecian en el resto del sistema. Causa: `canWritePatchCloudSync()` (frontend) no incluia a `proveedor`, asi que su patch nunca se enviaba (el servidor ya lo aceptaba via PATCH_SYNC_ROLES). Se agrego `proveedor` a esa funcion.

---

## v12.9.51 - Config: recuadros con scroll (2026-07-04)

- En Configuracion (gerente) se agrego scroll (alto maximo + barra) a los paneles "Orden del sidebar", "Productos con leyenda kg", "Aviso de feriados (WhatsApp)" y "Permisos y sidebar por rol", para que no ocupen tanto alto.

---

## v12.9.50 - Interruptores de WhatsApp y Facturacion (2026-07-04)

- Nuevo check "Enviar WhatsApp automaticos" (`appSettings.whatsappEnabled`, default activado): destildado, no se envian los WhatsApp de mora, aviso de cambio de pedido, suba de precio ni feriados. Kill-switch por env `WHATSAPP_DISABLED`.
- Nuevo check "Facturacion automatica activada" (`appSettings.billingEnabled`, default activado): destildado, el scheduler no emite facturas automaticamente (la facturacion manual desde la pagina sigue disponible).

---

## v12.9.49 - Interruptor de correos automaticos (2026-07-04)

- Nuevo check en Configuracion "Enviar correos automaticos" (`appSettings.mailingEnabled`, default activado). Destildado, no se envian los correos de facturacion ni los de mora (dunning). El WhatsApp de mora no se ve afectado.
- Ademas, kill-switch a nivel servidor: si `MAILING_DISABLED` esta seteada en el .env, `sendMail` no envia ningun correo.

---

## v12.9.48 - Alineacion al plan: dunning, recambio y feriados (2026-07-04)

### Recordatorios de pago (dunning, backend)
- Estado por cliente persistido (`dunningState` en app_state: dueDate, daysWithoutPayment, lastWhatsappDate, emailSent).
- "Dia esperado" segun tipo de pago: contado/contra factura = tuvo pedido ayer; semanal/cuenta corriente = coincide el dia de semana (cuenta corriente SIN dia de pago no se molesta); 10/15/20 dias y mensual = ultimo pago (o primer saldo) + N.
- WhatsApp una vez por dia; el correo de mora se manda UNA sola vez al llegar a 3 dias (antes se reenviaba todos los dias). Se sale de mora al pagar en/despues del dia esperado o si el saldo queda en 0.
- Asunto del correo de mora configurable en Configuracion (`dunningMailSubject`, usa {cliente}).

### Recambio
- "Proximo pedido" ahora genera un PEDIDO SEPARADO a $0 (no se mezcla con el pedido del cliente).
- Idempotencia por nota "[REC-id]" en el pedido materializado (ademas del estado).
- Se valida que la cantidad a recambiar no supere la pedida.
- Las reposiciones "manana" se materializan cuando llega la fecha (createdDate+1 <= hoy) y se procesan al cargar la app (gerente/admin/empleado).
- Nueva pagina "Reposiciones" (gerente/admin/empleado) con tabla (fecha, cliente, productos recambio/pedido, reponer en, estado, foto) y boton Eliminar para pendientes; el banner "Prod reposicion" lleva a esa pagina.

### Feriados
- Boton en Configuracion renombrado a "Gestionar feriados" (id config-holidays-btn), como en el plan.

---

## v12.9.47 - Motor de precios dinamicos (2026-07-04)

### Motor (app.js, default APAGADO - sin cambios hasta activarlo)
- Ajusta el margen segun cuanto subio/bajo el costo de un producto POR ENCIMA de la inflacion general (canasta interna = mediana del cambio % de costos de los productos, ventana 14 dias). Subas fuertes comprimen el margen (hasta el minimo de la seccion) y el precio sube de una; bajas fuertes expanden el margen y el precio baja progresivamente (30% de la brecha por paso), con recalculo programado cada 14 dias para las bajas grandes. Zona neutral: el margen se recupera hacia el normal.
- Secciones de margen (min/normal/max) editables; cada producto pertenece a una seccion (default "Otros").
- Modo: Apagado (comportamiento actual) / Simulacion (calcula y registra sin tocar precios) / Activado. La edicion manual en Precios siempre gana y queda logueada.

### UI
- Configuracion (gerente): panel "Precios automaticos" con modo, secciones, parametros avanzados e indicador de canasta.
- Precios: columnas "Seccion" y "Auto" (pill del ultimo ajuste + checkbox "No ajustar").
- Nueva pagina "Ajustes de precios" (gerente/admin): metricas, registro de ajustes (con Revertir) y agenda de convergencia.

### Backend
- Endpoint Compra Hoy (server.js): marca `pendingReprice`; el frontend reprecia al cargar (bajo modo off el resultado es el mismo).

### Datos
- `state.marginSections`, `state.priceAutoLog`, `state.priceAutoSchedule`; `appSettings.priceAuto`; `product.marginSectionId/priceAutoExempt/isBasketReference`. Sincronizados y mergeados.

---

## v12.9.46 - Compras: hora de cada movimiento (2026-07-04)

- Las compras/gastos ahora guardan la hora de creacion (`createdAt`). En la tabla de movimientos de Compras/Gastos se muestra la hora (hh:mm) junto al nombre del usuario que registro el egreso, igual que en Pedidos. Aplica a los egresos nuevos (los cargados antes no tienen la marca de hora).

---

## v12.9.45 - Impresion: forzar tema claro (2026-07-04)

- Los documentos imprimibles ahora fuerzan `color-scheme: light only` (meta + CSS con fondo blanco). Evita que el "modo oscuro forzado" del navegador (Chrome/Android) oscurezca el remito y muestre barras negras tapando los nombres de los productos. Antes salia bien en un dispositivo sin ese modo y mal en uno con force-dark activado.

---

## v12.9.44 - Vehiculos: pedidos sin vehiculo (2026-07-04)

- La pagina Vehiculos solo mostraba los pedidos cuyo vehiculo coincidia con un vehiculo activo, por lo que los pedidos sin vehiculo asignado (o con un vehiculo borrado/inactivo) quedaban huerfanos y no se podian reasignar (ej. Charrua). Ahora aparece una columna "Sin vehiculo" con esos pedidos del dia y el selector incluye la opcion "Sin asignar".

---

## v12.9.43 - Parser: minimo por atado (2026-07-04)

- Los productos por atado no se dividen a menos de 0,5: si el parser interpreta una fraccion menor (ej. "un poquito" = 0,2), se sube a 0,5. Excepcion: perejil, que admite minimo 0,25. Ej: "un poquito de menta" -> 0,5 menta; "un poquito de perejil" -> 0,25 perejil. (Aplica a pedidos nuevos; los ya cargados no se recalculan solos.)

---

## v12.9.42 - Impresion +3pt y fixes de parser (2026-07-04)

### Impresion
- Se aumentaron en 3 puntos (px) todas las fuentes de los documentos imprimibles (remitos, dividir, vehiculos, historiales, proveedores, etc.).

### Parser de WhatsApp (Nuevo Pedido)
- "cebolla blanca" (por bolsa o kg) ahora se toma como Cebolla sin dejar "blanca" como nota (blanca es la variedad por defecto).
- "cebolla verde" / "cebolla verdeo" / "cebolla de verdeo" ahora mapean a Verdeo (antes caia en Cebolla Kg con nota).
- "N docena y media" (y atados/bolsas/cajones/jaulas/plantas/unidades/maples/kg) se interpreta como N,5 de esa unidad. Ej: "Banana 1 docena y media" -> Banana docena 1,5.

---

## v12.9.41 - Compras: fix boton Guardar en Otro gasto y favoritos del vendedor (2026-07-04)

- Compras/Gastos: al elegir Tipo "Otro gasto" (y otros tipos sin grilla) el boton "Guardar egreso" volvia a desaparecer porque quedaba dentro del bloque de items que se oculta. Se movio el Total y la fila de botones fuera de ese bloque, asi el boton Guardar egreso queda siempre visible; el recuadro Productos se oculta en esos tipos.
- Rol empleado: se oculta el recuadro "Favoritos del vendedor".

---

## v12.9.40 - Cierre de caja de empleados (2026-07-04)

### Empleado (Horarios)
- Nuevo recuadro "Cierre de caja": lista los pedidos de hoy con su total y permite marcar cuales cobro en efectivo. Vienen tildados por defecto los que ya tienen un pago registrado en Pagos; si marca uno sin pago, aparece un popup para registrarlo (efectivo).
- "Hoy cobre en efectivo: $X" (editable, default = suma de los marcados) con la diferencia contra lo que deberia haber cobrado.
- "Mi caja al cierre del dia es: $X" (editable, default = cierre del dia anterior - gastos/reintegros de hoy + cobros en efectivo de hoy) con la diferencia contra lo esperado. Al guardar, ajusta la caja del empleado al monto real ingresado (crea un ajuste de caja por la diferencia).
- Historial "Ultimos cierres de caja" con vista 30/60/120/todos (fecha, cobro esperado/real/dif, caja esperada/real/dif).

### Gerente / Admin
- En Empleados y en Caja se agrego el recuadro "Cierres de caja (empleados)" con los ultimos cierres de cada empleado activo, diferencias de cobro y de caja, con vista 30/60/120/todos.

### Datos
- Nueva coleccion `state.cashClosings` (sincronizada). Funciones: getCashClosings, expectedEmployeeCash, recordCashClosing, renderCashClosingHistory.

---

## v12.9.39 - Auto-actualizacion, logout por inactividad y toggle de contraseña (2026-07-04)

- Auto-actualizacion: el sistema detecta cuando se desplego una version nueva (compara el Last-Modified/ETag de app.js con un HEAD sin cache). El chequeo ahora corre a horas fijas (4,5,6,7,8,10,12 y luego cada 4h) y al volver a la pestania, para reducir trafico. Si hay version nueva y la pestania esta oculta o el usuario lleva >2 min inactivo, recarga sola; si esta usando activamente muestra el banner para no interrumpir. Muestra un banner "Hay una nueva version disponible - Actualizar ahora" y, al volver el foco a la pestania, recarga solo con cache-bust (?v=timestamp). Asi los usuarios no tienen que borrar cache ni cerrar la pagina. NOTA: recien toma efecto para los deploys POSTERIORES a que cada usuario cargue esta version una vez.
- Cierre de sesion por inactividad: si no se usa el sistema por 4 horas, la sesion se cierra sola.
- Login: el boton de "ver contraseña" pasa a ser un icono sin marco dentro del input de contraseña.

---

## v12.9.38 - Reajuste de fechas al cambiar de dia (2026-07-04)

(v12.9.38b) Se amplio el reajuste por cambio de dia a Historiales/Analisis y al "Hasta" de Facturacion. Compras/Gastos, Empleados, Horarios y Registrar transferencia ya usan la fecha de hoy fija en cada render, por lo que siempre muestran hoy.

- Si el sistema queda abierto de un dia para el otro, al cambiar de dia (deteccion en cada render con `ui.lastActiveDay`) los filtros de fecha operativos se reajustan solos a hoy: Pedidos, Proveedores, Remitos, Unidades, Vehiculos, Rendimiento/Analisis y el "Hasta" de Saldos. No se toca el "Desde" de Saldos ni Facturacion (siguen mostrando el rango completo, como se pidio). Durante el mismo dia se puede navegar libremente a rangos pasados sin que se reajusten.

---

## v12.9.37 - Fixes proveedor/unidades y mejoras caja/compras (2026-07-04)

### Fixes
- Rol proveedor: "Guardar egreso" no hacia nada porque el submit leia el campo Vendedor (que se saco para ese rol) y tiraba error. Se blindaron las lecturas de campos que pueden no existir.
- Unidades: el boton de vista cuadricula en "Productos sin compra o compra insuficiente" no hacia efecto porque el panel forzaba 1 columna siempre; ahora la vista cuadricula usa varias columnas y la lista una sola.

### Mejoras
- Caja: dropdown "Mostrar 30 / 60 / 120 / Todos" para los movimientos (igual que Compras/Gastos), estado `ui.cajaLimit`.
- Compras/Gastos: en la tabla de movimientos, al lado del usuario que registro el egreso se muestra la hora (formato como en Pedidos).

---

## v12.9.36 - Compras/Unidades: total, favoritos y toggle cuadricula/lista (2026-07-04)

### Compras/Gastos
- El Total ahora se muestra arriba del boton "Agregar producto", justo debajo del ultimo producto agregado (antes estaba arriba, en la grilla de campos).
- "Favoritos del proveedor" se movio abajo del recuadro "Productos", justo arriba de "Favoritos del vendedor".
- El recuadro "Productos" tiene los botones de vista cuadricula/lista (mismos iconos que Nuevo Pedido). Toggle in-place (no recarga el formulario) que tambien alterna la vista de los favoritos del vendedor.

### Unidades
- Se agregaron los botones de vista cuadricula/lista en "Notas de productos de hoy", "Productos por unidades pendientes" y "Productos sin compra o compra insuficiente" (estado `ui.unitsProductView`).

---

## v12.9.35 - Compras: fila en una linea, advertencia en popup y fix zebra mobile (2026-07-03)

### Compras/Gastos
- La fila de cada producto vuelve a quedar en una sola linea (el boton de ultimo costo y la advertencia habian roto el layout metiendose dentro de la celda de costo). El boton "ult $X" ahora es una columna propia (visible tambien en mobile). Labels renombrados: "cant", "costo u.", "$ mercado".
- La advertencia de suba >30% dejo de ser un cartel inline y ahora es un popup (confirm) en desktop y mobile: Aceptar mantiene el costo (y al guardar se avisa por WhatsApp), Cancelar borra el costo cargado.
- "Unid. calculo" sigue solo para mayoristas con relacion minorista (se colapsa su columna cuando no aplica, sin dejar hueco).

### Impresion
- El zebra gris de los remitos ahora tambien sale al imprimir en mobile: se agrego un bloque @media print que fuerza print-color-adjust y el fondo gris con !important (antes se veia en la pagina previa pero no en la impresion final del celular).

---

## v12.9.34 - Impresion: zebra en remitos impresos y fix Android (2026-07-03)

### Impresion / Remitos
- Se fuerza `print-color-adjust: exact` en los documentos imprimibles: el fondo gris (zebra) cada 2da fila de los remitos ahora sale tambien al imprimir / exportar PDF, no solo en el popup "Ver". Mantiene el formato compacto actual (interlineado minimo, letra chica) de Exportar PDF.
- Fix impresion en Android: la ventana de impresion movil ya no se auto-cierra (eso dejaba la hoja en blanco o cancelaba el dialogo en Android Chrome). Ahora muestra el contenido, intenta imprimir automaticamente y ademas ofrece un boton "Imprimir / Guardar PDF" visible como respaldo. En iOS ya funcionaba y sigue igual.

---

## v12.9.33 - Compras: costo unitario, ultimo costo y aviso de suba por WhatsApp (2026-07-03)

### Frontend / Compras
- El campo "Unid. calculo" solo se muestra para productos mayoristas con relacion minorista marcada en Productos (desktop y mobile, todos los roles).
- El input de costo unitario formatea los miles con punto (xxx.xxx) mientras se escribe.
- Cada producto seleccionado muestra un boton "Ultimo costo: $X" que al hacer click pega ese costo en el input.
- Advertencia visible si se carga un costo mas de 30% mayor al ultimo costo guardado.

### Aviso de suba por WhatsApp (backend + bot)
- Al guardar una compra con un costo >30% mayor al guardado, se envia automaticamente un WhatsApp (plantilla aprobada) a los clientes que tienen ese producto en pedidos de hoy, con el precio de venta de cada cliente (viejo vs nuevo, recalculado por costo+margen y ajuste del cliente). Endpoint `/clients/price-increase-notify`.
- Mensaje y nombre de plantilla configurables en Configuracion (admin/gerente): `priceIncreaseMessage` (usa {producto}, {porcentaje}, {precioAnterior}, {precioNuevo}) y `priceIncreaseTemplateName`. Default: "El producto {producto} tuvo una suba de un {porcentaje}%, paso de valer {precioAnterior} a valer {precioNuevo}, si se desea cancelar la compra avisar, de caso contrario no hace falta contestar, gracias".

---

## v12.9.32 - Stock: conteo por grupo en kg (2026-07-03)

### Stock
- El panel "Grupos / equivalencias" ahora permite el conteo del stock fisico por grupo en kg (una sola fila por grupo, en vez de contar kg/bandeja/unidad por separado). Columnas: Stock estimado (kg), Stock real (kg) con input + Guardar, Demanda hoy (kg) y Sugerencia de compra.
- El stock contado (o estimado: ultimo conteo + compras del grupo en kg - pedidos del grupo en kg) descuenta la sugerencia de compra: reduce el pool que se arma desde el bulto (jaulas/cajas), no los enteros que se compran por caja. Ej: 30 kg pedidos con 10 kg en stock -> 1 jaula en vez de 2.
- Los conteos de grupo se guardan como movimientos con productId sintetico "GRPKG:<idGrupo>" para no chocar con los productos reales ni con los conteos por producto. Funciones: groupCountKey, groupOrdersKg, groupComprasKg, getGroupEstimatedKg, getGroupStockKgToday, recordGroupStockCount.

---

## v12.9.31 - Proveedor: compra por dia y privacidad en Dividir (2026-07-03)

### Rol proveedor
- En Pedidos, se reemplaza "Tu pedido total del dia por producto" por "Compra por dia": una fila por dia con el precio total de la compra (cantidades x costo del proveedor cargado en Mis Precios), y al hacer click se despliega el detalle de cada producto asignado ese dia con su subtotal. Respeta el rango de fechas seleccionado.
- En Dividir Compras, el recuadro "Agrupado por cliente" ya no muestra el nombre del cliente; solo el numero.

---

## v12.9.30 - Facturacion TusFacturas: provincia, condicion de pago e IVA (2026-07-03)

### Backend (billing.js) - requiere ./deploy.sh (rebuild)
- Codigos de provincia corregidos a la tabla oficial de TusFacturas (estaban corridos: Salta se enviaba como "10" que es Jujuy; el default "17" que ahora es Salta explicaba a los que salian en Salta). Se agrega normalizacion de acentos y alias de CABA/Capital Federal. Ahora Salta=17, Jujuy=10, Buenos Aires=2, CABA=1.
- condicion_pago por defecto pasa a "205" (Cuenta corriente); antes "211" (Tarjeta de credito). Verificar que la variable de entorno TUSFACTURAS_CONDICION_PAGO no este forzando 211.
- Codigos de condicion_iva corregidos: Exento = "E" (antes "EX", invalido) y Monotributo = "M" (antes "MT"). Consumidor Final y Responsable Inscripto sin cambios.
- La condicion de IVA (igual que domicilio, provincia y razon social) prioriza lo que devuelve AFIP por CUIT; el dato cargado a mano en el cliente queda solo como respaldo si AFIP no devuelve nada. En la practica, de lo cargado a mano solo se usa el CUIT.

### Frontend
- Nuevo campo "Condicion IVA" en el formulario de cliente (Automatica/AFIP, Consumidor Final, Responsable Inscripto, Monotributo, Exento) para marcar exentos a los clientes que corresponda (46, 47, 48).

### Nota importante
- TusFacturas NO actualiza la condicion frente al IVA de un cliente que ya existe (solo la toma al crearlo). Los clientes 46/47/48 que ya se crearon como Consumidor Final probablemente haya que corregirlos una vez desde el panel de TusFacturas; de ahi en mas el sistema los enviara bien.

---

## v12.9.29 - Parser, proveedor y unidades (2026-07-03)

### Parser
- El match por alias ahora ignora los conectores "de/del/la/el". Antes un alias como "cebolla de verdeo" no matcheaba porque el parser quita el "de" del texto pegado; ahora "1 atado de cebolla de verdeo" carga Verdeo y no Cebolla Bolsa.

### Rol proveedor
- En Compras/Gastos ya no se renderiza el campo Vendedor ni el boton Registrar (updateKind los volvia a mostrar pese al display:none).
- En Pedidos, el detalle por producto de cada pedido muestra solo los productos asignados al proveedor.
- En Pedidos se agregan dos recuadros: "Pedidos por producto (hoy)" con desglose por cliente (estilo Dividir / Agrupado por producto) y "Tu pedido total del dia por producto".

### Unidades
- Al presionar Enviar en unidades pendientes, se quita el recuadro de ese pedido/producto (igual que Omitir), sin recargar la pantalla; si la tarjeta queda sin lineas, se saca entera.

---

## v12.9.28 - Compras: sumar por producto en la grilla de falta (2026-07-03)

### Frontend / Compras

- La grilla de falta agrupaba por producto + unidad, por lo que un mismo producto con la unidad escrita distinta en cada pedido (ej. Apio como "unidad" en un pedido y "atado" en otro) aparecia como dos tarjetas separadas. Ahora se agrupa solo por producto y se suma en una sola tarjeta, mostrando la unidad canonica del producto. Esto tambien colapsa los casos tipo "Remolacha por kg" vs "Remolacha por atado" cuando es el mismo producto con la unidad mal cargada en un pedido.

---

## v12.9.27 - Stock: conteo unico por grupo + conciliacion en Compras (2026-07-03)

### Frontend / Stock y Compras

- En Stock, los productos que son miembros de un grupo de equivalencia (ej. Berenjena Kg y Berenjena Unidad) o el producto "se compra entero" (cajon) ya NO aparecen como filas individuales: se cuentan una sola vez a nivel de grupo (panel Grupos / equivalencias). El bulto (jaula/caja) no se oculta porque es lo que se sugiere comprar.
- En Compras/Gastos la grilla de "falta" ahora concilia por grupo: en lugar de sobre-sugerir por cada miembro, muestra los enteros a comprar (cajones), netos de lo ya comprado, y el bulto a armar (jaulas/cajas), neto de lo ya comprado. Asi deja de aparecer "falta 2 cajones" cuando esos se arman desde jaulas.

---

## v12.9.26 - Stock: grupos y equivalencias (2026-07-02)

### Frontend / Stock

- Nueva seccion en Stock "Grupos / equivalencias" (admin/gerente): permite agrupar productos que son lo mismo contabilizado distinto, con un factor en kg por unidad de cada variante (berenjena unidad 0,4kg; calabaza unidad 2kg; manzana/pera unidad 0,25kg y bandeja 4kg; etc.). Asi la demanda del grupo se calcula una sola vez en kg.
- Regla especial (tomate): un producto se marca "se compra entero" (cajon, kg por unidad) y otro "bulto para armar el resto" (jaula, kg por bulto). La parte entera de cada pedido de cajon se compra entera; las fracciones (medios cajones) + los kg de los demas miembros (perita) se arman desde jaulas, redondeando para arriba. Ej: 1 cajon entero + 4 medios + perita -> 1 cajon + 2 jaulas.
- Panel de sugerencia por grupo en Stock (demanda en kg + cajones enteros a comprar + jaulas). La conciliacion automatica en Compras/Gastos (que hoy sigue mostrando el faltante por producto) queda como paso siguiente. Commit pendiente en este push.

---

## v12.9.25 - Precios: actualizan los pedidos del dia (2026-07-02)

### Frontend / Precios

- Al guardar precios en la pagina Precios y al usar "Importar precios (pegar)", los pedidos del mismo dia se actualizan con los nuevos precios (usa updateOrdersWithNewPrices). Antes los pedidos quedaban con el precio que tenian al cargarse. Commit pendiente en este push.

---

## v12.9.24 - Importar precios: match tolerante (2026-07-02)

### Frontend / Precios

- El importador de precios ahora hace match tolerante: intenta primero el nombre exacto y, si no encuentra, ignora palabras de relleno ("por", "x", "de", "del", "la", "el") - ej. "Zanahoria por Kg" matchea "Zanahoria Kg". Si la version tolerante corresponde a mas de un producto, no lo aplica y lo reporta como ambiguo. Commit pendiente en este push.

---

## v12.9.23 - Importar precios pegando (Precios) (2026-07-02)

### Frontend / Precios

- En la pagina Precios (admin/gerente), boton "Importar precios (pegar)": abre un textarea donde se pega "Nombre  Venta  Costo" (tab o espacios). Matchea por nombre contra el catalogo actual, actualiza costo y venta (y margen) de los productos existentes, saltea los que no existen y reporta la lista de no encontrados. Commit pendiente en este push.

---

## v12.9.22 - Rol Proveedor: Pedidos sin datos sensibles y "falta" en Venta de Hoy (2026-07-02)

### Frontend / Rol Proveedor

- Pedidos (rol proveedor): muestra solo el numero de cliente (no el nombre), sin precios ni total; el detalle muestra solo las cantidades. Se quita la columna de acciones.
- Venta de Hoy (rol proveedor): la grilla "falta" muestra los productos asignados al proveedor ese dia, igual que la ve el empleado al seleccionar su usuario en "Proveedor / Asignado a".

---

## v12.9.21 - Compras: reubicar botones Agregar producto / Guardar egreso (2026-07-02)

### Frontend / Compras

- En Compras/Gastos, los botones "Agregar producto" y "Guardar egreso" quedan uno al lado del otro, justo debajo del buscador de productos y arriba de la grilla de favoritos del vendedor (todos los roles, desktop y mobile). Commit pendiente en este push.

---

## v12.9.20 - Rol Proveedor: Proveedores y Caja Salida por estado (2026-07-02)

### Frontend / Rol Proveedor

- Proveedores (rol proveedor): se ocultan el boton "Agregar" y las pestanias "Activos"/"Inactivos".
- Venta de Hoy (rol proveedor): se elimina el recuadro "Vendedor" y su boton "Registrar".
- Venta de Hoy - Caja Salida segun Estado: con "Cuenta corriente" se oculta; con "Pagado" se muestra con los usuarios empleado (cada uno vinculado a su caja de efectivo) y la opcion "Transferencia" (vinculada a Banco).

---

## v12.9.19 - Ajustes del rol Proveedor (Venta de Hoy, Proveedores, Mis Precios) (2026-07-01)

### Frontend / Rol Proveedor

- Compras/Gastos del proveedor se renombra "Venta de Hoy": oculta Tipo, Caja salida, Empleado asignado y Vendedor; muestra Estado con "Cuenta Corriente" por defecto; el selector de productos lista los que el proveedor vende, ordenados con los que faltan (pedidos de hoy) primero. Commit pendiente en este push.
- Proveedores: se quita el recuadro "Buscar producto" (queda el panel "Productos que vende") y el campo "Margen defecto" del form; el boton "Pagar" pasa a "Cobrado"; en el pop-up de cobro el proveedor queda fijo (no seleccionable) para el rol proveedor y "Caja" se renombra "Pagado por:". Commit pendiente en este push.
- "Mis Costos" pasa a "Mis Precios": muestra los productos que el proveedor vende (como en su perfil), cada uno con boton "Desactivar" (lo saca de los que vende) y un boton "Agregar productos" para sumar productos a los que vende. Commit pendiente en este push.

---

## v12.9.18 - Parser: punto antes de parentesis no separa items (2026-07-01)

### Frontend / Parser

- En el parser de pedidos, un punto seguido de un parentesis ya no separa el item: "batata 2kg. ( grandes)" toma "(grandes)" como nota de la batata, en vez de crear un item fantasma (antes "grandes" matcheaba "Naranja Grande Jaula"). Commit pendiente en este push.

---

## v12.9.17 - Proveedores: productos que vende, detalle de movimientos y fix impresion mobile (2026-07-01)

### Frontend / Proveedores / Impresion

- Proveedores: al seleccionar un proveedor en el dropdown, aparece un panel "Productos que vende" que lista sus productos; para quien puede editar proveedores es editable (checkboxes con filtro, se guarda al instante), y para el rol proveedor es solo lectura. Commit pendiente en este push.
- Proveedores: en la tabla de movimientos, la descripcion de cada movimiento se despliega (click) mostrando los productos que componen esa compra (cantidad, costo unitario y total). Commit pendiente en este push.
- Impresion mobile: en mobile, "Exportar PDF remitos de hoy" (Remitos y Unidades) y "Imprimir movimientos" (Saldos) ahora imprimen solo su contenido en una pestania dedicada, en vez de imprimir la pagina completa o no disparar el dialogo. Se activa automaticamente el modo pestania en pantallas <=760px. Commit pendiente en este push.

---

## v12.9.16 - Proveedor: contador de recambios en Inicio (2026-07-01)

### Frontend / Rol Proveedor

- En el Inicio del proveedor se agrega la tarjeta "Recambios pendientes" con la cantidad de productos suyos marcados para reposicion. Commit pendiente en este push.

---

## v12.9.15 - Proveedor: selector de compras acotado y recambios visibles (2026-07-01)

### Frontend / Rol Proveedor

- En Compras/Gastos, el selector de productos (select y datalist) queda limitado a los productos asignados al proveedor. Commit pendiente en este push.
- El proveedor ve el panel de "Productos de reposición pendientes" filtrado a sus productos, y puede abrir la foto adjunta del recambio haciendo click en la miniatura (tambien disponible para el staff). Commit pendiente en este push.

---

## v12.9.14 - Nuevo rol Proveedor (2026-07-01)

### Frontend / Backend / Roles

- Nuevo rol `proveedor`, vinculado a una cuenta de proveedor (`user.providerId`) desde el formulario de Usuarios. Backend: incluido en STATE_READ_ROLES/PATCH_SYNC_ROLES y en el CHECK de la tabla users. Commits `f371157`.
- El proveedor solo ve: Inicio (panel propio con su estado de cuenta con la empresa, productos asignados, items de hoy y accesos rapidos), Pedidos (solo los que incluyen productos asignados a el), Dividir Compras (solo lo asignado a el, con export PDF/WhatsApp de lo suyo y sin poder reasignar ni cambiar de proveedor), Proveedores (solo su cuenta), Compras/Gastos (movimientos acotados a los que carga el), Mis Costos y Configuracion. Commits `5459957`, `e09a9a5`.
- "Mis Costos": vista rapida donde el proveedor carga el costo y el precio de mercado de sus productos asignados; actualiza el costo del sistema (`state.prices` + `product.baseCost`) sin tocar el precio de venta. Ademas puede cargar el costo generando una compra en Compras/Gastos, igual que el empleado. Commit `417010f`.

**Uso**: crear el usuario proveedor (rol Proveedor) y vincularlo a su cuenta de proveedor (Miriam, Chicho, Mario Ibero, Antonia, etc.); asignarle sus productos desde Productos / Dividir Compras (asignacion por producto). Deploy: cambia el backend -> `./deploy.sh` (rebuild; el nuevo rol requiere el ALTER del CHECK que corre en el bootstrap).

---

## v12.9.13 - Feriados en Config, plazo de pago, recordatorios de pago y pedir recambio (2026-07-01)

### Frontend / Backend / Config / Clientes / Cobranzas / Recambio

- Configuracion (admin/gerente): boton "Gestionar feriados" que abre el modal de alta/aprobacion de feriados (antes solo accesible desde Nuevo Pedido). Commit `0701bb1`.
- Clientes: en el edit, si el tipo de pago es semanal o cuenta corriente, aparece un dropdown de dia/plazo de pago (dias de la semana + 10/15/20 dias + mensual), guardado en `client.paymentDay`. Commit `0701bb1`.
- Recordatorios de pago (dunning): scheduler diario a las 8am en el backend (`runDunning` en server.js). Al vencer el plazo del cliente sin pago registrado, envia WhatsApp diario por plantilla Meta; a partir de 3 dias de mora envia correo al cliente (billingEmail) y al gerente. Plazos: contado/contra_factura = diario, semanal/dia de semana = 7, 10/15/20 dias, mensual = 30. Textos y plantilla configurables en Configuracion (`dunningEnabled`, `dunningWhatsappMessage`, `dunningMailMessage`, `dunningWhatsappTemplate`). Commit `32a38a3`.
- Pedir recambio: boton en Pedidos (staff) y Mis Pedidos (cliente) que abre un popup con los pedidos de los ultimos 3 dias; se eligen productos con +, se define cantidad (no mayor a la del pedido) y una foto obligatoria (camara o galeria), y "Reponer en: proximo pedido / manana". Se guarda en `state.replacements` y se muestra un panel de reposiciones pendientes en Pedidos y un cartel "Prod reposicion" en Inicio (empleado/admin/gerente). Al corresponder se genera un pedido de reposicion con items a $0 y nota "(reposicion)" (manana = dia siguiente; proximo = se adjunta al proximo pedido del cliente), asi aparece en Dividir Compras y en el remito sin tocar el precio real ni el saldo. Commits `71ab8f9`, `9a6bd39`.

**Deploy/externo**: cambia el backend -> `./deploy.sh` (rebuild). Crear en Meta la plantilla de recordatorio de pago (1 variable {{1}}) y cargar su nombre + activar en Configuracion. Requiere BROADCAST_KEY y SMTP en el `.env` (ya presentes).

---

## v12.9.12 - Fecha por defecto en Vehiculos/Unidades y lista de faltantes (2026-06-30)

### Frontend / Vehiculos / Unidades

- Vehiculos y Unidades vuelven siempre a la fecha de hoy por defecto (no arrastran una fecha de un dia anterior). Commit pendiente en este push.
- En Unidades, "Productos sin compra o compra insuficiente" se muestra en formato de lista (una columna) en vez de cuadricula. Commit pendiente en este push.

---

## v12.9.11 - Flete/comprobante, remitos PDF y aviso de cambios por WhatsApp (2026-06-30)

### Frontend / Backend / Compras / Remitos / Pedidos

- Compras/Gastos: nuevo tipo "Flete". En "Otro gasto" y "Flete" se puede adjuntar un comprobante (imagen comprimida) y, en el detalle del movimiento, aparece un boton "Ver comprobante". Commit `7382188`.
- Remitos: "Exportar PDF remitos de hoy" ahora imprime directo tambien en mobile (mismo formato que desktop, sin ir a otra pagina). Franja gris cada 2da fila de productos y filas en blanco sin gris. Commit `d98ef00`.
- Pedidos: al agregar o quitar un producto de un pedido (popup de edicion) se envia un aviso por WhatsApp al celular principal del cliente, via plantilla de Meta configurable. El texto/plantilla se edita en Configuracion (admin/gerente), con variables {cliente} y {detalle}. Backend: endpoint `/clients/order-change-notify` que usa el bot. Requiere BOT_BROADCAST_URL/BROADCAST_KEY y la plantilla aprobada en Meta. Commit `7fc43f2`.

---

## v12.9.10 - Unidades, parser docena, y detalle de Compras/Pagos (2026-06-30)

### Frontend / Unidades / Parser / Compras / Pagos

- Unidades: al enviar la cantidad de una linea, se muestra un tilde verde de confirmacion en la misma linea, sin popup ni recargar la pantalla. Commit `216c505`.
- Parser: los productos que se venden por docena, cuando se piden sin unidad y con cantidad > 2, se interpretan como unidades sueltas (ej. "Banana 6" -> 0,5 docena). Commit `25a5a4f`.
- Parser: el match de alias ahora tolera plural/singular (ej. "papas grandes bolsa" matchea el alias "papa grande bolsa"). Commit `25a5a4f`.
- Compras/Gastos y Pagos: en el detalle de cada movimiento se muestra el usuario que lo cargo (Compras no lo tenia) y el horario de carga (ambos). Commit `59decb8`.

---

## v12.9.9 - Vehiculos (impresion) y fecha por defecto del pedido (2026-06-30)

### Frontend / Vehiculos / Nuevo Pedido

- Impresion de Vehiculos (Sin Dividir, Todos y por vehiculo): la "Sumatoria total de productos" pasa de 2 a 3 columnas, y cada pedido muestra el N de cliente junto al nombre. Aplica en desktop y mobile. Commit `75f845e`.
- En "Sin Dividir" ya no se muestra el total de precio de cada pedido (se mantiene en "Todos" y por vehiculo). Commit `75f845e`.
- Nuevo Pedido: la fecha por defecto es el dia siguiente cuando se carga despues de las 10:00, y el mismo dia de 00:00 a 09:59. Commit `75f845e`.

---

## v12.9.8 - Eliminar productos inactivos (2026-06-30)

### Frontend / Productos

- En la pagina Productos, los productos inactivos tienen un boton "Eliminar" que los borra definitivamente del catalogo. Esta bloqueado (con aviso) si el producto figura en algun pedido, para no romper historiales. Util para limpiar duplicados (ej. la Remolacha inactiva PROD-040). Commit pendiente en este push.

---

## v12.9.7 - Agrupar variantes de producto en todas las listas (2026-06-30)

### Frontend / Orden de productos

- El orden de productos agrupa las variantes del mismo tipo una al lado de la otra (ej. Banana Docena junto a Banana Cajon; Manzana Roja Kg/Unidad/Bandeja/Caja juntas) en: Dividir compras (agrupado por producto: ordena por producto primero y responsable despues), la lista de productos/precios y Nuevo Pedido. Commit `e233674`.

---

## v12.9.6 - Match por palabra, Palta Kg, dividir y formato de cantidades en Sheets (2026-06-30)

### Frontend / Parser / Dividir / Sincronizacion

- Parser: el match de productos ahora compara por palabra completa (antes hacia substring), asi "ni" de una nota ya no cae dentro de "uNIdad". Esto corrige "Palta 1kg (NI BLANDAS...)" que tomaba "Palta Madura Unidad" y ahora toma "Palta Madura Kg", conservando la nota completa. Commit `e73afc6`.
- Parser: bonus cuando el nombre del producto termina en la unidad pedida, para desempatar variantes con la misma unitType (ej. "Palta 1kg" prefiere "Palta Madura Kg" sobre "Palta Madura Unidad"). Commit `e73afc6`.
- Dividir compras: el agrupado resuelve el producto por nombre cuando el item no trae productId, asi dos pedidos del mismo producto (ej. Menta) se suman en una sola linea aunque uno se haya cargado como texto libre. Commit `e73afc6`.
- Orden de productos (Nuevo Pedido): dentro de cada grupo de preferencia se ordena por nombre, agrupando las variantes del mismo producto una al lado de la otra (ej. Banana Docena junto a Banana Cajon; Manzana Roja Kg/Unidad/Bandeja/Caja juntas). Commit `e73afc6`.
- Impresion: la sumatoria de productos en los PDF de Dividir y Vehiculos pasa a 10px. Commit `e73afc6`.
- Sincronizacion con Google Sheets: las cantidades decimales (un peso en kg editado a mano sobre un producto "uni") se escriben como numero, sin la palabra "uni", para que la planilla las reconozca y sume; las cantidades enteras de unidades siguen como "N uni". Requiere republicar el Apps Script. Commit `64e272c`.

---

## v12.9.5 - Parser, dividir, vehiculos y formato de cliente en Sheets (2026-06-30)

### Frontend / Parser / Dividir / Vehiculos / Sincronizacion

- Parser de pedidos: resolver de nombre/nota mas robusto, no pela palabras discriminantes. "tomate cherry" ya no cae en "tomate perita" (toma Tomate Cherry), pero notas reales como "(para ensalada)" o "pequeñas" se conservan. Commit `44d5398`.
- Parser: "N kg y medio" / "N k y medio" se interpreta como N,5 (ej. "Cherry 1kg y medio" -> 1,5 kg; "Zuccini 1k y medio" -> 1,5). "zuccini"/"zucchini"/"zuchini" mapea a "zukini" (Zukini Kg). Commit `44d5398`.
- Dividir compras: el agrupado por producto usa la unidad canonica del producto, asi "Huevos Maple" de dos pedidos se suman en una linea aunque la unidad escrita difiera, y "Remolacha" (cargada como atado) ya no aparece como kg. Commit `d8522fb`.
- Dividir compras: el "Agrupado por cliente" impreso se muestra en 3 columnas (minimo margen) y todo el contenido a tamaño 10. Commit `d8522fb`.
- Vehiculos: "Imprimir todos" ya no genera una primera hoja vacia con solo titulos (se saltean los vehiculos sin pedidos y se quita la portada). Commit `5618a29`.
- Vehiculos ("sin dividir" e "imprimir todos"): el numero de orden va arriba del nombre del cliente y el total al final del pedido (misma columna); los pedidos se muestran en 3 columnas (minimo margen) y el contenido a tamaño 10. Commit `5618a29`.
- Sincronizacion con Google Sheets: al escribir los pedidos, la celda de cliente ahora es "NNN) Nombre" (ej. "015) H Villa Vicuna", "012) Estacion Belgrano 2") en vez de solo el nombre. Requiere rebuild (`./deploy.sh`). Commit `602c7c6`.

---

## v12.9.4 - Facturacion: detalle de pedidos y envio automatico por correo (2026-06-29)

### Frontend / Backend / Facturacion

- En la tabla de Facturacion, la cantidad de pedidos de cada cliente ahora es un boton: abre un popup con los pedidos del periodo que acumulan IVA, con detalle desplegable por pedido, total e IVA por pedido, fila de totales y un boton para imprimir el remito de cada pedido. Commit `9bac557`.
- El popup incluye un boton "Imprimir todo" que arma un documento (encabezado del cliente, periodo y detalle de cada pedido con totales) para enviarselo al cliente. Commit `9bac557`.
- Envio automatico por correo: al emitir la factura (corrida automatica de las 23hs y tambien "Emitir pendientes ahora") de clientes semanal/quincenal/mensual, se envia al correo de facturacion un PDF con el detalle de los pedidos incluidos (generado en el servidor con pdfkit) y la factura fiscal de TusFacturas adjunta (descargada al momento del envio). Los clientes diarios quedan excluidos. Commit `5e00f18`.
- Backend: `sendMail` admite adjuntos; nuevas funciones `buildBillingDetailPdf`, `fetchPdfAttachment` y `emailBillingResults`; las entradas de facturacion ahora incluyen `orderIds` y `email`. Requiere SMTP configurado en el `.env` y rebuild (`./deploy.sh`, instala `pdfkit`). Commit `5e00f18`.

---

## v12.9.3 - Impresion, parser de pedidos y dividir compras (2026-06-29)

### Frontend / Impresion / Parser / Dividir / Facturacion / Remitos (Apps Script)

- Impresion: el texto interno de todos los documentos (Vehiculos, Saldos, Dividir Compras, Proveedores, etc.) pasa a 11px; los titulos conservan su tamano. Commit `4f73e53`.
- Facturacion: el boton PDF ahora regenera la URL en TusFacturas (`regenerar_pdf`) en lugar de reutilizar la URL del alta que caduca (error ERRT001). Backend `regeneratePdf` en `billing.js` + endpoint `/billing/regenerate-pdf`; frontend `abrirFacturaPdf`. Commit `4f73e53`.
- Pedidos: al usar `Cargar` en `Pegar pedido de WhatsApp` se guarda el texto interpretado, con un boton para verlo/descargarlo (simetrico al de la imagen del pedido manuscrito). Commit `adf232c`.
- Parser de pedidos (casos reales #19/#30/#48): productos sin cantidad asumen cantidad 1; `un poquito`/`un poco` -> 0,2; `pimiento` mapea a `morron`; `aji molido` mapea al molido/`en polvo` (no al picante); `queso de cabra` resuelve al producto de cabra (match por nombre completo, no pela la palabra como nota); `x kg`/`x cajon`/`x planta` se interpretan como unidad y no como nota basura; `nuez moscada` queda sin match en vez de caer en `Pera`. Commit `e579ded`.
- Remitos: interlineado de la tabla al minimo legible (line-height 1.05, padding de fila reducido, border-collapse). Commit `78be0a0`.
- Dividir compras: el agrupado se hace por nombre de producto normalizado (fusiona `Menta` que aparecia duplicada y separa `Chaucha` que se perdia por colision de id); total por producto visible en pantalla y en el export de WhatsApp; numeros de cliente sin ceros a la izquierda y cantidades enteras sin decimal; el export de WhatsApp respeta el toggle `Agrupado por cliente`. Commit `adaee20`.
- Scripts de Remitos (Apps Script, repo `remitos-impresion/`): boton para imprimir a PDF horizontal (margenes 0.59cm) las paginas con contenido segun la tabla `Datos A7:C44`, apertura automatica del PDF y correccion del archivo destino por ID. Commits `3b72e48`, `5ee1ec6`, `c336d1a`, `9f8cc58`, `832aa33`.

---

## v12.9.2 - Feriados, aviso masivo y sincronizacion robusta de Sheets (2026-06-28)

### Frontend / Backend / Google Sheets (Apps Script) / Seguridad

- Feriados: recuadro con alta y aprobacion (el empleado propone, admin/gerente aprueban), bloqueo de la fecha en el calendario y texto del aviso configurable. Commit `5e2c08f`.
- Aviso masivo de feriado por WhatsApp a clientes activos via plantilla aprobada de Meta: bot `/broadcast` + `sendTemplate`, endpoint ERP `/clients/holiday-broadcast`, boton `Avisar a clientes`, env `BOT_BROADCAST_URL`/`BROADCAST_KEY`. Commit `f72f44f`.
- Telefonos adicionales por cliente: campo en la ficha y el bot reconoce cualquiera de los numeros del cliente. Commit `c6aee0e`.
- Sincronizacion de edicion de pedidos: el backend detecta pedidos editados/cancelados y el Apps Script hace upsert por numero (recuerda la fila en Properties) actualizando o vaciando la fila. Commit `d6dfad1`.
- Compra Hoy se observa por escaneo periodico (soporta formulas, no solo onEdit); frecuencia escalonada por franjas horarias (6-6:30 cada 5min, 6:30-10 cada 1min, 10-12 cada 5min, 12-14 cada 10min, 14-6 cada 1h). Commits `c6e46a5`, `2b1c48c`, `b9ac4b2`.
- Precios: `Guardar precios` ya no pisa precios editados a mano de productos derivados (solo propaga relaciones si cambio el costo de la fila). La busqueda de la fila de encabezados ya no asume fila 1 (soporta encabezados en fila 2 y productos en columna B). Busqueda de pestania sin importar mayusculas. Commits `c6e46a5`, `c500143`, `f7248af`.
- Rendimiento: `mirrorStateToTables` solo reconstruye las tablas que cambiaron, acelerando los guardados chicos. Commit `f7248af`.
- Seguridad: el `/broadcast` del bot rechaza el pedido si `BROADCAST_KEY` esta vacio (no queda accesible via Caddy `/wa/`). Commit `7afa530`.
- Documentacion y operacion: manual de feriados/aviso/sync, checklist de deploy y `.gitignore` para datos reales. Commits `cbddd83`, `83dafb9`, `3751070`.

---

## v12.9.1 - Bot de WhatsApp, endpoints externos y sync inicial a Sheets (2026-06-27)

### Backend / Integraciones / Parser

- Proyecto nuevo `whatsapp-bot`: bot WhatsApp Cloud API (webhook, clasificacion con IA OpenRouter, reglas de horario y confirmacion de equipo, notificaciones). Integrado en docker-compose con ruta `/wa/webhook` en Caddy. Commits `d8e6ed6`, `b632123`, `278ee1c`, `80ed983`.
- Endpoints externos del ERP para el bot (`/external/clients/by-phone`, `/external/orders/today`, `/external/products/names`, crear/agregar/cancelar pedido) con matcher de productos, precios+IVA por tier y segunda ronda, espejando a tablas en transaccion. Commit `4615287`.
- Sync a Google Sheets via Apps Script webhook: pedidos nuevos a la pestania `pedidos` (formato ancho, cliente en columna B) y precios/costo/compra-hoy a la pestania `precios`, con mapeo por nombre normalizado + overrides y diff en backend al guardar estado. Commits `d49e84f`, `6f5f69f`, `9cedb83`, `ba36575`.
- Compra Hoy es de entrada: el sheet no la escribe; al editarla actualiza el costo del producto y recalcula el precio de venta manteniendo el margen (como una compra). El sistema solo escribe Venta y Costo. Commits `6f5f69f`, `9cedb83`.
- Parser de pedidos de WhatsApp: gramos -> kg, coma/punto decimal no se parte (0,5), punto como separador de items, match por conjunto de palabras (`Papa Premium Bolsa`), variantes Unidad/Atado en conteo suelto, envases (botella/frasco/pote/horma) como unidad, guard de match debil. Commits `51888b0`, `a242476`, `302ef57`.
- Pedidos: al elegir cliente no se borra el carrito ni el texto de `Pegar pedido de WhatsApp`; en el popup de editar pedido el input Nota es mas chico y hay un boton X para quitar el producto de la fila. Commit `b8b4c73`.

---

## v12.9.0 - Subsistema de Stock, lote rapido de mejoras y Facturacion (2026-06-26)

### Frontend / Backend / Stock / Facturacion / Despliegue

- Subsistema de stock de fraccionados: pagina Stock, conteo diario, merma, sugerencia de compra en bultos (con override por menor y multi-bulto), peso por producto en Config, hook de compra y grafico de merma en kg en Inicio. Activar/desactivar por producto. Commits `0705b86`, `1077f71`, `43e8fa9`, `a879d28`, `8ef5e45`, `63accf0`.
- Facturacion para clientes que la requieren: pagina con cuentas vinculadas + rango, historial de emisiones con CAE/PDF imprimible y `Ver Pedidos` con remito directo y detalle desplegable; boton Factura en Mis Pedidos; OCR de imagen por OpenRouter con prompt configurable (API key solo por env). Commits `5f368f6`, `e83eb96`, `f8ac4cb`, `0ee79c5`.
- Compras: boton Guardar siempre visible (incluye `Otro gasto`), detalle de productos colapsable, y el stock impacta en los faltantes sugeridos. Commits `2cc17a2`, `a879d28`, `8ef5e45`.
- Lote rapido de mejoras de UX (#1-#15): edicion inline de cantidades en Unidades, modal de pedido con `Agregar producto` y foco en cantidad, boton enviar/omitir por linea, set absoluto en `Actualizar todos`, orden por favoritos/ultima compra, dropdown `mostrar N`, combobox de cliente en Pagos, detalle desplegable en Saldos, kg solo para productos configurables, admision de clientes pendientes desde Clientes y correo de activacion. Commits `baa640c`, `97913f9`, `14f2f79`, `3555d87`, `dad347b`, `954d255`, `3fa7839`, `3094502`, `f041078`, `6abe6c2`.
- Roles: cliente/empleado/contador trabajan online (sin snapshot en localStorage ni banners de sync); localStorage completo solo para admin y gerente. Commit `7e3492b`.
- Despliegue: `deploy.sh` (pull + backup + rebuild condicional) para `/opt/pare-carrito`, dumps comprimidos con rotacion y backup no bloqueante. Commits `fcd1785`, `306745f`, `23db3b6`, `bfbca19`, `bb2499d`, `115134d`.

---

## v12.8.42 - Parser WhatsApp y fusion segura de sync (2026-06-24)

### Frontend / Nuevo Pedido / Sincronizacion

- El parser de `Pegar pedido de WhatsApp` separa lineas con varios productos por comas o `y` solo cuando cada segmento parece un item con cantidad.
- Se corrigio la deteccion de notas para que partes reales del nombre, como `Abeja` en `Miel de Abeja` o `Soja` en `Brote de Soja`, no queden cargadas como nota.
- Se convierten gramos a kilos en entradas como `500g`, `500 g` o `500 gramos`.
- Los alias especificos del cliente y sus favoritos se priorizan antes del match generico por unidad, evitando casos como `Naranja 1` a `Naranja Docena` cuando el cliente usa `Naranja Jaula`.
- La descarga automatica de nube ya no reemplaza datos si hay cambios locales pendientes; la descarga manual fusiona nube y local y reencola las diferencias para subirlas sin pisar cambios.
- Commit funcional desplegado: `0f83e0eee8b1d924f0ef34c72c22226214c2ae81`.
- Verificacion: `node --check`, `git diff --check`, escaneo de secretos, deploy de `app.js` y health VPS correcto en API/DB.
- Backups: PC post-cambio `auditoria/repo-backup-20260624-post-sync-parser-merge.zip`; VPS pre-deploy `pare-carrito-code-pre-sync-parser-merge-retry_20260624_104900.tar.gz`; VPS post-deploy `pare-carrito-code-post-sync-parser-merge_20260624_104900.tar.gz`.
- No se registraron credenciales en documentacion ni reportes.

---

## v12.8.41 - Sincronizacion robusta por rol (2026-06-24)

### Frontend / Backend / Sincronizacion

- Se separaron permisos de sincronizacion por rol: lectura de estado, parches chicos y subida completa del estado.
- El rol `Cliente` sigue fuera de la sincronizacion completa y usa sus canales especificos para pedidos y transferencias.
- El rol `Empleado` puede descargar el estado para trabajar con datos actualizados y puede sincronizar cambios mediante parches chicos, pero ya no puede hacer `PUT /state` completo.
- El backend permite que parches operativos seguros de `Empleado` se fusionen sobre la version actual del servidor aunque el `baseUpdatedAt` local haya quedado viejo.
- Los parches de `Empleado` con eliminaciones, objetos globales o escalares siguen rechazandose si hay conflicto de version.
- Commit funcional desplegado: `09844088277ae8f9b22bc847040e51b0ab637107`.
- Verificacion: `node --check` en frontend y backend, `git diff --check`, escaneo de secretos, rebuild Docker de API, deploy de frontend/backend y health VPS correcto.
- Backups: PC pre-cambio `auditoria/repo-backup-20260624-pre-role-sync-hardening.zip`; VPS pre-deploy `pare-carrito-code-pre-role-sync-hardening_20260624_083412.tar.gz`; VPS post-deploy `pare-carrito-code-post-role-sync-hardening_20260624_083412.tar.gz`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.40 - Resolucion de cola pendiente en sincronizacion (2026-06-24)

### Frontend / Sincronizacion

- Se corrigio el conflicto circular donde `Descargar datos ahora` traia la version del servidor pero dejaba una cola local pendiente con `baseUpdatedAt` viejo.
- Al descargar datos de la nube, si existian cambios pendientes anteriores, el sistema los limpia despues de generar el backup local previo a la descarga.
- El mensaje manual de descarga informa cuantos cambios pendientes fueron limpiados por pertenecer a una version vieja del servidor.
- El banner de sincronizacion evita repetir el mismo conflicto dos veces y la pantalla `Backup` ya no duplica `lastError` cuando el banner global ya lo muestra.
- Commit funcional desplegado: `646cd90ef67c640cc58fc5e0bae1665310199c48`.
- Verificacion: `node --check`, `git diff --check`, escaneo de secretos, deploy de `app.js` y health VPS correcto.
- Backups: PC pre-cambio `auditoria/repo-backup-20260624-pre-sync-conflict-queue-fix.zip`; VPS pre-deploy `pare-carrito-code-pre-sync-conflict-queue-fix_20260624_081050.tar.gz`; VPS post-deploy `pare-carrito-code-post-sync-conflict-queue-fix_20260624_081050.tar.gz`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.39 - Parser WhatsApp para docenas y mayoristas (2026-06-24)

### Frontend / Nuevo Pedido

- El parser de `Pegar pedido de WhatsApp` ahora singulariza plurales simples para reconocer mejor productos escritos como `naranjas`, `bananas`, `morrones rojos` o `mandarinas`.
- Cuando el texto indica `cajon`, `jaula` o `bolsa`, el parser prioriza la presentacion mayorista real cargada para el mismo producto; por ejemplo `1/2 cajon de naranjas` se interpreta como `Naranja Jaula 0,5`.
- Cuando el producto encontrado se vende por docena y el texto indica unidades sueltas, convierte la cantidad a docenas; por ejemplo `6 bananas`, `Banana 6 unidades` y `Mandarina 6 unidades` se interpretan como `0,5 docena`.
- Si existe una presentacion por unidad para un producto escrito en plural, se prioriza esa unidad antes de caer en kilos; por ejemplo `2 morrones rojos` puede resolverse como `Morron Rojo Unidades 2` si esa presentacion esta cargada.
- Commit funcional desplegado: `8543296fcb5674e86cf4a4ef496b31084c0f0512`.
- Verificacion: `node --check`, `git diff --check`, escaneo de secretos, prueba local de parser, deploy de `app.js` y health VPS correcto.
- Backups: PC pre-cambio `auditoria/repo-backup-20260624-pre-whatsapp-units-docena-wholesale.zip`; VPS pre-deploy `pare-carrito-code-pre-whatsapp-units-docena-wholesale_20260624_000510.tar.gz`; VPS post-deploy `pare-carrito-code-post-whatsapp-units-docena-wholesale_20260624_000510.tar.gz`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.38 - Media jaula de naranja preserva 0,5 (2026-06-23)

### Frontend / Nuevo Pedido

- Se corrigio la regla de `Pegar pedido de WhatsApp` para que `Naranja bolsa 1/2` se interprete como `Naranja Jaula 0,5`.
- La unidad se sigue corrigiendo de `bolsa` a `jaula`, pero la cantidad original ya no se convierte a `1`.
- La regla general de cantidad mantiene `1/2` como `0,5` para todos los productos.
- No se hizo rollback al commit `a0475fe...` porque la correccion era puntual y no convenia perder las mejoras posteriores.
- Commit funcional desplegado: `2425de808532ff1040ae0d02dfea9f49d3d61c9c`.
- Verificacion: `node --check`, `git diff --check`, deploy de `app.js` y health VPS correcto.
- Backups: PC pre-cambio `auditoria/repo-backup-20260623-pre-orange-half-fix.zip`; VPS pre-deploy `pare-carrito-code-pre-orange-half-fix_20260623_233955.tar.gz`; VPS post-deploy `pare-carrito-code-post-orange-half-fix_20260623_233955.tar.gz`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.37 - Etiquetas limpias en graficos y naranja jaula (2026-06-23)

### Frontend / Historiales y Nuevo Pedido

- En los popup de graficos por producto de `Historiales`, cada punto muestra solo el valor de cantidad o precio, sin fecha visible junto al punto.
- Si el grafico tiene mas de 10 puntos, no se muestran etiquetas sobre los puntos y quedan solo los datos de los ejes horizontal y vertical.
- El tooltip accesible del punto conserva fecha y valor para no perder contexto al pasar por encima.
- En `Nuevo Pedido`, el parser de `Pegar pedido de WhatsApp` refuerza la interpretacion de `Naranja bolsa 1/2` como `Naranja Jaula 1`.
- Commit funcional desplegado: `2feb7b1db5f8519e26eeffae7bd26684fecf5b90`.
- Verificacion: `node --check`, `git diff --check`, escaneo de secretos, deploy de `app.js` y health VPS correcto.
- Backups: PC pre-cambio `auditoria/repo-backup-20260623-pre-history-popup-labels-orange-fix.zip`; VPS pre-deploy `pare-carrito-code-pre-history-popup-labels-orange-fix_20260623_202616.tar.gz`; VPS post-deploy `pare-carrito-code-post-history-popup-labels-orange-fix_20260623_202616.tar.gz`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.36 - Impresion de graficos y parser WhatsApp por unidad exacta (2026-06-23)

### Frontend / Historiales y Nuevo Pedido

- En `Historiales`, la impresion del popup de graficos por producto ya no muestra las fechas del rango ni las etiquetas de fecha del eje horizontal; conserva el grafico y los valores/cantidades para una impresion mas limpia.
- En `Nuevo Pedido`, el parser de `Pegar pedido de WhatsApp` prioriza `Tomate Perita Kg` cuando el texto indica `Tomate` con unidad `kg`, por ejemplo `Tomate 2kg`.
- El parser interpreta `1 bolsa de limon` como `Limon Jaula 1` en vez de `Limon Docena`.
- El parser interpreta `Naranja bolsa 1/2` como `Naranja Jaula 1` en vez de `Naranja Docena 0,5`.
- Se mantuvieron las mejoras previas para `Ajo 1 riestra`, `Papa.1 bolsa`, conversiones a docena y lechuga crespa.
- Commit funcional desplegado: `f5a5a8c671917d1afd4e569717d2b8e2f61e51c2`.
- Verificacion: `node --check`, `git diff --check`, escaneo de secretos, pruebas locales de parser, deploy de `app.js` y health VPS correcto.
- Backups: PC pre-cambio `auditoria/repo-backup-20260623-pre-history-print-parser-fixes.zip`; VPS pre-deploy `pare-carrito-code-pre-history-print-parser-fixes_20260623_192714.tar.gz`; VPS post-deploy `pare-carrito-code-post-history-print-parser-fixes_20260623_192714.tar.gz`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.35 - Graficos imprimibles y parser WhatsApp por unidad (2026-06-23)

### Frontend / Historiales, Inicio y Nuevo Pedido

- En `Historiales`, el popup por producto ahora usa el mismo formato de grafico lineal de la pagina `Inicio`: eje de cantidades/precios a la izquierda, grilla y tooltip con fecha y valor al pasar por cada punto.
- Los graficos de `Historiales` y `Inicio` muestran hasta 7 fechas distribuidas en la linea de tiempo; si el rango tiene menos de 7 dias, se muestran todos los dias disponibles.
- El popup de producto en `Historiales` incluye un boton para imprimir ambos graficos y cada grafico tiene su propio boton de impresion.
- La impresion se dispara directamente, en hoja horizontal, con margenes minimos y solo con los graficos seleccionados, sin imprimir el resto de la pagina.
- En `Nuevo Pedido`, el parser de `Pegar pedido de WhatsApp` mejora la prioridad producto/unidad para evitar que `kilos de tomate` elija `Tomate Cajon` y prioriza `Tomate Perita Kg`.
- El parser reconoce `riestra` como `ristra`, separa casos como `Papa.1 bolsa`, convierte cantidades en unidades a docenas cuando corresponde (`Banana 12 unidades` -> `Bananas Docena 1`) y mejora coincidencias como `Lechuga crespa.2 atado`.
- Commit funcional desplegado: `a0475fe722b61b29be85c197a06978059ba37413`.
- Verificacion: `node --check`, `git diff --check`, escaneo de secretos, pruebas locales de parser, deploy de assets y health VPS por Caddy correcto.
- Backups: PC pre-cambio `auditoria/repo-backup-20260623-pre-history-chart-print-parser-units.zip`; VPS pre-deploy `pare-carrito-code-pre-history-chart-print-parser-units_20260623_184842.tar.gz`; VPS post-deploy `pare-carrito-code-post-history-chart-print-parser-units_20260623_184842.tar.gz`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.34 - Graficos por producto y parser WhatsApp robusto (2026-06-23)

### Frontend / Historiales y Nuevo Pedido

- En la pagina `Historiales`, cada producto de los historiales de compra y venta abre un popup al hacer click.
- El popup se genera bajo demanda y muestra dos graficos lineales: cantidad y precio del producto en el rango seleccionado.
- Los graficos usan los datos ya cargados en la tabla del rango, sin llamadas extra al servidor ni carga inicial adicional.
- En `Nuevo Pedido`, el parser de `Pegar pedido de WhatsApp` reconoce cantidades con unidad pegada, por ejemplo `Tomate perita 1kg`, `Cherry 1kg` o `Pepino 1kg`.
- El parser normaliza frases como `10 kilos de morron verde`, `1 bolsa de cebolla`, `1 bolsa de limon`, `8 kilos de tomate`, `1 Kilonde Aji` y `4 kilos de palta`.
- Se eliminaron conectores como `de`, `del`, `la` y `el` del nombre del producto antes del matching.
- Verificacion local de parser: `Tomate perita 1kg` -> `Tomate Perita kg`, `10 kilos de morron verde` -> `Morron Verde Kg`, `1 bolsa de cebolla` -> `Cebolla Bolsa`, `8 kilos de tomate` -> `Tomate Perita kg`, `1 Kilonde Aji` -> `Aji Picante Kg`, `4 kilos de palta` -> `Palta Madura Kg`.
- Commit funcional desplegado: `1ba337215c04dea6b891b15d39c8ee0fa500ab3a`.
- Verificacion: `node --check`, `git diff --check`, escaneo de secretos, prueba local de parser, deploy de assets y health VPS correcto.
- Backups: PC pre-cambio `auditoria/repo-backup-20260623-pre-history-popup-whatsapp-parser.zip`; VPS pre-deploy `pare-carrito-code-pre-history-popup-whatsapp-parser_20260623_181512.tar.gz`; VPS post-deploy `pare-carrito-code-post-history-popup-whatsapp-parser_20260623_181513.tar.gz`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.33 - Carrito con logo, sync claro y matching exacto (2026-06-23)

### Frontend / Nuevo Pedido

- La ventana movil del carrito ahora muestra el icono de arrastre `cart-drag-handle.png` en la esquina superior derecha de la cabecera.
- El carrito flotante queda por encima de la topbar para evitar que la cabecera de arrastre quede atrapada debajo de la barra superior.
- El mensaje de `Sincronizacion: Conflicto de sincronizacion` ahora muestra el detalle guardado del conflicto y una indicacion concreta para resolverlo desde `Configuracion > Sincronizacion` usando `Descargar datos ahora` o `Subir datos ahora` segun corresponda.
- El pegado de WhatsApp prioriza alias exactos, nombre exacto con unidad, nombre exacto sin unidad y favoritos del cliente antes de usar similitud por palabras.
- Se validaron casos de matching: `Tomate cajon` -> `Tomate Cajon`, `Zapallo negro` -> `Zapallo Negro kg`, `Ajo Ristra` -> `Ajo Ristra`, `Albahaca unidad` -> `Albahaca unidad`.
- Commit funcional desplegado: `389238b401a567ca976d0e66e365d622099222fd`.
- Verificacion: `node --check` en copia de trabajo, `git diff --check`, prueba local de matching, deploy de assets y health VPS correcto.
- Backups: PC pre-cambio `auditoria/repo-backup-20260623-pre-cart-parser-sync-fixes.zip`; VPS pre-deploy `pare-carrito-code-pre-cart-parser-sync-fixes_20260623_172407.tar.gz`; VPS post-deploy `pare-carrito-code-post-cart-parser-sync-fixes_20260623_172409.tar.gz`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.32 - Carrito movible y mejoras WhatsApp (2026-06-23)

### Frontend / Nuevo Pedido

- En desktop, el carrito de `Nuevo Pedido` ahora funciona como panel flotante movible desde su cabecera y recuerda su posicion en el navegador.
- En mobile, el carrito conserva el formato fijo inferior compacto para evitar interferir con el scroll de productos.
- En el popup `Vincular productos no reconocidos`, cada fila no reconocida tiene un boton `X` para eliminarla de la lista antes de guardar alias.
- La deteccion automatica de cliente al pegar WhatsApp ya no usa cualquier numero de cantidad como cliente; solo toma cliente si la linea parece encabezado, contiene nombre claro del cliente o un identificador de cliente valido.
- Las lineas reconocidas como cliente se excluyen del popup de productos no reconocidos.
- Commit funcional desplegado: `a19a36dac6374e1d8e9e58243a7e4f1e6e5efdbf`.
- Verificacion: `node --check`, `git diff --check`, escaneo de secretos, deploy de assets y health VPS correcto.
- Backups: PC pre-cambio `auditoria/repo-backup-20260623-pre-cart-whatsapp-fixes.zip`; VPS pre-deploy `pare-carrito-code-pre-cart-whatsapp-fixes_20260623_154544.tar.gz`; VPS post-deploy `pare-carrito-code-post-cart-whatsapp-fixes_20260623_154545.tar.gz`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.31 - Modelo de vision para OCR Kimi (2026-06-23)

### Backend / OCR por imagen

- El endpoint `/ocr/order-image` ahora usa `MOONSHOT_VISION_MODEL` para lectura de imagen, con valor por defecto `moonshot-v1-32k-vision-preview`.
- `docker-compose.yml` declara `MOONSHOT_VISION_MODEL` para que el contenedor `api` reciba explicitamente el modelo de vision.
- Se sanitizan los errores externos de Moonshot/Kimi para no exponer datos internos de cuenta, organizaciones ni claves.
- En `Nuevo Pedido`, si la IA falla, el mensaje informa el motivo resumido antes de continuar con OCR local.
- Verificacion VPS: health correcto, `MOONSHOT_API_KEY` configurada, `MOONSHOT_VISION_MODEL=moonshot-v1-32k-vision-preview` activo.
- La prueba externa de vision respondio `429` por saldo/plan insuficiente en Moonshot/Kimi; al regularizar la facturacion, el flujo queda preparado para usar el modelo de vision.
- Commit funcional desplegado: `94a7000f702c2f13d88ce5e0e04ab2e2b1cde207`.
- Backups VPS: pre-deploy `pare-carrito-code-pre-kimi-vision-fix-final_20260623_144139.tar.gz` y post-deploy `pare-carrito-code-post-kimi-vision-fix_20260623_144156.tar.gz`.
- Backup PC pre-cambio: `auditoria/repo-backup-20260623-pre-kimi-vision-fix.zip`.
- No se registro la clave en Git, documentacion ni reportes.

---
## v12.8.30 - Kimi operativo para OCR de pedidos (2026-06-23)

### Backend / OCR por imagen

- Se configuro en el VPS productivo la variable operativa `MOONSHOT_API_KEY` para habilitar el endpoint `/ocr/order-image` con Kimi/Moonshot.
- Se mantuvieron `MOONSHOT_API_URL` y `MOONSHOT_MODEL=kimi-k2.7` como configuracion del backend.
- Se recreo el contenedor `api` para tomar la configuracion actualizada.
- Verificacion VPS: health de API correcto y `MOONSHOT_API_KEY` disponible dentro del contenedor sin exponer el valor.
- Backups VPS: pre-configuracion codigo `pare-carrito-code-pre-kimi-env-retry_20260623_134404.tar.gz`, backup privado de `.env` `env-pre-kimi-retry_20260623_134404.bak` y post-configuracion `pare-carrito-code-post-kimi-env_20260623_134421.tar.gz`.
- No se registro la clave en Git, documentacion ni reportes.

---
## v12.8.29 - Productos nuevos visibles en Nuevo Pedido (2026-06-23)

### Frontend / Nuevo Pedido y Productos

- `Nuevo Pedido` ahora considera activos a los productos salvo que tengan `isActive === false`, evitando ocultar productos nuevos o importados que no traigan ese campo explicitamente.
- Al crear un producto nuevo desde la pagina `Productos`, el `sortOrder` inicial pasa a `0` para que aparezca dentro del primer bloque visible de su categoria en `Nuevo Pedido`.
- Se ajustaron los productos ya creados `PROD-173` (`Pepino unidad`) y `PROD-174` (`Palta Madura Unidad`) para que queden en posiciones 42 y 43 del orden de `Nuevo Pedido`, dentro del primer lote virtualizado.
- Commit funcional desplegado: `93957387fcec2ccf26181b9cd89ebcf004579e87`.
- Verificacion: `node --check`, `git diff --check` y consulta SQL de posicion en listado.
- Backups VPS: pre-cambio codigo `20260623_070131`, SQL pre-ajuste `20260623_070303`, post-deploy codigo `20260623_070417`, SQL post-ajuste `20260623_070521`.
- Backup PC pre-cambio: `auditoria/repo-backup-20260623-pre-new-products-order-list.zip`.
- Backup PC post-deploy: `auditoria/repo-backup-20260623-post-new-products-order-list.zip`.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.28 - Pegado WhatsApp con notas y OCR IA configurable (2026-06-23)

### Frontend / Nuevo Pedido

- `Pegar pedido de WhatsApp` ahora descarta encabezados o textos claramente ajenos al pedido, como `Pedido 23/06` o `Lista de verduras`.
- El parseo de lineas pegadas conserva aclaraciones posteriores a producto/cantidad como nota del producto. Ejemplo: `Cebolla Morada Kg. 0,5. pequenas` carga cantidad `0,5` y nota `pequenas`.
- Si el texto pegado u OCR incluye datos de cliente por numero o nombre, como `194`, `pedido para Belgrano 2` o `Charrua`, intenta seleccionar ese cliente antes de cargar el pedido y actualiza precios/vehiculo en el momento.
- `Subir imagen` intenta leer la imagen con el endpoint backend `/ocr/order-image`, preparado para Kimi/Moonshot por variables de entorno, y mantiene fallback al OCR local si la API no esta configurada o falla.
- Se corrigieron textos visibles puntuales con tildes y enes, cuidando no modificar rutas, IDs internos ni nombres de productos/archivos.

### Backend / OCR IA

- Se agrego `POST /ocr/order-image` para roles gerente, admin y empleado.
- El endpoint envia la imagen a la API compatible de Moonshot/Kimi con el prompt solicitado y devuelve solo texto interpretado.
- La clave se configura con `MOONSHOT_API_KEY` en `.env`; no se guarda ni documenta ningun secreto.
- `docker-compose.yml` declara `MOONSHOT_API_KEY`, `MOONSHOT_API_URL` y `MOONSHOT_MODEL` como variables configurables.
- Commit funcional desplegado: `db227306efd36e15d5e5ade711b7168f72784350`.
- Verificacion: `node --check` en frontend/backend, `git diff --check`, rebuild de `api` y health check interno OK.
- Backups VPS: pre-cambio codigo `20260623_063119`; post-deploy codigo `20260623_065545`.
- Backup PC pre-cambio: `auditoria/repo-backup-20260623-pre-kimi-whatsapp-texts.zip`.
- Backup PC post-deploy: `auditoria/repo-backup-20260623-post-kimi-whatsapp-texts.zip`.
- Nota operativa: al momento del deploy, el VPS no tenia `MOONSHOT_API_KEY` configurada; el sistema queda con OCR local como respaldo hasta cargar esa variable.
- No se registraron credenciales en documentacion ni reportes.

---
## v12.8.27 - Limpieza de retencion de backups VPS (2026-06-23)

### Operacion / Infraestructura

- Se verificaron los backups zip recientes de PC abriendolos y leyendo sus entradas completas.
- Se verifico que `origin/master` en GitHub coincide con el HEAD local `c4766bc4105edda97dbc498e3e5d51fcce48e6ef`.
- Se aplico retencion en `/root/backups-pare-carrito`: 2 dumps `.sql`, 2 backups `.tar.gz` de codigo y 2 archivos json/otros mas recientes.
- La carpeta de backups del VPS paso de 150 archivos a 6 archivos, liberando aproximadamente 16.3 GB.
- El disco `/` del VPS paso de 99% usado a 31% usado, con aproximadamente 17 GB libres.
- No se registraron credenciales en documentacion ni reportes.

---
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
