# Taoji Cargo · Архитектура

Статус: Phase 0, срез текущего состояния до Mini App.

## 1. Что делает продукт

Telegram-бот и (в планах) Mini App для подбора б/у техники на Goofish.
Агент ищет лоты, проверяет карточки, продавцов, отзывы и фото, считает цену
в юанях и рублях и отдаёт менеджеру до трёх вариантов. Покупок и переписки
с продавцами нет.

## 2. Карта модулей

| Слой | Файлы | Ответственность |
|---|---|---|
| Промт | prompts/system.md | системный промт агента, разделы 0-14 |
| Контекст запроса | src/agent/prompt.js | sanitize, task_context, system+user |
| Цикл агента | src/agent/engine.js | LLM, tool calls, лимиты, finish, nudge |
| LLM | src/agent/llm.js | OpenAI-совместимый клиент, ретраи |
| Валидация итога | src/agent/validate.js | контракт finish, пересчёт фактов |
| Vision | src/agent/vision.js | фото по одному, PNG через sharp, вердикт |
| Инструменты | src/tools/definitions.js, executor.js | схемы и исполнение 7 инструментов |
| Лимиты | src/tools/budget.js | 45 вызовов, лимиты этапов |
| Деньги | src/tools/pricing.js | calc_price |
| Goofish HTTP | src/goofish/http.js | mtop, cookie, IPv4, throttle, ошибки |
| Нормализация | src/goofish/normalize.js | сырые ответы -> схемы инструментов |
| Mock | src/goofish/mock.js, fixtures | демо-данные |
| Настройки | src/store/settings.js | курс, комиссия, админ |
| Логи прогонов | src/store/runs.js | data/runs/*.json |
| Telegram | src/bot/telegram.js, app.js, format.js | polling, очередь, карточки, фото |
| CLI | src/cli.js, admin.js, probe.js, doctor.js | локальные операции |
| Конфиг | src/config.js, .env | env, dotenv, IPv4 |

## 3. Поток данных

    Telegram / CLI
        -> BotApp.runQuery (или src/cli.js)
        -> runAgent (engine)
            -> buildMessages: system prompt + task_context
            -> LLM (DeepSeek)
            -> tool call -> executeTool -> provider (http/mock)
                 -> normalize -> текст результата модели
            -> finish -> validateFinish -> нормализованный result
        -> saveRun (data/runs)
        -> BotApp: HTML-карточки, фото, кнопки
        -> Telegram (IP-транспорт при блокировке DNS)

CLI печатает карточки в stdout, JSON — с флагом --json.

## 4. Состояние прогона

- Budget: общий лимит 45 и лимиты этапов; finish резервируется.
- ToolState: карточки items, продавцы, отзывы, кэш, seen ids,
  viewedItemIds, priceResults, visionByItem, riskControlHits.
- Сообщения: system + user(task_context), затем assistant/tool пары;
  фото для основной модели не передаются, если включён отдельный vision.

## 5. Контракт денег

    base = ceil(price_cny * rate)
    commission = ceil(max(base * commission_percent / 100, commission_min_rub))
    final = base + commission

Курс и комиссия только из SettingsStore (data/settings.json, env bootstrap).
calc_price — единственный источник. Без курса: rate_unavailable,
все рублёвые поля null. Бюджет в рублях переводится в юани вниз.

## 6. Контракт finish

validateFinish проверяет:

- top <= 3, статус лота active, карточка была запрошена;
- price_cny равен карточке, url строится из item_id;
- цена не выше 105% бюджета, budget_status пересчитан;
- «брать» требует score >= 80, пустых red_flags, фото «ок»,
  бюджета «в рамках», доставки не «только местно»;
- score пересчитывается по score_breakdown;
- seller подтягивается из профиля, delivery и has_video из карточки;
- why_good, card без цен, question_for_seller, unknown;
- stats.tool_calls и checked_deeply считает harness;
- стоп-факторы экрана: 透图, 老化, 烧屏, 绿线, 漏液, 屏幕破损, 外壳破碎;
- результат vision перебивает photo_check.

При ошибке finish возвращает список проблем, модель исправляет
(до трёх попыток, каждая считается в лимит).

## 7. Goofish

Поиск, карточка, профиль и отзывы — разные методы mtop с appKey
12574478/34839810. Запрос подписывается md5(token&t&appKey&data),
token — первая часть cookie _m_h5_tk. Cookie живёт в .env.

Особенности:

- принудительный IPv4: AAAA-запись есть, но IPv6 не работает;
- throttle 1,5 с, один прогон — одна сессия;
- RGV587/FAIL_SYS_USER_VALIDATE классифицируются как risk_control:
  три таких ошибки останавливают прогон;
- текущий риск: поиск работает, карточка отдаёт RGV587 после серии
  прогонов; нужен cooldown или другой аккаунт.

Диплинки: www.goofish.com/item?id=..., h5.m.goofish.com/item?id=...,
fleamarket://awesome_detail?itemId=...

## 8. Vision

- отдельный OpenAI-совместимый endpoint (сейчас OpenRouter free);
- фото скачиваются, конвертируются в PNG 640 px через sharp;
- анализируются по одному, результаты агрегируются;
- если экран не виден: screen_ok=null, verdict=сомнительно;
- вердикт попадает в photo_check и влияет на top;
- при отсутствии vision фото всё равно отправляются в Telegram,
  но модель их не анализирует.

## 9. Mini App: точки расширения

Планируемые новые слои:

    src/web/server.js        node:http, статика, API, SSE
    src/web/auth.js          проверка Telegram initData
    src/web/runs.js          очередь/статусы прогонов
    src/web/storage.js       файловое хранилище за интерфейсом
    src/bot/format.js        общий рендер карточки (бот + API)
    web/                     статика без сборки, ES modules

API-контракт и SSE описаны в промте разработчика, фаза 3.
Инварианты: один активный прогон на пользователя, глобальный лимит,
таймаут и отмена, строгая валидация входа, закрытый CORS, CSP,
прокси картинок с allowlist доменов.

## 10. Конфигурация

.env: TELEGRAM_BOT_TOKEN, ADMIN_TELEGRAM_IDS, ALLOWED_TELEGRAM_IDS,
DEEPSEEK_API_KEY, LLM_BASE_URL, LLM_MODEL, RATE_CNY_RUB,
COMMISSION_PERCENT, COMMISSION_MIN_RUB, GOOFISH_PROVIDER,
GOOFISH_COOKIE, GOOFISH_PROXY_URL, SEND_PHOTOS_PER_LOT,
VISION_ENABLED, VISION_BASE_URL, VISION_API_KEY, VISION_MODEL,
VISION_MODELS, VISION_MAX_PHOTOS, PHOTO_MODE, TELEGRAM_API_IP,
BRAND_SEED, DATA_DIR, PORT.

data/ и .env не коммитятся. data/runs хранит запрос/итог/usage.

## 11. Тесты и проверки

- node --test: 64 теста (бюджеты, цены, mock, промт, валидация,
  bot-format, bot-app, settings, config, vision parse/mock).
- npm run doctor: env, ключи, Telegram, LLM, курс.
- npm run probe: сырые ответы Goofish для калибровки.
- CI GitHub Actions, Node 20.

## 12. Долг и риски

- RGV587 на карточке: аккаунт в cooldown, поиск жив.
- Vision free-модели медленные и лимитированные; платный ключ лучше.
- Нет пула аккаунтов, circuit breaker, search-only режима и кэша
  карточек с TTL — это фаза 1.
- Mini App отсутствует; web/ содержит только brand/logo.jpg.
- Telegram DNS блокируется: используется IP-транспорт 149.154.167.220.
- Единственная зависимость sharp; для фронтенда сборка не используется.

## 13. Запуск

    npm install
    npm run doctor
    npm run agent -- "Xiaomi 13 Ultra 16/512 до 20 000 ₽"
    npm start

BotHost: npm start, Node 20+, env из DEPLOY.md.
