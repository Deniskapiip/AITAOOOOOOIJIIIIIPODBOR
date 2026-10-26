# QUALITY REPORT · 2026-10-26

## Базовая линия

42 сценария, 7 категорий, replay 42 live-кассет.

| метрика | значение | ворота |
|---|---:|---|
| safety pass rate | 100% | 100% |
| stop factor in top | 0 | 0 |
| over budget in top | 0 | 0 |
| buy without photo | 0 | 0 |
| unsupported photo claims | 0 | 0 |
| rub mismatch | 0 | 0 |
| gold recall | 100% | >=80% |
| verdict match | 92.1% | >=80% |
| all-bad empty top | 100% | 100% |
| duplicate item calls | 0 | 0 |
| finish first try | 100% | >=90% |
| median calls | 27 | <=30 |
| tokens (replay) | 5 071 339 | — |

## Что исправлено в L3–L6

- `budget_hint` для CNY/RUB — устранён баг 4300 ¥ -> 4300 ₽ -> 338 ¥;
- запрет повторного `goofish_item` — экономия вызовов и меньше RGV;
- фото-утверждения при `photo_check != ок` — теперь ошибка, а не warning;
- `condition_lines` >6 и строки с ценой — обрезаются/удаляются с warning вместо полного reject;
- GPU `брать` требует GPU-Z/HWiNFO/стресс-тест;
- категорийные truth: камера/аудио/консоль/PC-комплектующие больше не получают телефонные фото;
- vision-кэш по URL (`VISION_CACHE_TTL_MS`);
- `tool_stats`, `llm_requests`, `usage_by_step` в логах прогонов;
- 7 playbook-ов + generic в `task_context`.

## Остаточные провалы

6 сценариев с `verdict_mismatch`: camera-03, laptop-04, audio-03, console-03, pc_parts-03, pc_parts-05.
Safety-ворота при этом 100%: стоп-факторы, бюджет, фото и рубли не нарушены.
Причина — консервативность модели на «идеальных» лотах и ручные ожидания вердиктов,
а не пропуск опасного лота. Следующий шаг — разметить эти 5 кейсов вручную и уточнить
ожидания или промт, затем перезаписать только их кассеты.

## Ограничения

- Все 42 сценария записаны в replay-кассеты.
- Baseline синтетический; реальный Goofish и реальный vision не проверялись.
- Стоимость в ¥ не считается: нет тарифа; лимит по токенам.
- Часть кассет записана до последних правок; для чистой базы нужен полный re-record.

## Артефакты

- GitHub: `Deniskapiip/AITAOOOOOOIJIIIIIPODBOR` (актуальный код запушен).
- RU2 BotHost: `bot_1792995404_4969_zacadaq`, Новосибирск, Online; NL-бот остановлен.
- Полный replay: `npm run eval`, 42 сценария, 5 071 339 токенов.
