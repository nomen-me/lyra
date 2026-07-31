'use strict';

const pino = require('pino');
const env = require('../config/env');

/**
 * Logger central da API.
 *
 * REGRA DE OURO (LGPD — zero log de conteúdo):
 * Este logger NUNCA deve receber `message.content`, `cpf_cliente`,
 * `nome`, endereços ou qualquer dado pessoal do cliente final.
 * Apenas metadados: tenant_id, call_id, timestamps, contagem de
 * tokens e status da resposta.
 *
 * Os helpers abaixo existem justamente para forçar essa disciplina
 * em vez de deixar cada rota decidir o que logar.
 */
const logger = pino({
  level: env.logLevel,
  redact: {
    // Camada de segurança extra: se algum dia um campo proibido
    // vazar para o logger por engano, ele é mascarado aqui também.
    paths: [
      'content',
      'message.content',
      'cpf_cliente',
      'nome',
      'nome_cliente',
      '*.cpf_cliente',
      '*.content',
    ],
    censor: '[REDACTED]',
  },
});

/**
 * Log de metadados de uma chamada — o único tipo de log permitido
 * envolvendo dados de uma interação com o cliente final.
 */
function logCallMetadata({ tenantId, callId, event, tokens, status, extra = {} }) {
  logger.info({
    tenant_id: tenantId,
    call_id: callId,
    event,
    tokens,
    status,
    ts: new Date().toISOString(),
    ...extra,
  });
}

module.exports = { logger, logCallMetadata };
