import assert from 'node:assert/strict';
import {
  GestureChordEngine, fingerStates, slotFromFingers, openness, toneFromX, chordForSlot,
  type Pt, type HandInput,
} from '../services/gestureChordEngine.ts';

// ── Synthetic hand builder ───────────────────────────────────────────────────
// Upright hand: wrist at bottom (y=0.9), fingers pointing up (smaller y).
// Extended tips sit farther from the wrist than their PIP; curled tips sit nearer.
type Fingers = { thumb?: boolean; index?: boolean; middle?: boolean; ring?: boolean; pinky?: boolean };

const hand = (f: Fingers, offsetX = 0, handedness: 'Left' | 'Right' = 'Left'): HandInput => {
  const p = (x: number, y: number): Pt => ({ x: x + offsetX, y });
  const lm: Pt[] = new Array(21).fill(null).map(() => p(0.5, 0.8));
  lm[0]  = p(0.50, 0.90);                                   // wrist
  lm[1]  = p(0.44, 0.85);                                   // thumb CMC
  lm[2]  = p(0.40, 0.80);                                   // thumb MCP
  lm[3]  = p(0.36, 0.78);                                   // thumb IP
  lm[4]  = f.thumb  ? p(0.30, 0.75) : p(0.45, 0.76);        // thumb TIP
  lm[5]  = p(0.44, 0.72);                                   // index MCP
  lm[6]  = p(0.43, 0.65);                                   // index PIP
  lm[7]  = p(0.42, 0.60);
  lm[8]  = f.index  ? p(0.42, 0.55) : p(0.44, 0.70);        // index TIP
  lm[9]  = p(0.50, 0.70);                                   // middle MCP
  lm[10] = p(0.50, 0.63);                                   // middle PIP
  lm[11] = p(0.50, 0.57);
  lm[12] = f.middle ? p(0.50, 0.52) : p(0.50, 0.68);        // middle TIP
  lm[13] = p(0.56, 0.72);                                   // ring MCP
  lm[14] = p(0.57, 0.65);                                   // ring PIP
  lm[15] = p(0.58, 0.60);
  lm[16] = f.ring   ? p(0.58, 0.55) : p(0.56, 0.69);        // ring TIP
  lm[17] = p(0.63, 0.73);                                   // pinky MCP
  lm[18] = p(0.64, 0.68);                                   // pinky PIP
  lm[19] = p(0.65, 0.64);
  lm[20] = f.pinky  ? p(0.65, 0.60) : p(0.63, 0.72);        // pinky TIP
  return { landmarks: lm, handedness };
};

const ALL = { thumb: true, index: true, middle: true, ring: true, pinky: true };
const FIST = {};

// ── finger detection ──
{
  const open = fingerStates(hand(ALL).landmarks, 'Left');
  assert.deepEqual(open, { thumb: true, index: true, middle: true, ring: true, pinky: true }, 'open palm → all fingers extended');

  const fist = fingerStates(hand(FIST).landmarks, 'Left');
  assert.deepEqual(fist, { thumb: false, index: false, middle: false, ring: false, pinky: false }, 'fist → no fingers extended');

  const two = fingerStates(hand({ index: true, middle: true }).landmarks, 'Left');
  assert.ok(two.index && two.middle && !two.ring && !two.pinky && !two.thumb, 'peace sign → exactly index+middle');
}

// ── rotation invariance (the thing tip.y<pip.y gets wrong) ──
{
  // Rotate the whole hand 90° about its wrist: fingers now point sideways, so a
  // naive tip.y < pip.y test would fail, but distance-from-wrist still works.
  const src = hand({ index: true, middle: true });
  const w = src.landmarks[0];
  const rotated = {
    ...src,
    landmarks: src.landmarks.map(p => ({
      x: w.x + (p.y - w.y),   // (dx,dy) → (dy,-dx)
      y: w.y - (p.x - w.x),
    })),
  };
  const f = fingerStates(rotated.landmarks, 'Left');
  assert.equal(slotFromFingers(f), 2, 'tilted hand still reads 2 fingers (rotation-invariant)');
}

