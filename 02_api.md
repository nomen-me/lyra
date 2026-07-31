# 02 — Contrato da API

## Autenticação

Toda requisição VPS → API Central carrega:

```
Authorization: Bearer <api_key_da_vps>
X-Tenant-ID: <tenant_id>
```

- API Key emitida no provisionamento da VPS, atrelada ao `tenant_id`.
- Rate limit individual por token (isola risco entre clientes) — Redis com **sliding window**, validado no middleware da API Central antes de repassar ao Gemini.
- `call_id` é sempre gerado pela **API Central** (não pela VPS), prefixado por tenant, para evitar colisão entre clientes:
  ```
  call_id: "call_lojaabc123_7f3e9a1c"
  ```

## Observabilidade — Correlation ID

Toda requisição carrega um `X-Correlation-ID`, gerado na origem (Harpa/Chatwoot) e propagado por toda a cadeia: **Harpa → API Central → Harmonia → Ritmo**. Se a requisição chegar sem o header, a API Central gera um novo (nunca deixa a cadeia sem correlação).

Os logs devem registrar, por correlation_id:
- tempo gasto na IA (Gemini)
- tempo gasto na Tool (Harmonia)
- tempo gasto no ERP (Ritmo)

## Endpoints

### `POST /v1/chat`

Envia mensagem do usuário, recebe resposta via streaming (SSE).

**Request:**
```json
{
  "tenant_id": "loja_abc123",
  "conversation_id": "conv_9f8a2",
  "messages": [
    { "role": "user", "content": "Qual o frete pra CEP 28900-000?" }
  ],
  "context": {
    "store_rules": "Frete grátis acima de R$200. Prazo padrão 5 dias úteis.",
    "channel": "whatsapp"
  },
  "tools_available": ["consultar_frete", "gerar_etiqueta", "consultar_saldo", "emitir_nf"]
}
```

> **Payload leve por design:** `messages` carrega apenas as últimas N mensagens (histórico completo fica no Ritmo/Chatwoot). Estoque e catálogo completo **não** trafegam aqui — a Lyra os consulta via `function calling` no Harmonia local.

Antes de repassar `tools_available` ao Gemini, a API Central remove qualquer tool com **circuit breaker aberto** para aquele tenant (ver `04_operacao.md`).

**Response (stream SSE):**
```
event: token
data: {"text": "Vou calcular o frete pra você..."}

event: function_call
data: {"name": "consultar_frete", "arguments": {"cep": "28900-000"}, "call_id": "call_lojaabc123_7f3e9a1c"}

event: done
data: {"finish_reason": "tool_calls"}
```

### `POST /v1/chat/tool-result`

A VPS devolve o resultado da execução do Harmonia.

**Request (sucesso):**
```json
{
  "tenant_id": "loja_abc123",
  "conversation_id": "conv_9f8a2",
  "call_id": "call_lojaabc123_7f3e9a1c",
  "tool_name": "consultar_frete",
  "result": { "frete": "R$18,90", "prazo": "5 dias úteis" }
}
```

**Request (falha reportada pelo Harmonia):**
```json
{
  "tenant_id": "loja_abc123",
  "conversation_id": "conv_9f8a2",
  "call_id": "call_lojaabc123_7f3e9a1c",
  "tool_name": "consultar_estoque",
  "error": "ERP_OFFLINE"
}
```
Uma falha aqui incrementa o contador do circuit breaker para `(tenant, tool)`. Um sucesso zera o contador.

**Response:** novo stream SSE com a resposta final em linguagem natural.

### `POST /v1/chat/async-update`

Usado quando uma ação assíncrona (nativa ou convertida por timeout) é concluída pelo Harmonia fora do ciclo síncrono. Empurra a atualização final para o painel/conversa via SSE/websocket já aberto ou novo evento no Chatwoot.

**Request:**
```json
{
  "tenant_id": "loja_abc123",
  "call_id": "call_lojaabc123_7f3e9a1c",
  "status": "timeout_converted"
}
```
`status` possíveis: `timeout_converted` | `infra_failure` | qualquer status de conclusão de ação assíncrona nativa (ex: `etiqueta_gerada`).

> **Idempotência obrigatória:** este endpoint usa o `call_id` como chave de idempotência (Redis `SET NX`, TTL de 6h). Se o Harmonia reexecutar um nó por retry, o mesmo `call_id` não gera duas mensagens de retorno ao cliente final — a segunda chamada retorna `200 { "status": "already_processed" }` sem reenviar nada. A mesma regra vale para toda ação mutável (`gerar_etiqueta`, `emitir_nf`).

### `GET /v1/usage/:tenant_id`

Consulta de consumo/cota corrente.

```json
{
  "tenant_id": "vps-loja-123",
  "mes_vigente": "2026-09",
  "atendimentos_incluidos_plano": 500,
  "atendimentos_usados": 380,
  "atendimentos_restantes": 120,
  "percentual_uso": 88.0,
  "recargas_usadas_no_mes": 3,
  "recargas_maximas_permitidas": 3,
  "status_cota": "limite_recargas_atingido",
  "permite_nova_recarga": false,
  "plano_atual": "essencial"
}
```

> `mes_vigente` em formato ISO (`YYYY-MM`) — a tradução para exibição ("Setembro/2026") fica na camada do painel, não na API.

### `POST /v1/webhooks/quota-alert` (Nomen → painel do cliente)

```json
{
  "tenant_id": "vps-loja-123",
  "mes_vigente": "2026-09",
  "status": "alerta_80",
  "mensagem_sugerida": "Você já utilizou 80% dos atendimentos da Lyra deste mês.",
  "acao_recomendada": "nenhuma",
  "recargas_usadas_no_mes": 2,
  "recargas_maximas_permitidas": 3
}
```

`status` possíveis: `alerta_80` | `esgotado` | `bloqueado_para_recarga`
`acao_recomendada` possíveis: `nenhuma` | `oferecer_recarga` | `forcar_upgrade`

> `acao_recomendada` explícito centraliza a lógica de negócio na API — o painel apenas renderiza o botão correspondente, sem duplicar regra no front-end.

## Fluxo Síncrono vs. Assíncrono

| Tipo | Exemplos | Comportamento |
|---|---|---|
| **Síncrono** | `consultar_frete`, `consultar_saldo`, `consultar_estoque` | Lyra aguarda o retorno do Harmonia antes de formular a resposta final |
| **Assíncrono nativo** | `gerar_etiqueta`, `emitir_nf` | Lyra confirma o início e o Harmonia atualiza o status via callback quando concluir |

### Timeout e fallback automático (síncrono → assíncrono)

| Ação | Tipo padrão | Timeout antes do fallback |
|---|---|---|
| `consultar_frete` | síncrono | 5s |
| `consultar_saldo` | síncrono | 4s |
| `consultar_estoque` | síncrono | 4s |
| `gerar_etiqueta` | assíncrono nativo | — |
| `emitir_nf` | assíncrono nativo | — |

**Regra de conversão:**
1. Lyra dispara `function_call` → aguarda `tool-result`.
2. Timer inicia (conforme tabela acima).
3. Se o Harmonia responde antes do timeout → fluxo síncrono normal.
4. Se o timer estoura → API Central emite `fallback_async`:
   - Lyra responde: *"Deixa eu verificar isso e já te aviso"*.
   - `call_id` muda de status: `pending_sync` → `converted_async`.
   - A conexão SSE original é liberada.
   - A resposta tardia do Harmonia chega como `POST /v1/chat/async-update` com `status: "timeout_converted"`.
