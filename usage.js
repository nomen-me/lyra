'use strict';

const express = require('express');
const env = require('../config/env');
const { ErrorCodes } = require('../utils/errorCodes');

const router = express.Router();

/**
 * GET /v1/usage/:tenantId
 *
 * TODO: substituir pelos dados reais vindos do Postgres/Redis de
 * billing. Este stub devolve um formato válido pro painel já
 * conseguir integrar antes do billing real estar pronto.
 */
router.get('/usage/:tenantId', async (req, res) => {
  const { tenantId } = req.params;

  if (tenantId !== req.tenantId) {
    return res.status(403).json({
      error: ErrorCodes.TENANT_MISMATCH,
      message: 'O tenant autenticado não pode consultar cota de outro tenant.',
    });
  }

  // TODO: buscar valores reais.
  return res.status(200).json({
    tenant_id: tenantId,
    mes_vigente: new Date().toISOString().slice(0, 7), // YYYY-MM
    atendimentos_incluidos_plano: null,
    atendimentos_usados: null,
    atendimentos_restantes: null,
    percentual_uso: null,
    recargas_usadas_no_mes: null,
    recargas_maximas_permitidas: env.billing.recargasMaximasMes,
    status_cota: 'nao_implementado',
    permite_nova_recarga: null,
    plano_atual: null,
  });
});

module.exports = router;
