// Low-latency strum detection for Air Strum.
//
// WHY THIS EXISTS — the previous engine detected string CROSSINGS: it waited for
// the hand to arrive over string N, then plucked it. Two fatal problems:
//   1) A crossing can only be observed AFTER the hand is already there, so the
//      note fires late — on top of the ~110ms camera+inference+audio pipeline.
//   2) It needed accurate traversal of each string, so fast strums (exactly when
//      people strum hardest) skipped strings or missed entirely → "can't detect".
//
// This engine detects the strum's ONSET instead: the velocity spike that happens
// as the hand ACCELERATES, which occurs *before* it reaches the strings. Firing on
// onset therefore lands earlier and cancels much of the pipeline latency rather
// than adding to it. One physical strum produces exactly one rake, whose 6 strings
// are then scheduled with correct internal spacing by the audio layer — which is
// also how a real guitar behaves (strings ring in a ~20-40ms cascade).
//
// Slow, deliberate motion still picks individual strings, so both gestures work:
//   fast sweep  → full chord rake, velocity-scaled dynamics
//   slow move   → single-string picking
//
// Pure: no DOM/audio/camera. Unit-tested in scripts/test-strum-onset.ts.

export interface StrumOnsetConfig {
  /** |velocity| (screen-widths/sec) that starts a strum. */
  onThreshold: number;
  /** |velocity| the hand must fall back under before another strum can fire. */
  offThreshold: number;
  /** Minimum ms between strums — one physical sweep = one rake. */
  refractoryMs: number;
  /** Velocity mapped to full intensity (1.0). */
  fullIntensityVel: number;
  /** Below this |velocity|, motion counts as deliberate single-string picking. */
  pickMaxVel: number;
  /** Per-string debounce for slow picking. */
  pickDebounceMs: number;
  /** One-Euro filter: baseline cutoff (Hz). Lower = smoother when still. */
  minCutoff: number;
  /** One-Euro filter: speed coefficient. Higher = less lag when moving fast. */
  beta: number;
  /**
   * Cutoff (Hz) for the VELOCITY estimate. The usual default of 1.0 needs ~3
   * frames to register a spike (~70ms) — which would eat the latency we're trying
   * to win back. 3.0 detects the onset within a frame or two while still ignoring
   * single-frame landmark noise.
   */
  dCutoff: number;
}

export const DEFAULT_STRUM_ONSET_CONFIG: StrumOnsetConfig = {
  onThreshold: 0.9,
  offThreshold: 0.45,
  refractoryMs: 130,
  fullIntensityVel: 3.0,
  pickMaxVel: 0.55,
  pickDebounceMs: 90,
  minCutoff: 1.2,
  beta: 0.9,
  dCutoff: 3.0,
};

/**
 * One-Euro filter — the standard low-latency filter for interactive gesture input.
 * Unlike a fixed EMA (which trades lag for smoothness at ALL speeds), it widens its
 * cutoff as the hand speeds up, so fast strums keep almost no lag while a resting
 * hand still stops jittering. This is why the previous EMA smoothing felt sluggish.
 */
class OneEuro {
  private xHat: number | null = null;
  private xPrev = 0;   // previous RAW input — the derivative must use this, not xHat
  private dxHat = 0;
  private tPrev = 0;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  constructor(minCutoff: number, beta: number, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
  }

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset(): void { this.xHat = null; this.xPrev = 0; this.dxHat = 0; this.tPrev = 0; }

  /** Returns { value, velocity(units/sec) }. */
  filter(x: number, tMs: number): { value: number; velocity: number } {
    if (this.xHat === null) { this.xHat = x; this.xPrev = x; this.tPrev = tMs; return { value: x, velocity: 0 }; }
    const dt = Math.max(1e-3, (tMs - this.tPrev) / 1000);
    this.tPrev = tMs;

    // Derivative of the RAW signal. Using (x - xHat) would inflate it ~3x, because
    // xHat lags the input — that made every slow drag read as a fast strum.
    const dx = (x - this.xPrev) / dt;
    this.xPrev = x;
    this.dxHat = this.dxHat + OneEuro.alpha(this.dCutoff, dt) * (dx - this.dxHat);

    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxHat);
    this.xHat = this.xHat + OneEuro.alpha(cutoff, dt) * (x - this.xHat);
    return { value: this.xHat, velocity: this.dxHat };
  }
}

export interface StrumEvent {
  direction: 'D' | 'U';
  /** 0..1 from hand speed → drives volume + brightness. */
  intensity: number;
  /** Filtered hand x at the moment of onset (0..1). */
  x: number;
}

