# Carga de pedidos historicos

`fusionar.html` toma un backup completo del sistema y un archivo de registros
(pedidos y pagos a agregar) y devuelve un backup nuevo con todo junto.

Existe porque la importacion por seccion del sistema (Backup -> Importar registro)
**reemplaza** toda la coleccion: un archivo con solo los pedidos nuevos borraria el
historial. Esta herramienta fusiona en vez de reemplazar.

## Como se usa

1. En el sistema: Backup -> "Cargar historial completo" -> Descargar backup.
2. Abrir `fusionar.html` con doble clic. Corre 100% en el navegador: no sube nada a
   ningun servidor.
3. Cargar el backup y el archivo de registros, y apretar "Analizar". Muestra pedido
   por pedido el total calculado contra el total del remito, avisa si algun cliente o
   producto no existe en el sistema, y avisa si el backup ya tiene pedidos en esas
   fechas (para no duplicar).
4. "Descargar backup con los datos cargados" e importarlo en Backup.

## Formato del archivo de registros

```json
{
  "remapeoClientes": { "014": "069" },
  "pedidos": [
    { "fecha": "2026-08-31", "clienteSistema": "002", "clienteNombre": "...",
      "items": [ { "producto": "Pera Kg", "cantidad": 2, "precioUnitario": 2886, "subtotal": 5772 } ],
      "total": 55027, "totalImpreso": 55020, "origen": "remito 31/08/2026" }
  ],
  "pagos": [
    { "fecha": "2026-08-31", "clienteSistema": "007", "monto": 90500,
      "metodo": "efectivo", "origen": "rendicion fila 37" }
  ]
}
```

Los productos y clientes se resuelven **por nombre y numero contra el propio backup**,
asi que la herramienta no necesita conocer los ids del sistema.

Notas de criterio:
- Los pedidos se cargan con IVA 0, para que el total del pedido sea exactamente el del
  remito y los saldos coincidan.
- El acumulado (`balance`) de `saldos` se recalcula por cliente en orden de fecha.
- Los archivos de datos concretos (los registros de cada carga) NO se versionan: son
  datos operativos del negocio, no codigo.
