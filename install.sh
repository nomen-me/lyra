#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────
# install.sh — instala e sobe a Lyra Central API como serviço systemd
#
# Substitui o fluxo manual (npm start solto no terminal, fuser -k
# pra liberar porta, etc.) por um processo repetível e idempotente.
# Pensado pra rodar tanto na primeira instalação quanto em deploys
# subsequentes (git pull + restart do serviço).
#
# Uso:
#   sudo ./scripts/install.sh
#
# Variáveis de ambiente que podem ser sobrescritas na chamada:
#   APP_USER=ubuntu APP_DIR=/home/ubuntu/lyra-central-api ./scripts/install.sh
# ─────────────────────────────────────────────────────────────────

APP_NAME="lyra-central-api"
APP_USER="${APP_USER:-$(whoami)}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
NODE_MIN_MAJOR=20

log()  { echo -e "\033[1;34m[install]\033[0m $1"; }
warn() { echo -e "\033[1;33m[atenção]\033[0m $1"; }
die()  { echo -e "\033[1;31m[erro]\033[0m $1" >&2; exit 1; }

# ── 1. Pré-requisitos ─────────────────────────────────────────────
log "Verificando pré-requisitos..."

if ! command -v node >/dev/null 2>&1; then
  die "Node.js não encontrado. Instale Node >= ${NODE_MIN_MAJOR} antes de continuar (ex: via nvm ou NodeSource)."
fi

NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt "$NODE_MIN_MAJOR" ]; then
  die "Node.js >= ${NODE_MIN_MAJOR} é obrigatório. Versão encontrada: $(node -v)"
fi
log "Node.js $(node -v) OK."

if ! command -v redis-cli >/dev/null 2>&1; then
  warn "redis-cli não encontrado no PATH. Certifique-se de que o Redis está acessível via REDIS_URL no .env — rate limiting e billing dependem dele."
else
  if redis-cli ping >/dev/null 2>&1; then
    log "Redis respondendo localmente OK."
  else
    warn "Redis instalado mas não respondeu a PING local. Confirme se está rodando e se REDIS_URL no .env aponta pro lugar certo."
  fi
fi

# ── 2. Dependências do projeto ────────────────────────────────────
log "Instalando dependências (npm ci)..."
cd "$APP_DIR"
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  warn "package-lock.json não encontrado — rodando 'npm install' em vez de 'npm ci'. Gere o lockfile e commite-o pra builds reprodutíveis."
  npm install --omit=dev
fi

# ── 3. Arquivo .env ────────────────────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
  log "Nenhum .env encontrado — copiando de .env.example."
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  warn "Edite $APP_DIR/.env antes de subir em produção: preencha GEMINI_API_KEY, REDIS_URL, SECRETS_PROVIDER, etc."
else
  log ".env já existe — mantendo como está (não sobrescrito)."
fi

# Checagem mínima: NODE_ENV=production não deve rodar com SECRETS_PROVIDER=env
if grep -q '^NODE_ENV=production' "$APP_DIR/.env" 2>/dev/null; then
  if grep -q '^SECRETS_PROVIDER=env' "$APP_DIR/.env" 2>/dev/null; then
    die "NODE_ENV=production com SECRETS_PROVIDER=env detectado. Isso usa o store local de dev (data/tenants.dev.json), que não é seguro para produção. Configure gcp_secret_manager ou vault antes de prosseguir."
  fi
  if ! grep -q '^GEMINI_API_KEY=.\+' "$APP_DIR/.env" 2>/dev/null; then
    die "NODE_ENV=production sem GEMINI_API_KEY preenchido no .env."
  fi
fi

# ── 4. Diretório de dados (store dev) ─────────────────────────────
mkdir -p "$APP_DIR/data"
chmod 700 "$APP_DIR/data"

# ── 5. Serviço systemd ─────────────────────────────────────────────
log "Gerando unit file systemd em $SERVICE_FILE ..."

if [ "$EUID" -ne 0 ]; then
  die "Este script precisa rodar como root (ou via sudo) para instalar o serviço systemd. Ex: sudo ./scripts/install.sh"
fi

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Lyra Central API — IA da Synapse (Nomen Tecnologia)
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=$(command -v node) ${APP_DIR}/src/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=${APP_DIR}/.env
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${APP_NAME}

# Hardening básico — ajustar se o processo precisar de mais acesso
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

log "Recarregando systemd e (re)iniciando o serviço..."
systemctl daemon-reload
systemctl enable "${APP_NAME}"
systemctl restart "${APP_NAME}"

sleep 2

if systemctl is-active --quiet "${APP_NAME}"; then
  log "Serviço ${APP_NAME} está ativo."
  log "Logs em tempo real: journalctl -u ${APP_NAME} -f"
  log "Health check: curl http://localhost:8080/healthz"
else
  die "O serviço não subiu corretamente. Veja: journalctl -u ${APP_NAME} -n 50 --no-pager"
fi