export interface StrumOnsetResult {
  /** A full chord rake fired this frame (fast sweep), else null. */
  strum: StrumEvent | null;
  /** A single string to pick (slow, deliberate motion), else null. */
  pick: number | null;
  /** Smoothed hand x (for the visual playhead). */
  x: number;
  /** Signed velocity in screen-widths/sec (for debug/visuals). */
  velocity: number;
  /** True while the hand is mid-sweep (drives the "armed" glow). */
  sweeping: boolean;
  handPresent: boolean;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class StrumOnsetEngine {
  private cfg: StrumOnsetConfig;
  private filter: OneEuro;
  private armed = true;          // ready to fire a new strum
  private lastStrumDir = 0;      // direction of the last rake (+1 / -1)
  private lastStrumAt = -Infinity;
  private lastPickIdx = -1;
  private perStringLast: number[];
  private stringCount: number;

  constructor(config: Partial<StrumOnsetConfig> = {}, stringCount = 6) {
    this.cfg = { ...DEFAULT_STRUM_ONSET_CONFIG, ...config };
    this.filter = new OneEuro(this.cfg.minCutoff, this.cfg.beta, this.cfg.dCutoff);
    this.stringCount = stringCount;
    this.perStringLast = new Array(stringCount).fill(-Infinity);
  }

  reset(): void {
    this.filter.reset();
    this.armed = true;
    this.lastStrumAt = -Infinity;
    this.lastPickIdx = -1;
    this.perStringLast.fill(-Infinity);
  }

  /** @param x normalized hand x (0..1), or null when no hand is visible. */
  step(x: number | null, nowMs: number, stringIndexFromX?: (x: number) => number): StrumOnsetResult {
    if (x === null) {
      this.filter.reset();
      this.armed = true;
      this.lastPickIdx = -1;
      return { strum: null, pick: null, x: 0.5, velocity: 0, sweeping: false, handPresent: false };
    }

    const { value, velocity } = this.filter.filter(x, nowMs);
    const speed = Math.abs(velocity);
    const cfg = this.cfg;

    let strum: StrumEvent | null = null;
    let pick: number | null = null;

    // ── Fast sweep → fire the whole rake at ONSET (early = cancels latency) ──
    // A real strumming pattern (D-D-U-D-U) never lets the hand come to rest, so a
    // DIRECTION REVERSAL counts as a fresh stroke even while still moving fast —
    // otherwise continuous strumming would only ever fire once.
    const dir = Math.sign(velocity);
    const reversed = this.lastStrumDir !== 0 && dir !== 0 && dir !== this.lastStrumDir;
    if ((this.armed || reversed) && speed >= cfg.onThreshold && nowMs - this.lastStrumAt >= cfg.refractoryMs) {
      strum = {
        direction: velocity > 0 ? 'D' : 'U',
        intensity: clamp01(speed / cfg.fullIntensityVel),
        x: value,
      };
      this.armed = false;
      this.lastStrumDir = dir;
      this.lastStrumAt = nowMs;
    }

    // Re-arm once the hand slows — covers repeated strokes in the SAME direction
    // (the reversal rule above covers alternating ones).
    if (!this.armed && speed <= cfg.offThreshold) this.armed = true;

    // ── Slow, deliberate motion → pick the individual string under the hand ──
    if (!strum && speed < cfg.pickMaxVel && stringIndexFromX) {
      const idx = stringIndexFromX(value);
      if (idx >= 0 && idx < this.stringCount && idx !== this.lastPickIdx) {
        if (nowMs - this.perStringLast[idx] > cfg.pickDebounceMs) {
          this.perStringLast[idx] = nowMs;
          pick = idx;
        }
        this.lastPickIdx = idx;
      }
    } else if (speed >= cfg.pickMaxVel) {
      // Moving fast: forget the last picked string so a later slow pass re-picks it.
      this.lastPickIdx = -1;
    }

    return { strum, pick, x: value, velocity, sweeping: !this.armed, handPresent: true };
  }
}

/**
 * Per-string time offsets (ms) for one rake — a real strum is a fast cascade, not
 * a simultaneous block chord. Harder strums are tighter (faster pick travel).
 */
export const rakeOffsets = (intensity: number, stringCount = 6, direction: 'D' | 'U' = 'D'): number[] => {
  const spacing = 26 - clamp01(intensity) * 16; // 26ms (soft) → 10ms (hard)
  const offs = Array.from({ length: stringCount }, (_, i) => i * spacing);
  return direction === 'D' ? offs : offs.slice().reverse();
};
