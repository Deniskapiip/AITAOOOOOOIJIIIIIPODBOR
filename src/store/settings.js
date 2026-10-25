import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SETTINGS = Object.freeze({
  rate_cny_rub: null,
  commission_percent: 6.5,
  commission_min_rub: 650,
});

export class SettingsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SettingsError';
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function normalizeSettings(raw) {
  const data = {
    rate_cny_rub: raw && raw.rate_cny_rub !== undefined && raw.rate_cny_rub !== null ? Number(raw.rate_cny_rub) : null,
    commission_percent:
      raw && raw.commission_percent !== undefined && raw.commission_percent !== null
        ? Number(raw.commission_percent)
        : DEFAULT_SETTINGS.commission_percent,
    commission_min_rub:
      raw && raw.commission_min_rub !== undefined && raw.commission_min_rub !== null
        ? Number(raw.commission_min_rub)
        : DEFAULT_SETTINGS.commission_min_rub,
    updated_at: raw && raw.updated_at ? String(raw.updated_at) : null,
    updated_by: raw && raw.updated_by ? String(raw.updated_by) : null,
  };
  if (data.rate_cny_rub !== null && (!isFiniteNumber(data.rate_cny_rub) || data.rate_cny_rub <= 0 || data.rate_cny_rub >= 100)) {
    throw new SettingsError('Курс CNY/RUB должен быть числом больше 0 и меньше 100');
  }
  if (!isFiniteNumber(data.commission_percent) || data.commission_percent < 0 || data.commission_percent > 50) {
    throw new SettingsError('Комиссия должна быть числом от 0 до 50 процентов');
  }
  if (!isFiniteNumber(data.commission_min_rub) || data.commission_min_rub < 0) {
    throw new SettingsError('Минимальная комиссия должна быть неотрицательным числом');
  }
  return data;
}

export class SettingsStore {
  constructor(dataDir, logger, defaults = null) {
    this.file = path.join(dataDir, 'settings.json');
    this.logger = logger;
    this.defaults = defaults || {};
    this.data = normalizeSettings(this.defaults);
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = normalizeSettings({ ...this.defaults, ...raw });
      }
    } catch (err) {
      if (this.logger) this.logger.warn('settings: не удалось прочитать файл, используются значения из окружения', { error: err.message });
    }
    return this.data;
  }

  get() {
    return { ...this.data };
  }

  hasRate() {
    return isFiniteNumber(this.data.rate_cny_rub) && this.data.rate_cny_rub > 0;
  }

  setRate(rate, updatedBy) {
    if (!isFiniteNumber(rate) || rate <= 0 || rate >= 100) {
      throw new SettingsError('Курс CNY/RUB должен быть числом больше 0 и меньше 100');
    }
    this.data = { ...this.data, rate_cny_rub: rate };
    this.persist(updatedBy);
    return this.get();
  }

  setCommission(percent, minRub, updatedBy) {
    if (percent !== undefined && percent !== null && (!isFiniteNumber(percent) || percent < 0 || percent > 50)) {
      throw new SettingsError('Комиссия должна быть числом от 0 до 50 процентов');
    }
    if (minRub !== undefined && minRub !== null && (!isFiniteNumber(minRub) || minRub < 0)) {
      throw new SettingsError('Минимальная комиссия должна быть неотрицательным числом');
    }
    this.data = {
      ...this.data,
      commission_percent: percent !== undefined && percent !== null ? percent : this.data.commission_percent,
      commission_min_rub: minRub !== undefined && minRub !== null ? minRub : this.data.commission_min_rub,
    };
    this.persist(updatedBy);
    return this.get();
  }

  persist(updatedBy) {
    this.data = {
      ...this.data,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy ? String(updatedBy) : this.data.updated_by,
    };
    this.data = normalizeSettings(this.data);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
    if (this.logger) this.logger.info('settings: сохранены', { file: this.file });
    return this.get();
  }
}
