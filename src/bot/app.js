import { runAgent } from '../agent/engine.js';
import { createProvider } from '../goofish/index.js';
import { saveRun, newRunId } from '../store/runs.js';
import { buildButtons, buildResultPlan, escapeHtml, formatCny, formatRub, progressText } from './format.js';
import { runSearchOnly } from '../agent/searchOnly.js';
import { SettingsError } from '../store/settings.js';
import { formatRetryAfter } from '../goofish/errors.js';

class Semaphore {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.active += 1;
  }

  release() {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

export class BotApp {
  constructor({ config, logger, telegram, settings, llm, provider }) {
    this.config = config;
    this.logger = logger;
    this.telegram = telegram;
    this.settings = settings;
    this.llm = llm;
    this.provider = provider;
    this.semaphore = new Semaphore(config.bot.maxConcurrentRuns);
    this.chatQueues = new Map();
    this.lastRuns = new Map();
    this.adminNotices = new Map();
    this.running = false;
  }

  isAdmin(userId) {
    return this.config.telegram.adminIds.includes(Number(userId));
  }

  async start() {
    this.running = true;
    try {
      const pending = await this.telegram.getUpdates(0);
      for (const update of pending) {
        this.telegram.offset = Math.max(this.telegram.offset, update.update_id + 1);
      }
      if (pending.length) this.logger.info('bot: пропущено старых апдейтов', { count: pending.length });
    } catch (err) {
      this.logger.warn('bot: не удалось прочитать стартовые апдейты', { error: err.message });
    }
    this.logger.info('bot: запущен long polling');
    while (this.running) {
      try {
        const updates = await this.telegram.getUpdates(30);
        for (const update of updates) {
          this.telegram.offset = Math.max(this.telegram.offset, update.update_id + 1);
          this.dispatch(update).catch((err) => {
            this.logger.error('bot: ошибка обработки апдейта', { error: err.message });
          });
        }
      } catch (err) {
        if (!this.running) break;
        this.logger.error('bot: getUpdates failed', { error: err.message });
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  stop() {
    this.running = false;
  }

  async dispatch(update) {
    if (update.message) return this.handleMessage(update.message);
    if (update.callback_query) return this.handleCallback(update.callback_query);
  }

  enqueue(chatId, task) {
    const previous = this.chatQueues.get(chatId) || Promise.resolve();
    const next = previous.then(task).catch((err) => {
      this.logger.error('bot: задача упала', { chatId, error: err.message });
    });
    this.chatQueues.set(chatId, next);
    next.finally(() => {
      if (this.chatQueues.get(chatId) === next) this.chatQueues.delete(chatId);
    });
    return next;
  }

  async handleMessage(message) {
    const chatId = message.chat.id;
    const userId = message.from ? message.from.id : null;
    const text = String(message.text || '').trim();
    if (!text) return;
    this.logger.info('bot: входящее', { chatId, userId, kind: text.startsWith('/') ? text.split(/\s+/)[0] : 'query' });

    if (text.startsWith('/start') || text.startsWith('/help')) {
      const modeLine =
        this.config.goofish.provider === 'mock'
          ? 'Режим: демо-данные (GOOFISH_PROVIDER=mock). Реальный Goofish требует GOOFISH_COOKIE и прокси.'
          : 'Режим: реальный Goofish (GOOFISH_PROVIDER=http).';
      await this.telegram.sendMessage(
        chatId,
        [
          '<b>Подбор техники на Goofish</b>',
          '',
          'Отправь запрос одной строкой: модель, память, бюджет, регион, состояние.',
          'Например: «Xiaomi 15 Ultra 16/512, до 55 000 ₽, только 国行, без ремонтов».',
          '',
          escapeHtml(modeLine),
          '',
          'Команды:',
          '/settings — курс и комиссия',
          '/json — JSON последнего прогона',
          '/id — твой Telegram ID',
          '',
          'Админ: /rate 12.4 · /commission 6.5 650',
          'Админ: /accounts · /cookie · /verify_help',
        ].join('\n'),
        { parse_mode: 'HTML' },
      );
      return;
    }

    if (text.startsWith('/id')) {
      await this.telegram.sendMessage(chatId, 'Твой Telegram ID: <code>' + escapeHtml(userId) + '</code>', { parse_mode: 'HTML' });
      return;
    }

    if (text.startsWith('/accounts')) {
      if (!this.isAdmin(userId)) {
        await this.telegram.sendMessage(chatId, 'Только администратор видит аккаунты.');
        return;
      }
      if (!this.provider || !this.provider.health) {
        await this.telegram.sendMessage(chatId, 'Провайдер не поддерживает health.');
        return;
      }
      const health = this.provider.health();
      const lines = ['<b>Goofish аккаунты</b>'];
      for (const account of health.accounts || []) {
        const until = account.item_cooldown_until
          ? ' · карточки до ' + new Date(account.item_cooldown_until).toLocaleString('ru-RU')
          : '';
        lines.push(
          '• <code>' + escapeHtml(account.id) + '</code> — <b>' + escapeHtml(account.status) + '</b>' +
          ' · вызовов ' + account.calls_today + '/' + account.daily_limit +
          ' · риск ' + account.risk_count + until,
        );
        if (account.last_error) lines.push('  <i>' + escapeHtml(String(account.last_error).slice(0, 160)) + '</i>');
      }
      lines.push('');
      lines.push('Карточки: ' + (health.item_available ? 'доступны' : 'недоступны') + '. Поиск: ' + (health.search_available ? 'доступен' : 'недоступен') + '.');
      if (!health.item_available && health.next_item_at) {
        lines.push('Ближайшая попытка карточек: через ' + formatRetryAfter(Math.max(0, health.next_item_at - Date.now())) + '.');
      }
      await this.telegram.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' });
      return;
    }

    if (text.startsWith('/cookie')) {
      if (!this.isAdmin(userId)) {
        await this.telegram.sendMessage(chatId, 'Только администратор может менять cookie.');
        return;
      }
      const cookie = text.slice('/cookie'.length).trim();
      if (!cookie) {
        await this.telegram.sendMessage(
          chatId,
          'Пришли: <code>/cookie &lt;полный cookie&gt;</code>\nЗначение не будет выведено в чат. После обновления проверь /accounts.',
          { parse_mode: 'HTML' },
        );
        return;
      }
      if (cookie.length < 80) {
        await this.telegram.sendMessage(chatId, 'Cookie слишком короткий. Нужен полный cookie из залогиненного goofish.com.');
        return;
      }
      if (!this.provider || !this.provider.accounts || !this.provider.accounts.setCookie) {
        await this.telegram.sendMessage(chatId, 'Провайдер не поддерживает обновление cookie.');
        return;
      }
      try {
        const account = this.provider.accounts.setCookie(cookie, 'telegram:' + userId);
        await this.telegram.sendMessage(
          chatId,
          'Cookie сохранён для <code>' + escapeHtml(account.id) + '</code>. Статус: <b>' + escapeHtml(account.status) + '</b>. Проверь /accounts.',
          { parse_mode: 'HTML' },
        );
        if (this.telegram.deleteMessage) {
          await this.telegram.deleteMessage(chatId, message.message_id).catch(() => {});
        }
      } catch (err) {
        await this.telegram.sendMessage(chatId, 'Ошибка cookie: ' + escapeHtml(err.message));
      }
      return;
    }

    if (text.startsWith('/verify_help')) {
      await this.telegram.sendMessage(
        chatId,
        [
          '<b>Если Goofish просит проверку</b>',
          '1. Открой goofish.com в обычном браузере под этим аккаунтом.',
          '2. Пройди капчу/слайдер вручную, открой любой лот.',
          '3. Обнови cookie: /cookie &lt;полный cookie&gt;.',
          '4. Проверь /accounts — статус должен стать ok.',
          '',
          'Не решай капчу автоматически и не долби API: это продлевает блок.',
        ].join('\n'),
        { parse_mode: 'HTML' },
      );
      return;
    }

    if (text.startsWith('/settings')) {
      const s = this.settings.get();
      await this.telegram.sendMessage(
        chatId,
        '<b>Настройки</b>\nКурс: ' + (s.rate_cny_rub === null ? 'не задан' : s.rate_cny_rub + ' ₽/¥') +
          '\nКомиссия: ' + s.commission_percent + '% (мин. ' + s.commission_min_rub + ' ₽)' +
          '\nОбновлено: ' + (s.updated_at || '—') + (s.updated_by ? ' (' + s.updated_by + ')' : ''),
        { parse_mode: 'HTML' },
      );
      return;
    }

    if (text.startsWith('/rate')) {
      if (!this.isAdmin(userId)) {
        await this.telegram.sendMessage(chatId, 'Только администратор может менять курс.');
        return;
      }
      const value = Number(text.split(/\s+/)[1]);
      try {
        const updated = this.settings.setRate(value, 'telegram:' + userId);
        await this.telegram.sendMessage(chatId, 'Курс установлен: ' + updated.rate_cny_rub + ' ₽/¥');
      } catch (err) {
        await this.telegram.sendMessage(chatId, 'Ошибка: ' + (err instanceof SettingsError ? err.message : err.message));
      }
      return;
    }

    if (text.startsWith('/commission')) {
      if (!this.isAdmin(userId)) {
        await this.telegram.sendMessage(chatId, 'Только администратор может менять комиссию.');
        return;
      }
      const parts = text.split(/\s+/);
      const percent = parts[1] === undefined ? undefined : Number(parts[1]);
      const minRub = parts[2] === undefined ? undefined : Number(parts[2]);
      try {
        const updated = this.settings.setCommission(percent, minRub, 'telegram:' + userId);
        await this.telegram.sendMessage(chatId, 'Комиссия: ' + updated.commission_percent + '% (мин. ' + updated.commission_min_rub + ' ₽)');
      } catch (err) {
        await this.telegram.sendMessage(chatId, 'Ошибка: ' + (err instanceof SettingsError ? err.message : err.message));
      }
      return;
    }

    if (text.startsWith('/json')) {
      const last = this.lastRuns.get(chatId);
      if (!last) {
        await this.telegram.sendMessage(chatId, 'Пока нет прогонов в этом чате.');
        return;
      }
      await this.sendJson(chatId, last);
      return;
    }

    if (text.startsWith('/')) {
      await this.telegram.sendMessage(chatId, 'Не знаю такую команду. Отправь запрос текстом или /help.');
      return;
    }

    const allowed = this.config.telegram.allowedIds;
    if (allowed.length && !this.isAdmin(userId) && !allowed.includes(Number(userId))) {
      await this.telegram.sendMessage(chatId, 'Доступ к подбору ограничен. Попроси администратора добавить твой ID.');
      return;
    }

    this.enqueue(chatId, () => this.runQuery(chatId, userId, text));
  }

  async runQuery(chatId, userId, query) {
    const runId = newRunId();
    const log = this.logger.child({ runId, chatId });
    let placeholder = null;
    try {
      placeholder = await this.telegram.sendMessage(chatId, '⏳ Принял запрос, начинаю подбор…');
    } catch (err) {
      log.warn('bot: не удалось отправить статус', { error: err.message });
    }
    const placeholderId = placeholder && placeholder.message_id;
    let lastEdit = 0;
    let lastText = '';

    const onEvent = (event) => {
      const text = progressText(event);
      if (!text || !placeholderId) return;
      const now = Date.now();
      if (event.type === 'tool' && now - lastEdit < 2500) return;
      if (text === lastText) return;
      if (event.type !== 'tool' && now - lastEdit < 8000) return;
      lastEdit = now;
      lastText = text;
      this.telegram
        .editMessageText(chatId, placeholderId, escapeHtml(text) + '\n<i>Goofish · подбор</i>', { parse_mode: 'HTML' })
        .catch(() => {});
    };

    await this.semaphore.acquire();
    let outcome = null;
    let searchOnly = null;
    let error = null;
    const settings = this.settings.get();

    const persistSearchOnly = (payload) => {
      const saved = saveRun(
        this.config.dataDir,
        {
          id: runId,
          chat_id: chatId,
          user_id: userId,
          query,
          provider: this.config.goofish.provider,
          mode: 'search_only',
          settings,
          result: payload,
          duration_ms: payload.duration_ms || null,
        },
        log,
      );
      this.lastRuns.set(chatId, { result: payload, file: saved ? saved.file : null, runId });
      return saved;
    };

    try {
      log.info('run: старт', { query, provider: this.config.goofish.provider });
      const health = this.provider.health ? this.provider.health() : null;
      const itemAvailable = !health || health.item_available !== false;
      if (this.config.goofish.searchOnlyFallback && !itemAvailable) {
        log.info('run: карточки недоступны, включаю search-only');
        searchOnly = await runSearchOnly({
          query,
          provider: this.provider,
          llm: this.llm,
          settings,
          logger: log,
          reason: 'карточки Goofish в cooldown после RGV587',
        });
        persistSearchOnly(searchOnly);
        void this.notifyAdmins('Goofish: карточки в cooldown, прогон ' + runId + ' ушёл в search-only. Причина: ' + (searchOnly.reason || 'RGV587'), 'search-only', 30 * 60 * 1000, chatId);
      } else {
        outcome = await runAgent({
          query,
          provider: this.provider,
          settings,
          llm: this.llm,
          config: this.config,
          logger: log,
          onEvent,
        });
        const saved = saveRun(
          this.config.dataDir,
          {
            id: runId,
            chat_id: chatId,
            user_id: userId,
            query,
            provider: this.config.goofish.provider,
            settings,
            result: outcome.result,
            calls: outcome.calls,
            usage: outcome.usage,
            warnings: outcome.finishWarnings,
            duration_ms: outcome.durationMs,
          },
          log,
        );
        this.lastRuns.set(chatId, { result: outcome.result, file: saved ? saved.file : null, runId });
        log.info('run: готово', { calls: outcome.calls, durationMs: outcome.durationMs, top: outcome.result.top.length });
      }
    } catch (err) {
      const health = this.provider.health ? this.provider.health() : null;
      const canSearch = !health || health.search_available !== false;
      const canFallback = this.config.goofish.searchOnlyFallback && canSearch &&
        ((health && health.item_available === false) || err.code === 'risk_control' || err.kind === 'NO_ACCOUNT' || (err.details && err.details.riskControlHits));
      if (canFallback) {
        try {
          log.warn('run: fallback в search-only', { error: err.message });
          searchOnly = await runSearchOnly({
            query,
            provider: this.provider,
            llm: this.llm,
            settings,
            logger: log,
            reason: err.message,
          });
          persistSearchOnly(searchOnly);
          void this.notifyAdmins('Goofish: карточки в cooldown, прогон ' + runId + ' ушёл в search-only. Причина: ' + (searchOnly.reason || err.message), 'search-only', 30 * 60 * 1000, chatId);
          error = null;
        } catch (fallbackErr) {
          error = fallbackErr;
          log.error('run: search-only тоже упал', { error: fallbackErr.message });
        }
      } else {
        error = err;
      }
      if (error) {
        log.error('run: ошибка', { error: error.message });
        saveRun(
          this.config.dataDir,
          {
            id: runId,
            chat_id: chatId,
            user_id: userId,
            query,
            provider: this.config.goofish.provider,
            error: error.message,
            details: error.details || null,
          },
          log,
        );
      }
    } finally {
      this.semaphore.release();
    }

    if (!searchOnly && !error && outcome && outcome.result && Array.isArray(outcome.result.top) && outcome.result.top.length === 0) {
      const health = this.provider.health ? this.provider.health() : null;
      if (this.config.goofish.searchOnlyFallback && health && health.item_available === false && health.search_available !== false) {
        try {
          log.info('run: пустой top при недоступных карточках, search-only');
          searchOnly = await runSearchOnly({
            query,
            provider: this.provider,
            llm: this.llm,
            settings,
            logger: log,
            reason: 'карточки Goofish в cooldown после RGV587',
          });
          persistSearchOnly(searchOnly);
          void this.notifyAdmins('Goofish: карточки в cooldown, прогон ' + runId + ' ушёл в search-only. Причина: ' + (searchOnly.reason || 'RGV587'), 'search-only', 30 * 60 * 1000, chatId);
        } catch (fallbackErr) {
          log.error('run: search-only после пустого top упал', { error: fallbackErr.message });
        }
      }
    }

    if (placeholderId) {
      const status = searchOnly ? '✅ Поиск завершён' : error ? '❌ Подбор не завершён' : '✅ Подбор завершён';
      await this.telegram.editMessageText(chatId, placeholderId, status).catch(() => {});
    }

    if (searchOnly) {
      await this.sendSearchOnly(chatId, searchOnly, runId);
      return;
    }

    if (error) {
      await this.telegram.sendMessage(
        chatId,
        '❌ ' + escapeHtml(error.message || 'Неизвестная ошибка') + '\nID прогона: <code>' + escapeHtml(runId) + '</code>',
        { parse_mode: 'HTML' },
      );
      return;
    }

    const photosByItem = {};
    for (const lot of outcome.result.top) {
      const item = outcome.state.items.get(String(lot.item_id));
      photosByItem[lot.item_id] = item && Array.isArray(item.image_urls) ? item.image_urls : [];
      if (item) {
        lot.seller_nick = item.seller_nick || (lot.seller && lot.seller.nickname) || '';
        lot.seller_credit = item.seller_credit || '';
      }
    }
    const plan = buildResultPlan(
      outcome.result,
      {
        rate: settings.rate_cny_rub,
        commissionPercent: settings.commission_percent,
        commissionMin: settings.commission_min_rub,
        durationMs: outcome.durationMs,
        warnings: outcome.finishWarnings,
        provider: this.config.goofish.provider,
        photoMode: this.config.vision.enabled ? 'vision' : this.config.images.mode,
        runId,
        maxPhotos: this.config.bot.sendPhotos,
      },
      photosByItem,
    );

    try {
      await this.telegram.sendMessage(chatId, plan.header, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (err) {
      log.warn('bot: не удалось отправить заголовок', { error: err.message });
    }

    for (const entry of plan.lots) {
      try {
        await this.telegram.sendMessage(chatId, entry.text, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: entry.buttons,
        });
      } catch (err) {
        log.warn('bot: не удалось отправить карточку', { itemId: entry.lot.item_id, error: err.message });
      }
      try {
        if (entry.photos.length >= 2) {
          await this.telegram.sendMediaGroup(chatId, entry.photos.map((url) => ({ type: 'photo', media: url })));
        } else if (entry.photos.length === 1) {
          await this.telegram.sendPhoto(chatId, entry.photos[0]);
        }
      } catch (err) {
        log.warn('bot: группа фото не ушла, пробую по одной', { itemId: entry.lot.item_id, error: err.message });
        for (const url of entry.photos) {
          try {
            await this.telegram.sendPhoto(chatId, url);
          } catch (photoErr) {
            log.warn('bot: фото не отправилось', { itemId: entry.lot.item_id, error: photoErr.message });
            break;
          }
        }
      }
    }

    try {
      await this.telegram.sendMessage(chatId, plan.footer, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(plan.footerButtons ? { reply_markup: plan.footerButtons } : {}),
      });
    } catch (err) {
      log.warn('bot: не удалось отправить футер', { error: err.message });
    }
  }

  async sendSearchOnly(chatId, result, runId) {
    const items = (Array.isArray(result.items) ? result.items : []).slice(0, this.config.bot.searchOnlyMax);
    const header = items.length
      ? '<b>Ограниченный режим · НЕ ПРОВЕРЕНО</b>\n' +
        'Карточки Goofish сейчас недоступны (RGV587/cooldown). Это не подбор: только заголовок и цена из поиска, без фото-анализа, продавца, отзывов и рынка.'
      : '<b>Ограниченный режим · НЕ ПРОВЕРЕНО</b>\nПодходящих лотов в поиске не нашлось.';
    await this.telegram.sendMessage(chatId, header, { parse_mode: 'HTML', disable_web_page_preview: true });

    for (const item of items) {
      const price = formatCny(item.price_cny);
      const rub = formatRub(item.final_price_rub);
      const lines = [
        '<b>' + escapeHtml(item.rank + '. ' + item.title) + '</b>',
        '',
        '<b>' + (price === null ? '—' : price + ' ¥') + (rub === null ? '' : ' · ' + rub + ' ₽') + '</b>',
        '🟡 кандидат · уверенность низкая',
      ];
      if (item.seller_nick || item.location) {
        lines.push('👤 ' + escapeHtml([item.seller_nick, item.location].filter(Boolean).join(' · ')));
      }
      if (Array.isArray(item.risks) && item.risks.length) {
        lines.push('⚠️ ' + escapeHtml(item.risks.slice(0, 2).join('; ')));
      }
      lines.push('🔗 <a href="' + escapeHtml(item.url) + '">Открыть на сайте</a>');
      try {
        await this.telegram.sendMessage(chatId, lines.join('\n'), {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: buildButtons(item),
        });
      } catch (err) {
        this.logger.warn('bot: не удалось отправить search-only карточку', { itemId: item.item_id, error: err.message });
      }
      if (item.image_url) {
        try {
          await this.telegram.sendPhoto(chatId, item.image_url);
        } catch {
          /* фото не критично */
        }
      }
    }

    const footer = [
      escapeHtml(result.disclaimer || 'Это только поиск, не проверка карточки.'),
      'Найдено в поиске: ' + (result.total_found || 0) + ' · показано: ' + items.length + ' · ключ: ' + escapeHtml(result.keyword || '—'),
      'Это не карточка: фото, продавец, отзывы, рынок и статус продажи не проверялись.',
    ];
    try {
      await this.telegram.sendMessage(chatId, footer.join('\n'), {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: '📄 JSON прогона', callback_data: 'json:' + runId }]] },
      });
    } catch (err) {
      this.logger.warn('bot: не удалось отправить search-only футер', { error: err.message });
    }
  }

  async notifyAdmins(text, key = 'risk', ttlMs = 30 * 60 * 1000, skipChatId = null) {
    const now = Date.now();
    const last = this.adminNotices.get(key) || 0;
    if (now - last < ttlMs) return;
    this.adminNotices.set(key, now);
    for (const adminId of this.config.telegram.adminIds) {
      if (skipChatId !== null && Number(adminId) === Number(skipChatId)) continue;
      try {
        await this.telegram.sendMessage(adminId, escapeHtml(text));
      } catch (err) {
        this.logger.debug('bot: admin notify failed', { adminId, error: err.message });
      }
    }
  }

  async sendJson(chatId, last) {
    const json = JSON.stringify(last.result, null, 2);
    try {
      await this.telegram.sendDocument(chatId, 'goofish-' + last.runId + '.json', json, 'JSON прогона ' + last.runId);
    } catch {
      const truncated = json.length > 3800 ? json.slice(0, 3800) + '\n… (обрезано)' : json;
      await this.telegram.sendMessage(chatId, '<pre>' + escapeHtml(truncated) + '</pre>', { parse_mode: 'HTML' });
    }
  }

  async handleCallback(query) {
    const data = String(query.data || '');
    const chatId = query.message ? query.message.chat.id : null;
    if (!chatId) return;
    if (data.startsWith('json:')) {
      const runId = data.slice(5);
      const last = this.lastRuns.get(chatId);
      await this.telegram.answerCallbackQuery(query.id, 'Отправляю JSON');
      if (last && last.runId === runId) await this.sendJson(chatId, last);
      else await this.telegram.sendMessage(chatId, 'Этот прогон уже недоступен в памяти, файл лежит в data/runs.');
    }
  }
}
