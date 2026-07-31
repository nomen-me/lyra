'use strict';

const crypto = require('crypto');
const { resolveTenantApiKeyHash } = require('../services/secrets');
const { logger } = require('../utils/logger');
const { ErrorCodes } = require('../utils/errorCodes');

/**
 * Autenticação por Bearer Token + X-Tenant-ID.
 *
 * Contrato (definido em `/v1/*`):
 *   Authorization: Bearer <api_key_da_vps>
 *   X-Tenant-ID: <tenant_id>
 *
 * A API Key é validada contra o hash armazenado no Secret Manager/
 * Vault para aquele tenant_id — nunca comparamos a chave em texto
 * puro salva em banco de aplicação.
 *
 * Importante: tenant_id sozinho NUNCA autentica nada. Ele só serve
 * pra saber QUAL segredo buscar; quem prova identidade é o token.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers['authorization'] || '';
    const tenantId = req.headers['x-tenant-id'];

    if (!tenantId) {
      return res.status(401).json({
        error: ErrorCodes.AUTH_INVALID,
        message: 'Header X-Tenant-ID é obrigatório.',
      });
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({
        error: ErrorCodes.AUTH_INVALID,
        message: 'Header Authorization deve ser "Bearer <api_key>".',
      });
    }

    const expectedHash = await resolveTenantApiKeyHash(tenantId);

    if (!expectedHash) {
      logger.warn({ event: 'auth_unknown_tenant', tenant_id: tenantId });
      return res.status(401).json({ error: ErrorCodes.AUTH_INVALID });
    }

    const providedHash = hashToken(token);

    // Comparação em tempo constante — evita timing attack revelando
    // por quanto tempo o hash "quase bateu".
    const isValid =
      providedHash.length === expectedHash.length &&
      crypto.timingSafeEqual(Buffer.from(providedHash), Buffer.from(expectedHash));

    if (!isValid) {
      logger.warn({ event: 'auth_invalid_token', tenant_id: tenantId });
      return res.status(401).json({ error: ErrorCodes.AUTH_INVALID });
    }

    // A partir daqui, todo o resto do pipeline (rate limit, rotas,
    // billing) pode confiar em req.tenantId.
    req.tenantId = tenantId;
    return next();
  } catch (err) {
    logger.error({ event: 'auth_error', message: err.message });
    return res.status(500).json({ error: 'internal_auth_error' });
  }
}

module.exports = { authenticate };
