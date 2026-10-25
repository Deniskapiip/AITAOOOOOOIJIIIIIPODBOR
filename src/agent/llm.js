export class LlmError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.body = body;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasImages(messages) {
  return messages.some((m) => Array.isArray(m.content) && m.content.some((part) => part.type === 'image_url'));
}

function stripImages(messages) {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    const parts = message.content.map((part) => {
      if (part.type === 'text') return part.text;
      return '[изображение недоступно: провайдер модели не поддерживает картинки]';
    });
    return { ...message, content: parts.join('\n') };
  });
}

function normalizeMessage(message) {
  const content = message && message.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('\n')
      : '';
  const toolCalls = Array.isArray(message && message.tool_calls)
    ? message.tool_calls.map((call, index) => ({
        id: call.id || 'call_' + Date.now() + '_' + index,
        name: call.function ? call.function.name : call.name,
        arguments: call.function ? call.function.arguments || '{}' : call.arguments || '{}',
      }))
    : [];
  return { content: text, toolCalls };
}

export class LlmClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.visionSupported = true;
    this.requests = 0;
    this.totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  }

  async request(messages, tools, signal, temperature) {
    const controllerSignal = AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]) : signal;
    const body = {
      model: this.config.model,
      messages,
      temperature: temperature === undefined ? this.config.temperature : temperature,
      max_tokens: this.config.maxTokens,
      stream: false,
    };
    if (Array.isArray(tools) && tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    const res = await fetch(this.config.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + this.config.apiKey,
      },
      body: JSON.stringify(body),
      signal: controllerSignal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new LlmError('LLM HTTP ' + res.status, res.status, text.slice(0, 4000));
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmError('LLM вернул не JSON', res.status, text.slice(0, 2000));
    }
    if (json.error) {
      throw new LlmError('LLM error: ' + (json.error.message || JSON.stringify(json.error)), res.status, text.slice(0, 2000));
    }
    const choice = (json.choices && json.choices[0]) || {};
    const message = normalizeMessage(choice.message || {});
    if (json.usage) {
      this.totalUsage.prompt_tokens += json.usage.prompt_tokens || 0;
      this.totalUsage.completion_tokens += json.usage.completion_tokens || 0;
      this.totalUsage.total_tokens += json.usage.total_tokens || 0;
    }
    return {
      content: message.content,
      toolCalls: message.toolCalls,
      finishReason: choice.finish_reason || null,
      usage: json.usage || null,
      vision: this.visionSupported,
    };
  }

  async chat({ messages, tools, signal, temperature }) {
    let prepared = messages;
    let retries = 0;
    for (;;) {
      this.requests += 1;
      try {
        return await this.request(prepared, tools, signal, temperature);
      } catch (err) {
        if (err && err.name === 'AbortError') throw new LlmError('LLM запрос прерван по таймауту', 0, '');
        const status = err.status || 0;
        const body = String(err.body || err.message || '');
        if (status === 400 && this.visionSupported && hasImages(prepared) && /image|vision|content|unsupported/i.test(body)) {
          this.visionSupported = false;
          prepared = stripImages(prepared);
          if (this.logger) this.logger.warn('LLM не принимает изображения, переключаюсь на текстовый режим');
          continue;
        }
        const retryable = status === 429 || status >= 500 || status === 0;
        if (retryable && retries < 2) {
          retries += 1;
          const delay = 800 * retries + Math.floor(Math.random() * 300);
          if (this.logger) this.logger.warn('LLM ошибка, повтор', { status, retry: retries, delay });
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }
  }
}
