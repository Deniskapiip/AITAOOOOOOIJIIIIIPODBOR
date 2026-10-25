export class RateLimiter {
  constructor(options = {}) {
    this.minIntervalMs = Math.max(0, Number(options.minIntervalMs) || 0);
    this.jitterMs = Math.max(0, Number(options.jitterMs) || 0);
    this.now = options.now || (() => Date.now());
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.lastAt = 0;
  }

  async wait() {
    if (!this.minIntervalMs) return 0;
    const now = this.now();
    const target = this.lastAt + this.minIntervalMs;
    let waitMs = target - now;
    if (waitMs > 0) {
      if (this.jitterMs) waitMs += Math.floor(Math.random() * this.jitterMs);
      await this.sleep(waitMs);
    }
    this.lastAt = this.now();
    return Math.max(0, waitMs);
  }
}
