'use strict';

const express = require('express');
const { provisionTenant, rotateTenantKey, listTenants } = require('../services/tenantProvisioning');
const { ErrorCodes } = require('../utils/errorCodes');

const router = express.Router();

/**
 * POST /admin/tenants
 * Body: { "tenant_id": "loja_abc123" }
 * Provisiona um tenant novo. Retorna a API Key EM TEXTO PURO — única
 * vez que ela aparece. Quem chamar este endpoint é responsável por
 * entregá-la com segurança pra quem for configurar a VPS do cliente.
 */
router.post('/tenants', (req, res) => {
  const { tenant_id: tenantId } = req.body;

  try {
    const { apiKey } = provisionTenant(tenantId);
    return res.status(201).json({ tenant_id: tenantId, api_key: apiKey });
  } catch (err) {
    if (err.code === 'INVALID_TENANT_ID') {
      return res.status(400).json({ error: ErrorCodes.INVALID_PAYLOAD, message: err.message });
    }
    if (err.code === 'TENANT_ALREADY_EXISTS') {
      return res.status(409).json({ error: 'TENANT_ALREADY_EXISTS', message: err.message });
    }
    throw err;
  }
});

/**
 * POST /admin/tenants/:tenantId/rotate
 * Rotaciona a chave de um tenant existente. A chave antiga para de
 * funcionar imediatamente.
 */
router.post('/tenants/:tenantId/rotate', (req, res) => {
  const { tenantId } = req.params;

  try {
    const { apiKey } = rotateTenantKey(tenantId);
    return res.status(200).json({ tenant_id: tenantId, api_key: apiKey });
  } catch (err) {
    if (err.code === 'TENANT_NOT_FOUND') {
      return res.status(404).json({ error: 'TENANT_NOT_FOUND', message: err.message });
    }
    throw err;
  }
});

/**
 * GET /admin/tenants
 * Lista tenant_ids cadastrados (sem expor hashes nem chaves).
 */
router.get('/tenants', (req, res) => {
  return res.status(200).json({ tenants: listTenants() });
});

module.exports = router;
