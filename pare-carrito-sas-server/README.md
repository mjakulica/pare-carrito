# Pare Carrito SAS - Servidor autoalojado (Node.js + PostgreSQL)

API con usuarios reales (bcrypt), JWT, permisos por endpoint, espejo relacional
en PostgreSQL para reportes pesados, exportaciones CSV y backups. Independiente
de cualquier proveedor cloud: corre en cualquier VPS con Docker.

Guia completa de instalacion: ver DEPLOYMENT.md (Opcion F) en la raiz del repo.

## Endpoints

| Metodo | Ruta                       | Permisos                  |
|--------|----------------------------|---------------------------|
| GET    | /health                    | publico                   |
| POST   | /auth/login                | publico                   |
| GET    | /state                     | gerente, admin, empleado  |
| PUT    | /state                     | gerente, admin, empleado (control de conflictos 409) |
| POST   | /proofs                    | cualquier usuario logueado|
| GET    | /proofs/:key               | cualquier usuario logueado|
| GET    | /reports/sales             | gerente, admin            |
| GET    | /reports/top-products      | gerente, admin            |
| GET    | /reports/top-clients       | gerente, admin            |
| GET    | /exports/orders.csv        | gerente, admin            |
| GET    | /exports/backup.json       | gerente                   |

Los usuarios se administran desde la pagina Usuarios del propio ERP: en cada
sincronizacion el servidor guarda los usuarios con hash bcrypt y esos mismos
usuarios/contrasenas sirven para la API.

## Recuperar productos de pedidos que quedaron vacios

Hasta la v34, si un dispositivo en vista rapida modificaba un pedido viejo (que le llega sin
productos), el servidor guardaba esa copia vacia encima de la completa. Desde la v34 el servidor
ya no lo permite. Para devolverles los productos a los pedidos que se vaciaron, se usa un
respaldo anterior (los `.sql.gz` que guarda `deploy.sh`, o un backup `.json` exportado desde la
app con el historial completo). Solo toca pedidos y compras que hoy estan vacios.

```bash
cd /opt/pare-carrito/pare-carrito-sas-server
ls -lt /root/backups-pare-carrito/           # ver que respaldos hay
# 1) Ver que recuperaria (no cambia nada):
docker compose run --rm -v /root/backups-pare-carrito:/backups api \
  node src/recuperar-productos.js /backups/db_AAAAMMDD_HHMMSS.sql.gz
# 2) Si esta bien, aplicar:
docker compose run --rm -v /root/backups-pare-carrito:/backups api \
  node src/recuperar-productos.js /backups/db_AAAAMMDD_HHMMSS.sql.gz --aplicar
```

Se pueden pasar varios respaldos (del mas nuevo al mas viejo): para cada pedido usa el primero
que lo tenga con productos. Al final informa los pedidos que siguen vacios porque ningun
respaldo los tiene.
