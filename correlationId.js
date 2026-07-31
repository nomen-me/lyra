'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Middleware de Correlation ID.
 *
 * Contrato: o Harpa (Chatwoot) gera um X-Correlation-ID na origem da
 * conversa e o propaga em toda chamada subsequente (API Central →
 * Harmonia → Ritmo). Se por algum motivo a requisição chegar sem o
 * header (ex: chamada direta em teste/dev), a API Central gera um
 * novo — nunca deixa uma requisição seguir sem correlation_id, senão
 * a observabilidade fica com buracos.
 *
 * O ID é anexado a req.correlationId e devolvido no header de
 * resposta, pra quem chamou conseguir correlacionar ponta a ponta.
 */
function correlationId() {
  return function correlationIdMiddleware(req, res, next) {
    const incoming = req.headers['x-correlation-id'];
    req.correlationId = incoming || uuidv4();
    res.set('X-Correlation-ID', req.correlationId);
    next();
  };
}

module.exports = { correlationId };
