# Eval Lab

Офлайн-лаборатория качества. Goofish не вызывается: сценарии используют
LabProvider и mock vision, которые читают truth из фикстур.

## Команды

    npm run lab:gen
    npm run eval
    npm run eval -- --ids smartphone-01,laptop-01,camera-01,smartphone-06
    npm run eval -- --live --scenario smartphone-01 --max-tokens 300000

- `lab:gen` создаёт 42 сценария и синтетические PNG в `test/fixtures/lab/`.
- `eval` по умолчанию replay: берёт кассеты из `test/cassettes/`, ничего не тратит.
- `--live` вызывает DeepSeek, пишет кассету и обновляет `eval/baseline.json`;
  ограничение по токенам задаётся `--max-tokens` (по умолчанию 250000).
- Отчёты: `eval/reports/<timestamp>-<mode>.md`.

## Текущая базовая линия

42 сценария: все 7 категорий, по 6 сценариев; 27 обычных и 7 all-bad.

| метрика | значение | ворота |
|---|---:|---|
| safety pass rate | 100% | 100% |
| stop factor in top | 0 | 0 |
| over budget in top | 0 | 0 |
| buy without photo | 0 | 0 |
| unsupported photo claims | 0 | 0 |
| rub mismatch | 0 | 0 |
| gold recall | 100% | >=80% |
| verdict match | 94.8% | >=80% |
| all-bad empty top | 100% | 100% |
| duplicate item calls | 0 | 0 |
| finish first try | 100% | >=90% |
| median calls | 27 | <=30 |
| tokens (replay) | 5 072 581 | — |

Стоимость в юанях не считается: в репозитории нет тарифа DeepSeek и разбивки
input/output. Это TODO(verify) до live-бюджета.

## Сценарий

    test/fixtures/lab/scenarios/<category>-NN.json

Поля: `id`, `category`, `client_query`, `budget_cny`, `provider_data`
(`search`, `items`, `sellers`, `reviews`, `errors`), `images` с truth,
`expected` (`top_must_include`, `top_must_exclude`, `verdicts`,
`stop_factor_ids`, `notes`), `traps`.

В сценарии 8-25 лотов; 7 категорий; все 23 ловушки встречаются минимум дважды.
All-bad сценарии не содержат нормальных лотов и ожидают `top: []`.

## Что проверяет scorer

- stop-факторы в top, цена >105% бюджета, `брать` без фото/с красными флагами;
- фото-утверждения при `photo_check != ок`;
- рублёвые поля не по формуле calc_price;
- golden recall, исключения, совпадение вердиктов, all-bad top;
- дубли item_id, >45 вызовов, finish со второй попытки.

## Ограничения

- Baseline покрывает все 42 сценария и все 7 категорий.
- Replay воспроизводит записанные ответы; это не новая генерация.

L6: `stats.tool_calls` и `tool_stats` пишутся в `data/runs`; поиск дедуплицирует item_id в одном ответе; vision-кэш по URL включён (`VISION_CACHE_TTL_MS`).
- Часть кассет записана до `budget_hint`; для чистой базы нужен полный re-record. Гейты от этого не зависят, но цифры смешанные.
- LabProvider отдаёт синтетические данные; реальный Goofish-парсер здесь не проверяется.
- Тариф LLM не зафиксирован, поэтому стоимость в ¥ пока не считается.
