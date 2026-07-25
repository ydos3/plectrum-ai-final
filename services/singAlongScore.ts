// Turns a song's inline-chord lyrics into a "sing-along score" for Air Jam:
// every chord in the song is assigned a FINGER COUNT, so the singer just holds up
// that many fingers when the chord changes while the app keeps the rhythm.
//
// Why this split: rhythmic strumming through a webcam is impossible (~110ms+ of
// camera+inference+audio latency vs. the ~25ms humans need for timing). Chord
// CHANGES happen about once per bar and tolerate that latency easily. So the
// machine keeps time (auto-strum) and the hand supplies harmony — which is the
// only division of labour that actually works with hand tracking.
//
// Pure: no DOM/audio/camera, unit-tested in scripts/test-sing-along.ts.

export interface ScoreToken {
  /** Chord starting at this point in the line, if any. */
  chord?: string;
  /** Finger count (1-based slot) for that chord. */
  slot?: number;
  /** Lyric text that follows the chord. */
  text: string;
}

export interface ScoreLine {
  kind: 'section' | 'lyric' | 'blank';
  /** Section label (kind==='section') or the plain lyric text. */
  label: string;
  tokens: ScoreToken[];
}

export interface SingAlongScore {
  /** Unique chords in order of first appearance; index+1 === finger count. */
  chords: string[];
  lines: ScoreLine[];
  /** Chords beyond what fingers can express (>7), if the song is very complex. */
  overflow: string[];
}

const CHORD_RE = /\[([A-G][#b]?(?:maj7|m7|m|7|sus2|sus4|dim|aug|add9|6|9)?(?:\/[A-G][#b]?)?)\]/g;

/** Max distinct chords a hand can express: 5 finger counts + horns + horns/thumb. */
export const MAX_SLOTS = 7;

/**
 * Build a sing-along score. Chords are ranked by FREQUENCY (most-used chord gets
 * 1 finger) so the easiest gesture maps to the chord you'll play most — which
 * matters a lot when you're also singing.
 */
export const buildSingAlongScore = (content: string): SingAlongScore => {
  const raw = String(content ?? '');

  // Count chord usage across the song.
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const m of raw.matchAll(CHORD_RE)) {
    const c = m[1];
    if (!counts.has(c)) { counts.set(c, 0); order.push(c); }
    counts.set(c, (counts.get(c) || 0) + 1);
  }

  // Most frequent first; ties keep first-appearance order for stability.
  const ranked = [...order].sort((a, b) => {
    const d = (counts.get(b) || 0) - (counts.get(a) || 0);
    return d !== 0 ? d : order.indexOf(a) - order.indexOf(b);
  });
  const chords = ranked.slice(0, MAX_SLOTS);
  const overflow = ranked.slice(MAX_SLOTS);
  const slotOf = new Map(chords.map((c, i) => [c, i + 1]));

  const lines: ScoreLine[] = raw.split(/\r?\n/).map((line): ScoreLine => {
    const t = line.trim();
    if (!t) return { kind: 'blank', label: '', tokens: [] };
    if (t.startsWith('###') || (t.startsWith('[') && t.endsWith(']') && !CHORD_RE.test(t))) {
      return { kind: 'section', label: t.replace(/#/g, '').replace(/[[\]]/g, '').trim(), tokens: [] };
    }

    const tokens: ScoreToken[] = [];
    let last = 0;
    CHORD_RE.lastIndex = 0;
    for (const m of t.matchAll(CHORD_RE)) {
      const before = t.slice(last, m.index);
      if (before) {
        // Text before the first chord belongs to the previous token (or is a lead-in).
        if (tokens.length) tokens[tokens.length - 1].text += before;
        else tokens.push({ text: before });
      }
      const chord = m[1];
      tokens.push({ chord, slot: slotOf.get(chord), text: '' });
      last = (m.index ?? 0) + m[0].length;
    }
    const tail = t.slice(last);
    if (tail) {
      if (tokens.length) tokens[tokens.length - 1].text += tail;
      else tokens.push({ text: tail });
    }

    return { kind: 'lyric', label: t.replace(CHORD_RE, '').replace(/\s{2,}/g, ' ').trim(), tokens };
  });

  return { chords, lines, overflow };
};

/** The chord a given finger count should play, or null. */
export const chordForSlotInScore = (score: SingAlongScore, slot: number | null): string | null =>
  !slot || slot > score.chords.length ? null : score.chords[slot - 1];

/** Every chord in the song, in play order, for a "what's next" cue strip. */
export const chordSequence = (score: SingAlongScore): Array<{ chord: string; slot: number }> => {
  const out: Array<{ chord: string; slot: number }> = [];
  for (const line of score.lines) {
    for (const tk of line.tokens) {
      if (tk.chord && tk.slot) {
        const prev = out[out.length - 1];
        if (!prev || prev.chord !== tk.chord) out.push({ chord: tk.chord, slot: tk.slot });
      }
    }
  }
  return out;
};
