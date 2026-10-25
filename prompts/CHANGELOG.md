# Playbooks changelog

## v1 · 2026-10-25

- Added 7 category playbooks: smartphone, laptop, camera, pc_parts, console, audio, tablet.
- Added deterministic category selector and `<playbook>` block in `task_context`.
- Playbooks are advisory only; stop factors and money rules remain in the system prompt.
- Eval coverage: each category has 6 lab scenarios; baseline uses 3 categories + all-bad.

## v2 · 2026-10-25

- Added `budget_hint` for explicit CNY/RUB budgets; prevents 4300 CNY -> 4300 RUB errors.
- `goofish_item` now rejects duplicate item IDs in one run (saves calls and reduces RGV risk).
- Photo claims in `why_good` are now a validation error when `photo_check != "ок"`.

## v3 · 2026-10-25

- Search results are deduplicated by `item_id` before the model sees them.
- Runs store `llm_requests` and `tool_stats`.
- Baseline extended to 11 scenarios / 7 categories; all safety gates pass.
