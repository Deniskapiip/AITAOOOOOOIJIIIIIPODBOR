import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFinish } from '../src/agent/validate.js';
import { baseResult, makeTokenContext } from './helpers.js';

async function check(mutate, contextOptions) {
  const ctx = await makeTokenContext(contextOptions);
  const result = baseResult();
  if (mutate) mutate(result, ctx);
  const validation = validateFinish({
    result,
    state: ctx.state,
    settings: ctx.settings.get(),
    budget: ctx.budget,
    config: ctx.config,
  });
  return { validation, ctx };
}

test('базовый итог проходит проверку и нормализуется', async () => {
  const { validation } = await check();
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.result.top.length, 2);
  assert.equal(validation.result.top[0].url, 'https://www.goofish.com/item?id=812345678901');
  assert.equal(validation.result.top[0].final_price_rub, 58533);
  assert.equal(validation.result.stats.tool_calls, 5);
  assert.equal(validation.result.stats.checked_deeply, 2);
});

test('цена, не совпадающая с карточкой, отклоняется', async () => {
  const { validation } = await check((r) => {
    r.top[0].price_cny = 4000;
  });
  assert.ok(validation.errors.some((e) => e.includes('не совпадает с карточкой')));
});

test('лота без карточки в top быть не может', async () => {
  const { validation } = await check((r) => {
    r.top[1].item_id = '812345678902';
    r.top[1].url = 'https://www.goofish.com/item?id=812345678902';
  });
  assert.ok(validation.errors.some((e) => e.includes('не проверялся через goofish_item')));
});

test('цена в тексте карточки запрещена', async () => {
  const { validation } = await check((r) => {
    r.top[0].card.condition_lines.push('Цена 4580 ¥');
  });
  assert.ok(validation.errors.some((e) => e.includes('нельзя писать цену')));
});

test('"брать" без просмотра фото невозможно', async () => {
  const ctx = await makeTokenContext();
  ctx.state.viewedItemIds.delete('812345678901');
  const validation = validateFinish({
    result: baseResult(),
    state: ctx.state,
    settings: ctx.settings.get(),
    budget: ctx.budget,
    config: ctx.config,
  });
  assert.ok(validation.errors.some((e) => e.includes('фото лота не просматривались')));
});

test('"брать" требует score ≥ 80', async () => {
  const { validation } = await check((r) => {
    r.top[0].score_breakdown = { price: 15, condition: 15, seller: 15, match: 10, description: 8, delivery: 7, penalties: 0 };
    r.top[0].score = 70;
    r.top[0].verdict = 'брать';
  });
  assert.ok(validation.errors.some((e) => e.includes('score ≥ 80')));
  assert.equal(validation.result.top[0].score, 70);
});

test('лот дороже 105% бюджета отклоняется', async () => {
  const { validation } = await check(null, { budgetRub: 48000 });
  assert.ok(validation.errors.some((e) => e.includes('105% бюджета')));
});

test('без calc_price рублёвые поля не подставляются', async () => {
  const ctx = await makeTokenContext();
  ctx.state.priceResults.clear();
  const validation = validateFinish({
    result: baseResult(),
    state: ctx.state,
    settings: ctx.settings.get(),
    budget: ctx.budget,
    config: ctx.config,
  });
  assert.ok(validation.errors.some((e) => e.includes('не вызван calc_price')));
  assert.equal(validation.result.top[0].final_price_rub, null);
});

test('score пересчитывается по breakdown, а не принимается на слово', async () => {
  const { validation } = await check((r) => {
    r.top[0].score = 55;
    r.top[0].verdict = 'проверить';
  });
  assert.equal(validation.result.top[0].score, 89);
  assert.ok(validation.warnings.some((w) => w.includes('score пересчитан')));
});

test('факты о продавце берутся из профиля', async () => {
  const { validation } = await check((r) => {
    r.top[0].seller.zhima = 999;
  });
  assert.equal(validation.result.top[0].seller.zhima, 780);
  assert.ok(validation.warnings.some((w) => w.includes('zhima исправлен')));
});

test('больше 3 лотов в top нельзя', async () => {
  const { validation } = await check((r) => {
    r.top.push(JSON.parse(JSON.stringify(r.top[1])));
    r.top.push(JSON.parse(JSON.stringify(r.top[1])));
  });
  assert.ok(validation.errors.some((e) => e.includes('больше 3')));
});

test('verdict "пропустить" не может быть в top', async () => {
  const { validation } = await check((r) => {
    r.top[1].verdict = 'пропустить';
    r.top[1].score = 55;
  });
  assert.ok(validation.errors.some((e) => e.includes('пропустить')));
});

test('длинный summary и пустые вопросы дают предупреждения', async () => {
  const { validation } = await check((r) => {
    r.summary_ru = 'Раз. Два. Три. Четыре.';
    r.top[0].questions_for_seller = [];
  });
  assert.ok(validation.warnings.some((w) => w.includes('3 предложений')));
  assert.equal(validation.result.top[0].questions_for_seller.length, 1);
});

test('битый результат не роняет валидатор', async () => {
  const ctx = await makeTokenContext();
  const validation = validateFinish({ result: 'x', state: ctx.state, settings: ctx.settings.get(), budget: ctx.budget, config: ctx.config });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.length > 0);
});

test('лот с дефектом экрана не проходит', async () => {
  const ctx = await makeTokenContext();
  ctx.state.items.get('812345678901').description += ' 轻微透图';
  const validation = validateFinish({
    result: baseResult(),
    state: ctx.state,
    settings: ctx.settings.get(),
    budget: ctx.budget,
    config: ctx.config,
  });
  assert.ok(validation.errors.some((e) => e.includes('стоп-фактор экрана')));
});

test('vision-вердикт "плохо" перебивает фото-проверку', async () => {
  const ctx = await makeTokenContext();
  ctx.state.visionByItem.set('812345678901', { verdict: 'плохо', defects: ['трещина экрана'], mismatches: [] });
  const validation = validateFinish({
    result: baseResult(),
    state: ctx.state,
    settings: ctx.settings.get(),
    budget: ctx.budget,
    config: ctx.config,
  });
  assert.equal(validation.result.top.find((l) => l.item_id === '812345678901').photo_check.verdict, 'плохо');
  assert.ok(validation.errors.some((e) => e.includes('photo_check = "плохо"')));
});
