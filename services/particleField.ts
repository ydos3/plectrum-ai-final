// Canvas stage engine for Air Strum.
//
// Strings: thick metallic guitar strings, confined to a lower "guitar body"
// band, that vibrate tightly (a small, fast blur that settles) when plucked.
// Only the plucked string reacts — each string is independent.
//
// Ambience: smooth, wispy, magical ember-purple smoke that curls up from the
// point a string is plucked — light and flowing (fairytale feel), not thick.
//
// Perf: string/body gradients are cached (not rebuilt per frame) and the smoke
// keeps a small live-particle budget so it renders smoothly on mobile.

interface Wisp {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  seed: number;
  color: [number, number, number];
}

// Ember-purple palette: violet, purple, magenta, with a warm ember glow.
const SMOKE_COLORS: [number, number, number][] = [
  [168, 85, 247],   // purple
  [139, 92, 246],   // violet
  [192, 38, 211],   // magenta
  [124, 58, 237],   // deep violet
  [251, 146, 60],   // warm ember (accent, used sparingly)
];

interface StringState {
  amp: number;
  freq: number;
  phase: number;
  thickness: number;
}

const MAX_STRING_AMP = 7;
const MAX_WISPS = 90; // hard budget so it never chugs

export class ParticleField {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private wisps: Wisp[] = [];
  private strings: StringState[] = [];
  private stringLeft = 0.1;
  private stringSpan = 0.8;
  private raf: number | null = null;
  private lastTs = 0;
  private timeSec = 0;
  private rand: () => number;

