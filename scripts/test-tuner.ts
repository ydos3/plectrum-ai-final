import assert from 'node:assert/strict';
import {
  detectPitchYIN, TUNINGS, centsOffFromPitch, findNearestGuitarString, getNoteFromFrequency,
  assessTuningSafety, tensionRatio, AMBIGUOUS_MATCH_CENTS,
} from '../services/tunerService.ts';

// SAFETY-CRITICAL: people tune real instruments with this. A wrong reading can make
// someone over-tighten and snap a string (tension rises with the SQUARE of pitch).
// These tests use synthetic tones so accuracy is verifiable without a microphone.

const SR = 44100, N = 8192;

/**
 * A plucked-guitar tone. Real strings have a WEAK fundamental relative to
 * harmonics 2-4 — the classic trap that makes naive detectors report an octave
 * too high, which would tell a player to tune DOWN an octave (or up).
 */
const guitarTone = (
  f0: number,
  { amps = [0.3, 1.0, 0.7, 0.5, 0.3, 0.2], noise = 0, decay = 0, gain = 0.25, n = N, sr = SR } = {},
): Float32Array => {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    amps.forEach((a, k) => { v += a * Math.sin(2 * Math.PI * f0 * (k + 1) * t); });
    const env = decay ? Math.exp(-decay * t) : 1;
    buf[i] = (v * env + (noise ? (Math.random() * 2 - 1) * noise : 0)) * gain;
  }
  return buf;
};

const errCents = (detected: number | null, target: number) => {
  assert.ok(detected !== null, `expected a pitch near ${target}Hz, got null`);
  return centsOffFromPitch(detected as number, target);
};

// ── every standard string detected to within 1 cent ──
{
  TUNINGS.Standard.frequencies.forEach((f, i) => {
    const name = TUNINGS.Standard.notes[i];
    const pure = errCents(detectPitchYIN(guitarTone(f, { amps: [1] }), SR), f);
    assert.ok(Math.abs(pure) < 1, `${name} pure sine within 1 cent (got ${pure.toFixed(2)})`);

    const real = errCents(detectPitchYIN(guitarTone(f), SR), f);
    assert.ok(Math.abs(real) < 1, `${name} realistic tone within 1 cent (got ${real.toFixed(2)})`);
    // Explicitly assert NO octave error — the dangerous failure mode.
    assert.ok(Math.abs(real) < 600, `${name} must not be an octave out (got ${real.toFixed(1)} cents)`);
  });
}

// ── alternate tunings resolve too (Drop D / Bass low strings) ──
{
  [TUNINGS['Drop D'], TUNINGS['Bass Standard']].forEach(tuning => {
    tuning.frequencies.forEach((f, i) => {
      if (f < 65) return; // below the detector's supported range; asserted separately
      const e = errCents(detectPitchYIN(guitarTone(f), SR), f);
      assert.ok(Math.abs(e) < 2, `${tuning.name} ${tuning.notes[i]} within 2 cents (got ${e.toFixed(2)})`);
    });
  });
}

// ── robust to real-world conditions on the hardest (lowest) string ──
{
  const f = 82.41;
  assert.ok(Math.abs(errCents(detectPitchYIN(guitarTone(f, { noise: 0.10 }), SR), f)) < 5, 'low E survives 10% noise');
  assert.ok(Math.abs(errCents(detectPitchYIN(guitarTone(f, { noise: 0.30 }), SR), f)) < 10, 'low E survives 30% noise');
  assert.ok(Math.abs(errCents(detectPitchYIN(guitarTone(f, { decay: 3 }), SR), f)) < 5, 'low E survives a plucked decay envelope');
  assert.ok(Math.abs(errCents(detectPitchYIN(guitarTone(f, { gain: 0.03 }), SR), f)) < 5, 'low E detected when played quietly');
}

