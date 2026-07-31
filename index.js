'use strict';

const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');

const env = require('./config/env');
const { logger } = require('./utils/logger');
const { authenticate } = require('./middleware/auth');
const { rateLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');
const { correlationId } = require('./middleware/correlationId');
const { authenticateAdmin } = require('./middleware/adminAuth');
const chatRoutes = require('./routes/chat');
const usageRoutes = require('./routes/usage');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(helmet());
app.use(correlationId()); // gera/propaga X-Correlation-ID antes de qualquer outra coisa
app.use(express.json({ limit: '256kb' })); // payload é sempre leve por design (ver contrato)
app.use(
  pinoHttp({
    logger,
    // Nunca logar corpo da requisição automaticamente — pode conter
    // mensagens do cliente final. Logs de conteúdo são proibidos
    // (ver src/utils/logger.js).
    autoLogging: {
      ignore: (req) => req.url === '/healthz',
    },
    customProps: (req) => ({ correlation_id: req.correlationId, tenant_id: req.tenantId }),
  })
);

// Health check público — sem autenticação, usado por Netdata/Uptime
// Kuma (Acorde/Eco) e pelo orquestrador de deploy.
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// ── Rotas autenticadas (contrato /v1/*) ──────────────────────
// Ordem importa: autenticação primeiro (resolve req.tenantId),
// rate limiting depois (precisa de req.tenantId).
const v1Router = express.Router();
v1Router.use(authenticate);
v1Router.use(rateLimiter());
v1Router.use(chatRoutes);
v1Router.use(usageRoutes);

app.use('/v1', v1Router);

// ── Rotas administrativas (/admin/*) ─────────────────────────
// Autenticação própria (ADMIN_API_KEY), NUNCA a mesma chave de
// tenant. Usadas pelo scripts/onboard-client.sh para provisionar
// clientes novos sem precisar de SSH na máquina que roda a API.
const adminRouter = express.Router();
adminRouter.use(authenticateAdmin);
adminRouter.use(adminRoutes);

app.use('/admin', adminRouter);

// 404 explícito para rotas não mapeadas
app.use((req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.use(errorHandler);

app.listen(env.port, () => {
  logger.info({ event: 'server_started', port: env.port, node_env: env.nodeEnv });
});

module.exports = app;
