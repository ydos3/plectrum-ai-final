import assert from 'node:assert/strict';
import { buildSingAlongScore, chordForSlotInScore, chordSequence, MAX_SLOTS } from '../services/singAlongScore.ts';

const SONG = `### [Verse 1]
Heart beats fast [G]
Colors and pro[Em7]mises
How can I love when I'm [G] afraid to [D] fall

### [Chorus]
[G] I have died every day [D] waiting for you
[Em7] Darling don't be afraid I have [D] loved you
For a [Cadd9] thousand years`;

// ── chord extraction + finger assignment ──
{
  const s = buildSingAlongScore(SONG);
  // G appears 3x, D 3x, Em7 2x, Cadd9 1x → most-used chord gets 1 finger.
  assert.equal(s.chords[0], 'G', 'most frequent chord (G) → 1 finger');
  assert.ok(s.chords.includes('D') && s.chords.includes('Em7') && s.chords.includes('Cadd9'), 'all chords assigned a slot');
  assert.equal(s.chords.length, 4, 'four distinct chords');
  assert.deepEqual(s.overflow, [], 'nothing overflows for a 4-chord song');
  assert.equal(chordForSlotInScore(s, 1), 'G', 'slot 1 → G');
  assert.equal(chordForSlotInScore(s, 99), null, 'slot beyond the song → null');
  assert.equal(chordForSlotInScore(s, null), null, 'no slot → null');
}

// ── lyric lines keep singable text, with chords positioned inside ──
{
  const s = buildSingAlongScore(SONG);
  const sections = s.lines.filter(l => l.kind === 'section').map(l => l.label);
  assert.deepEqual(sections, ['Verse 1', 'Chorus'], 'section headers parsed and cleaned');

  const line = s.lines.find(l => l.label.startsWith('Colors and'))!;
  assert.equal(line.label, 'Colors and promises', 'chord markers stripped from the singable text');
  assert.ok(line.tokens.some(t => t.chord === 'Em7'), 'chord retained as a token for cueing');

  // A mid-line chord must not swallow the lyric that follows it.
  const midLine = s.lines.find(l => l.label.includes('afraid to'))!;
  const joined = midLine.tokens.map(t => t.text).join('');
  assert.ok(joined.includes('afraid to'), 'lyric text after a chord is preserved');
  assert.ok(joined.includes('fall'), 'trailing lyric after the last chord is preserved');
}

// ── every chord token carries the finger count the singer must hold ──
{
  const s = buildSingAlongScore(SONG);
  const chordTokens = s.lines.flatMap(l => l.tokens).filter(t => t.chord);
  assert.ok(chordTokens.length >= 6, 'multiple chord cues across the song');
  assert.ok(chordTokens.every(t => typeof t.slot === 'number' && t.slot! >= 1 && t.slot! <= MAX_SLOTS), 'every chord cue has a playable finger count');
}

// ── cue sequence collapses repeats (so "next chord" is meaningful) ──
{
  const seq = chordSequence(buildSingAlongScore(SONG));
  assert.ok(seq.length >= 4, 'sequence has the chord changes');
  for (let i = 1; i < seq.length; i++) {
    assert.notEqual(seq[i].chord, seq[i - 1].chord, 'consecutive duplicates collapsed');
  }
}

// ── complex song: overflow beyond 7 chords is reported, not silently dropped ──
{
  const many = '[C]a [G]b [Am]c [F]d [Dm]e [E]f [Bb]g [Ab]h [Db]i';
  const s = buildSingAlongScore(many);
  assert.equal(s.chords.length, MAX_SLOTS, 'caps at what a hand can express');
  assert.equal(s.overflow.length, 2, 'extra chords reported as overflow');
}

// ── degenerate input never throws ──
{
  assert.deepEqual(buildSingAlongScore('').chords, [], 'empty content → no chords');
  const noChords = buildSingAlongScore('Just words, no chords at all');
  assert.deepEqual(noChords.chords, [], 'lyrics without chords → no slots');
  assert.equal(noChords.lines[0].label, 'Just words, no chords at all', 'plain lyric preserved');
  assert.deepEqual(chordSequence(noChords), [], 'no chords → empty sequence');
}

console.log('sing-along tests passed');
