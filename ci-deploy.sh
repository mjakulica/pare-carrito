#!/usr/bin/env bash
# ci-deploy.sh - Lo unico que puede correr la clave SSH de GitHub Actions en el VPS.
#
# En /root/.ssh/authorized_keys la clave de GitHub queda atada a este script con command="...":
# aunque alguien la robe, no puede abrir una consola ni correr otra cosa; solo dispara un deploy.
# Ver "Deploy automatico" en pare-carrito-sas-server/README.md.
set -euo pipefail

PROJECT_DIR="/opt/pare-carrito"
LOG_DIR="/root/deploy-logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/deploy_$(date +%Y%m%d_%H%M%S).log"
# Se guardan los ultimos 30 logs.
{ ls -t "$LOG_DIR"/deploy_*.log 2>/dev/null | tail -n +31 | xargs -r rm -f; } || true

# Un deploy a la vez: si llegan dos pushes seguidos, el segundo espera al primero.
exec 9>/var/lock/pare-carrito-deploy.lock
flock 9

# No desplegar entre las 23:00 y las 23:15 (hora de Argentina): es cuando se cargan los pedidos
# de la noche. Si cae en esa ventana, espera a que termine.
while :; do
  hhmm=$(TZ=America/Argentina/Buenos_Aires date +%H%M)
  if [ "$hhmm" -ge 2300 ] && [ "$hhmm" -lt 2316 ]; then
    echo "Son las ${hhmm:0:2}:${hhmm:2:2} en Argentina: espero a las 23:16 para desplegar..."
    sleep 60
  else
    break
  fi
done

# Se corre una COPIA de deploy.sh: el git pull puede cambiar deploy.sh mientras bash lo esta
# leyendo, y eso rompe el script a mitad de camino.
COPIA="$(mktemp /tmp/deploy.XXXXXX.sh)"
cp "$PROJECT_DIR/deploy.sh" "$COPIA"

# El deploy corre en su propia sesion (setsid) y escribe solo al log: si se corta la conexion con
# GitHub, sigue hasta el final en vez de quedar a medias. Aca solo se muestra el log en vivo.
echo "Deploy disparado por GitHub Actions - log en el VPS: $LOG"
setsid bash -c 'bash "$1"; r=$?; rm -f "$1"; exit $r' _ "$COPIA" > "$LOG" 2>&1 < /dev/null &
pid=$!
tail --pid="$pid" -n +1 -f "$LOG" || true
wait "$pid"
