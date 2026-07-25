// Pure gesture→chord engine for "Air Jam" — the camera-legible mode where you
// hold up N fingers to play chord N of a real song.
//
// Why this shape (vs. the usual air-guitar sim): a hand sweeping at invisible
// strings is unreadable on video and is strictly worse than a real guitar. Holding
// up 3 fingers and hearing the 3rd chord is instantly legible to a viewer and is a
// thing you CAN'T do with a real guitar. That's the shareable mechanic.
//
// Design choices that matter:
//  • Rotation-invariant finger detection (distance-from-wrist, not tip.y<pip.y) so
//    tilting your hand doesn't scramble the chord.
//  • Stability gating: a shape must hold for N frames before it commits, which
//    removes the flicker you get mid-transition between finger counts.
//  • Slots map to the CURRENT SONG's progression, so "2 fingers = Am" is musical,
//    not an abstract scale degree.
//
// No DOM / audio / camera here, so it is unit-tested headlessly with synthetic
// landmarks (scripts/test-gesture-chord.ts).

export interface Pt { x: number; y: number }

export interface HandInput {
  landmarks: Pt[];              // 21 MediaPipe landmarks, already mirrored
  handedness: 'Left' | 'Right'; // as seen on screen
}

export interface FingerState {
  thumb: boolean; index: boolean; middle: boolean; ring: boolean; pinky: boolean;
}

export interface GestureConfig {
  /** Frames a shape must persist before it commits (kills flicker). */
  commitFrames: number;
  /** Extended if dist(tip,wrist) > dist(pip,wrist) * this. >1 adds hysteresis. */
  extendRatio: number;
  /** Ratio used to release an already-extended finger (lower = sticky, anti-chatter). */
  releaseRatio: number;
  /** Fist-to-open range for the volume mapping, in hand-scale units. */
  openMin: number;
  openMax: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  commitFrames: 3,
  extendRatio: 1.15,
  releaseRatio: 1.02,
  openMin: 1.1,
  openMax: 2.1,
};

const LM = {
  wrist: 0,
  thumbMcp: 2, thumbTip: 4,
  indexMcp: 5, indexPip: 6, indexTip: 8,
  middleMcp: 9, middlePip: 10, middleTip: 12,
  ringPip: 14, ringTip: 16,
  pinkyMcp: 17, pinkyPip: 18, pinkyTip: 20,
} as const;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Wrist→middle-MCP length: a rotation-invariant scale for this hand. */
export const handScale = (lm: Pt[]): number => Math.max(1e-6, dist(lm[LM.wrist], lm[LM.middleMcp]));

/**
 * Which fingers are extended. Uses distance-from-wrist rather than tip.y < pip.y,
 * so it still works when the hand is tilted or rotated. `prev` (if supplied) adds
 * hysteresis: an already-extended finger needs a lower ratio to stay extended.
 */
export const fingerStates = (lm: Pt[], handedness: 'Left' | 'Right', cfg: GestureConfig = DEFAULT_GESTURE_CONFIG, prev?: FingerState): FingerState => {
  const w = lm[LM.wrist];
  const ext = (tip: number, pip: number, was?: boolean) => {
    const ratio = dist(lm[tip], w) / Math.max(1e-6, dist(lm[pip], w));
    return ratio > (was ? cfg.releaseRatio : cfg.extendRatio);
  };
  // Thumb sticks out sideways, so compare against the pinky MCP instead of the wrist.
  const pinkyMcp = lm[LM.pinkyMcp];
  const thumbRatio = dist(lm[LM.thumbTip], pinkyMcp) / Math.max(1e-6, dist(lm[LM.thumbMcp], pinkyMcp));
  void handedness; // distance-based test is handedness-independent
  return {
    thumb: thumbRatio > (prev?.thumb ? 1.02 : 1.12),
    index: ext(LM.indexTip, LM.indexPip, prev?.index),
    middle: ext(LM.middleTip, LM.middlePip, prev?.middle),
    ring: ext(LM.ringTip, LM.ringPip, prev?.ring),
    pinky: ext(LM.pinkyTip, LM.pinkyPip, prev?.pinky),
  };
};

/**
 * Finger shape → chord slot (1-based), or null for "no chord" (closed fist).
 *  1–5 fingers  → slots 1–5 (counted, so any comfortable fingering works)
 *  index+pinky  → slot 6  (🤘 horns — deliberate, memorable, great on camera)
 *  horns+thumb  → slot 7
 */
export const slotFromFingers = (f: FingerState): number | null => {
  const { thumb, index, middle, ring, pinky } = f;
  if (index && pinky && !middle && !ring) return thumb ? 7 : 6;
  const count = [thumb, index, middle, ring, pinky].filter(Boolean).length;
  return count >= 1 && count <= 5 ? count : null;
};

