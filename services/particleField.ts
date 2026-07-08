// Canvas stage engine for Air Strum.
//
// Strings: thick metallic guitar strings that vibrate TIGHTLY like a real
// string — a small, fast motion-blur spindle that settles quickly (not a
// floppy sine wave).
//
// Ambience: calm, peaceful water ripples (koi-pond / mirror surface) that
// radiate out from where a string is plucked and fade — no smoke, no clutter.

interface Ripple {
  x: number;
  y: number;
  delay: number;   // ms before it starts expanding
  life: number;
  max: number;
  maxR: number;
  color: [number, number, number];
}

interface StringState {
  amp: number;       // current vibration amplitude (px) — small, guitar-like
  freq: number;      // visual shimmer frequency (Hz)
  phase: number;
  thickness: number;
}

// Serene, moonlit-water palette (soft blues, teal, periwinkle, warm white).
const RIPPLE_COLORS: [number, number, number][] = [
  [173, 216, 230],
  [150, 220, 210],
  [180, 200, 255],
  [255, 244, 224],
  [200, 180, 255],
];

const MAX_STRING_AMP = 7;

export class ParticleField {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private ripples: Ripple[] = [];
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
      freq: 18 + i * 2.5, // higher strings shimmer faster
      phase: this.rand() * 6.28,
      thickness: 7 - i * 0.7,
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

  /** Pluck string i: kick a tight vibration + send out calm water ripples. */
  pluck(i: number, intensity = 1) {
    const s = this.strings[i];
    if (s) {
      s.amp = MAX_STRING_AMP * Math.min(1, intensity);
      s.phase = this.rand() * 6.28;
    }
    const x = this.stringX(i);
    const y = this.h * 0.5;
    const color = RIPPLE_COLORS[Math.floor(this.rand() * RIPPLE_COLORS.length)];
    const rings = 3;
    for (let k = 0; k < rings; k++) {
      this.ripples.push({
        x,
        y: y + (this.rand() - 0.5) * this.h * 0.08,
        delay: k * 150,
        life: 0,
        max: 1600 + this.rand() * 600,
        maxR: this.h * (0.30 + this.rand() * 0.18),
        color,
      });
    }
    this.ensureLoop();
  }

  start() { this.ensureLoop(); }

  private active() {
    return this.ripples.length > 0 || this.strings.some(s => s.amp > 0.3);
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
    const decay = Math.pow(0.5, dt / 150); // tight settle (~150ms half-life)
    for (const s of this.strings) {
      s.amp *= decay;
      if (s.amp < 0.3) s.amp = 0;
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.life += dt;
      if (r.life >= r.max) this.ripples.splice(i, 1);
    }
  }

  private draw() {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    ctx.clearRect(0, 0, w, h);

    // ── Peaceful water ripples (mirror / koi-pond surface) ─────────────────────
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.5;
    for (const rp of this.ripples) {
      const active = rp.life - rp.delay;
      if (active <= 0) continue;
      const span = rp.max - rp.delay;
      const prog = Math.min(1, active / span);
      const radius = prog * rp.maxR;
      const alpha = (1 - prog) * 0.35;
      if (alpha <= 0.01 || radius <= 0.5) continue;
      const [r, g, b] = rp.color;
      // Outer ring
      ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, radius, radius * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
      // Inner shimmer ring (mirror sheen)
      const r2 = radius * 0.62;
      ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.5})`;
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, r2, r2 * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // ── Strings ────────────────────────────────────────────────────────────────
    for (let i = 0; i < this.strings.length; i++) {
      const s = this.strings[i];
      const baseX = this.stringX(i);
      const ringing = s.amp > 0.3;

      // Motion-blur spindle: a translucent lens widest at the centre, showing
      // the string vibrating tightly. Settles fast.
      if (ringing) {
        const A = s.amp * (0.85 + 0.15 * Math.sin(this.timeSec * s.freq * 6.28 + s.phase));
        const segs = 24;
        ctx.beginPath();
        for (let k = 0; k <= segs; k++) {
          const yn = k / segs;
          const wgt = Math.sin(Math.PI * yn);
          const x = baseX - A * wgt;
          ctx.lineTo(x, yn * h);
        }
        for (let k = segs; k >= 0; k--) {
          const yn = k / segs;
          const wgt = Math.sin(Math.PI * yn);
          const x = baseX + A * wgt;
          ctx.lineTo(x, yn * h);
        }
        ctx.closePath();
        ctx.fillStyle = `rgba(253,230,138,${(s.amp / MAX_STRING_AMP) * 0.4})`;
        ctx.fill();
      }

      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(255,240,205,0.4)');
      grad.addColorStop(0.25, '#fde68a');
      grad.addColorStop(0.55, '#f59e0b');
      grad.addColorStop(0.8, '#b45309');
      grad.addColorStop(1, 'rgba(120,53,15,0.4)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = s.thickness;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(245,158,11,0.85)';
      ctx.shadowBlur = ringing ? 12 : 5;

      // Crisp centreline (oscillates within the spindle for a taut-string feel).
      const osc = ringing ? s.amp * 0.5 * Math.sin(this.timeSec * s.freq * 6.28 + s.phase) : 0;
      ctx.beginPath();
      const segs = ringing ? 16 : 1;
      for (let k = 0; k <= segs; k++) {
        const yn = k / segs;
        const x = baseX + osc * Math.sin(Math.PI * yn);
        if (k === 0) ctx.moveTo(x, 0); else ctx.lineTo(x, yn * h);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  destroy() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.ripples = [];
    try { this.ctx.clearRect(0, 0, this.w, this.h); } catch { /* ignore */ }
  }
}
