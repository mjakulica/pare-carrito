#!/usr/bin/env bash
# deploy-vps.sh - Deployment seguro de Pare Carrito SAS en VPS
# Uso: copiar al VPS, editar PROJECT_DIR si es necesario, y ejecutar como root.

set -euo pipefail

# ---------------------------------------------------------------------------
# CONFIGURACION
# ---------------------------------------------------------------------------
PROJECT_DIR="/root/pare-carrito"
BACKUP_DIR="/root/backups-pare-carrito"
DB_CONTAINER="pare-carrito-sas-server-db-1"
API_CONTAINER="pare-carrito-sas-server-api-1"
DATE=$(date +%Y%m%d_%H%M%S)

# ---------------------------------------------------------------------------
# COLORES
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ---------------------------------------------------------------------------
# VALIDACIONES
# ---------------------------------------------------------------------------
if [ "$EUID" -ne 0 ]; then
  log_error "Este script debe ejecutarse como root."
  exit 1
fi

if [ ! -d "$PROJECT_DIR" ]; then
  log_error "No existe el directorio del proyecto: $PROJECT_DIR"
  log_info "Edita la variable PROJECT_DIR al inicio del script."
  exit 1
fi

if ! command -v docker &> /dev/null || ! command -v docker compose &> /dev/null; then
  log_error "No se encontro docker o docker compose."
  exit 1
fi

# ---------------------------------------------------------------------------
# BACKUP
# ---------------------------------------------------------------------------
log_info "Creando backup en $BACKUP_DIR ..."
mkdir -p "$BACKUP_DIR"

# Backup del estado de la base de datos (si esta corriendo)
if docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  log_info "Haciendo pg_dump de PostgreSQL ..."
  docker exec "$DB_CONTAINER" pg_dump -U postgres pare_carrito > "$BACKUP_DIR/pare_carrito_${DATE}.sql" || {
    log_warn "No se pudo hacer pg_dump. Continuando con backup de app_state.json ..."
  }
else
  log_warn "Contenedor de DB no encontrado. Saltando pg_dump."
fi

# Backup del directorio del proyecto (codigo fuente)
log_info "Comprimiendo directorio del proyecto ..."
tar -czf "$BACKUP_DIR/pare-carrito-code_${DATE}.tar.gz" -C "$(dirname "$PROJECT_DIR")" "$(basename "$PROJECT_DIR")"

# Backup del app_state actual (JSONB) via API container
if docker ps --format '{{.Names}}' | grep -q "^${API_CONTAINER}$"; then
  log_info "Extrayendo app_state actual ..."
  docker exec "$API_CONTAINER" node -e "
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    pool.query(\"SELECT data FROM app_state WHERE id = 'main'\")
      .then(r => { console.log(JSON.stringify(r.rows[0]?.data || {})); pool.end(); })
      .catch(e => { console.error(e); pool.end(); process.exit(1); });
  " > "$BACKUP_DIR/app_state_${DATE}.json" 2>/dev/null || log_warn "No se pudo extraer app_state."
fi

log_info "Backup completado en $BACKUP_DIR"

# ---------------------------------------------------------------------------
# DEPLOY
# ---------------------------------------------------------------------------
cd "$PROJECT_DIR"

log_info "Obteniendo ultimos cambios del repositorio ..."
git pull origin master

log_info "Actualizando dependencias del backend ..."
cd "$PROJECT_DIR/pare-carrito-sas-server"
npm ci

log_info "Reconstruyendo y levantando contenedores ..."
docker compose down
docker compose up -d --build

# ---------------------------------------------------------------------------
# VERIFICACION
# ---------------------------------------------------------------------------
log_info "Esperando que el servicio API responda ..."
for i in {1..30}; do
  if docker compose ps | grep -q "healthy\|Up"; then
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health || echo "000")
    if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "404" ]; then
      log_info "API responde con HTTP $HTTP_STATUS. Deploy OK."
      break
    fi
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then
    log_warn "El servicio no respondio a tiempo. Revisar logs."
  fi
done

log_info "Mostrando ultimos logs del API ..."
docker compose logs --tail 50 api

log_info "Deploy finalizado."
log_info "Si necesitas revertir, el backup esta en: $BACKUP_DIR"
