export class TelegramError extends Error {
  constructor(message, code, method) {
    super(message);
    this.name = 'TelegramError';
    this.code = code;
    this.method = method;
  }
}

export class TelegramClient {
  constructor(token, logger) {
    this.token = token;
    this.logger = logger;
    this.base = 'https://api.telegram.org/bot' + token;
    this.offset = 0;
  }

  async call(method, payload = {}, timeoutMs = 40000) {
    const res = await fetch(this.base + '/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let json;
    try {
      json = await res.json();
    } catch {
      throw new TelegramError('Telegram вернул не JSON (HTTP ' + res.status + ')', res.status, method);
    }
    if (!json.ok) {
      throw new TelegramError(json.description || 'Telegram API error', json.error_code || res.status, method);
    }
    return json.result;
  }

  async getUpdates(timeoutSeconds = 30) {
    return this.call(
      'getUpdates',
      { offset: this.offset, timeout: timeoutSeconds, allowed_updates: ['message', 'callback_query'] },
      (timeoutSeconds + 15) * 1000,
    );
  }

  async sendMessage(chatId, text, extra = {}) {
    return this.call('sendMessage', { chat_id: chatId, text: text.slice(0, 4096), ...extra });
  }

  async editMessageText(chatId, messageId, text, extra = {}) {
    try {
      return await this.call('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: text.slice(0, 4096),
        ...extra,
      });
    } catch (err) {
      if (this.logger) this.logger.debug('telegram: не удалось отредактировать сообщение', { error: err.message });
      return null;
    }
  }

  async answerCallbackQuery(id, text) {
    try {
      return await this.call('answerCallbackQuery', { callback_query_id: id, text });
    } catch (err) {
      if (this.logger) this.logger.debug('telegram: answerCallbackQuery failed', { error: err.message });
      return null;
    }
  }

  async sendDocument(chatId, filename, content, caption = '') {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption.slice(0, 1024));
    form.append('document', new Blob([content], { type: 'application/json' }), filename);
    const res = await fetch(this.base + '/sendDocument', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json().catch(() => null);
    if (!json || !json.ok) {
      throw new TelegramError((json && json.description) || 'sendDocument failed', (json && json.error_code) || res.status, 'sendDocument');
    }
    return json.result;
  }
}
