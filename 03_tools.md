# 03 — Catálogo de Tools

Schemas no formato `functionDeclarations` esperado pelo Function Calling nativo do Gemini.

```json
{
  "functionDeclarations": [
    {
      "name": "consultar_frete",
      "description": "Consulta o valor e prazo de frete para um CEP de destino, considerando peso e dimensões do pacote. Use quando o cliente perguntar sobre custo ou prazo de entrega.",
      "parameters": {
        "type": "object",
        "properties": {
          "cep": {
            "type": "string",
            "description": "CEP de destino, formato 00000-000 ou 00000000."
          },
          "peso": {
            "type": "number",
            "description": "Peso total do pacote em kg. Se não informado pelo cliente, usar o peso padrão do produto consultado."
          },
          "dimensoes": {
            "type": "object",
            "properties": {
              "altura_cm": { "type": "number" },
              "largura_cm": { "type": "number" },
              "comprimento_cm": { "type": "number" }
            },
            "description": "Dimensões do pacote em cm. Opcional — se ausente, o Harmonia usa a dimensão padrão cadastrada do produto."
          }
        },
        "required": ["cep"]
      }
    },
    {
      "name": "consultar_estoque",
      "description": "Verifica se um produto está disponível em estoque e a quantidade. Use quando o cliente perguntar se um item está disponível, ou antes de confirmar uma venda.",
      "parameters": {
        "type": "object",
        "properties": {
          "sku": {
            "type": "string",
            "description": "Código SKU do produto, se conhecido."
          },
          "nome_produto": {
            "type": "string",
            "description": "Nome ou descrição do produto, usado quando o SKU não está disponível. Buscar por aproximação no catálogo local."
          }
        },
        "required": []
      }
    },
    {
      "name": "consultar_status_pedido",
      "description": "Consulta o status atual e o saldo/situação de um pedido específico. Use quando o cliente perguntar 'cadê meu pedido', 'já foi enviado', ou similar.",
      "parameters": {
        "type": "object",
        "properties": {
          "pedido_id": {
            "type": "string",
            "description": "Número/ID do pedido. Preferencial sobre CPF quando disponível."
          },
          "cpf_cliente": {
            "type": "string",
            "description": "CPF do cliente, usado para localizar o pedido caso o pedido_id não seja informado. Deve ser validado no Harmonia antes de retornar dados sensíveis."
          }
        },
        "required": []
      }
    }
  ]
}
```

## Regra de parâmetro mínimo obrigatório

O JSON Schema **não** valida "pelo menos um de dois campos" — isso é imposto via System Prompt, não via schema:

- `consultar_estoque`: exige `sku` OU `nome_produto`. Se nenhum vier, a Lyra pergunta ao cliente antes de chamar a tool.
- `consultar_status_pedido`: exige `pedido_id` OU `cpf_cliente`. Mesma regra.

## Tratamento do CPF

- O `cpf_cliente` trafega no `function_call` da API Central **em trânsito** (processamento em memória, sem persistência em disco na Nomen — ver regra de Zero Log em `01_arquitetura.md`).
- No **Harmonia local**, o log de execução grava apenas o CPF **mascarado** (ex: `***.123.456-**`), nunca o CPF completo.
- A Lyra **nunca repete o CPF completo de volta ao cliente** na resposta em linguagem natural, mesmo que o próprio cliente o tenha enviado por extenso. Usar referência parcial (ex: "encontrei seu pedido com o CPF final 456-**").

## Retorno de erro de uma tool

Quando o Harmonia não consegue executar a ação (ex: ERP fora do ar), o retorno em `POST /v1/chat/tool-result` deve usar o enum padronizado (ver `04_operacao.md`):

```json
{
  "call_id": "call_lojaabc123_7f3e9a1c",
  "tool_name": "consultar_estoque",
  "error": "ERP_OFFLINE"
}
```

Isso alimenta o circuit breaker daquele `(tenant, tool)` — 5 falhas consecutivas abrem o circuito temporariamente (ver `04_operacao.md`).

## Próximas tools (backlog, sem schema definido ainda)

- `gerar_etiqueta` (assíncrona nativa)
- `emitir_nf` (assíncrona nativa)
