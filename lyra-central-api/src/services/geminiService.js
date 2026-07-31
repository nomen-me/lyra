'use strict';

const { GoogleGenAI } = require('@google/genai');
const env = require('../config/env');
const { buildToolsConfig } = require('../config/tools');
const { buildSystemInstruction } = require('../config/systemPrompt');
const { logger } = require('../utils/logger');

const ai = new GoogleGenAI({ apiKey: env.gemini.apiKey });

/**
 * Converte o histórico de mensagens do contrato (`role: "user" | "assistant"`)
 * para o formato de `contents` esperado pelo Gemini (`role: "user" | "model"`).
 *
 * IMPORTANTE: nunca logar o conteúdo dessas mensagens (regra de zero
 * log — ver src/utils/logger.js). Esta função só transforma, não loga.
 */
function toGeminiContents(messages) {
  return messages.map((msg) => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }],
  }));
}

/**
 * Chama o Gemini em modo streaming e emite eventos via callback,
 * no formato que src/routes/chat.js já espera repassar como SSE.
 *
 * onEvent(eventName, data) é chamado para cada:
 *   - 'token'         → { text }              (chunk de texto)
 *   - 'function_call'  → { name, arguments }    (a Lyra decidiu chamar uma tool)
 *   - 'done'           → { finish_reason, usage } (fim do stream)
 *
 * Retorna { finishReason, usage, functionCalls } ao final, pra quem
 * chamou decidir o que fazer em seguida (ex: logCallMetadata).
 */
async function streamChat({ messages, context = {}, toolsAvailable = [], onEvent }) {
  const contents = toGeminiContents(messages);
  const tools = buildToolsConfig(toolsAvailable);
  const systemInstruction = buildSystemInstruction({ storeRules: context.store_rules });

  const config = { systemInstruction };
  if (tools) config.tools = tools;

  let accumulatedFunctionCalls = [];
  let finishReason = 'stop';
  let usage = null;

  try {
    const stream = await ai.models.generateContentStream({
      model: env.gemini.model,
      contents,
      config,
    });

    for await (const chunk of stream) {
      // Texto incremental — repassa direto como evento SSE.
      if (chunk.text) {
        onEvent('token', { text: chunk.text });
      }

      // Function calls: o SDK expõe isso agregado por chunk quando o
      // modelo decide chamar uma tool. Em geral chega no(s) chunk(s)
      // finais, não incrementalmente como o texto.
      if (chunk.functionCalls && chunk.functionCalls.length > 0) {
        for (const call of chunk.functionCalls) {
          accumulatedFunctionCalls.push(call);
          onEvent('function_call', { name: call.name, arguments: call.args || {} });
        }
      }

      if (chunk.usageMetadata) {
        usage = {
          promptTokens: chunk.usageMetadata.promptTokenCount,
          completionTokens: chunk.usageMetadata.candidatesTokenCount,
          totalTokens: chunk.usageMetadata.totalTokenCount,
        };
      }

      if (chunk.candidates && chunk.candidates[0] && chunk.candidates[0].finishReason) {
        finishReason = accumulatedFunctionCalls.length > 0 ? 'tool_calls' : 'stop';
      }
    }

    onEvent('done', { finish_reason: finishReason, usage });

    return { finishReason, usage, functionCalls: accumulatedFunctionCalls };
  } catch (err) {
    // Erro do Gemini (5xx, rate limit do provedor, etc.) — quem
    // chamou decide se isso vira `infra_failure` (não conta cota) e
    // aciona o circuit breaker/transbordo humano. Este service não
    // toma essa decisão de negócio, só propaga o erro original.
    logger.error({ event: 'gemini_stream_error', message: err.message });
    throw err;
  }
}

module.exports = { streamChat, toGeminiContents };
