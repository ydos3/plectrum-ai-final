import assert from 'node:assert/strict';
import { StrumOnsetEngine, rakeOffsets, DEFAULT_STRUM_ONSET_CONFIG } from '../services/strumOnsetEngine.ts';

const FRAME = 24; // ms — matches the app's ~40fps inference budget
const stringIdx = (x: number) => Math.max(0, Math.min(5, Math.round(((x - 0.1) / 0.8) * 5)));

/** Drive the engine along a path of x positions, one per frame. */
const run = (engine: StrumOnsetEngine, xs: number[], startT = 1000) => {
  const strums: Array<{ frame: number; x: number; direction: string; intensity: number }> = [];
  const picks: number[] = [];
  xs.forEach((x, i) => {
    const r = engine.step(x, startT + i * FRAME, stringIdx);
    if (r.strum) strums.push({ frame: i, x: r.strum.x, direction: r.strum.direction, intensity: r.strum.intensity });
    if (r.pick !== null) picks.push(r.pick);
  });
  return { strums, picks };
};

/** A sweep from a→b over n frames. */
const sweep = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + (b - a) * (i / (n - 1)));
const hold = (x: number, n: number) => Array.from({ length: n }, () => x);

// ── a still hand makes no sound ──
{
  const e = new StrumOnsetEngine();
  const { strums, picks } = run(e, hold(0.5, 30));
  assert.equal(strums.length, 0, 'stationary hand never strums');
  assert.ok(picks.length <= 1, 'stationary hand does not machine-gun picks');
}

// ── camera jitter must not trigger anything ──
{
  const e = new StrumOnsetEngine();
  const jitter = Array.from({ length: 40 }, (_, i) => 0.5 + (i % 2 === 0 ? 0.004 : -0.004));
  const { strums } = run(e, jitter);
  assert.equal(strums.length, 0, 'landmark jitter never fires a strum');
}

// ── one fast sweep = exactly ONE rake (not six pluck events, not repeats) ──
{
  const e = new StrumOnsetEngine();
  const { strums } = run(e, [...hold(0.12, 3), ...sweep(0.12, 0.88, 10), ...hold(0.88, 6)]);
  assert.equal(strums.length, 1, `one physical sweep → exactly one rake (got ${strums.length})`);
  assert.equal(strums[0].direction, 'D', 'left→right is a downstroke');
}

// ── THE latency win: the rake fires EARLY, while the hand is still accelerating ──
{
  const e = new StrumOnsetEngine();
  const path = [...hold(0.12, 3), ...sweep(0.12, 0.88, 10), ...hold(0.88, 4)];
  const { strums } = run(e, path);
  assert.equal(strums.length, 1, 'fired once');
  // Crossing-detection would only fire once the hand reached each string; onset
  // detection fires in the first part of the motion instead.
  assert.ok(strums[0].x < 0.5, `strum fires in the first half of the sweep (x=${strums[0].x.toFixed(2)}) — ahead of the crossings`);
  assert.ok(strums[0].frame <= 7, `fires within a couple of frames of motion start (frame ${strums[0].frame})`);
}

// ── direction is detected correctly both ways ──
{
  const e = new StrumOnsetEngine();
  const { strums } = run(e, [...hold(0.88, 3), ...sweep(0.88, 0.12, 10), ...hold(0.12, 4)]);
  assert.equal(strums.length, 1, 'one upstroke');
  assert.equal(strums[0].direction, 'U', 'right→left is an upstroke');
}

// ── two separate strums fire twice; hysteresis prevents mid-sweep retriggering ──
{
  const e = new StrumOnsetEngine();
  const path = [
    ...hold(0.12, 3), ...sweep(0.12, 0.88, 8), ...hold(0.88, 8),   // strum 1 + settle
    ...sweep(0.88, 0.12, 8), ...hold(0.12, 5),                      // strum 2 (back)
  ];
  const { strums } = run(e, path);
  assert.equal(strums.length, 2, `two deliberate sweeps → two rakes (got ${strums.length})`);
  assert.equal(strums[0].direction, 'D', 'first is down');
  assert.equal(strums[1].direction, 'U', 'second is up');
}

