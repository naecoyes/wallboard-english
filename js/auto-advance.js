// Foreground countdown based on elapsed time, not interval callback count.
export class AdvanceClock {
  constructor(seconds, now = 0, visible = true) {
    this.duration = Math.max(0, seconds * 1000);
    this.remaining = this.duration;
    this.last = now;
    this.visible = visible;
    this.paused = false;
  }
  tick(now) {
    if (this.visible && !this.paused) this.remaining = Math.max(0, this.remaining - Math.max(0, now - this.last));
    this.last = now;
    return this.duration > 0 && this.remaining === 0;
  }
  reset(now) { this.remaining = this.duration; this.last = now; }
  setVisible(now, visible) { this.tick(now); this.visible = visible; }
  setPaused(now, paused) { this.tick(now); this.paused = paused; }
}
