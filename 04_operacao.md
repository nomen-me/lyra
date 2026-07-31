# 04 — Operação: Erros, Observabilidade e Resiliência

## Enums de Erro Padronizados

Usados tanto pela API Central quanto pelos fluxos do Harmonia (N8N) na VPS do cliente, pra agilizar debug e correlação de logs entre os dois lados. Implementados em `src/utils/errorCodes.js`.

| Código | Significado |
|---|---|
| `TOOL_TIMEOUT` | Harmonia estourou o tempo limite síncrono |
| `AUTH_INVALID` | Token de autenticação da VPS/Tenant inválido |
| `RATE_LIMIT_EXCEEDED` | Cota por minuto excedida na API Central |
| `ERP_OFFLINE` | Falha de comunicação no conector local com o Ritmo |
| `TOOL_UNAVAILABLE` | Tool indisponível (ex: circuit breaker aberto) |
| `INFRA_FAILURE` | Erro 5xx no Gemini ou na própria API Central |
| `INVALID_PAYLOAD` | Corpo da requisição malformado |
| `TENANT_MISMATCH` | Tenant autenticado tentando acessar dado de outro |
| `INTERNAL_ERROR` | Fallback genérico — evitar quando um enum específico existir |

## Correlation ID

- Gerado na origem (Harpa/Chatwoot) como `X-Correlation-ID`, propagado por toda a cadeia: **Harpa → API Central → Harmonia → Ritmo**.
- Se ausente na entrada da API Central, um novo é gerado (`src/middleware/correlationId.js`) — nenhuma requisição segue sem correlation_id.
- Devolvido no header de resposta pra quem chamou conseguir correlacionar ponta a ponta.
- Todo log estruturado da API Central inclui `correlation_id` (via `pino-http` com `customProps`).

**Métricas a registrar por correlation_id** (ainda não implementado no stub — ver `TODO`s em `src/routes/chat.js`):
- tempo gasto na IA (Gemini)
- tempo gasto na Tool (Harmonia)
- tempo gasto no ERP (Ritmo)

## Circuit Breaker

Implementado em `src/services/circuitBreaker.js`, por par `(tenant_id, tool_name)` — uma loja com ERP local instável não afeta as outras lojas usando a mesma tool.

**Regra:**
- 5 falhas consecutivas de uma tool para a mesma loja → circuito abre por 2 minutos (cooldown ajustável).
- Enquanto aberto, a API Central nem tenta chamar o Harmonia para aquela tool — a Lyra responde diretamente: *"Esta consulta está temporariamente indisponível no momento."*
- Um sucesso zera o contador de falhas.

**Uso no fluxo:**
1. Em `POST /v1/chat`, antes de repassar `tools_available` ao Gemini, a API Central filtra as tools com circuito aberto para aquele tenant.
2. Em `POST /v1/chat/tool-result`, um retorno com `error` incrementa o contador; um retorno de sucesso zera.

## Idempotência

Implementado em `src/services/idempotency.js`, via Redis `SET NX` com TTL de 6h (cobre folgadamente a janela de retry do N8N).

**Ações mutáveis que exigem idempotência por `call_id`:**
- `POST /v1/chat/async-update`
- `gerar_etiqueta` (quando implementada)
- `emitir_nf` (quando implementada)

Se o Harmonia reexecutar um nó por retry, ou o cliente reenviar a mensagem, o servidor descarta o processamento duplicado e retorna `200 OK` — nunca reenvia a notificação ao cliente final duas vezes.

## Rate Limiting

- Redis com **sliding window log**, por `tenant_id` — implementado em `src/middleware/rateLimiter.js`.
- Roda como segunda camada de defesa; em produção também pode existir um API Gateway (Traefik/Kong + plugin Redis) na frente da API.
- **Fail-open:** se o Redis cair, o middleware loga o erro e deixa a requisição passar (evita que uma falha de infra derrube o serviço todo). Ajustável para fail-closed se a política de segurança exigir o contrário.

## Health Check

`GET /healthz` — público, sem autenticação. Usado por Netdata (Acorde) e Uptime Kuma (Eco) para monitoramento externo, e pelo orquestrador de deploy.