  // Cached geometry / gradients (rebuilt only on resize).
  private yTop = 0;
  private yBot = 0;
  private stringGrad: CanvasGradient | null = null;
  private bodyGrad: CanvasGradient | null = null;

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
      freq: 18 + i * 2.5,
      phase: this.rand() * 6.28,
      thickness: 7 - i * 0.7,
    }));
  }

  resize(cssWidth: number, cssHeight: number, dpr = 1) {
    this.canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.rebuildGradients(cssWidth, cssHeight);
  }

  private rebuildGradients(w: number, h: number) {
    this.yTop = h * 0.34;
    this.yBot = h * 0.95;
    const g = this.ctx.createLinearGradient(0, this.yTop, 0, this.yBot);
    g.addColorStop(0, 'rgba(253,230,138,0)');
    g.addColorStop(0.12, 'rgba(253,230,138,0.85)');
    g.addColorStop(0.5, '#f59e0b');
    g.addColorStop(0.88, 'rgba(180,83,9,0.85)');
    g.addColorStop(1, 'rgba(180,83,9,0)');
    this.stringGrad = g;

    const cy = this.yTop + (this.yBot - this.yTop) * 0.55;
    const bg = this.ctx.createRadialGradient(w * 0.5, cy, 0, w * 0.5, cy, Math.max(w, this.yBot - this.yTop) * 0.5);
    bg.addColorStop(0, 'rgba(168,85,247,0.06)');
    bg.addColorStop(1, 'rgba(168,85,247,0)');
    this.bodyGrad = bg;
  }

  private get w() { return this.canvas.width / (this.ctx.getTransform().a || 1); }
  private get h() { return this.canvas.height / (this.ctx.getTransform().d || 1); }

  private stringX(i: number) {
    const n = this.strings.length - 1 || 1;
    return (this.stringLeft + (i / n) * this.stringSpan) * this.w;
  }

  /** Pluck string i: kick its (independent) vibration + release a smoke wisp. */
  pluck(i: number, intensity = 1) {
    const s = this.strings[i];
    if (s) {
      s.amp = MAX_STRING_AMP * Math.min(1, intensity);
      s.phase = this.rand() * 6.28;
    }
    const x = this.stringX(i);
    const y = this.yTop + (this.yBot - this.yTop) * 0.5;
    // A few light wisps only — smooth and airy, not a thick cloud.
    const count = 3;
    for (let k = 0; k < count; k++) {
      // Ember accent is rare (~1 in 6); mostly purples/violets.
      const color = this.rand() < 0.16 ? SMOKE_COLORS[4] : SMOKE_COLORS[Math.floor(this.rand() * 4)];
      this.wisps.push({
        x: x + (this.rand() - 0.5) * 14,
        y: y + (this.rand() - 0.5) * 20,
        vx: (this.rand() - 0.5) * 16,
        vy: -(24 + this.rand() * 30),
        life: 0,
        max: 1500 + this.rand() * 1100,
        size: 8 + this.rand() * 10,
        seed: this.rand() * 6.28,
        color,
      });
    }
    if (this.wisps.length > MAX_WISPS) this.wisps.splice(0, this.wisps.length - MAX_WISPS);
    this.ensureLoop();
  }

  start() { this.ensureLoop(); }

  private active() {
    return this.wisps.length > 0 || this.strings.some(s => s.amp > 0.3);
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
      this.raf = this.active() ? requestAnimationFrame(step) : null;
    };
    this.raf = requestAnimationFrame(step);
  }

  private update(dt: number) {
    const secs = dt / 1000;
    const decay = Math.pow(0.5, dt / 150);
    for (const s of this.strings) {
      s.amp *= decay;
      if (s.amp < 0.3) s.amp = 0;
    }
    for (let i = this.wisps.length - 1; i >= 0; i--) {
      const p = this.wisps[i];
      p.life += dt;
      if (p.life >= p.max) { this.wisps.splice(i, 1); continue; }
      // Buoyant rise + gentle sideways curl → smooth wavy smoke.
      p.vy *= 0.99;
      p.vx += Math.sin(this.timeSec * 1.3 + p.seed) * 12 * secs;
      p.x += p.vx * secs;
      p.y += p.vy * secs;
      p.size += 22 * secs; // slowly expand as it dissipates
    }
  }

  private draw() {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    ctx.clearRect(0, 0, w, h);

    // ── Ember-purple smoke (additive glow, soft & wispy) ───────────────────────
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.wisps) {
      const t = p.life / p.max;
      // Ease in then out → smooth appearance & fade.
      const alpha = Math.sin(Math.min(1, t) * Math.PI) * 0.14;
      if (alpha <= 0.004) continue;
      const [r, g, b] = p.color;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
      grad.addColorStop(0.55, `rgba(${r},${g},${b},${alpha * 0.35})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // ── Guitar body glow + strings (confined band, cached gradients) ────────────
    const yTop = this.yTop;
    const yBot = this.yBot;
    const span = yBot - yTop;
    if (this.bodyGrad) { ctx.fillStyle = this.bodyGrad; ctx.fillRect(0, yTop, w, span); }
    const yAt = (yn: number) => yTop + yn * span;

    for (let i = 0; i < this.strings.length; i++) {
      const s = this.strings[i];
      const baseX = this.stringX(i);
      const ringing = s.amp > 0.3;

      if (ringing) {
        const A = s.amp * (0.85 + 0.15 * Math.sin(this.timeSec * s.freq * 6.28 + s.phase));
        const segs = 20;
        ctx.beginPath();
        for (let k = 0; k <= segs; k++) {
          const yn = k / segs;
          ctx.lineTo(baseX - A * Math.sin(Math.PI * yn), yAt(yn));
        }
        for (let k = segs; k >= 0; k--) {
          const yn = k / segs;
          ctx.lineTo(baseX + A * Math.sin(Math.PI * yn), yAt(yn));
        }
        ctx.closePath();
        ctx.fillStyle = `rgba(253,230,138,${(s.amp / MAX_STRING_AMP) * 0.4})`;
        ctx.fill();
      }

      ctx.strokeStyle = this.stringGrad || '#f59e0b';
      ctx.lineWidth = Math.max(2, s.thickness - 2.5);
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(245,158,11,0.7)';
      ctx.shadowBlur = ringing ? 12 : 4;

      const osc = ringing ? s.amp * 0.5 * Math.sin(this.timeSec * s.freq * 6.28 + s.phase) : 0;
      ctx.beginPath();
      const segs = ringing ? 14 : 1;
      for (let k = 0; k <= segs; k++) {
        const yn = k / segs;
        const x = baseX + osc * Math.sin(Math.PI * yn);
        if (k === 0) ctx.moveTo(x, yAt(yn)); else ctx.lineTo(x, yAt(yn));
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  destroy() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.wisps = [];
    try { this.ctx.clearRect(0, 0, this.w, this.h); } catch { /* ignore */ }
  }
}
