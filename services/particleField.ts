// Canvas stage engine for Air Strum: draws thick metallic guitar strings with a
// real, decaying sine-wave vibration when plucked, plus colorful, wispy, fluid
// particles (soft abstract blobs + downward "water trickle" droplets) in
// maroon / magenta / purple tones. Pure canvas 2D + rAF, no dependencies.

type ParticleKind = 'blob' | 'trickle';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  kind: ParticleKind;
  seed: number;
  color: [number, number, number];
}

// Maroon, magenta, purple, rose, violet — colourful and "vibing".
const PALETTE: [number, number, number][] = [
  [136, 19, 55],
  [192, 38, 211],
  [124, 58, 237],
  [225, 29, 72],
  [167, 139, 250],
];

interface StringState {
  amp: number;        // current vibration amplitude (px)
  freq: number;       // visual oscillation frequency (Hz)
  phase: number;
  thickness: number;
}

export class ParticleField {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private particles: Particle[] = [];
  private strings: StringState[] = [];
  private stringLeft = 0.1;
  private stringSpan = 0.8;
  private raf: number | null = null;
  private lastTs = 0;
  private timeSec = 0;
  private rand: () => number;

  constructor(canvas: HTMLCanvasElement, opts: { random?: () => number } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.rand = opts.random || Math.random;
    this.configureStrings(6, 0.1, 0.8);
  }

  configureStrings(count: number, left: number, span: number) {
    this.stringLeft = left;
    this.stringSpan = span;
    this.strings = Array.from({ length: count }, (_, i) => ({
      amp: 0,
      freq: 6.5 + i * 1.4,
      phase: this.rand() * 6.28,
      thickness: 8 - i * 0.8, // bass strings thicker
    }));
  }

  resize(cssWidth: number, cssHeight: number, dpr = 1) {
    this.canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private get w() { return this.canvas.width / (this.ctx.getTransform().a || 1); }
  private get h() { return this.canvas.height / (this.ctx.getTransform().d || 1); }

  private stringX(i: number) {
    const n = this.strings.length - 1 || 1;
    return (this.stringLeft + (i / n) * this.stringSpan) * this.w;
  }

  /** Pluck string i: kick its vibration and release a small colourful flourish. */
  pluck(i: number, intensity = 1) {
    const s = this.strings[i];
    if (s) {
      s.amp = (10 + (this.strings.length - 1 - i) * 1.2) * intensity;
      s.phase = this.rand() * 6.28;
    }
    this.spawnAt(this.stringX(i), intensity);
    this.ensureLoop();
  }

  private spawnAt(x: number, intensity: number) {
    const h = this.h;
    const y = h * 0.5;
    const pick = () => PALETTE[Math.floor(this.rand() * PALETTE.length)];
    // A couple of soft rising blobs (abstract, wispy).
    const blobs = 2 + Math.round(intensity);
    for (let k = 0; k < blobs; k++) {
      this.particles.push({
        x: x + (this.rand() - 0.5) * 22,
        y: y + (this.rand() - 0.5) * h * 0.14,
        vx: (this.rand() - 0.5) * 26,
        vy: -(10 + this.rand() * 34),
        life: 0,
        max: 900 + this.rand() * 900,
        size: 10 + this.rand() * 16,
        kind: 'blob',
        seed: this.rand() * 6.28,
        color: pick(),
      });
    }
    // Water-trickle droplets flowing down.
    const drops = 2 + Math.round(intensity);
    for (let k = 0; k < drops; k++) {
      this.particles.push({
        x: x + (this.rand() - 0.5) * 10,
        y: y + (this.rand() - 0.3) * h * 0.06,
        vx: (this.rand() - 0.5) * 10,
        vy: 18 + this.rand() * 26,
        life: 0,
        max: 1100 + this.rand() * 900,
        size: 2 + this.rand() * 2.4,
        kind: 'trickle',
        seed: this.rand() * 6.28,
        color: pick(),
      });
    }
  }

  start() { this.ensureLoop(); }

  private active() {
    return this.particles.length > 0 || this.strings.some(s => s.amp > 0.4);
  }

  private ensureLoop() {
    if (this.raf !== null) return;
    this.lastTs = 0;
    const step = (ts: number) => {
      if (!this.lastTs) this.lastTs = ts;
      const dt = Math.min(64, ts - this.lastTs);
      this.lastTs = ts;
      this.timeSec += dt / 1000;
      this.update(dt);
      this.draw();
      // Keep looping while strings are ringing or particles are alive.
      this.raf = this.active() ? requestAnimationFrame(step) : null;
    };
    this.raf = requestAnimationFrame(step);
  }

  private update(dt: number) {
    const secs = dt / 1000;
    const decay = Math.pow(0.5, dt / 300); // vibration half-life ~300ms
    for (const s of this.strings) {
      s.amp *= decay;
      if (s.amp < 0.4) s.amp = 0;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) { this.particles.splice(i, 1); continue; }
      if (p.kind === 'trickle') {
        p.vy += 70 * secs;                 // gravity for liquid
        p.vx += Math.sin(this.timeSec * 3 + p.seed) * 10 * secs;
      } else {
        p.vy *= 0.985;
        p.vx += Math.sin(this.timeSec * 1.6 + p.seed) * 8 * secs;
        p.size += 12 * secs;               // slowly dissipate
      }
      p.x += p.vx * secs;
      p.y += p.vy * secs;
    }
  }

