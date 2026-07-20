import assert from 'node:assert/strict';
import { StrumDetector, stringIndexFromX, chordIndexFromX, resolvePluckNote } from '../services/airStrumDetector.ts';
import { StrumEngine } from '../services/airStrumEngine.ts';
import { parseFingerstyleTab } from '../services/tabParser.ts';

// ─── Simulated hand gestures through the real engine ─────────────────────────
// This drives the exact logic Air Strum uses, with synthetic hand positions, so
// recognition is verified without a camera.
{
  const STRUM_Y = 0.7; // lower zone
  const NOTE_Y = 0.2;  // upper zone

  // A left→right sweep across the whole string band should pluck all 6 strings in order.
  {
    const e = new StrumEngine();
    const played: number[] = [];
    let t = 0;
    // Sweep x from 0.05 → 0.95 over ~20 frames (33ms each).
    for (let i = 0; i <= 20; i++) {
      const x = 0.05 + (0.90 * i) / 20;
      const r = e.step([{ x, y: STRUM_Y }], (t += 33));
      played.push(...r.pluck);
    }
    assert.deepEqual(played, [0, 1, 2, 3, 4, 5], `full sweep plays every string in order (got ${played})`);
  }

  // A right→left sweep plays them in reverse.
  {
    const e = new StrumEngine();
    const played: number[] = [];
    let t = 0;
    for (let i = 0; i <= 20; i++) {
      const x = 0.95 - (0.90 * i) / 20;
      const r = e.step([{ x, y: STRUM_Y }], (t += 33));
      played.push(...r.pluck);
    }
    assert.deepEqual(played, [5, 4, 3, 2, 1, 0], `reverse sweep plays every string (got ${played})`);
  }

  // A still (slightly jittering) hand must NOT play anything.
  {
    const e = new StrumEngine();
    const played: number[] = [];
    let t = 0;
    for (let i = 0; i < 30; i++) {
      const x = 0.5 + (i % 2 === 0 ? 0.004 : -0.004); // tiny jitter around a boundary
      const r = e.step([{ x, y: STRUM_Y }], (t += 33));
      played.push(...r.pluck);
    }
    assert.equal(played.length, 0, `still/jittering hand plays nothing (got ${played})`);
  }

  // Waving back-and-forth over ONE string re-plucks that string repeatedly
  // (a real guitar lets you rake one string over and over — this was the bug
  // where holding on one string took "5 seconds" to sound).
  {
    const e = new StrumEngine();
    const played: number[] = [];
    let t = 0;
    e.step([{ x: 0.58, y: STRUM_Y }], (t += 33)); // arm on string 3
    const targets = [0.52, 0.52, 0.64, 0.64, 0.52, 0.52, 0.64, 0.64]; // oscillate within string 3's band
    for (const x of targets) {
      const r = e.step([{ x, y: STRUM_Y }], (t += 60));
      played.push(...r.pluck);
    }
    assert.ok(played.length >= 3, `waving over one string re-plucks it repeatedly (got ${played})`);
    assert.ok(played.every(s => s === 3), `all re-plucks stay on the waved string (got ${played})`);
  }

  // Entering the frame over a string does NOT auto-play (fixes "one tune on load").
  {
    const e = new StrumEngine();
    const r = e.step([{ x: 0.42, y: STRUM_Y }], 33);
    assert.equal(r.pluck.length, 0, 'entering the frame does not auto-pluck');
  }

  // A fast sweep that skips (0.10 → 0.90 in one jump) still plucks every string it passed.
  {
    const e = new StrumEngine();
    e.step([{ x: 0.10, y: STRUM_Y }], 33);          // arm at string 0
    const r = e.step([{ x: 0.90, y: STRUM_Y }], 66); // jump to string 5
    // smoothing pulls the jump toward the middle, but it must cross multiple strings
    assert.ok(r.pluck.length >= 2, `fast sweep crosses multiple strings (got ${r.pluck})`);
    assert.ok(r.pluck[0] < r.pluck[r.pluck.length - 1], 'crossed strings are in ascending order');
  }

  // Pointing at a chord (upper zone) and holding commits that chord after the dwell.
  {
    const e = new StrumEngine();
    let t = 0;
    let selected: number | null = null;
    for (let i = 0; i < 15; i++) {
      const r = e.step([{ x: 1.0, y: NOTE_Y }], (t += 33)); // far right → last chord (index 5)
      if (r.selectChord !== null) selected = r.selectChord;
    }
    assert.equal(selected, 5, `point-and-hold on the right selects the last chord (got ${selected})`);
  }

  // Two hands: upper picks a chord, lower strums — independently.
  {
    const e = new StrumEngine();
    let t = 0;
    let selected: number | null = null;
    const played: number[] = [];
    for (let i = 0; i <= 12; i++) {
      const strumX = 0.05 + (0.90 * i) / 12;
      const r = e.step([{ x: 0.0, y: NOTE_Y }, { x: strumX, y: STRUM_Y }], (t += 33));
      if (r.selectChord !== null) selected = r.selectChord;
      played.push(...r.pluck);
    }
    assert.equal(selected, 0, 'left-pointed hand selects the first chord');
    assert.ok(played.length >= 4, `strum hand still plays while the other picks a chord (got ${played})`);
  }
}

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

