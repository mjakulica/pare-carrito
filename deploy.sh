#!/usr/bin/env bash
# deploy.sh - Deploy de Pare Carrito SAS desde GitHub.
# Uso en el VPS:  cd /opt/pare-carrito && ./deploy.sh
set -euo pipefail

PROJECT_DIR="/opt/pare-carrito"
SERVER_DIR="$PROJECT_DIR/pare-carrito-sas-server"
BACKUP_DIR="/root/backups-pare-carrito"
DB_CONTAINER="pare-carrito-sas-server-db-1"
DATE="$(date +%Y%m%d_%H%M%S)"

cd "$PROJECT_DIR"

echo "==> 1/4 Backup de la base de datos..."
mkdir -p "$BACKUP_DIR"
if docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  docker exec "$DB_CONTAINER" pg_dump -U parecarrito parecarrito > "$BACKUP_DIR/db_${DATE}.sql" \
    && echo "    OK -> $BACKUP_DIR/db_${DATE}.sql"
else
  echo "    (contenedor de DB no encontrado, salteo el pg_dump)"
fi

BEFORE="$(git rev-parse HEAD)"

echo "==> 2/4 Trayendo cambios de GitHub (git pull)..."
git pull --ff-only origin master

AFTER="$(git rev-parse HEAD)"

if [ "$BEFORE" = "$AFTER" ]; then
  echo "==> Ya estaba al dia. No habia cambios nuevos."
  exit 0
fi

echo "==> 3/4 Cambios aplicados: ${BEFORE:0:7} -> ${AFTER:0:7}"
if git diff --name-only "$BEFORE" "$AFTER" | grep -q "^pare-carrito-sas-server/"; then
  echo "    Cambio el BACKEND -> reinstalando dependencias y reconstruyendo contenedores..."
  cd "$SERVER_DIR"
  npm ci
  docker compose up -d --build
  docker compose ps
  cd "$PROJECT_DIR"
else
  echo "    Solo cambio el FRONTEND -> Caddy lo sirve en vivo, no hace falta reconstruir."
  echo "    Hace Ctrl+F5 / ventana incognito en el navegador para ver los cambios."
fi

echo "==> 4/4 Deploy finalizado. Version actual:"
git --no-pager log --oneline -1