  private draw() {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    ctx.clearRect(0, 0, w, h);

    // ── Strings ──────────────────────────────────────────────────────────────
    for (let i = 0; i < this.strings.length; i++) {
      const s = this.strings[i];
      const baseX = this.stringX(i);
      const ringing = s.amp > 0.4;
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(255,240,205,0.35)');
      grad.addColorStop(0.25, '#fde68a');
      grad.addColorStop(0.55, '#f59e0b');
      grad.addColorStop(0.8, '#b45309');
      grad.addColorStop(1, 'rgba(120,53,15,0.35)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = s.thickness;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(245,158,11,0.9)';
      ctx.shadowBlur = ringing ? 16 : 6;

      ctx.beginPath();
      const segs = 28;
      for (let k = 0; k <= segs; k++) {
        const yn = k / segs;
        const env = Math.sin(Math.PI * yn); // fundamental standing wave
        const off = s.amp * env * Math.sin(this.timeSec * s.freq * 6.28 + s.phase);
        const x = baseX + off;
        const y = yn * h;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // ── Water trickle (liquid droplets) ────────────────────────────────────────
    ctx.globalCompositeOperation = 'source-over';
    for (const p of this.particles) {
      if (p.kind !== 'trickle') continue;
      const t = p.life / p.max;
      const alpha = Math.sin(Math.min(1, t) * Math.PI) * 0.5;
      if (alpha <= 0.01) continue;
      const [r, g, b] = p.color;
      const len = p.size * 4.5;
      const trail = ctx.createLinearGradient(p.x, p.y - len, p.x, p.y + p.size);
      trail.addColorStop(0, `rgba(${r},${g},${b},0)`);
      trail.addColorStop(1, `rgba(${r},${g},${b},${alpha})`);
      ctx.fillStyle = trail;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.size, len, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)},${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y + p.size * 0.6, p.size * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Soft colourful blobs (additive glow) ───────────────────────────────────
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      if (p.kind !== 'blob') continue;
      const t = p.life / p.max;
      const alpha = Math.sin(Math.min(1, t) * Math.PI) * 0.22;
      if (alpha <= 0.01) continue;
      const [r, g, b] = p.color;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
      grad.addColorStop(0.6, `rgba(${r},${g},${b},${alpha * 0.4})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  destroy() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.particles = [];
    try { this.ctx.clearRect(0, 0, this.w, this.h); } catch { /* ignore */ }
  }
}