// ── REAL strumming: continuous D-U-D-U where the hand never stops ──
// This is how people actually strum. The hand reverses without resting, so the
// engine must treat each direction change as a new stroke.
{
  const e = new StrumOnsetEngine();
  const path: number[] = [...hold(0.2, 3)];
  for (let i = 0; i < 4; i++) {
    path.push(...sweep(0.2, 0.8, 6));  // down
    path.push(...sweep(0.8, 0.2, 6));  // up
  }
  const { strums } = run(e, path);
  assert.ok(strums.length >= 7, `continuous alternating strumming fires per stroke (got ${strums.length} of 8)`);
  // Directions must alternate, not repeat.
  let alternations = 0;
  for (let i = 1; i < strums.length; i++) if (strums[i].direction !== strums[i - 1].direction) alternations++;
  assert.ok(alternations >= strums.length - 2, 'strokes alternate D/U as the hand reverses');
}

// ── a single LONG sweep still only fires once ──
{
  const e = new StrumOnsetEngine();
  const { strums } = run(e, [...hold(0.05, 3), ...sweep(0.05, 0.95, 30), ...hold(0.95, 5)]);
  assert.equal(strums.length, 1, 'one long continuous sweep is still a single rake');
}

// ── harder strum = higher intensity ──
{
  const soft = new StrumOnsetEngine();
  const hard = new StrumOnsetEngine();
  const s = run(soft, [...hold(0.2, 3), ...sweep(0.2, 0.8, 16), ...hold(0.8, 4)]); // slower
  const h = run(hard, [...hold(0.2, 3), ...sweep(0.2, 0.8, 5), ...hold(0.8, 4)]);  // faster
  assert.ok(s.strums.length === 1 && h.strums.length === 1, 'both sweeps registered');
  assert.ok(h.strums[0].intensity > s.strums[0].intensity, `faster sweep is louder (${h.strums[0].intensity.toFixed(2)} > ${s.strums[0].intensity.toFixed(2)})`);
  assert.ok(h.strums[0].intensity <= 1 && s.strums[0].intensity >= 0, 'intensity stays within 0..1');
}

// ── slow deliberate motion picks individual strings instead of raking ──
{
  const e = new StrumOnsetEngine();
  // Deliberately dragging across the strings: 0.73 width over ~1.9s ≈ 0.38/s.
  const { strums, picks } = run(e, sweep(0.12, 0.85, 80));
  assert.equal(strums.length, 0, 'slow motion does not trigger a full rake');
  assert.ok(picks.length >= 3, `slow motion picks individual strings (got ${picks.length})`);
  assert.deepEqual(picks, [...picks].sort((a, b) => a - b), 'picked strings ascend with the hand');
}

// ── hand leaving the frame resets cleanly ──
{
  const e = new StrumOnsetEngine();
  run(e, [...hold(0.12, 3), ...sweep(0.12, 0.88, 8)]);
  const gone = e.step(null, 99999, stringIdx);
  assert.equal(gone.strum, null, 'no strum when the hand disappears');
  assert.equal(gone.handPresent, false, 'hand reported absent');
  // Re-entering and sweeping works immediately afterwards.
  const after = run(e, [...hold(0.12, 3), ...sweep(0.12, 0.88, 8)], 200000);
  assert.equal(after.strums.length, 1, 'a new sweep after re-entry fires normally');
}

// ── rake shaping: a real strum is a cascade, harder = tighter ──
{
  const soft = rakeOffsets(0.1, 6, 'D');
  const hard = rakeOffsets(1.0, 6, 'D');
  assert.equal(soft.length, 6, 'one offset per string');
  assert.equal(soft[0], 0, 'first string fires immediately');
  assert.ok(soft[5] > hard[5], `soft strum spreads wider than a hard one (${soft[5]}ms > ${hard[5]}ms)`);
  assert.ok(hard[5] <= 60, 'even a soft rake completes fast enough to read as one chord');
  const up = rakeOffsets(0.5, 6, 'U');
  assert.ok(up[0] > up[5], 'upstroke reverses the cascade order');
}

// ── config is honoured (so the UI can expose a sensitivity slider) ──
{
  const sensitive = new StrumOnsetEngine({ onThreshold: 0.35 });
  const gentle = [...hold(0.3, 3), ...sweep(0.3, 0.62, 10), ...hold(0.62, 4)]; // soft flick
  const { strums } = run(sensitive, gentle);
  assert.ok(strums.length >= 1, 'a lower threshold detects gentler strums');
  const strict = new StrumOnsetEngine({ onThreshold: 2.5 });
  assert.equal(run(strict, gentle).strums.length, 0, 'a higher threshold ignores the same gentle motion');
  assert.ok(DEFAULT_STRUM_ONSET_CONFIG.offThreshold < DEFAULT_STRUM_ONSET_CONFIG.onThreshold, 'defaults keep on/off hysteresis');
}

console.log('strum-onset tests passed');
