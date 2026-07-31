'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { logCallMetadata, logger } = require('../utils/logger');
const { ErrorCodes } = require('../utils/errorCodes');
const idempotency = require('../services/idempotency');
const circuitBreaker = require('../services/circuitBreaker');
const geminiService = require('../services/geminiService');

const router = express.Router();

/**
 * POST /v1/chat
 *
 * Recebe a mensagem do usuário, chama o Gemini em streaming (com
 * tools e system prompt), e repassa os eventos como SSE.
 *
 * NOTA DE IMPLEMENTAÇÃO: o parsing de `function_call` no streaming
 * (src/services/geminiService.js) foi escrito com base na
 * documentação pública do @google/genai, mas o formato exato de
 * `chunk.functionCalls` deve ser validado contra uma chamada real
 * antes de considerar isso pronto pra produção — SDKs de IA mudam
 * formato de resposta com frequência entre versões menores.
 */
router.post('/chat', async (req, res) => {
  const { conversation_id: conversationId, messages, context, tools_available: toolsAvailable = [] } = req.body;

  if (!conversationId || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: ErrorCodes.INVALID_PAYLOAD,
      message: 'conversation_id e messages (array não vazio) são obrigatórios.',
      correlation_id: req.correlationId,
    });
  }

  // Remove das tools disponíveis para este turno qualquer uma com
  // circuito aberto para este tenant — a Lyra nem tenta chamá-la.
  const availableAfterBreaker = [];
  const blockedByBreaker = [];
  for (const toolName of toolsAvailable) {
    const open = await circuitBreaker.isOpen(req.tenantId, toolName);
    if (open) {
      blockedByBreaker.push(toolName);
    } else {
      availableAfterBreaker.push(toolName);
    }
  }

  if (blockedByBreaker.length > 0) {
    logger.warn({
      event: 'tools_blocked_by_circuit_breaker',
      tenant_id: req.tenantId,
      correlation_id: req.correlationId,
      tools: blockedByBreaker,
    });
  }

  const callId = `call_${req.tenantId}_${uuidv4().slice(0, 8)}`;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const emit = (eventName, data) => {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const startedAt = Date.now();

  try {
    const { finishReason, usage } = await geminiService.streamChat({
      messages,
      context,
      toolsAvailable: availableAfterBreaker,
      onEvent: (eventName, data) => {
        // O call_id vai junto em eventos de function_call, pra bater
        // com o contrato documentado em docs/02_api.md.
        if (eventName === 'function_call') {
          emit(eventName, { ...data, call_id: callId });
        } else {
          emit(eventName, data);
        }
      },
    });

    res.end();

    logCallMetadata({
      tenantId: req.tenantId,
      callId,
      event: 'chat_request_completed',
      tokens: usage ? usage.totalTokens : null,
      status: finishReason,
      extra: {
        correlation_id: req.correlationId,
        tempo_ia_ms: Date.now() - startedAt,
      },
    });
  } catch (err) {
    // Falha de infraestrutura do Gemini/API Central — status
    // infra_failure, isento de cota (regra definida em
    // docs/01_arquitetura.md), sem tentar mascarar como resposta
    // normal. O painel/Harpa deve tratar isso como transbordo.
    logger.error({
      event: 'gemini_call_failed',
      tenant_id: req.tenantId,
      call_id: callId,
      correlation_id: req.correlationId,
      message: err.message,
    });

    if (!res.headersSent) {
      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    }
    emit('token', {
      text: 'Tive uma pequena instabilidade no meu sistema. Para não te deixar esperando, estou te direcionando para um dos nossos atendentes.',
    });
    emit('done', { finish_reason: 'infra_failure' });
    res.end();

    logCallMetadata({
      tenantId: req.tenantId,
      callId,
      event: 'chat_request_infra_failure',
      tokens: null,
      status: ErrorCodes.INFRA_FAILURE,
      extra: { correlation_id: req.correlationId },
    });
  }
});

/**
 * POST /v1/chat/tool-result
 * A VPS devolve o resultado da execução do Harmonia (N8N) para um
 * function_call síncrono. A Lyra retoma a conversa incluindo o
 * resultado da tool no histórico e formula a resposta final.
 */
