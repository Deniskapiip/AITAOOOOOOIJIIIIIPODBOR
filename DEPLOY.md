# Деплой на BotHost

Ниже — путь от этой папки до работающего бота. Проект без внешних зависимостей:
npm install ничего не качает, Node.js 20+ достаточно.

## 1. Проверить локально

    npm test
    npm run doctor

doctor покажет, заданы ли токен бота, ключ LLM и курс. Если api.telegram.org
недоступен из твоей сети (в РФ часто блокируется), это нормально: на хостинге
Telegram обычно доступен.

## 2. Git-репозиторий

BotHost удобнее всего подключать к Git. Если репозитория ещё нет:

    git init
    git add .
    git commit -m "Goofish sourcing agent v2"

Дальше создать пустой репозиторий на GitHub и выполнить:

    git remote add origin https://github.com/ТВОЙ_АККАУНТ/goofish-agent.git
    git branch -M main
    git push -u origin main

Файл .env в репозиторий не попадает (он в .gitignore), секреты добавляются
только в панели BotHost.

Альтернатива без GitHub: загрузить проект архивом, если панель это поддерживает.

## 3. Создать бота в BotHost

1. Открой панель BotHost и создай нового бота.
2. Платформа: Node.js.
3. Источник: Git-репозиторий (или архив).
4. Команда запуска: npm start.
5. Версия Node.js: 20 или новее.
6. Порт: если панель требует порт, задай переменную PORT — проект поднимет
   GET /health и продолжит long polling Telegram.

## 4. Переменные окружения

Минимум:

| Переменная | Значение |
|---|---|
| TELEGRAM_BOT_TOKEN | токен от @BotFather |
| DEEPSEEK_API_KEY | ключ LLM |
| ADMIN_TELEGRAM_IDS | твой Telegram ID (узнать: /id в боте или @userinfobot) |
| ALLOWED_TELEGRAM_IDS | кому разрешён подбор; можно оставить пустым |
| TELEGRAM_API_IP | 149.154.167.220 (если Telegram блокируется по DNS) |
| RATE_CNY_RUB | актуальный курс, например 12.4 |
| GOOFISH_PROVIDER | mock для демо или http для реального Goofish |
| PHOTO_MODE | off для DeepSeek; vision только для vision-модели |

Если api.telegram.org не открывается, но IP доступен, бот сам ходит на
TELEGRAM_API_IP с SNI api.telegram.org. На BotHost обычно можно оставить пустым.

Для реального Goofish дополнительно:

| Переменная | Значение |
|---|---|
| GOOFISH_COOKIE | cookie залогиненного аккаунта goofish.com (получить из обычного браузера, не из автоматизированного входа) |
| GOOFISH_PROXY_URL | китайский прокси, например http://user:pass@host:port |

Курс и комиссию можно менять без перезапуска: /rate 12.4 и
/commission 6.5 650 (только для ID из ADMIN_TELEGRAM_IDS).

Важно: если диск контейнера не сохраняется между перезапусками, изменения
/rate могут сброситься. Тогда задавай курс через RATE_CNY_RUB в панели,
а файл data/settings.json считай кэшем текущего запуска.

## 5. Запуск и проверка

После деплоя в логах должно появиться:

    bot: запущен long polling

Проверка в Telegram:

1. /start — инструкция.
2. /id — ID, добавь его в ADMIN_TELEGRAM_IDS при необходимости.
3. /settings — курс и комиссия.
4. Запрос: Xiaomi 15 Ultra 16/512 до 60 000 ₽, только 国行.
5. /json — последний JSON, кнопка «JSON прогона» отправляет файл.

## 6. Если что-то не работает

| Симптом | Причина |
|---|---|
| Не задан TELEGRAM_BOT_TOKEN | переменная не добавлена или бот не перезапущен |
| Не задан DEEPSEEK_API_KEY | нет ключа LLM |
| Telegram 401/404 | неверный токен или бот удалён |
| LLM HTTP 401 | неверный ключ или base URL |
| В итоге рубли null | не задан курс: /rate или RATE_CNY_RUB |
| rate_unavailable | то же самое; агент обязан вернуть null, а не выдумать |
| Goofish FAIL_SYS_TOKEN_EXOIRED | cookie устарел, обнови GOOFISH_COOKIE |
| Goofish timeout | нужен прокси GOOFISH_PROXY_URL |
| Фото не проверяются | модель без vision: PHOTO_MODE=off или vision-модель |

Логи прогонов лежат в data/runs/<id>.json: запрос, итог, число вызовов,
ошибка. Секретов там нет.

## 7. Обновление

    git add .
    git commit -m "update"
    git push

В BotHost нажать перезапуск/редеплой. Настройки в data/ и переменные
окружения при этом не теряются, если диск сохраняется.
