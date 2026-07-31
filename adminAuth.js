'use strict';

const crypto = require('crypto');
const env = require('../config/env');
const { logger } = require('../utils/logger');
const { ErrorCodes } = require('../utils/errorCodes');

/**
 * Autenticação administrativa — usada SÓ pelas rotas /admin/*, que
 * provisionam/rotacionam tenants. Deliberadamente separada da
 * autenticação de tenant (src/middleware/auth.js): a chave de admin
 * nunca deve ser distribuída pra VPS de cliente nenhum, só fica com
 * quem opera o onboarding (ex: o script scripts/onboard-client.sh,
 * rodado da sua própria máquina ou de um pipeline de automação).
 *
 * Header esperado:
 *   Authorization: Bearer <ADMIN_API_KEY>
 */
function authenticateAdmin(req, res, next) {
  if (!env.adminApiKey) {
    logger.error({ event: 'admin_auth_misconfigured' });
    return res.status(500).json({ error: ErrorCodes.INTERNAL_ERROR, message: 'ADMIN_API_KEY não configurado no servidor.' });
  }

  const authHeader = req.headers['authorization'] || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: ErrorCodes.AUTH_INVALID, message: 'Header Authorization deve ser "Bearer <admin_api_key>".' });
  }

  const provided = Buffer.from(token);
  const expected = Buffer.from(env.adminApiKey);

  const isValid = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

  if (!isValid) {
    logger.warn({ event: 'admin_auth_invalid_attempt' });
    return res.status(401).json({ error: ErrorCodes.AUTH_INVALID });
  }

  return next();
}

module.exports = { authenticateAdmin };