router.post('/chat/tool-result', async (req, res) => {
  const {
    conversation_id: conversationId,
    call_id: callId,
    result,
    tool_name: toolName,
    error: toolError,
    messages, // histórico completo até aqui, incluindo a function_call original — reenviado pela VPS
  } = req.body;

  if (!conversationId || !callId || (result === undefined && !toolError)) {
    return res.status(400).json({
      error: ErrorCodes.INVALID_PAYLOAD,
      message: 'conversation_id, call_id e (result ou error) são obrigatórios.',
      correlation_id: req.correlationId,
    });
  }

  if (toolError) {
    if (toolName) await circuitBreaker.recordFailure(req.tenantId, toolName);

    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(
      `event: token\ndata: ${JSON.stringify({
        text: 'Não consegui confirmar essa informação agora. Já estou te direcionando para um atendente.',
      })}\n\n`
    );
    res.write(`event: done\ndata: ${JSON.stringify({ finish_reason: 'tool_error' })}\n\n`);
    res.end();

    logCallMetadata({
      tenantId: req.tenantId,
      callId,
      event: 'tool_result_error',
      tokens: null,
      status: toolError,
      extra: { correlation_id: req.correlationId, tool: toolName },
    });
    return;
  }

  if (toolName) await circuitBreaker.recordSuccess(req.tenantId, toolName);

  if (!Array.isArray(messages)) {
    return res.status(400).json({
      error: ErrorCodes.INVALID_PAYLOAD,
      message: 'messages (histórico até aqui, incluindo a function_call) é obrigatório para formular a resposta final.',
      correlation_id: req.correlationId,
    });
  }

  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const emit = (eventName, data) => res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    // Anexa o resultado da tool como próxima mensagem do histórico
    // (formato simplificado — em produção, usar o content type
    // "function_response" nativo do Gemini em vez de texto simples).
    const messagesWithToolResult = [
      ...messages,
      { role: 'user', content: `[resultado da tool ${toolName}]: ${JSON.stringify(result)}` },
    ];

    const { finishReason, usage } = await geminiService.streamChat({
      messages: messagesWithToolResult,
      context: req.body.context,
      toolsAvailable: [],
      onEvent: emit,
    });

    res.end();

    logCallMetadata({
      tenantId: req.tenantId,
      callId,
      event: 'tool_result_completed',
      tokens: usage ? usage.totalTokens : null,
      status: finishReason,
      extra: { correlation_id: req.correlationId },
    });
  } catch (err) {
    logger.error({ event: 'gemini_tool_result_failed', tenant_id: req.tenantId, call_id: callId, message: err.message });
    emit('token', { text: 'Tive uma instabilidade ao concluir sua consulta. Te direcionando para um atendente.' });
    emit('done', { finish_reason: 'infra_failure' });
    res.end();
  }
});

/**
 * POST /v1/chat/async-update
 * Harmonia empurra a conclusão de uma ação assíncrona (nativa ou
 * convertida por timeout: status "timeout_converted" vs falha de
 * infra: "infra_failure"). Idempotente por call_id.
 */
router.post('/chat/async-update', async (req, res) => {
  const { call_id: callId, status } = req.body;

  if (!callId || !status) {
    return res.status(400).json({
      error: ErrorCodes.INVALID_PAYLOAD,
      message: 'call_id e status são obrigatórios.',
      correlation_id: req.correlationId,
    });
  }

  const { alreadyProcessed, markProcessed } = await idempotency.check(callId);

  if (alreadyProcessed) {
    logger.info({
      event: 'async_update_duplicate_discarded',
      tenant_id: req.tenantId,
      call_id: callId,
      correlation_id: req.correlationId,
    });
    return res.status(200).json({ status: 'already_processed' });
  }

  // TODO: efetivamente empurrar a atualização para o painel/Chatwoot
  // (via SSE/websocket já aberto, ou novo evento no Chatwoot).
  // Se status === 'infra_failure', não descontar da cota do tenant.
  // Se status === 'timeout_converted', descontar normalmente.

  await markProcessed();

  logCallMetadata({
    tenantId: req.tenantId,
    callId,
    event: 'async_update_processed',
    tokens: null,
    status,
    extra: { correlation_id: req.correlationId },
  });

  return res.status(200).json({ status: 'received' });
});

module.exports = router;
