'use strict';

require('dotenv').config();

/**
 * Carrega e valida as variáveis de ambiente uma única vez na
 * inicialização do processo. Falha rápido (fail-fast) se algo
 * essencial estiver faltando, em vez de deixar o servidor subir
 * quebrado e falhar silenciosamente na primeira requisição.
 */
function required(name) {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '8080', 10),
  logLevel: process.env.LOG_LEVEL || 'info',

  gemini: {
    // Em produção, isso deveria vir do Secret Manager/Vault via
    // src/services/secrets.js, não diretamente do .env.
    apiKey: required('GEMINI_API_KEY'),
    // gemini-2.5-flash é estável e mais barato para começar; para
    // produção considerar gemini-3.6-flash (lançado jul/2026,
    // workhorse atual da família Flash) — trocar via .env, sem
    // precisar mudar código. Confirmar disponibilidade no tier
    // gratuito do AI Studio antes de usar em dev.
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },

  secretsProvider: process.env.SECRETS_PROVIDER || 'env',

  // Autenticação das rotas /admin/* (provisionamento de tenant via
  // scripts/onboard-client.sh). NUNCA a mesma chave usada por tenant
  // nenhum. Obrigatório em produção — ver required() acima.
  adminApiKey: required('ADMIN_API_KEY'),

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  billing: {
    tokensPerAttendance: parseInt(process.env.TOKENS_PER_ATTENDANCE || '1000', 10),
    recargasMaximasMes: parseInt(process.env.RECARGAS_MAXIMAS_MES || '3', 10),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '60', 10),
  },

  // Timeouts do fluxo síncrono, por tool. Ao estourar, a chamada é
  // convertida para assíncrona (status: timeout_converted) e CONTINUA
  // contando na cota — não confundir com infra_failure.
  syncTimeoutsMs: {
    consultar_frete: parseInt(process.env.TIMEOUT_CONSULTAR_FRETE_MS || '5000', 10),
    consultar_saldo: parseInt(process.env.TIMEOUT_CONSULTAR_SALDO_MS || '4000', 10),
    consultar_estoque: parseInt(process.env.TIMEOUT_CONSULTAR_ESTOQUE_MS || '4000', 10),
    consultar_status_pedido: parseInt(process.env.TIMEOUT_CONSULTAR_SALDO_MS || '4000', 10),
  },
};

module.exports = env;
