'use strict';

const redis = require('./redisClient');

const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 6; // 6h — cobre folgadamente a janela de retry do N8N
const KEY_PREFIX = 'idempotency:call:';

/**
 * Garante que uma ação mutável (gerar_etiqueta, emitir_nf,
 * async-update) só produza efeito uma vez por call_id, mesmo que o
 * Harmonia reexecute o nó por retry.
 *
 * Uso:
 *   const { alreadyProcessed, markProcessed } = await idempotency.check(callId);
 *   if (alreadyProcessed) return res.status(200).json({ status: 'already_processed' });
 *   ... processa a ação ...
 *   await markProcessed();
 *
 * Implementado com SET NX (atômico) — evita race condition entre
 * duas requisições concorrentes com o mesmo call_id chegando quase
 * ao mesmo tempo.
 */
async function check(callId) {
  const key = `${KEY_PREFIX}${callId}`;

  // SET key value NX EX ttl — só seta se a chave não existir.
  // Se retornar null, a chave já existia (já processado ou em processamento).
  const wasSet = await redis.set(key, 'processing', 'NX', 'EX', IDEMPOTENCY_TTL_SECONDS);

  if (wasSet === null) {
    return {
      alreadyProcessed: true,
      markProcessed: async () => {}, // no-op — já estava marcado
    };
  }

  return {
    alreadyProcessed: false,
    markProcessed: async () => {
      await redis.set(key, 'done', 'EX', IDEMPOTENCY_TTL_SECONDS);
    },
  };
}

module.exports = { check };