// ── must stay silent rather than guess ──
{
  assert.equal(detectPitchYIN(new Float32Array(N), SR), null, 'silence returns null (no phantom reading)');
  assert.equal(detectPitchYIN(guitarTone(0, { amps: [0], noise: 1 }), SR), null, 'pure noise returns null');
  const tooQuiet = guitarTone(110, { gain: 0.001 });
  assert.equal(detectPitchYIN(tooQuiet, SR), null, 'below the noise gate returns null');
}

// ── cents readout is accurate across the usable detune range ──
{
  for (const trueCents of [-50, -30, -10, 0, 10, 30, 50]) {
    const f = 82.41 * Math.pow(2, trueCents / 1200);
    const detected = detectPitchYIN(guitarTone(f), SR);
    const r = getNoteFromFrequency(detected as number, TUNINGS.Standard, 'E2');
    assert.ok(Math.abs(r.cents - trueCents) <= 1, `detuned ${trueCents}c reads ${r.cents}c (±1)`);
    assert.equal(r.targetNote, 'E2', 'locked string stays the target');
    if (trueCents === 0) assert.ok(r.isInTune, '0 cents is reported in tune');
    if (Math.abs(trueCents) >= 30) assert.ok(!r.isInTune, `${trueCents}c is NOT reported in tune`);
    if (trueCents < -5) assert.equal(r.status, 'flat', 'negative cents = flat');
    if (trueCents > 5) assert.equal(r.status, 'sharp', 'positive cents = sharp');
  }
}

// ── SAFETY: a pitch between two strings must be flagged ambiguous, not asserted ──
{
  // 100 Hz sits between E2 (82.41) and A2 (110). Auto-matching it to A2 and saying
  // "tune up" is exactly how a low E gets tightened a 4th too far.
  const m = findNearestGuitarString(100, TUNINGS.Standard);
  assert.equal(m.note, 'A2', 'nearest string is still reported');
  assert.ok(m.ambiguous, '100Hz between E2 and A2 is flagged ambiguous');

  const safety = assessTuningSafety(100, m.frequency);
  assert.ok(safety.risky, 'raising 100Hz to A2 is flagged risky');
  assert.ok(safety.tension > 1.15, `tension increase is material (${safety.tension.toFixed(2)}x)`);

  // Same trap on other strings.
  assert.ok(findNearestGuitarString(130, TUNINGS.Standard).ambiguous, '130Hz (between A2/D3) is ambiguous');
  assert.ok(findNearestGuitarString(300, TUNINGS.Standard).ambiguous, '300Hz (between B3/E4) is ambiguous');
}

// ── SAFETY: a genuinely in-tune-ish string is NOT flagged ──
{
  TUNINGS.Standard.frequencies.forEach((f, i) => {
    const slightlyOff = f * Math.pow(2, 25 / 1200); // 25 cents sharp
    const m = findNearestGuitarString(slightlyOff, TUNINGS.Standard);
    assert.equal(m.note, TUNINGS.Standard.notes[i], 'a nearly-tuned string matches itself');
    assert.ok(!m.ambiguous, `${m.note} 25c off is a confident match, not ambiguous`);
    assert.ok(!assessTuningSafety(slightlyOff, m.frequency).risky, 'small correction is not risky');
  });
}

// ── SAFETY: manual string lock is always confident (the recommended mode) ──
{
  const m = findNearestGuitarString(100, TUNINGS.Standard, 'E2');
  assert.equal(m.note, 'E2', 'manual lock overrides auto-matching');
  assert.ok(!m.ambiguous, 'a user-chosen string is never ambiguous');
  assert.ok(m.cents > 0, 'a low E at 100Hz reads sharp, so the player loosens — safe');
}

// ── physics sanity: tension really does scale with frequency squared ──
{
  assert.ok(Math.abs(tensionRatio(100, 200) - 4) < 1e-9, 'doubling pitch quadruples tension');
  assert.ok(Math.abs(tensionRatio(110, 110) - 1) < 1e-9, 'no change = no added tension');
  assert.ok(tensionRatio(110, 100) < 1, 'loosening reduces tension');
  assert.ok(AMBIGUOUS_MATCH_CENTS <= 250, 'ambiguity guard is tighter than half the gap between strings');
}

console.log('tuner tests passed');
