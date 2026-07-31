# 01 — Arquitetura

## Visão Geral

A Lyra é a IA nativa da Synapse, construída sobre o **Gemini Flash**. Ela atua tanto no **atendimento ao cliente final** (via Harpa/Chatwoot) quanto em **automações internas** (via Harmonia/N8N), desde o lançamento.

Cada cliente da Synapse opera em uma **VPS independente** (não é hospedagem compartilhada). A Lyra, porém, é **centralizada na infraestrutura da Nomen**, seguindo o modelo:

> **Lyra Centralizada com Cota Gerenciada (Híbrida SaaS)**

```
[VPS do Cliente]                             [Infra Nomen / Central]
  ├── Painel / Ritmo ──(envia mensagem)────> ├── API Central da Lyra
  │                                           │   └── Valida Cota/Pacote de IA
  │                                           │   └── Processa via Gemini
  └── Harmonia (n8n) <──(dispara ação)────────┘
```

**Por que centralizada:** permite à Nomen (a) manter isolamento de dados entre lojistas, (b) monetizar excedente de uso via pacotes/upgrade, e (c) atualizar a lógica da IA sem depender de deploy em cada VPS.

**Por que a execução fica local:** o Harmonia (N8N) de cada VPS executa as ações (consultar estoque, gerar etiqueta, emitir NF) diretamente no banco local (Ritmo), sem que dados brutos do cliente trafeguem desnecessariamente até a Nomen.

## Componentes Envolvidos

| Codinome | Sistema | Papel na arquitetura da Lyra |
|---|---|---|
| Ritmo | ERPNext | Fonte de dados operacionais (estoque, pedidos); persiste histórico de conversa |
| Harmonia | N8N | Orquestra execução de ações (tools) localmente na VPS |
| Harpa | Chatwoot | Canal de atendimento ao cliente final |
| Lyra | Gemini Flash (API central Nomen) | Inteligência conversacional e decisão de ações |

## Segurança e Performance

- **Isolamento de dados:** a Lyra só recebe o contexto da loja que está atendendo (`tenant_id`, histórico recente, regras) — sem cruzamento entre lojistas.
- **Rate limit por token**, não por tenant_id isolado do resto — protege contra abuso vindo de uma única VPS comprometida.
- **Streaming (SSE)** da API Central para a VPS mantém o chat fluido apesar do hop de rede adicional.
- **Hospedagem da API Central** planejada para a mesma região dos data centers do Gemini/Vertex AI, minimizando latência.
- **Ambiente:** tier gratuito do Google AI Studio para dev/testes; produção em pay-as-you-go (Google Cloud/Vertex AI), evitando bloqueio por limite de RPM.
- **Gerenciamento de API Keys:** via Secret Manager (GCP Secret Manager ou HashiCorp Vault). A chave é gerada no provisionamento da VPS e registrada encriptada, vinculada ao `tenant_id`, permitindo rotação/revogação sem acesso SSH à VPS do cliente.

## LGPD e Retenção de Dados

- **Zero Log de Mensagem:** a API Central processa os payloads para o Gemini estritamente **em trânsito** e os descarta da memória após a execução.
- **Onde fica a persistência:** o histórico completo e auditável da conversa permanece exclusivamente no banco local da VPS do cliente (Ritmo/Harpa).
- **Logs da API Central:** registram apenas metadados (`tenant_id`, `call_id`, timestamp, contagem de tokens/caracteres, status da resposta). Sem conteúdo de mensagem, nomes ou documentos.
- **Termos de Uso:** incluirão cláusula de *Operator* — a Nomen atua como operadora dos dados em trânsito sob orientação do lojista, que é o controlador.
- **Recomendação:** validar a redação final dessas cláusulas com um advogado especializado em direito digital/consumidor antes da publicação — este documento não substitui parecer jurídico.

## Modelo de Billing e Cota

### Unidade de cobrança (camada dupla)

- **Interno/técnico:** contabilizado em **tokens brutos** (fonte de verdade real, alinhada ao custo da API do Gemini).
- **Exposto ao lojista:** convertido em **"atendimentos"** — 1 atendimento = **1.000 tokens** (`prompt_tokens` + `completion_tokens`). Uma interação padrão de e-commerce (pergunta + tool + resposta) consome, em média, 800–1.200 tokens no Gemini Flash. Parametrizado como `TOKENS_PER_ATTENDANCE` em variável de ambiente, ajustável com telemetria real.

### Ciclo de cota

- **Mês calendário nomeado** (1º ao último dia do mês civil), não rolling 30 dias.
- O contador de recargas zera no dia 1º de cada mês.

### Funil de 3 estágios

| Estágio | Gatilho | Comportamento |
|---|---|---|
| Cota do plano esgotada | 100% do incluso no mês | Oferece recarga avulsa |
| Recargas 1–3 | Cada nova recarga no mesmo mês | Libera; incrementa contador "X de 3" visível no painel |
| 4ª tentativa no mês | Excedeu as 3 recargas permitidas | Bloqueia nova recarga; força fluxo de upgrade de plano |

- Máximo de **3 recargas avulsas por mês calendário**.
- Na 4ª tentativa, a loja é obrigada a migrar para um plano superior — a Lyra não é desligada abruptamente; ações síncronas simples (frete, saldo) podem permanecer liberadas num modo básico enquanto o lojista decide.

### Isenção de cota — timeout vs. falha de infraestrutura

| Status | Significado | Efeito na cota |
|---|---|---|
| `timeout_converted` | Gemini respondeu normalmente, mas o Harmonia local demorou; a Lyra converteu para o modo assíncrono | **Conta na cota normalmente** — o atendimento aconteceu, só demorou |
| `infra_failure` | Erro `5xx` no Gemini ou queda na própria API Central | **Isento de cota** — cliente é transferido para atendimento humano |

Essa distinção evita duas coisas: (a) a Nomen ser penalizada por lentidão que não é dela, e (b) o lojista conseguir "gamear" a cota deixando o Harmonia lento de propósito.

### Margem e enquadramento legal (referência para revisão jurídica)

- Margem de lucro de 250% sobre o custo do serviço de IA é praticada, no contexto de contrato B2B/SaaS.
- O modelo de limite de recargas + upgrade obrigatório se apoia no CDC:
  - **Art. 6º, III** — direito à informação clara: as regras precisam estar explicitamente descritas nos Termos de Uso/Contrato de Prestação de Serviços assinado no credenciamento.
  - **Art. 39, I** — a migração obrigatória é apresentada como enquadramento no porte correto do contrato, não como venda casada.

### Comunicação com o lojista (tom não-punitivo)

- Evitar linguagem como "operação bloqueada".
- Preferir mensagens que expliquem o benefício, ex.: *"Sua loja cresceu! Para garantir melhor custo-benefício e capacidade contínua de atendimento da Lyra, sua conta atingiu o limite de recargas avulsas. Recomendamos a migração para o Plano [Nome] que já inclui esse volume."*
- Painel deve exibir indicador visual permanente: **"Recargas avulsas utilizadas este mês: X de 3"**.

## Pontos em Aberto

- Texto final das cláusulas dos Termos de Uso (recomenda-se revisão jurídica).
- Desenho visual do painel de indicador de cota.
- Ajuste fino de `TOKENS_PER_ATTENDANCE` com base em telemetria real de uso.
