import assert from 'node:assert/strict';
import { StrumDetector } from '../services/airStrumDetector.ts';
import { parseFingerstyleTab } from '../services/tabParser.ts';

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
