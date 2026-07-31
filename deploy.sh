#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────
# deploy.sh — atualiza uma instalação já existente da Lyra Central API
#
# Fluxo: git pull -> npm ci -> restart do serviço systemd, com
# rollback automático se o healthcheck falhar após o restart.
#
# Uso:
#   ./scripts/deploy.sh
# ─────────────────────────────────────────────────────────────────

APP_NAME="lyra-central-api"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://localhost:8080/healthz}"
HEALTHCHECK_RETRIES=10
HEALTHCHECK_INTERVAL=2

log()  { echo -e "\033[1;34m[deploy]\033[0m $1"; }
warn() { echo -e "\033[1;33m[atenção]\033[0m $1"; }
die()  { echo -e "\033[1;31m[erro]\033[0m $1" >&2; exit 1; }

cd "$APP_DIR"

PREVIOUS_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "")

log "Buscando atualizações (git pull)..."
git pull --ff-only

log "Instalando dependências..."
npm ci --omit=dev

log "Reiniciando serviço ${APP_NAME}..."
sudo systemctl restart "${APP_NAME}"

log "Aguardando healthcheck em ${HEALTHCHECK_URL}..."
for i in $(seq 1 $HEALTHCHECK_RETRIES); do
  if curl -sf "$HEALTHCHECK_URL" > /dev/null 2>&1; then
    log "Deploy concluído com sucesso. Serviço saudável."
    exit 0
  fi
  sleep "$HEALTHCHECK_INTERVAL"
done

warn "Healthcheck falhou após ${APP_NAME} reiniciar."

if [ -n "$PREVIOUS_COMMIT" ]; then
  warn "Revertendo para o commit anterior (${PREVIOUS_COMMIT:0:8}) e reiniciando..."
  git reset --hard "$PREVIOUS_COMMIT"
  npm ci --omit=dev
  sudo systemctl restart "${APP_NAME}"
  die "Deploy revertido automaticamente. Verifique os logs: journalctl -u ${APP_NAME} -n 100 --no-pager"
else
  die "Deploy falhou e não havia commit anterior para reverter. Verifique os logs: journalctl -u ${APP_NAME} -n 100 --no-pager"
fi
