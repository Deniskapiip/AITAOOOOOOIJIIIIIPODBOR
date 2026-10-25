import { Budget } from '../tools/budget.js';
import { ToolState, executeTool } from '../tools/executor.js';
import { TOOL_DEFINITIONS } from '../tools/definitions.js';
import { buildMessages } from './prompt.js';

export class AgentError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'AgentError';
    this.details = details || null;
  }
}

export function parseToolArguments(raw) {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'object') return raw;
  let text = String(raw).trim();
  if (!text) return {};
  text = text.replace(/^\u0060\u0060\u0060(?:json)?/i, '').replace(/\u0060\u0060\u0060$/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    /* try to extract a balanced object */
  }
  const start = text.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new AgentError('Не удалось разобрать аргументы инструмента как JSON');
}

const TOOLS_FOR_LLM = TOOL_DEFINITIONS.map((tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
}));

export async function runAgent({
  query,
  provider,
  settings,
  llm,
  config,
  logger,
  onEvent = () => {},
  signal = null,
}) {
  if (!query || !String(query).trim()) throw new AgentError('Пустой запрос клиента');
  if (!settings) throw new AgentError('Настройки не загружены');

  const startedAt = Date.now();
  const budget = new Budget(config.agent.maxToolCalls);
  const state = new ToolState({ provider, settings, budget, config, logger });
  const messages = buildMessages({ query, settings });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.agent.runTimeoutMs);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  let nudges = 0;
  let rejectedCalls = 0;
  let step = 0;

  try {
    for (step = 0; step < config.agent.maxSteps && !state.finished; step += 1) {
      if (controller.signal.aborted) throw new AgentError('Прогон прерван (таймаут или отмена)');
      onEvent({ type: 'llm_request', step: step + 1, used: budget.used, max: budget.max });
      const response = await llm.chat({ messages, tools: TOOLS_FOR_LLM, signal: controller.signal });

      if (response.vision === false && !state.visionUnavailable) {
        state.visionUnavailable = true;
        state.viewedItemIds.clear();
        messages.push({
          role: 'user',
          content:
            'Провайдер модели не принимает изображения. Фото не просмотрены: photo_check.verdict должен быть "не проверялось", выводов по фото не делай.',
        });
      }

      const calls = Array.isArray(response.toolCalls) ? response.toolCalls : [];
      if (!calls.length) {
        if (response.content) messages.push({ role: 'assistant', content: response.content });
        nudges += 1;
        if (nudges > 2) throw new AgentError('Модель не вызвала finish и отвечает текстом вместо инструментов');
        messages.push({
          role: 'user',
          content:
            'Ты не вызвал инструменты. Работай только вызовами инструментов, без текста для пользователя, и заверши ровно одним вызовом finish(result).',
        });
        continue;
      }

      nudges = 0;
      messages.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      });

      const pendingImages = [];
      for (let i = 0; i < calls.length; i += 1) {
        const call = calls[i];
        if (state.finished) {
          messages.push({ role: 'tool', tool_call_id: call.id, content: 'Пропущено: итог уже принят.' });
          continue;
        }
        const name = call.name;
        const allowed = budget.canCall(name);
        if (!allowed.ok) {
          budget.markLimit(allowed.reason);
          rejectedCalls += 1;
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content:
              'ОШИБКА: ' + allowed.reason + '. ' +
              (name === 'finish' ? 'Итог нельзя принять без finish.' : 'Не повторяй этот инструмент, переходи к finish с уже собранными данными.'),
          });
          if (rejectedCalls >= 6) throw new AgentError('Модель зациклилась на отклонённых вызовах', { rejectedCalls });
          continue;
        }

        let args;
        try {
          args = parseToolArguments(call.arguments);
        } catch (err) {
          budget.record(name);
          messages.push({ role: 'tool', tool_call_id: call.id, content: 'ОШИБКА: аргументы не являются валидным JSON. Вызови инструмент заново с корректным JSON.' });
          continue;
        }

        budget.record(name);
        onEvent({ type: 'tool', name, args, used: budget.used, max: budget.max });
        const result = await executeTool(name, args, state);
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.text || '' });
        if (Array.isArray(result.images) && result.images.length) pendingImages.push(...result.images);
      }

      if (state.finished) {
        onEvent({ type: 'finish', used: budget.used, result: state.result });
        break;
      }

      if (pendingImages.length) {
        const parts = [{ type: 'text', text: 'Фотографии из последнего вызова view_images. Оцени их как изображения.' }];
        for (const img of pendingImages) {
          if (img.caption) parts.push({ type: 'text', text: img.caption });
          parts.push({ type: 'image_url', image_url: { url: img.imageUrl } });
        }
        messages.push({ role: 'user', content: parts });
      }

      if (budget.remaining() <= 1) {
        messages.push({
          role: 'user',
          content: 'Лимит вызовов почти исчерпан. Прямо сейчас вызови finish с итогом по уже собранным данным. Другие инструменты недоступны.',
        });
      }
    }

    if (!state.finished) {
      throw new AgentError(
        budget.remaining() <= 1
          ? 'Лимит вызовов исчерпан без валидного finish'
          : 'Модель не завершила прогон вызовом finish за ' + step + ' шагов',
        { step, used: budget.used },
      );
    }

    return {
      result: state.result,
      state,
      messages,
      usage: llm.totalUsage || null,
      calls: budget.used,
      budget,
      finishWarnings: state.finishWarnings,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