/** Openness 0..1 (fist→open palm): drives volume. Scale-invariant. */
export const openness = (lm: Pt[], cfg: GestureConfig = DEFAULT_GESTURE_CONFIG): number => {
  const w = lm[LM.wrist];
  const s = handScale(lm);
  const tips = [LM.indexTip, LM.middleTip, LM.ringTip, LM.pinkyTip];
  const avg = tips.reduce((acc, t) => acc + dist(lm[t], w) / s, 0) / tips.length;
  const n = (avg - cfg.openMin) / (cfg.openMax - cfg.openMin);
  return Math.max(0, Math.min(1, n));
};

/** Horizontal hand position → tone/filter, -1 (dark) .. +1 (bright). */
export const toneFromX = (lm: Pt[]): number => Math.max(-1, Math.min(1, (lm[LM.wrist].x - 0.5) * 2));

export interface GestureResult {
  /** Committed chord slot (1..7) or null. Stable — only changes after commitFrames. */
  slot: number | null;
  /** True on the frame the committed slot changed (use this to trigger a chord). */
  changed: boolean;
  /** Raw (uncommitted) slot this frame — for responsive UI hints. */
  rawSlot: number | null;
  /** 0..1 progress toward committing rawSlot; drives a "hold to lock" ring. */
  commitProgress: number;
  volume: number;   // 0..1 from the expression hand's openness
  tone: number;     // -1..1 from the expression hand's x position
  chordHandPresent: boolean;
  expressionHandPresent: boolean;
}

/**
 * Stateful wrapper: feeds hands in, emits a debounced chord slot + expression.
 * The chord hand is whichever hand shows a valid shape (defaults to the left);
 * the other hand controls volume/tone. Works one-handed too — the chord hand's
 * own openness then drives volume, so a single hand still makes sound.
 */
export class GestureChordEngine {
  private cfg: GestureConfig;
  private committed: number | null = null;
  private pending: number | null = null;
  private pendingCount = 0;
  private prevFingers = new Map<string, FingerState>();

  constructor(config: Partial<GestureConfig> = {}) {
    this.cfg = { ...DEFAULT_GESTURE_CONFIG, ...config };
  }

  reset(): void {
    this.committed = null;
    this.pending = null;
    this.pendingCount = 0;
    this.prevFingers.clear();
  }

  step(hands: HandInput[]): GestureResult {
    const valid = hands.filter(h => h?.landmarks?.length >= 21);
    if (valid.length === 0) {
      this.pending = null; this.pendingCount = 0;
      const had = this.committed !== null;
      this.committed = null;
      return { slot: null, changed: had, rawSlot: null, commitProgress: 0, volume: 0, tone: 0, chordHandPresent: false, expressionHandPresent: false };
    }

    // Score each hand for "is this making a chord shape?" and pick the best.
    const scored = valid.map(h => {
      const prev = this.prevFingers.get(h.handedness);
      const f = fingerStates(h.landmarks, h.handedness, this.cfg, prev);
      this.prevFingers.set(h.handedness, f);
      return { hand: h, fingers: f, slot: slotFromFingers(f) };
    });

    // Prefer a hand that is actually forming a slot; tie-break to the left hand
    // (natural fretting hand for right-handed players).
    const chordCandidates = scored.filter(s => s.slot !== null);
    const chordHand = chordCandidates.find(s => s.hand.handedness === 'Left')
      ?? chordCandidates[0]
      ?? scored.find(s => s.hand.handedness === 'Left')
      ?? scored[0];
    const other = scored.find(s => s !== chordHand);

    const rawSlot = chordHand.slot;

    // Commit only after the same shape persists — this is what stops the chord
    // flickering while fingers are still moving into position.
    if (rawSlot === this.committed) {
      this.pending = null; this.pendingCount = 0;
    } else if (rawSlot === this.pending) {
      this.pendingCount += 1;
    } else {
      this.pending = rawSlot; this.pendingCount = 1;
    }

    let changed = false;
    if (this.pending !== null && this.pendingCount >= this.cfg.commitFrames) {
      this.committed = this.pending;
      this.pending = null; this.pendingCount = 0;
      changed = true;
    }
    // Releasing to "no chord" (fist / hand gone) commits immediately for a crisp stop.
    if (rawSlot === null && this.committed !== null && this.pendingCount >= Math.min(2, this.cfg.commitFrames)) {
      this.committed = null; this.pending = null; this.pendingCount = 0;
      changed = true;
    }

    const exprHand = other?.hand ?? chordHand.hand;
    return {
      slot: this.committed,
      changed,
      rawSlot,
      commitProgress: this.pending === null ? 0 : Math.min(1, this.pendingCount / this.cfg.commitFrames),
      volume: openness(exprHand.landmarks, this.cfg),
      tone: toneFromX(exprHand.landmarks),
      chordHandPresent: true,
      expressionHandPresent: !!other,
    };
  }
}

/**
 * Map a committed slot to a chord name from the song's progression.
 * Slots beyond the progression wrap, so a 3-chord song still uses all fingers.
 */
export const chordForSlot = (progression: string[], slot: number | null): string | null => {
  if (!slot || progression.length === 0) return null;
  return progression[(slot - 1) % progression.length];
};
