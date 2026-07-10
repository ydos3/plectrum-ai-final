import assert from 'node:assert/strict';
import { StrumDetector, stringIndexFromX, chordIndexFromX, resolvePluckNote } from '../services/airStrumDetector.ts';
import { parseFingerstyleTab } from '../services/tabParser.ts';

// ─── Hand-position → string / chord mapping ──────────────────────────────────
{
  // 6 strings centred at x = 0.10, 0.26, 0.42, 0.58, 0.74, 0.90.
  assert.equal(stringIndexFromX(0.10), 0, 'low E at left edge');
  assert.equal(stringIndexFromX(0.26), 1, 'A');
  assert.equal(stringIndexFromX(0.42), 2, 'D');
  assert.equal(stringIndexFromX(0.58), 3, 'G');
  assert.equal(stringIndexFromX(0.74), 4, 'B string reachable');
  assert.equal(stringIndexFromX(0.90), 5, 'high e reachable');
  // Edge tolerance: a hand slightly short of / past the band still hits the outer strings.
  assert.equal(stringIndexFromX(0.06), 0, 'just left of band → low E');
  assert.equal(stringIndexFromX(0.95), 5, 'just right of band → high e');

  // 6 chord chips spread 0..1.
  assert.equal(chordIndexFromX(0.0, 6), 0, 'first chord');
  assert.equal(chordIndexFromX(0.6, 6), 3, 'fourth chord (G in Bollywood set)');
  assert.equal(chordIndexFromX(1.0, 6), 5, 'last chord');
}

// ─── Muted string → nearest sounding chord tone (every string must sound) ────
{
  // Am = [-1, 0, 2, 2, 1, 0]: low E is muted → falls back to open A (idx 1).
  const am = [-1, 0, 2, 2, 1, 0];
  assert.deepEqual(resolvePluckNote(am, 0), { playIdx: 1, fret: 0 }, 'Am low-E → open A');
  assert.deepEqual(resolvePluckNote(am, 1), { playIdx: 1, fret: 0 }, 'Am A plays itself');

  // D = [-1, -1, 0, 2, 3, 2]: both low E and A muted → nearest sounding is D (idx 2).
  const d = [-1, -1, 0, 2, 3, 2];
  assert.deepEqual(resolvePluckNote(d, 0), { playIdx: 2, fret: 0 }, 'D low-E → D string');
  assert.deepEqual(resolvePluckNote(d, 1), { playIdx: 2, fret: 0 }, 'D A → D string');
  // Every string index now resolves to an audible note.
  for (let i = 0; i < 6; i++) assert.ok(resolvePluckNote(d, i) !== null, `D string ${i} sounds`);
}

// ─── Strum detector ────────────────────────────────────────────────────────

// A left→right sweep is a downstroke.
{
  const d = new StrumDetector();
  assert.equal(d.push({ centroidX: 0.2, magnitude: 0.1, time: 0 }), null, 'first sample primes history');
  const ev = d.push({ centroidX: 0.6, magnitude: 0.1, time: 100 });
  assert.ok(ev, 'moving sweep produces an event');
  assert.equal(ev!.direction, 'down', 'left→right = downstroke');
}

// A right→left sweep is an upstroke.
{
  const d = new StrumDetector();
  d.push({ centroidX: 0.8, magnitude: 0.1, time: 0 });
  const ev = d.push({ centroidX: 0.3, magnitude: 0.1, time: 120 });
  assert.ok(ev && ev.direction === 'up', 'right→left = upstroke');
}

// Debounce prevents a second strum firing too soon (no false doubles).
{
  const d = new StrumDetector({ debounceMs: 160 });
  d.push({ centroidX: 0.2, magnitude: 0.1, time: 0 });
  const first = d.push({ centroidX: 0.7, magnitude: 0.1, time: 100 });
  assert.ok(first, 'first strum fires');
  const tooSoon = d.push({ centroidX: 0.2, magnitude: 0.1, time: 180 });
  assert.equal(tooSoon, null, 'second strum inside debounce window is suppressed');
  const later = d.push({ centroidX: 0.8, magnitude: 0.1, time: 400 });
  assert.ok(later, 'strum after debounce window fires again');
}

// Below the motion threshold nothing fires and history resets.
{
  const d = new StrumDetector();
  assert.equal(d.push({ centroidX: 0.2, magnitude: 0.001, time: 0 }), null, 'no motion → no strum');
  assert.equal(d.push({ centroidX: 0.9, magnitude: 0.001, time: 100 }), null, 'still no motion → no strum');
}

// ─── Channa Mereya fingerstyle demo tab ──────────────────────────────────────

const CHANNA_TAB = 'A0-e0-B1-G2-B1-e0-E0-e0-B0-G0-B0-e0-D3-e0-B1-G2-B1-e0-A3-e0-B1-G0-B1-e0-E3-e3-B0-G0-B0-e3-A0-e0-B1-G2-B1-e0-e0-h-e2-B1-s-B3-B3-p-B1-G0-E0/G1/B0/e0-e0-B0-G1-A0/G2/B1/e0-e0-B1-G2-D3/G2/B1/e0-e0-B1-G2-A3/G0/B1/e0-e0-B1-G0-slap-A0-e0';

{
  const frames = parseFingerstyleTab(CHANNA_TAB);
  assert.ok(frames.length > 30, `Channa tab yields a substantial sequence (got ${frames.length})`);

  // Every note must reference a valid string (0..5) and a non-negative fret.
  for (const frame of frames) {
    for (const note of frame.notes) {
      assert.ok(note.string >= 0 && note.string <= 5, `valid string index ${note.string}`);
      assert.ok(note.fret >= 0, `valid fret ${note.fret}`);
    }
  }

  // The demo shows off techniques + percussion.
  const hasChord = frames.some(f => f.notes.length > 1);
  const hasTechnique = frames.some(f => f.notes.some(n => n.technique && n.technique !== 'normal'));
  const hasSlap = frames.some(f => f.percussion === 'slap');
  assert.ok(hasChord, 'includes simultaneous chord stabs');
  assert.ok(hasTechnique, 'includes hammer-on/slide/pull-off techniques');
  assert.ok(hasSlap, 'includes a percussive slap');
}

console.log('air-strum + channa demo tests passed');
