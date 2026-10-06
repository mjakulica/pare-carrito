#!/usr/bin/env bash
# deploy.sh - Deploy de Pare Carrito SAS desde GitHub.
# Uso en el VPS:  cd /opt/pare-carrito && ./deploy.sh
# (GitHub Actions lo corre solo a traves de ci-deploy.sh despues de cada push a master.)
#
# Pasos: backup de la base -> git pull -> contenedores nuevos -> verificar que la API responda.
# Si la API no responde, vuelve solo a la version anterior. Si responde, recarga Caddy.
set -Eeuo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/pare-carrito}"
SERVER_DIR="$PROJECT_DIR/pare-carrito-sas-server"
BACKUP_DIR="${BACKUP_DIR:-/root/backups-pare-carrito}"
DB_CONTAINER="pare-carrito-sas-server-db-1"
DATE="$(date +%Y%m%d_%H%M%S)"

cd "$PROJECT_DIR"

echo "==> 1/5 Backup de la base de datos (comprimido)..."
mkdir -p "$BACKUP_DIR"
# Rotacion previa (|| true para no abortar si no hay archivos que coincidan)
{ ls -t "$BACKUP_DIR"/db_*.sql.gz 2>/dev/null | tail -n +5 | xargs -r rm -f; } || true
{ ls -t "$BACKUP_DIR"/code_*.tar.gz 2>/dev/null | tail -n +3 | xargs -r rm -f; } || true
if docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  # Se excluyen los DATOS de las tablas internas de historial/idempotencia (no son datos de
  # negocio y pueden pesar varios GB): la estructura se mantiene, pero sin las filas gigantes.
  # gzip -1 = compresion rapida (el cuello de botella era comprimir varios GB de snapshots).
  if docker exec "$DB_CONTAINER" pg_dump -U parecarrito \
       --exclude-table-data=state_history \
       --exclude-table-data=state_operations \
       parecarrito | gzip -1 > "$BACKUP_DIR/db_${DATE}.sql.gz"; then
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

echo "==> 2/5 Trayendo cambios de GitHub (git pull)..."
git pull --ff-only origin master

AFTER="$(git rev-parse HEAD)"

if [ "$BEFORE" = "$AFTER" ]; then
  echo "==> Ya estaba al dia. No habia cambios nuevos."
  exit 0
fi

# La API responde /health solo si tambien llega a la base. Se pregunta desde adentro del
# contenedor (no depende de Caddy ni del DNS). Hasta 90 segundos: el arranque crea tablas.
api_responde() {
  for _ in $(seq 1 45); do
    if (cd "$SERVER_DIR" && docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))") >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

reconstruir() {
  cd "$SERVER_DIR"
  docker compose up -d --build
  docker compose ps
  cd "$PROJECT_DIR"
}

ROLLBACK_HECHO=0
volver_atras() {
  [ "$ROLLBACK_HECHO" = "1" ] && return
  ROLLBACK_HECHO=1
  echo ""
  echo "!!! El deploy fallo. Vuelvo a la version anterior (${BEFORE:0:7})..."
  cd "$PROJECT_DIR"
  git reset --hard "$BEFORE"
  if reconstruir && api_responde; then
    echo "!!! Version anterior restaurada y la API responde. El cambio nuevo NO quedo aplicado."
  else
    echo "!!! ATENCION: la version anterior tampoco responde. Revisar a mano: cd $SERVER_DIR && docker compose logs --tail=100 api"
  fi
  echo "    (la base no se toca; el backup de antes del deploy esta en $BACKUP_DIR)"
}
# Cualquier error a partir de aca (build roto, contenedor que no levanta) dispara la vuelta atras.
trap 'volver_atras; exit 1' ERR

echo "==> 3/5 Cambios aplicados: ${BEFORE:0:7} -> ${AFTER:0:7}"
if git diff --name-only "$BEFORE" "$AFTER" | grep -qE "^(pare-carrito-sas-server|whatsapp-bot)/"; then
  echo "    Cambio el BACKEND o el BOT -> reconstruyendo contenedores..."
  reconstruir
else
  echo "    Solo cambio el FRONTEND -> Caddy lo sirve en vivo, no hace falta reconstruir."
fi

echo "==> 4/5 Verificando que la API responda..."
if ! api_responde; then
  echo "    La API no respondio /health."
  (cd "$SERVER_DIR" && docker compose logs --tail=40 api) || true
  trap - ERR
  volver_atras
  exit 1
fi
echo "    OK, la API responde."
trap - ERR

echo "==> 5/5 Recargando Caddy (servidor web con los certificados HTTPS)..."
if ! (cd "$SERVER_DIR" && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile); then
  echo "    WARN: Caddy no acepto la configuracion nueva; sigue con la anterior. Revisar el Caddyfile."
fi

echo "==> Deploy finalizado. Version actual:"
git --no-pager log --oneline -1
