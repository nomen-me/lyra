'use strict';

/**
 * Enums de erro padronizados — usados tanto pela API Central quanto
 * pelos fluxos do Harmonia (N8N) na VPS do cliente, pra agilizar
 * debug e correlação de logs entre os dois lados.
 */
const ErrorCodes = Object.freeze({
  TOOL_TIMEOUT: 'TOOL_TIMEOUT', // Harmonia estourou o tempo limite síncrono
  AUTH_INVALID: 'AUTH_INVALID', // Token de autenticação da VPS/Tenant inválido
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED', // Cota por minuto excedida na API Central
  ERP_OFFLINE: 'ERP_OFFLINE', // Falha de comunicação no conector local com o Ritmo
  TOOL_UNAVAILABLE: 'TOOL_UNAVAILABLE', // Tool indisponível (ex: circuit breaker aberto)
  INFRA_FAILURE: 'INFRA_FAILURE', // Erro 5xx no Gemini ou na própria API Central
  INVALID_PAYLOAD: 'INVALID_PAYLOAD', // Corpo da requisição malformado
  TENANT_MISMATCH: 'TENANT_MISMATCH', // Tenant autenticado tentando acessar dado de outro
  INTERNAL_ERROR: 'INTERNAL_ERROR', // Fallback genérico — evitar usar quando um enum específico existir
});

/**
 * Erro de aplicação com código padronizado + statusCode HTTP, pra
 * lançar em qualquer camada e deixar o errorHandler global montar
 * a resposta certa.
 */
class AppError extends Error {
  constructor(code, message, statusCode = 500) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

module.exports = { ErrorCodes, AppError };
