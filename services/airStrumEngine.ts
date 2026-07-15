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
  moveMin: number;       // min horizontal move to allow a new pluck (kills jitter)
  perStringDebounceMs: number;
  smoothAlpha: number;   // EMA factor (higher = more responsive)
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  noteZoneTop: 0.42,
  stringsLeft: 0.10,
  stringsSpan: 0.80,
  stringCount: 6,
  chordCount: 6,
  dwellMs: 220,
  moveMin: 0.02,
  perStringDebounceMs: 90,
  smoothAlpha: 0.5,
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
    this.lastStrumIdx = -1;
    this.lastPluckX = null;
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
      this.lastStrumIdx = -1;
      this.lastPluckX = null;
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

    // ── Strum (lower hand sweep → pluck every crossed string) ──
    if (strumHand) {
      const sx = this.strumSmoothX === null ? strumHand.x : this.strumSmoothX + (strumHand.x - this.strumSmoothX) * cfg.smoothAlpha;
      this.strumSmoothX = sx;
      const idx = stringIndexFromX(sx, cfg.stringsLeft, cfg.stringsSpan, cfg.stringCount);
      result.strumString = idx;

      if (this.lastStrumIdx === -1) {
        // Just entered — arm without auto-playing (fixes "plays one note on load").
        this.lastStrumIdx = idx;
        this.lastPluckX = sx;
        this.armed = true;
      } else if (idx !== this.lastStrumIdx && this.lastPluckX !== null && Math.abs(sx - this.lastPluckX) > cfg.moveMin) {
        // Pluck every string crossed between the last string and the new one.
        // On the FIRST crossing of a sweep (armed), include the origin string so a
        // sway that starts over string 0 still plays it — "play everything together".
        const dir = idx > this.lastStrumIdx ? 1 : -1;
        const start = this.armed ? this.lastStrumIdx : this.lastStrumIdx + dir;
        this.armed = false;
        for (let k = start; ; k += dir) {
          if (now - this.perStringLast[k] > cfg.perStringDebounceMs) {
            this.perStringLast[k] = now;
            result.pluck.push(k);
          }
          if (k === idx) break;
        }
        this.lastStrumIdx = idx;
        this.lastPluckX = sx;
      }
    } else {
      this.strumSmoothX = null;
      this.lastStrumIdx = -1;
      this.lastPluckX = null;
      this.armed = false;
    }

    return result;
  }
}
