export const STAGE_LIMITS = Object.freeze({
  calc_price: 2,
  goofish_search: 9,
  goofish_item: 15,
  goofish_seller: 8,
  goofish_reviews: 4,
  view_images: 4,
  finish: 1,
});

export class Budget {
  constructor(maxToolCalls = 45) {
    this.max = Math.max(1, Math.min(Number(maxToolCalls) || 45, 45));
    this.used = 0;
    this.stageUsed = {};
    this.limitsHit = [];
    this.rejected = 0;
    this.finishInvalid = false;
  }

  stageCount(name) {
    return this.stageUsed[name] || 0;
  }

  remaining() {
    return this.max - this.used;
  }

  canCall(name) {
    const stage = STAGE_LIMITS[name];
    if (!stage) return { ok: false, reason: 'Неизвестный инструмент: ' + name };
    if (name === 'finish') {
      const attempts = this.stageCount('finish');
      if (attempts >= 3) return { ok: false, reason: 'finish отклонялся 3 раза' };
      if (attempts >= 1 && !this.finishInvalid) return { ok: false, reason: 'finish уже вызывался' };
      if (this.used + 1 > this.max) return { ok: false, reason: 'Общий лимит вызовов исчерпан (' + this.max + ')' };
      return { ok: true };
    }
    if (this.used + 2 > this.max) {
      return { ok: false, reason: 'Осталось ' + this.remaining() + ' вызов(а): резерв только под finish' };
    }
    if (this.stageCount(name) >= stage) {
      return { ok: false, reason: 'Исчерпан лимит этапа ' + name + ' (' + stage + ')' };
    }
    return { ok: true };
  }

  record(name) {
    if (this.used >= this.max) throw new Error('budget overflow');
    this.used += 1;
    this.stageUsed[name] = this.stageCount(name) + 1;
  }

  markLimit(reason) {
    if (reason && !this.limitsHit.includes(reason)) this.limitsHit.push(reason);
  }
}
