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

## Deploy automatico (GitHub Actions)

Cada push a `master` dispara `.github/workflows/ci.yml`:

1. **Pruebas:** sintaxis de todo el JavaScript, coherencia de la version de la web
   (`APP_VERSION`, `version.json` e `index.html`), una prueba de la API contra una base vacia
   (`test/smoke.js`) y el build de las imagenes Docker. Si algo falla, no se despliega.
2. **Deploy:** se conecta al VPS por SSH con una clave que solo puede correr `ci-deploy.sh`.
3. En el VPS, `ci-deploy.sh` corre `deploy.sh` (de a uno, y nunca entre las 23:00 y las 23:15):
   backup de la base -> `git pull` -> contenedores nuevos si cambio la API o el bot ->
   verifica que la API responda. Si no responde, vuelve sola a la version anterior. Si responde,
   recarga Caddy. El log queda en `/root/deploy-logs/`.

`./deploy.sh` a mano en el VPS sigue funcionando igual que siempre.

### Configuracion (una sola vez)

**En el VPS** (como root). Primero un deploy a mano, para que exista `ci-deploy.sh`:

```
cd /opt/pare-carrito && ./deploy.sh
chmod +x /opt/pare-carrito/ci-deploy.sh /opt/pare-carrito/deploy.sh
```

Crear la clave de deploy (sin contrasena) y atarla a `ci-deploy.sh`:

```
ssh-keygen -t ed25519 -N "" -C "github-actions-deploy" -f /root/.ssh/github_deploy
echo "command=\"/opt/pare-carrito/ci-deploy.sh\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty $(cat /root/.ssh/github_deploy.pub)" >> /root/.ssh/authorized_keys
cat /root/.ssh/github_deploy          # clave PRIVADA -> secreto VPS_SSH_KEY
ssh-keyscan -t ed25519 localhost | sed "s/^localhost/<IP-DEL-VPS>/"   # -> secreto VPS_KNOWN_HOSTS
rm /root/.ssh/github_deploy           # una vez copiada a GitHub, no hace falta en el VPS
```

**En GitHub:** repo -> Settings -> Secrets and variables -> Actions -> New repository secret:

| Secreto | Valor |
|---|---|
| `VPS_HOST` | la IP del VPS |
| `VPS_SSH_KEY` | todo el contenido de `/root/.ssh/github_deploy` (incluidas las lineas BEGIN/END) |
| `VPS_KNOWN_HOSTS` | la linea que imprimio `ssh-keyscan` (con la IP en vez de `localhost`) |

La clave privada se pega solo en GitHub; no se manda por chat ni por mail.

**Probar:** en GitHub -> Actions -> CI -> Run workflow sobre `master` (o hacer un push). En el
job "Deploy al VPS" se ve el log del deploy en vivo.

**Desactivar:** borrar la linea `github-actions-deploy` de `/root/.ssh/authorized_keys`.
