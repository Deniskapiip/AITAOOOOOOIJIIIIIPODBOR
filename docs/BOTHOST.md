# BotHost · новый бот Taoji Agent

Старый бот **Taoji Cargo - бот для заказов** не изменялся.

## Текущее размещение

| Параметр | Значение |
|---|---|
| Панель | bothost.ru, аккаунт zacadaq |
| Имя | Taoji Agent |
| ID | bot_1792953776_5397_zacadaq |
| Платформа | Telegram · Node.js 20 (node:20-alpine) |
| Регион | Нидерланды (nl8) |
| Домен | https://bot-1792953776-5397-zacadaq.bothost.tech |
| Репозиторий | github.com/Deniskapiip/AITAOOOOOOIJIIIIIPODBOR (пустой) |
| Статус | Online, long polling |

## Как залит код

Репозиторий пустой, GitHub-токена нет. Код загружен через файловый менеджер
BotHost в /app, затем нажата «Пересобрать из /app» (beta).

Состав /app:

    index.js            точка входа (импортирует src/index.js)
    package.json        зависимость sharp
    .env                ключи и настройки (не в git)
    prompts/system.md
    src/...             все модули
    web/brand/logo.jpg

Секреты лежат только в /app/.env и в переменных BotHost; в репозиторий не попадают.

## Важно: порт

BotHost запускает свой wrapper на PORT (по умолчанию 3000) и проверяет домен им.
Наш health-сервер раньше тоже занимал PORT и падал с EADDRINUSE. Теперь:

- конфиг читает APP_PORT, а не PORT;
- PORT на BotHost не задаём;
- wrapper отвечает на домене «Bot is running»;
- long polling живёт отдельным процессом node index.js.

Для Mini App (фаза 3) этого мало: домен указывает на wrapper, а не на наш HTTP.
Понадобится либо собственный Dockerfile (включить «Использовать свой Dockerfile»)
и один процесс, который поднимает и бота, и API, либо отдельный сервис/порт.
Решение фиксируем в DECISIONS.md перед фазой 3.

## Пересборка после изменений

1. Залить изменённые файлы в /app через file-manager.php.
2. POST /api/bot-settings.php:

       {"action":"rebuild_from_files","id":"bot_1792953776_5397_zacadaq"}

3. Дождаться окончания сборки в логах «Сборка».
4. Проверить «Работа»: должно быть "bot: запущен long polling".

Если репозиторий позже подключат, rebuild можно заменить на git deploy.

## Проверка

- домен отдаёт 200 от wrapper;
- runtime-логи содержат "bot: запущен long polling";
- Telegram getMe для токена проходит;
- старый бот продолжает работать.

## Ограничения

- Goofish всё ещё отдаёт RGV587 на карточке; бот запущен, но реальный подбор
  упрётся в это до снятия блокировки/смены аккаунта.
- Vision на OpenRouter free: медленно, лимиты.
- Mini App пока нет.

## После пересборки

BotHost может оставить контейнер в статусе Stopped. На дашборде нажми кнопку
перезапуска (`restartBot`) и убедись, что статус Online, а в runtime-логах есть
`bot: запущен long polling`. Без этого бот не отвечает.
