'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DEV_STORE_PATH } = require('./secrets');
const { logger } = require('../utils/logger');

/**
 * Lógica de provisionamento de tenant, compartilhada entre:
 *   - scripts/provision-tenant.js (CLI, roda local na máquina/VPS)
 *   - src/routes/admin.js (endpoint HTTP, pra automatizar sem SSH)
 *
 * Modo atual: escreve no store de DEV (data/tenants.dev.json).
 * TODO: quando SECRETS_PROVIDER != 'env', trocar a implementação de
 * readStore/writeStore para gravar no GCP Secret Manager/Vault em
 * vez do arquivo local — a assinatura das funções públicas
 * (provisionTenant, rotateTenantKey) não deveria precisar mudar.
 */

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(DEV_STORE_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(DEV_STORE_PATH), { recursive: true });
  fs.writeFileSync(DEV_STORE_PATH, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
}

function generateApiKey() {
  return crypto.randomBytes(32).toString('hex');
}

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Provisiona um tenant novo. Lança erro se já existir.
 * Retorna { tenantId, apiKey } — a apiKey só existe neste retorno,
 * nunca é recuperável depois (só o hash fica salvo).
 */
function provisionTenant(tenantId) {
  if (!tenantId || typeof tenantId !== 'string' || !/^[a-z0-9_-]{3,64}$/.test(tenantId)) {
    const err = new Error('tenant_id inválido: use apenas letras minúsculas, números, "_" e "-", entre 3 e 64 caracteres.');
    err.code = 'INVALID_TENANT_ID';
    throw err;
  }

  const store = readStore();

  if (store[tenantId]) {
    const err = new Error(`Tenant "${tenantId}" já existe.`);
    err.code = 'TENANT_ALREADY_EXISTS';
    throw err;
  }

  const apiKey = generateApiKey();
  store[tenantId] = hashApiKey(apiKey);
  writeStore(store);

  logger.info({ event: 'tenant_provisioned', tenant_id: tenantId });

  return { tenantId, apiKey };
}

/**
 * Rotaciona a chave de um tenant existente. Lança erro se não existir.
 */
function rotateTenantKey(tenantId) {
  const store = readStore();

  if (!store[tenantId]) {
    const err = new Error(`Tenant "${tenantId}" não encontrado.`);
    err.code = 'TENANT_NOT_FOUND';
    throw err;
  }

  const apiKey = generateApiKey();
  store[tenantId] = hashApiKey(apiKey);
  writeStore(store);

  logger.info({ event: 'tenant_key_rotated', tenant_id: tenantId });

  return { tenantId, apiKey };
}

function listTenants() {
  return Object.keys(readStore());
}

module.exports = { provisionTenant, rotateTenantKey, listTenants };
