#!/usr/bin/env node
'use strict';

/**
 * Rotaciona a API Key de um tenant já existente — uso local/manual.
 *
 * Uso:
 *   node scripts/rotate-tenant-key.js <tenant_id>
 *   npm run tenant:rotate -- <tenant_id>
 */

const { rotateTenantKey } = require('../src/services/tenantProvisioning');

function main() {
  const tenantId = process.argv[2];

  if (!tenantId) {
    console.error('Uso: node scripts/rotate-tenant-key.js <tenant_id>');
    process.exit(1);
  }

  try {
    const { apiKey } = rotateTenantKey(tenantId);
    console.log(`Chave do tenant "${tenantId}" rotacionada com sucesso.\n`);
    console.log(`  Nova API Key: ${apiKey}\n`);
    console.log('A chave anterior parou de funcionar imediatamente.');
  } catch (err) {
    console.error(`Erro: ${err.message}`);
    process.exit(1);
  }
}

main();
