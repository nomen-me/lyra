# Lyra Central API

API Central da Lyra — IA nativa da Synapse (Nomen Tecnologia), construída
sobre o Gemini Flash. Documentação completa fatiada em `docs/`:

- [`docs/01_arquitetura.md`](docs/01_arquitetura.md) — visão geral, infra e billing
- [`docs/02_api.md`](docs/02_api.md) — contratos REST, SSE e webhooks
- [`docs/03_tools.md`](docs/03_tools.md) — catálogo de schemas JSON e retornos
- [`docs/04_operacao.md`](docs/04_operacao.md) — métricas, erros e observabilidade

## Estrutura

```
src/
├── index.js              # bootstrap do servidor Express
├── config/
│   └── env.js              # carga e validação de variáveis de ambiente
├── middleware/
│   ├── auth.js              # Bearer token + X-Tenant-ID
│   ├── rateLimiter.js        # sliding window via Redis, por tenant
│   ├── correlationId.js      # X-Correlation-ID, gerado/propagado
│   └── errorHandler.js       # handler global de erros
├── routes/
│   ├── chat.js               # /v1/chat, /v1/chat/tool-result, /v1/chat/async-update
│   └── usage.js              # /v1/usage/:tenantId
├── services/
│   ├── secrets.js            # abstração sobre Secret Manager / Vault
│   ├── redisClient.js        # cliente Redis compartilhado
│   ├── idempotency.js        # idempotência por call_id (Redis SET NX)
│   └── circuitBreaker.js     # circuit breaker por (tenant, tool)
└── utils/
    ├── logger.js              # logger com regra de zero-log de conteúdo
    └── errorCodes.js          # enums de erro padronizados (AppError)
```

## Setup local (dev)

```bash
npm install
cp .env.example .env
# preencher GEMINI_API_KEY (ver seção "Chave do Gemini" abaixo)
npm run tenant:add -- minha_loja_teste   # gera API Key + tenant_id de teste
npm run dev
```

Requer um Redis rodando localmente (`docker run -p 6379:6379 redis`)
para rate limiting funcionar — sem Redis, o middleware faz fail-open
(loga erro e deixa passar), então dá pra subir sem Redis em dev, mas
sem a proteção de rate limit ativa.

Teste rápido:
```bash
curl http://localhost:8080/healthz

curl -X POST http://localhost:8080/v1/chat \
  -H "Authorization: Bearer <api_key_gerada_pelo_tenant:add>" \
  -H "X-Tenant-ID: minha_loja_teste" \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"c1","messages":[{"role":"user","content":"oi"}]}'
```

## Onboarding de cliente novo (escala — sem SSH)

Este é o fluxo pra quando surge um cliente novo. Não usa SSH nem
comando manual na VPS da API Central — só o endpoint administrativo:

```bash
export ADMIN_API_KEY=<valor do .env da API Central>
export LYRA_CENTRAL_URL=https://lyra.suaempresa.com   # ou http://localhost:8080 em dev

./scripts/onboard-client.sh loja_novo_cliente
# ou, copiando o config direto pra VPS do cliente via SSH:
./scripts/onboard-client.sh loja_novo_cliente ubuntu@vps-do-cliente.com
```

O script:
1. Chama `POST /admin/tenants` na API Central (provisiona o tenant e recebe a API Key)
2. Gera `client-configs/<tenant_id>.env` com `LYRA_CENTRAL_URL`, `LYRA_TENANT_ID`, `LYRA_API_KEY` — pronto pra colar na config do Harmonia daquele cliente
3. Se você passar o segundo argumento, copia o arquivo via `scp` direto pra VPS do cliente

> **Escopo:** este script só provisiona o acesso à Lyra. Ele **não**
> instala Ritmo/Harmonia/Harpa na VPS do cliente novo — isso ainda é
> um processo separado (a VPS do cliente precisa já existir com a
> stack da Synapse rodando). Automatizar a VPS inteira é um próximo
> passo em aberto, não coberto aqui ainda.

`client-configs/` não é versionado (tem API Keys em texto puro).

### Rotacionar ou revogar um cliente existente
```bash
curl -X POST "${LYRA_CENTRAL_URL}/admin/tenants/loja_novo_cliente/rotate" \
  -H "Authorization: Bearer ${ADMIN_API_KEY}"
```

### Gerenciamento local (dev/homologação, sem passar pela API)

Enquanto `SECRETS_PROVIDER=env` (modo dev — ver `.env`), os tenants
ficam num store local em `data/tenants.dev.json` (não versionado).
**Isso não é seguro pra produção** — em produção, use
`SECRETS_PROVIDER=gcp_secret_manager` (integração ainda não
implementada, ver `src/services/secrets.js`).

```bash
npm run tenant:add -- <tenant_id>       # equivalente local ao onboard-client.sh
npm run tenant:rotate -- <tenant_id>    # equivalente local ao endpoint de rotate
```

A API Key só é exibida uma vez, na criação/rotação — apenas o hash
fica salvo.

## Chave do Gemini

Duas opções, dependendo do momento do projeto:

