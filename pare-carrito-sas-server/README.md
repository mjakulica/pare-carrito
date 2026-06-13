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
