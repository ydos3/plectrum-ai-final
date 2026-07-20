// Pure, deterministic gesture engine for Air Strum. It takes per-frame hand
// positions (from MediaPipe, already normalized + mirrored) and decides what to
// play — with NO DOM/camera/audio dependencies, so it can be simulated and
// unit-tested with synthetic hand sweeps (the "real-world in an environment"
// test the product needs).
//
// Model (matches a real air-guitar):
//  • Upper hand (y < noteZoneTop) POINTS to pick a chord — dwell to commit.
//  • Lower hand SWEEPS across the strings — every string the hand crosses is
//    plucked in order, so a single sway plays them all in sequence. A still or
//    jittering hand crosses no boundaries (and is movement-gated) → no notes.

import { stringIndexFromX, chordIndexFromX } from './airStrumDetector.ts';

export interface EnginePoint { x: number; y: number }

export interface EngineConfig {
  noteZoneTop: number;   // y above this = chord-picking zone
  stringsLeft: number;   // left edge of the string band (0..1)
  stringsSpan: number;   // width of the string band
  stringCount: number;   // 6
  chordCount: number;    // number of chord chips
  dwellMs: number;       // hold time to commit a chord
  moveMin: number;       // min horizontal move to arm/ignore micro-jitter
  repluckTravel: number; // horizontal travel over the SAME string that re-plucks it
  perStringDebounceMs: number;
  smoothAlpha: number;   // EMA factor (higher = more responsive)
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  noteZoneTop: 0.42,
  stringsLeft: 0.10,
  stringsSpan: 0.80,
  stringCount: 6,
  chordCount: 6,
  dwellMs: 200,
  moveMin: 0.009,
  // Wave back-and-forth over one string ≈ re-strum it. Small enough to feel
  // sensitive, large enough that smoothed hand-jitter (~0.004) never triggers it.
  repluckTravel: 0.024,
  perStringDebounceMs: 45,
  // Higher = the tracked position snaps to the hand faster (less lag). Tuned up
  // for responsiveness; jitter is still held off by moveMin / repluckTravel.
  smoothAlpha: 0.72,
};

export interface EngineResult {
  pluck: number[];            // string indices to play this frame (in sweep order)
  selectChord: number | null; // chord index to commit this frame, else null
  hoverChord: number;         // chord currently pointed at (-1 = none)
  hoverProgress: number;      // 0..1 dwell progress for the hovered chord
  strumString: number;        // string the strum hand is over (-1 = none)
  handInFrame: boolean;
}

export class StrumEngine {
  private cfg: EngineConfig;
  private strumSmoothX: number | null = null;
  private lastStrumIdx = -1;
  private lastPluckX: number | null = null;
  private armed = false; // true right after the hand enters, before its first pluck
  private strumPrevX: number | null = null; // previous frame's smoothed x (for direction)
  private pluckDir = 0;  // horizontal direction (+1/-1) of the last pluck's stroke
  private perStringLast: number[];
  private noteSmoothX: number | null = null;
  private hover = { idx: -1, since: 0, committed: -1 };

  constructor(config: Partial<EngineConfig> = {}) {
    this.cfg = { ...DEFAULT_ENGINE_CONFIG, ...config };
    this.perStringLast = new Array(this.cfg.stringCount).fill(-Infinity);
  }

  setChordCount(n: number) { this.cfg.chordCount = n; }

  reset() {
    this.strumSmoothX = null;
    this.strumPrevX = null;
    this.lastStrumIdx = -1;
    this.lastPluckX = null;
    this.pluckDir = 0;
    this.armed = false;
    this.noteSmoothX = null;
    this.hover = { idx: -1, since: 0, committed: -1 };
    this.perStringLast.fill(-Infinity);
  }

