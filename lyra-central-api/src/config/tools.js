'use strict';

/**
 * Tools disponíveis para a Lyra, no formato `functionDeclarations`
 * esperado pelo SDK @google/genai (config.tools).
 *
 * Fonte única de verdade — este arquivo é o que de fato vai pro
 * Gemini. `docs/03_tools.md` documenta o mesmo conteúdo em prosa;
 * se editar aqui, atualize lá também.
 *
 * Regra de parâmetro mínimo obrigatório (não expressável em JSON
 * Schema puro — "pelo menos um de dois campos") é imposta via
 * System Prompt, não aqui. Ver src/config/systemPrompt.js.
 */
const toolDeclarations = {
  consultar_frete: {
    name: 'consultar_frete',
    description:
      'Consulta o valor e prazo de frete para um CEP de destino, considerando peso e dimensões do pacote. Use quando o cliente perguntar sobre custo ou prazo de entrega.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        cep: {
          type: 'string',
          description: 'CEP de destino, formato 00000-000 ou 00000000.',
        },
        peso: {
          type: 'number',
          description:
            'Peso total do pacote em kg. Se não informado pelo cliente, usar o peso padrão do produto consultado.',
        },
        dimensoes: {
          type: 'object',
          properties: {
            altura_cm: { type: 'number' },
            largura_cm: { type: 'number' },
            comprimento_cm: { type: 'number' },
          },
          description:
            'Dimensões do pacote em cm. Opcional — se ausente, o Harmonia usa a dimensão padrão cadastrada do produto.',
        },
      },
      required: ['cep'],
    },
  },

  consultar_estoque: {
    name: 'consultar_estoque',
    description:
      'Verifica se um produto está disponível em estoque e a quantidade. Use quando o cliente perguntar se um item está disponível, ou antes de confirmar uma venda.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        sku: {
          type: 'string',
          description: 'Código SKU do produto, se conhecido.',
        },
        nome_produto: {
          type: 'string',
          description:
            'Nome ou descrição do produto, usado quando o SKU não está disponível. Buscar por aproximação no catálogo local.',
        },
      },
      required: [],
    },
  },

  consultar_status_pedido: {
    name: 'consultar_status_pedido',
    description:
      "Consulta o status atual e o saldo/situação de um pedido específico. Use quando o cliente perguntar 'cadê meu pedido', 'já foi enviado', ou similar.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        pedido_id: {
          type: 'string',
          description: 'Número/ID do pedido. Preferencial sobre CPF quando disponível.',
        },
        cpf_cliente: {
          type: 'string',
          description:
            'CPF do cliente, usado para localizar o pedido caso o pedido_id não seja informado. Deve ser validado no Harmonia antes de retornar dados sensíveis.',
        },
      },
      required: [],
    },
  },
};

/**
 * Monta o array `config.tools` do Gemini a partir de uma lista de
 * nomes de tools disponíveis para este turno (já filtrada pelo
 * circuit breaker em src/routes/chat.js).
 */
function buildToolsConfig(toolNames = []) {
  const functionDeclarations = toolNames
    .map((name) => toolDeclarations[name])
    .filter(Boolean);

  if (functionDeclarations.length === 0) return undefined;

  return [{ functionDeclarations }];
}

module.exports = { toolDeclarations, buildToolsConfig };
