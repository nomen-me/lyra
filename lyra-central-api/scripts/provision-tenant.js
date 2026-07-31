#!/usr/bin/env node
'use strict';

/**
 * Provisiona um tenant novo — uso local/manual (roda direto no
 * servidor da API Central). Para onboarding remoto de um cliente
 * novo sem SSH, use scripts/onboard-client.sh, que chama o mesmo
 * serviço via endpoint HTTP (/admin/tenants).
 *
 * Uso:
 *   node scripts/provision-tenant.js <tenant_id>
 *   npm run tenant:add -- <tenant_id>
 */

const { provisionTenant } = require('../src/services/tenantProvisioning');

function main() {
  const tenantId = process.argv[2];

  if (!tenantId) {
    console.error('Uso: node scripts/provision-tenant.js <tenant_id>');
    process.exit(1);
  }

  try {
    const { apiKey } = provisionTenant(tenantId);
    console.log('Tenant provisionado com sucesso (modo DEV).\n');
    console.log(`  tenant_id: ${tenantId}`);
    console.log(`  API Key:   ${apiKey}\n`);
    console.log('Guarde a API Key agora — ela não é recuperável depois (só o hash fica salvo).\n');
    console.log('Exemplo de uso:');
    console.log(`  curl -H "Authorization: Bearer ${apiKey}" -H "X-Tenant-ID: ${tenantId}" http://localhost:8080/v1/usage/${tenantId}`);
  } catch (err) {
    console.error(`Erro: ${err.message}`);
    process.exit(1);
  }
}

main();