  step(hands: EnginePoint[], now: number): EngineResult {
    const result: EngineResult = { pluck: [], selectChord: null, hoverChord: -1, hoverProgress: 0, strumString: -1, handInFrame: hands.length > 0 };
    const { cfg } = this;

    if (hands.length === 0) {
      this.strumSmoothX = null;
      this.strumPrevX = null;
      this.lastStrumIdx = -1;
      this.lastPluckX = null;
      this.pluckDir = 0;
      this.armed = false;
      this.noteSmoothX = null;
      this.hover.committed = -1;
      return result;
    }

    const noteHand = hands.find(h => h.y < cfg.noteZoneTop);
    const strumHand = hands.find(h => h.y >= cfg.noteZoneTop);

    // ── Chord pointing (upper hand, dwell) ──
    if (noteHand) {
      const nx = this.noteSmoothX === null ? noteHand.x : this.noteSmoothX + (noteHand.x - this.noteSmoothX) * cfg.smoothAlpha;
      this.noteSmoothX = nx;
      const idx = chordIndexFromX(nx, cfg.chordCount);
      if (idx !== this.hover.idx) { this.hover.idx = idx; this.hover.since = now; }
      result.hoverChord = idx;
      result.hoverProgress = Math.min(1, (now - this.hover.since) / cfg.dwellMs);
      if (result.hoverProgress >= 1 && this.hover.committed !== idx) {
        this.hover.committed = idx;
        result.selectChord = idx;
      }
    } else {
      this.hover.idx = -1;
      this.hover.committed = -1;
      this.noteSmoothX = null;
    }

    // ── Strum (lower hand) ──
    // Two ways to sound strings, so it feels like a real guitar:
    //  • Move ACROSS strings → rake every string crossed, in order (a strum).
    //  • Wave back-and-forth over ONE string → re-pluck it on each reversal.
    // A one-way sweep therefore plays each string exactly once, while planting on
    // a string and sawing keeps sounding it. No velocity gate — gentle motion works.
    if (strumHand) {
      const sx = this.strumSmoothX === null ? strumHand.x : this.strumSmoothX + (strumHand.x - this.strumSmoothX) * cfg.smoothAlpha;
      const prevX = this.strumPrevX;
      this.strumSmoothX = sx;
      this.strumPrevX = sx;
      const frameDir = prevX === null ? 0 : Math.sign(sx - prevX);
      const idx = stringIndexFromX(sx, cfg.stringsLeft, cfg.stringsSpan, cfg.stringCount);
      result.strumString = idx;

      const pluckOne = (k: number, dir: number) => {
        if (now - this.perStringLast[k] > cfg.perStringDebounceMs) {
          this.perStringLast[k] = now;
          result.pluck.push(k);
        }
        this.pluckDir = dir || this.pluckDir;
        this.lastPluckX = sx;
        this.armed = false;
      };

      if (this.lastStrumIdx === -1) {
        // Just entered — arm without auto-playing (fixes "plays one note on load").
        this.lastStrumIdx = idx;
        this.lastPluckX = sx;
        this.armed = true;
      } else if (idx !== this.lastStrumIdx && this.lastPluckX !== null && Math.abs(sx - this.lastPluckX) > cfg.moveMin) {
        // Crossed into a different string → rake each crossed string in order.
        // On the first crossing after arming, include the origin string too.
        const dir = idx > this.lastStrumIdx ? 1 : -1;
        const start = this.armed ? this.lastStrumIdx : this.lastStrumIdx + dir;
        for (let k = start; ; k += dir) {
          if (now - this.perStringLast[k] > cfg.perStringDebounceMs) {
            this.perStringLast[k] = now;
            result.pluck.push(k);
          }
          if (k === idx) break;
        }
        this.lastStrumIdx = idx;
        this.lastPluckX = sx;
        this.pluckDir = dir;
        this.armed = false;
      } else if (idx === this.lastStrumIdx && this.lastPluckX !== null && Math.abs(sx - this.lastPluckX) > cfg.repluckTravel) {
        // Still over the same string. Re-pluck only on the FIRST stroke after
        // arming, or when the stroke direction REVERSES — so a one-way sweep
        // doesn't double-hit a string, but sawing on one string keeps sounding it.
        const reversed = frameDir !== 0 && frameDir !== this.pluckDir;
        if (this.armed || reversed) pluckOne(idx, frameDir);
      }
    } else {
      this.strumSmoothX = null;
      this.strumPrevX = null;
      this.lastStrumIdx = -1;
      this.lastPluckX = null;
      this.pluckDir = 0;
      this.armed = false;
    }

    return result;
  }
}