// ─── Parenthetical annotations must not break tab loading ────────────────────
// The user's tab carries "(CHORD SHAPE: A3-D2-G2)" / "(Chord to A3, D1, G2)"
// annotation lines and inline "Slap(playing the d and g string)" notes. Loading
// it should behave EXACTLY like the hand-cleaned version (annotations removed),
// so they never have to edit it by hand.
{
  const original = `E3/B0-Slap-E3-B3-Slap-E3/B0-Slap-E3/B3-Hammer-B5-Pulloff-B0-Slap-E3

E2/B0-Slap-E2-B3-Slap-E2/G2-Slap-E2-B3-B0-Slap-E2/B0

(CHORD SHAPE: A3-D2-G2)

A3/D2/G2-G0-Slap(playing the d and g string)-A3-G0-G2-Slap-A3/B0

Slap-A3-B3-B0-Slap-B0

(Chord to A3, D1, G2)

A3-D1-G2-G2-Slap-A3/B3-B3-Slap-A3/B0-Slap-A3-G2-G0-Slap`;

  const handCleaned = `E3/B0-Slap-E3-B3-Slap-E3/B0-Slap-E3/B3-Hammer-B5-Pulloff-B0-Slap-E3

E2/B0-Slap-E2-B3-Slap-E2/G2-Slap-E2-B3-B0-Slap-E2/B0

A3/D2/G2-G0-Slap-A3-G0-G2-Slap-A3/B0

Slap-A3-B3-B0-Slap-B0

A3-D1-G2-G2-Slap-A3/B3-B3-Slap-A3/B0-Slap-A3-G2-G0-Slap`;

  const parsedOriginal = parseFingerstyleTab(original);
  const parsedClean = parseFingerstyleTab(handCleaned);
  assert.deepEqual(parsedOriginal, parsedClean, 'annotated tab parses identically to the hand-cleaned one');
  assert.ok(parsedOriginal.length > 20, `annotated tab yields a full sequence (got ${parsedOriginal.length})`);
  assert.ok(parsedOriginal.some(f => f.percussion === 'slap'), 'slaps survive (incl. the inline "Slap(...)" ones)');
  // No phantom notes leaked from the "(CHORD SHAPE: A3-D2-G2)" annotation: every
  // note is a valid string/fret (that was always true, but confirm no crash/NaN).
  for (const f of parsedOriginal) for (const n of f.notes) {
    assert.ok(n.string >= 0 && n.string <= 5 && n.fret >= 0, 'valid note');
  }
}

console.log('air-strum + channa demo tests passed');
