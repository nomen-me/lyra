#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────
# onboard-client.sh — provisiona um cliente novo na Lyra em um único
# comando: cria o tenant na API Central e gera o arquivo de config
# pronto pra usar na VPS do cliente (Harmonia/N8N).
#
# ESCOPO: este script cobre só a parte da LYRA (tenant_id + API Key
# + config de conexão). NÃO instala Ritmo/Harmonia/Harpa na VPS do
# cliente — isso é um processo de provisionamento de VPS separado,
# ainda não scriptado nesta conversa. Este script assume que a VPS
# do cliente já existe e só precisa ser configurada para falar com
# a Lyra Central.
#
# Uso:
#   LYRA_CENTRAL_URL=https://lyra.suaempresa.com \
#   ADMIN_API_KEY=xxxxx \
#   ./scripts/onboard-client.sh <tenant_id>
#
# Opcional — copia o config direto pra VPS do cliente via SSH:
#   ./scripts/onboard-client.sh <tenant_id> ubuntu@vps-do-cliente.com
# ─────────────────────────────────────────────────────────────────

TENANT_ID="${1:-}"
CLIENT_SSH_TARGET="${2:-}"

LYRA_CENTRAL_URL="${LYRA_CENTRAL_URL:-http://localhost:8080}"
ADMIN_API_KEY="${ADMIN_API_KEY:-}"

CONFIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/client-configs"

log()  { echo -e "\033[1;34m[onboard]\033[0m $1"; }
warn() { echo -e "\033[1;33m[atenção]\033[0m $1"; }
die()  { echo -e "\033[1;31m[erro]\033[0m $1" >&2; exit 1; }

# ── Validações ─────────────────────────────────────────────────
[ -n "$TENANT_ID" ] || die "Uso: $0 <tenant_id> [usuario@host-da-vps-do-cliente]"

if ! [[ "$TENANT_ID" =~ ^[a-z0-9_-]{3,64}$ ]]; then
  die "tenant_id inválido: use apenas letras minúsculas, números, '_' e '-' (3 a 64 caracteres). Recebido: $TENANT_ID"
fi

[ -n "$ADMIN_API_KEY" ] || die "Variável ADMIN_API_KEY não definida. Exporte-a antes de rodar: export ADMIN_API_KEY=..."

if ! command -v curl >/dev/null 2>&1; then
  die "curl não encontrado."
fi

JSON_PARSER=""
if command -v jq >/dev/null 2>&1; then
  JSON_PARSER="jq"
elif command -v python3 >/dev/null 2>&1; then
  JSON_PARSER="python3"
else
  die "Precisa de 'jq' ou 'python3' instalado para interpretar a resposta da API."
fi

# ── 1. Provisiona o tenant na API Central ─────────────────────────
log "Provisionando tenant '${TENANT_ID}' em ${LYRA_CENTRAL_URL} ..."

HTTP_RESPONSE=$(curl -sS -w "\n%{http_code}" -X POST "${LYRA_CENTRAL_URL}/admin/tenants" \
  -H "Authorization: Bearer ${ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\": \"${TENANT_ID}\"}")

HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed '$d')
HTTP_STATUS=$(echo "$HTTP_RESPONSE" | tail -n1)

if [ "$HTTP_STATUS" = "409" ]; then
  die "Tenant '${TENANT_ID}' já existe. Use 'rotate' para gerar uma nova chave: curl -X POST ${LYRA_CENTRAL_URL}/admin/tenants/${TENANT_ID}/rotate -H \"Authorization: Bearer \$ADMIN_API_KEY\""
fi

if [ "$HTTP_STATUS" != "201" ]; then
  die "Falha ao provisionar tenant (HTTP ${HTTP_STATUS}): ${HTTP_BODY}"
fi

if [ "$JSON_PARSER" = "jq" ]; then
  API_KEY=$(echo "$HTTP_BODY" | jq -r '.api_key')
else
  API_KEY=$(echo "$HTTP_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['api_key'])")
fi

[ -n "$API_KEY" ] && [ "$API_KEY" != "null" ] || die "Resposta da API não trouxe api_key: ${HTTP_BODY}"

log "Tenant provisionado com sucesso."

# ── 2. Gera o arquivo de config pronto pra VPS do cliente ────────
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"
CONFIG_FILE="${CONFIG_DIR}/${TENANT_ID}.env"

cat > "$CONFIG_FILE" <<EOF
# Config gerado automaticamente por onboard-client.sh em $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Copiar estas variáveis para o ambiente do Harmonia (N8N) na VPS
# deste cliente — são as credenciais que o Harmonia usa para chamar
# a Lyra Central API.

LYRA_CENTRAL_URL=${LYRA_CENTRAL_URL}
LYRA_TENANT_ID=${TENANT_ID}
LYRA_API_KEY=${API_KEY}
EOF

chmod 600 "$CONFIG_FILE"
log "Config salvo em: ${CONFIG_FILE}"

# ── 3. Opcional: copia direto pra VPS do cliente ──────────────────
if [ -n "$CLIENT_SSH_TARGET" ]; then
  log "Copiando config para ${CLIENT_SSH_TARGET}:~/lyra-client.env ..."
  if scp -q "$CONFIG_FILE" "${CLIENT_SSH_TARGET}:~/lyra-client.env"; then
    log "Config copiado com sucesso. Configure o Harmonia nessa VPS para carregar ~/lyra-client.env."
  else
    warn "Falha ao copiar via SCP. O arquivo continua disponível localmente em ${CONFIG_FILE} — copie manualmente."
  fi
else
  warn "Nenhuma VPS de destino informada — copie ${CONFIG_FILE} manualmente para o Harmonia do cliente."
fi

log "Onboarding da Lyra concluído para '${TENANT_ID}'."
echo ""
echo "Lembrete: este script NÃO instala Ritmo/Harmonia/Harpa na VPS do"
echo "cliente — apenas provisiona o acesso à Lyra Central. A VPS do"
echo "cliente precisa já ter a stack da Synapse rodando."
