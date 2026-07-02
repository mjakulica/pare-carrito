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

echo "==> 1/4 Backup de la base de datos (comprimido)..."
mkdir -p "$BACKUP_DIR"
# Rotacion previa (|| true para no abortar si no hay archivos que coincidan)
{ ls -t "$BACKUP_DIR"/db_*.sql.gz 2>/dev/null | tail -n +5 | xargs -r rm -f; } || true
{ ls -t "$BACKUP_DIR"/code_*.tar.gz 2>/dev/null | tail -n +3 | xargs -r rm -f; } || true
if docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  if docker exec "$DB_CONTAINER" pg_dump -U parecarrito parecarrito | gzip > "$BACKUP_DIR/db_${DATE}.sql.gz"; then
    echo "    OK -> $BACKUP_DIR/db_${DATE}.sql.gz ($(du -h "$BACKUP_DIR/db_${DATE}.sql.gz" | cut -f1))"
  else
    echo "    WARN: fallo el pg_dump (revisar espacio). Continuo igual."
    rm -f "$BACKUP_DIR/db_${DATE}.sql.gz"
  fi
else
  echo "    (contenedor de DB no encontrado, salteo el pg_dump)"
fi
# Rotacion final: como mucho 5 dumps comprimidos
{ ls -t "$BACKUP_DIR"/db_*.sql.gz 2>/dev/null | tail -n +6 | xargs -r rm -f; } || true

BEFORE="$(git rev-parse HEAD)"

echo "==> 2/4 Trayendo cambios de GitHub (git pull)..."
git pull --ff-only origin master

AFTER="$(git rev-parse HEAD)"

if [ "$BEFORE" = "$AFTER" ]; then
  echo "==> Ya estaba al dia. No habia cambios nuevos."
  exit 0
fi

echo "==> 3/4 Cambios aplicados: ${BEFORE:0:7} -> ${AFTER:0:7}"
if git diff --name-only "$BEFORE" "$AFTER" | grep -qE "^(pare-carrito-sas-server|whatsapp-bot)/"; then
  echo "    Cambio el BACKEND o el BOT -> reinstalando dependencias y reconstruyendo contenedores..."
  cd "$SERVER_DIR"
  if command -v npm >/dev/null 2>&1; then npm ci; else echo "    (npm no esta en el host; las dependencias se instalan dentro del build de Docker)"; fi
  docker compose up -d --build
  docker compose ps
  cd "$PROJECT_DIR"
else
  echo "    Solo cambio el FRONTEND -> Caddy lo sirve en vivo, no hace falta reconstruir."
  echo "    Hace Ctrl+F5 / ventana incognito en el navegador para ver los cambios."
fi

echo "==> 4/4 Deploy finalizado. Version actual:"
git --no-pager log --oneline -1