// ── slot mapping ──
{
  assert.equal(slotFromFingers({ thumb: false, index: true, middle: false, ring: false, pinky: false }), 1, '1 finger → slot 1');
  assert.equal(slotFromFingers({ thumb: false, index: true, middle: true, ring: false, pinky: false }), 2, '2 fingers → slot 2');
  assert.equal(slotFromFingers({ thumb: false, index: true, middle: true, ring: true, pinky: false }), 3, '3 fingers → slot 3');
  assert.equal(slotFromFingers({ thumb: false, index: true, middle: true, ring: true, pinky: true }), 4, '4 fingers → slot 4');
  assert.equal(slotFromFingers({ thumb: true, index: true, middle: true, ring: true, pinky: true }), 5, 'open palm → slot 5');
  assert.equal(slotFromFingers({ thumb: false, index: true, middle: false, ring: false, pinky: true }), 6, 'horns → slot 6');
  assert.equal(slotFromFingers({ thumb: true, index: true, middle: false, ring: false, pinky: true }), 7, 'horns+thumb → slot 7');
  assert.equal(slotFromFingers({ thumb: false, index: false, middle: false, ring: false, pinky: false }), null, 'fist → no chord');
}

// ── stability gating: commits only after the shape is held ──
{
  const e = new GestureChordEngine({ commitFrames: 3 });
  const two = [hand({ index: true, middle: true })];
  const r1 = e.step(two); assert.equal(r1.slot, null, 'frame 1: not committed yet');
  const r2 = e.step(two); assert.equal(r2.slot, null, 'frame 2: still pending');
  assert.ok(r2.commitProgress > 0 && r2.commitProgress < 1, 'commit progress ramps for the UI ring');
  const r3 = e.step(two);
  assert.equal(r3.slot, 2, 'frame 3: commits slot 2');
  assert.equal(r3.changed, true, 'changed fires exactly on commit');
  const r4 = e.step(two);
  assert.equal(r4.changed, false, 'holding does not re-fire changed');
  assert.equal(r4.slot, 2, 'slot stays committed while held');
}

// ── flicker rejection: alternating shapes must never commit ──
{
  const e = new GestureChordEngine({ commitFrames: 3 });
  const a = [hand({ index: true })];
  const b = [hand({ index: true, middle: true, ring: true })];
  let commits = 0;
  for (let i = 0; i < 12; i++) {
    const r = e.step(i % 2 === 0 ? a : b);
    if (r.changed) commits += 1;
  }
  assert.equal(commits, 0, 'rapid alternating shapes never commit a chord (no flicker)');
}

// ── expression: openness → volume, x → tone ──
{
  const openVol = openness(hand(ALL).landmarks);
  const fistVol = openness(hand(FIST).landmarks);
  assert.ok(openVol > 0.5, `open palm is loud (got ${openVol.toFixed(2)})`);
  assert.ok(fistVol < 0.1, `fist is silent (got ${fistVol.toFixed(2)})`);
  assert.ok(openVol > fistVol, 'opening the hand increases volume');

  assert.ok(toneFromX(hand(ALL, -0.3).landmarks) < -0.4, 'hand at left → dark tone');
  assert.ok(toneFromX(hand(ALL, +0.3).landmarks) > 0.4, 'hand at right → bright tone');
}

// ── two hands: one plays chords, the other controls expression ──
{
  const e = new GestureChordEngine({ commitFrames: 2 });
  const chordHand = hand({ index: true, middle: true }, 0, 'Left');
  const exprOpen = hand(ALL, 0.25, 'Right');
  let r = e.step([chordHand, exprOpen]);
  r = e.step([chordHand, exprOpen]);
  assert.equal(r.slot, 2, 'left hand sets the chord');
  assert.equal(r.expressionHandPresent, true, 'right hand detected as expression hand');
  assert.ok(r.volume > 0.4, 'volume comes from the OPEN right hand, not the 2-finger chord hand');
  assert.ok(r.tone > 0.3, 'tone follows the right hand position');
}

// ── hands gone → chord releases ──
{
  const e = new GestureChordEngine({ commitFrames: 2 });
  const two = [hand({ index: true, middle: true })];
  e.step(two); e.step(two);
  const gone = e.step([]);
  assert.equal(gone.slot, null, 'no hands → chord released');
  assert.equal(gone.changed, true, 'release is reported so audio can stop');
  assert.equal(gone.volume, 0, 'no hands → silent');
}

// ── slot → real song chord (the bit that makes it musical) ──
{
  const prog = ['Am', 'F', 'C', 'G'];
  assert.equal(chordForSlot(prog, 1), 'Am', 'slot 1 → first chord of the song');
  assert.equal(chordForSlot(prog, 4), 'G', 'slot 4 → fourth chord');
  assert.equal(chordForSlot(prog, 5), 'Am', 'slots wrap so every finger plays something');
  assert.equal(chordForSlot(prog, null), null, 'no slot → no chord');
  assert.equal(chordForSlot([], 3), null, 'empty progression → no chord');
}

console.log('gesture-chord tests passed');
