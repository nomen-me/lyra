'use strict';

const redis = require('../services/redisClient');
const env = require('../config/env');
const { logger } = require('../utils/logger');
const { ErrorCodes } = require('../utils/errorCodes');

/**
 * Rate limiting por tenant_id usando sliding window log no Redis.
 *
 * Estratégia: cada requisição registra um timestamp num sorted set
 * `ratelimit:{tenantId}`. A cada nova requisição:
 *   1. Remove entradas mais antigas que a janela atual.
 *   2. Conta quantas entradas restaram.
 *   3. Se >= limite, rejeita com 429.
 *   4. Senão, registra a requisição atual e segue.
 *
 * Roda como middleware Express DEPOIS da autenticação — precisa de
 * req.tenantId já resolvido. Em produção, isso também pode viver
 * num API Gateway (Traefik/Kong + plugin Redis) na frente da API;
 * manter aqui também serve como segunda camada de defesa.
 */
function rateLimiter() {
  return async function rateLimiterMiddleware(req, res, next) {
    const tenantId = req.tenantId;
    if (!tenantId) {
      // Não deveria acontecer se authenticate() rodou antes,
      // mas falha de forma segura (nega) em vez de deixar passar.
      return res.status(401).json({ error: 'missing_tenant_context' });
    }

    const key = `ratelimit:${tenantId}`;
    const now = Date.now();
    const windowStart = now - env.rateLimit.windowMs;

    try {
      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now, `${now}-${Math.random()}`);
      pipeline.zcard(key);
      pipeline.pexpire(key, env.rateLimit.windowMs);

      const results = await pipeline.exec();
      const currentCount = results[2][1];

      if (currentCount > env.rateLimit.maxRequests) {
        logger.warn({ event: 'rate_limit_exceeded', tenant_id: tenantId, current_count: currentCount });
        res.set('Retry-After', Math.ceil(env.rateLimit.windowMs / 1000).toString());
        return res.status(429).json({
          error: ErrorCodes.RATE_LIMIT_EXCEEDED,
          message: 'Limite de requisições excedido para este tenant. Tente novamente em instantes.',
        });
      }

      return next();
    } catch (err) {
      // Redis fora do ar não deveria derrubar a API inteira — loga
      // e deixa passar (fail-open). Ajustar para fail-closed se a
      // política de segurança exigir.
      logger.error({ event: 'rate_limiter_error', message: err.message, tenant_id: tenantId });
      return next();
    }
  };
}

module.exports = { rateLimiter };
