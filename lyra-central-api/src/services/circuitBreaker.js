'use strict';

const redis = require('./redisClient');
const { logger } = require('../utils/logger');

const FAILURE_THRESHOLD = 5; // falhas consecutivas antes de abrir o circuito
const OPEN_STATE_TTL_SECONDS = 60 * 2; // tempo de resfriamento (ajustável)
const FAILURE_COUNT_TTL_SECONDS = 60 * 5; // janela pra contar falhas "consecutivas"

function failureKey(tenantId, toolName) {
  return `circuit:failures:${tenantId}:${toolName}`;
}

function openKey(tenantId, toolName) {
  return `circuit:open:${tenantId}:${toolName}`;
}

/**
 * Circuit breaker simples por (tenant, tool), apoiado em Redis.
 *
 * Fluxo:
 *   - isOpen(tenantId, tool): checa antes de chamar o Harmonia. Se
 *     true, a Lyra responde diretamente sem tentar a tool.
 *   - recordFailure(tenantId, tool): chamado a cada erro/timeout de
 *     infraestrutura da tool. Ao atingir o threshold, abre o circuito.
 *   - recordSuccess(tenantId, tool): zera o contador de falhas.
 *
 * Importante: isso é por LOJA, não global — uma loja com ERP local
 * instável não deve afetar as outras lojas usando a mesma tool.
 */
async function isOpen(tenantId, toolName) {
  const open = await redis.get(openKey(tenantId, toolName));
  return open !== null;
}

async function recordFailure(tenantId, toolName) {
  const key = failureKey(tenantId, toolName);
  const count = await redis.incr(key);
  await redis.expire(key, FAILURE_COUNT_TTL_SECONDS);

  if (count >= FAILURE_THRESHOLD) {
    await redis.set(openKey(tenantId, toolName), '1', 'EX', OPEN_STATE_TTL_SECONDS);
    logger.warn({
      event: 'circuit_breaker_opened',
      tenant_id: tenantId,
      tool: toolName,
      consecutive_failures: count,
      cooldown_seconds: OPEN_STATE_TTL_SECONDS,
    });
  }

  return count;
}

async function recordSuccess(tenantId, toolName) {
  await redis.del(failureKey(tenantId, toolName));
}

module.exports = { isOpen, recordFailure, recordSuccess };