- **Dev/testes** — [Google AI Studio](https://aistudio.google.com/apikey),
  tier gratuito. Gere a chave e cole em `GEMINI_API_KEY` no `.env`.
  Tem RPM baixo, não usar em produção.
- **Produção** — projeto no Google Cloud com faturamento
  (pay-as-you-go) e a API do Vertex AI/Gemini habilitada. Configure
  um teto de gastos no projeto GCP antes de gerar a chave, pra evitar
  surpresa de fatura. Ver `docs/01_arquitetura.md` (seção de
  segurança) para o motivo de produção não poder ficar no tier
  gratuito.

## Deploy scriptado (VPS)

Nada de `npm start` solto no terminal nem `fuser -k` manual — os
scripts abaixo cobrem instalação inicial e atualização:

```bash
# Primeira instalação — cria o serviço systemd, valida Node/Redis,
# gera .env se não existir. Precisa rodar como root/sudo.
sudo APP_USER=ubuntu APP_DIR=/home/ubuntu/lyra-central-api ./scripts/install.sh

# Atualizações subsequentes — git pull + npm ci + restart do serviço,
# com rollback automático se o healthcheck falhar depois de subir.
./scripts/deploy.sh
```

O serviço fica registrado no systemd (`lyra-central-api.service`),
então:
```bash
sudo systemctl status lyra-central-api
sudo systemctl restart lyra-central-api
journalctl -u lyra-central-api -f
```

## O que já está implementado

- [x] Servidor Express com middlewares na ordem correta
      (correlation id → auth → rate limit → rotas)
- [x] Autenticação Bearer token + X-Tenant-ID, com hash de token e
      comparação em tempo constante
- [x] Rate limiting via Redis (sliding window), por tenant
- [x] Correlation ID (`X-Correlation-ID`) gerado/propagado e presente
      em todo log estruturado
- [x] Circuit breaker por `(tenant, tool)` — 5 falhas consecutivas
      abrem o circuito por 2 min; filtra tools indisponíveis antes de
      repassar ao Gemini
- [x] Idempotência por `call_id` (Redis `SET NX`) em
      `/v1/chat/async-update`, reaproveitável para `gerar_etiqueta` e
      `emitir_nf` quando implementadas
- [x] Enums de erro padronizados (`src/utils/errorCodes.js`) usados
      em todas as respostas de erro da API
- [x] Esqueleto das rotas do contrato (`/v1/chat`, `/v1/chat/tool-result`,
      `/v1/chat/async-update`, `/v1/usage/:tenantId`)
- [x] Logger com redação automática de campos sensíveis (regra de
      zero-log de conteúdo/LGPD)
- [x] Abstração de Secret Manager/Vault (stub — modo `env` suporta
      múltiplos tenants via store local em `data/tenants.dev.json`,
      produção precisa da integração real)
- [x] Provisionamento/rotação de tenant via CLI (`npm run tenant:add`,
      `npm run tenant:rotate`) — local, dev/homologação
- [x] **Onboarding remoto de cliente novo** via `/admin/tenants`
      (autenticação própria, separada da autenticação de tenant) +
      `scripts/onboard-client.sh` — provisiona sem SSH e gera o
      config pronto pra VPS do cliente
- [x] Deploy scriptado (`scripts/install.sh`, `scripts/deploy.sh`) com
      serviço systemd, healthcheck e rollback automático em falha
- [x] Integração real com o Gemini (`@google/genai`) — streaming,
      tools (function calling) e system prompt conectados em
      `/v1/chat` e `/v1/chat/tool-result`. **Ver ressalva abaixo.**

> ⚠️ **Validar antes de produção:** o parsing de `function_call` em
> streaming (`src/services/geminiService.js`) foi implementado com
> base na documentação pública do `@google/genai`, mas o formato
> exato de `chunk.functionCalls` precisa ser confirmado contra uma
> chamada real — este ambiente de geração de código não teve acesso
> de rede para instalar o pacote e testar de ponta a ponta. Rode
> `npm install`, gere uma API Key de teste no AI Studio, e faça uma
> chamada real para `/v1/chat` com `tools_available` preenchido antes
> de confiar nesse caminho em produção.

## O que falta implementar (próximos passos)

1. **SDK do Gemini** — plugar `@google/generative-ai` em
   `src/routes/chat.js`, incluindo os `functionDeclarations` das 3
   tools iniciais (ver `docs/03_tools.md`).
2. **System Prompt** — carregar o system prompt da Lyra (v1, já
   redigido) na chamada ao modelo.
3. **Timeout síncrono → assíncrono** — implementar a lógica de
   `env.syncTimeoutsMs` disparando conversão `timeout_converted` vs.
   `infra_failure` (distinção que afeta billing e circuit breaker).
4. **Billing real** — schema Postgres/Redis para
   `atendimentos_usados`, `recargas_usadas_no_mes`, etc., e a
   conversão tokens → atendimentos via `TOKENS_PER_ATTENDANCE`.
5. **Secret Manager real** — implementar os branches `gcp_secret_manager`
   e `vault` em `src/services/secrets.js` (hoje lançam erro
   deliberadamente). **Bloqueante para produção** — `install.sh` já
   recusa subir com `NODE_ENV=production` + `SECRETS_PROVIDER=env`.
6. **Persistência de histórico** — a Lyra Central é stateless por
   design; confirmar o contrato de como o painel/VPS reenvia as
   últimas N mensagens a cada chamada.
7. **Medição de tempo por etapa** (IA / Tool / ERP) associada ao
   `correlation_id`, conforme `docs/04_operacao.md` — ainda é só um
   TODO em `src/routes/chat.js`.
8. **Testes** — nenhum teste automatizado ainda. Sugestão: começar
   pelo middleware de auth, pela lógica de timeout e pelo circuit
   breaker, que são os pontos com mais risco de bug silencioso.

## Notas de segurança já embutidas no código

- O `logger` (`src/utils/logger.js`) redige automaticamente campos
  como `content`, `cpf_cliente` e `nome` — mas isso é uma rede de
  segurança, não uma licença para logar esses campos de propósito em
  outro lugar do código.
- `src/middleware/auth.js` nunca compara a API Key em texto puro
  contra um valor salvo em banco — sempre hash + comparação em tempo
  constante (`crypto.timingSafeEqual`), para não vazar informação por
  side-channel de timing.
