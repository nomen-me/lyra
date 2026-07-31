'use strict';

const { logger } = require('../utils/logger');
const { ErrorCodes } = require('../utils/errorCodes');

/**
 * Handler global de erros. Fica registrado por último no Express.
 *
 * Importante para o contrato de billing: erros aqui capturados que
 * se originem de falha de infraestrutura (Gemini 5xx, timeout de
 * conexão, etc.) devem ser marcados como `infra_failure` pela rota
 * que os gerou — este handler só garante que nenhum erro derruba o
 * processo ou vaza stack trace para o cliente final.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  logger.error({
    event: 'unhandled_error',
    message: err.message,
    tenant_id: req.tenantId,
    correlation_id: req.correlationId,
    path: req.path,
  });

  if (res.headersSent) {
    return next(err);
  }

  return res.status(err.statusCode || 500).json({
    error: err.code || ErrorCodes.INTERNAL_ERROR,
    message: 'Ocorreu um erro inesperado. A equipe já foi notificada.',
    correlation_id: req.correlationId,
  });
}

module.exports = { errorHandler };
