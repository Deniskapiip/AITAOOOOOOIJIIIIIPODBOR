import fs from 'node:fs';
import path from 'node:path';

export class CassetteLlm {
  constructor({ inner = null, file, mode = 'replay', logger = null } = {}) {
    this.inner = inner;
    this.file = file;
    this.mode = mode;
    this.logger = logger;
    this.entries = [];
    this.cursor = 0;
    this.totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    this.visionSupported = true;
    if (mode === 'replay') this.load();
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) throw new Error('Нет кассеты: ' + this.file + '. Сначала запусти --live --record.');
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.entries = Array.isArray(raw.entries) ? raw.entries : [];
    if (!this.entries.length) throw new Error('Пустая кассета: ' + this.file);
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ entries: this.entries }, null, 2), 'utf8');
  }

  async chat(args) {
    if (this.mode === 'replay') {
      const entry = this.entries[this.cursor];
      if (!entry) throw new Error('Кассета кончилась: ' + this.file);
      this.cursor += 1;
      return entry.response;
    }
    if (!this.inner) throw new Error('Нет LLM для live-режима');
    const response = await this.inner.chat(args);
    this.entries.push({ request: args, response });
    this.save();
    if (this.inner.totalUsage) {
      this.totalUsage.prompt_tokens = this.inner.totalUsage.prompt_tokens;
      this.totalUsage.completion_tokens = this.inner.totalUsage.completion_tokens;
      this.totalUsage.total_tokens = this.inner.totalUsage.total_tokens;
    }
    return response;
  }
}
