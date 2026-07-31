'use strict';

const Redis = require('ioredis');
const env = require('../config/env');
const { logger } = require('../utils/logger');

const redis = new Redis(env.redis.url, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on('error', (err) => {
  logger.error({ event: 'redis_error', message: err.message });
});

redis.on('connect', () => {
  logger.info({ event: 'redis_connected' });
});

module.exports = redis;
