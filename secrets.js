'use strict';

const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const { logger } = require('../utils/logger');

/**
 * Abstração sobre o provedor de segredos.
 *
 * Em produção, cada VPS/tenant tem uma API Key gerada no
 * provisionamento e guardada no GCP Secret Manager ou HashiCorp
 * Vault — nunca em texto puro em banco de aplicação. Isso permite
 * rotação/revogação imediata sem precisar de acesso SSH à VPS do
 * cliente.
 *
 * Esta camada existe pra rota de autenticação nunca falar
 * diretamente com o Vault/Secret Manager — troca de provedor no
 * futuro não deveria tocar em src/middleware/auth.js.
 *
 * ── Modo dev/local ("env") ──────────────────────────────────────
 * Suporta MÚLTIPLOS tenants (não apenas um hardcoded), guardados em
 * um arquivo JSON local (data/tenants.dev.json). NUNCA usar este
 * modo em produção — é só pra dev/homologação sem depender de GCP
 * ainda. Use `npm run tenant:add` (scripts/provision-tenant.js) pra
 * cadastrar um tenant de teste.
 */

const DEV_STORE_PATH = path.join(__dirname, '..', '..', 'data', 'tenants.dev.json');

function readDevStore() {
  try {
    const raw = fs.readFileSync(DEV_STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    logger.error({ event: 'dev_store_read_error', message: err.message });
    return {};
  }
}

async function resolveTenantApiKeyHash(tenantId) {
  switch (env.secretsProvider) {
    case 'gcp_secret_manager':
      // TODO: integrar @google-cloud/secret-manager
      // const client = new SecretManagerServiceClient();
      // const [version] = await client.accessSecretVersion({
      //   name: `projects/${env.gcpProjectId}/secrets/tenant-${tenantId}/versions/latest`,
      // });
      // return version.payload.data.toString('utf8');
      throw new Error('Integração com GCP Secret Manager ainda não implementada.');

    case 'vault':
      // TODO: integrar node-vault
      throw new Error('Integração com HashiCorp Vault ainda não implementada.');

    case 'env':
    default: {
      const store = readDevStore();
      return store[tenantId] || null;
    }
  }
}

module.exports = { resolveTenantApiKeyHash, DEV_STORE_PATH };
