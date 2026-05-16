/**
 * Adapter: Maps AcousticDbSong schema to Gemini API response format.
 * Ensures frontend receives the exact same response shape regardless of source.
 */

import { AcousticDbSong } from './songDbTypes';
import { normalizeSongQuery } from './privateSongDb';

export interface MappedSongResponse {
  title: string;
  artist: string;
  key: string;
  recommendedKey: string;
  capo: number;
  strummingPattern: string;
  difficulty: string;
  skillLevel: string;
  practiceTips: string[];
  chordSimplifications: Array<{ from: string; to: string; reason?: string }>;
  karaokeUrl: string;
  language: string;
  languageFallbackReason: string;
  content: string;
  duration: number | null;
  timedLyrics?: any[];
  source: 'private_db';
  // Debug fields (development only)
  _debug?: {
    confidence?: number;
    matchedSongId?: string;
    matchType?: string;
  };
}

/**
 * Extract section name from lyrics section key.
 * verse1 → Verse 1, pre_chorus → Pre-Chorus, etc.
 */
function formatSectionName(key: string): string {
  return key
    .replace(/_/g, '-')
    .split('-')
    .map((part, index) => {
      if (index === 0) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      }
      // Add number if present
      const match = part.match(/[0-9]+/);
      if (match) return match[0];
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

/**
 * Convert lyrics section key + lyrics array into formatted section block.
 * E.g., verse1: ["[Em] line 1", "[Bm] line 2"] → "### [Verse 1]\n[Em] line 1\n[Bm] line 2"
 */
function buildLyricsSection(sectionKey: string, lines: string[]): string {
  const sectionName = formatSectionName(sectionKey);
  const header = `### [${sectionName}]`;
  const body = lines.join('\n');
  return `${header}\n${body}`;
}

/**
 * Extract chord names from lyrics lines.
 * Looks for [CHORD] patterns.
 */
function extractChordsFromLyrics(lyrics: { [key: string]: string[] }): string[] {
  const chords = new Set<string>();
  const chordRegex = /\[([A-G](?:#|b)?(?:m|maj|maj7|maj9|min|dim|aug|sus|add|slash|\/)?[0-9]*(?:\/[A-G](?:#|b)?)?)\]/g;

  for (const sectionLines of Object.values(lyrics)) {
    for (const line of sectionLines) {
      let match;
      while ((match = chordRegex.exec(line)) !== null) {
        chords.add(match[1]);
      }
    }
  }

  return Array.from(chords).sort();
}

/**
 * Generate practice tips based on song difficulty and chords.
 */
function generatePracticeTips(
  song: AcousticDbSong,
  difficulty: string
): string[] {
  const tips: string[] = [];

  if (difficulty === 'Beginner' || difficulty === 'Beginner-Intermediate') {
    tips.push('Start slowly and focus on smooth chord transitions.');
    tips.push('Practice each verse separately before combining.');

    if (song.bpm && song.bpm > 120) {
      tips.push('Use a metronome to build speed gradually.');
    }

    if (song.capo > 0) {
      tips.push(`Use a capo on fret ${song.capo} for easier fingering.`);
    }
  } else {
    tips.push('Work on nail timing and chord accuracy.');
    if (song.bpm) {
      tips.push(`Target BPM: ${song.bpm}. Use a metronome to practice.`);
    }
  }

  if (song.strumming_pattern) {
    tips.push(`Learn the strumming pattern: ${song.strumming_pattern}`);
  }

  if (song.reel_potential === 'High') {
    tips.push('This song has great potential for social media reels.');
  }

  return tips;
}

/**
 * Generate chord simplifications for Beginner level.
 */
function generateChordSimplifications(
  song: AcousticDbSong,
  difficulty: string
): Array<{ from: string; to: string; reason?: string }> {
  if (difficulty !== 'Beginner' && difficulty !== 'Beginner-Intermediate') {
    return [];
  }

  const simplifications: Array<{ from: string; to: string; reason?: string }> = [];

  // Common simplifications for beginner
  const simplifyMap: { [key: string]: string } = {
    F: 'Fmaj7',
    Bm: 'Bm7',
    Dm: 'Dm9',
    'F#m': 'Fm',
  };

  for (const chord of song.chords_no_capo) {
    if (simplifyMap[chord]) {
      simplifications.push({
        from: chord,
        to: simplifyMap[chord],
        reason: 'Easier fingering without full barre',
      });
    }
  }

  return simplifications;
}

/**
 * Map AcousticDbSong to API response format.
 * Handles all format conversion and ensures frontend compatibility.
 */
export function mapAcousticDbSongToApiResponse(
  song: AcousticDbSong,
  options?: {
    confidence?: number;
    matchType?: string;
    includeDebug?: boolean;
  }
): MappedSongResponse {
  const language = song.language[0] || 'English';
  const difficulty = song.cover_difficulty || 'Intermediate';

  // Build full lyrics content with sections
  const contentLines: string[] = [];
  const sectionOrder = [
    'intro',
    'verse1',
    'verse2',
    'verse3',
    'pre_chorus',
    'chorus',
    'bridge',
    'outro',
  ];

  // Process lyrics in logical order
  for (const sectionKey of sectionOrder) {
    if (song.lyrics[sectionKey]) {
      contentLines.push(buildLyricsSection(sectionKey, song.lyrics[sectionKey]));
    }
  }

  // Add any remaining sections not in the standard order
  for (const sectionKey in song.lyrics) {
    if (!sectionOrder.includes(sectionKey)) {
      contentLines.push(buildLyricsSection(sectionKey, song.lyrics[sectionKey]));
    }
  }

  const content = contentLines.join('\n\n');

  // Extract chords
  const chords = extractChordsFromLyrics(song.lyrics);

  // Generate practical tips
  const practiceTips = generatePracticeTips(song, difficulty);

  // Generate chord simplifications
  const chordSimplifications = generateChordSimplifications(song, difficulty);

  const mapped: MappedSongResponse = {
    title: song.title,
    artist: song.singers.join(', '),
    key: song.verified_key,
    recommendedKey: song.verified_key,
    capo: song.capo,
    strummingPattern: song.strumming_pattern,
    difficulty,
    skillLevel: difficulty,
    practiceTips,
    chordSimplifications,
    karaokeUrl: '', // Will be populated by Gemini if needed
    language,
    languageFallbackReason: '',
    content,
    duration: song.duration_sec,
    timedLyrics: undefined,
    source: 'private_db',
  };

  // Add debug info in development
  if (options?.includeDebug) {
    mapped._debug = {
      confidence: options.confidence,
      matchedSongId: song.id,
      matchType: options.matchType,
    };
  }

  return mapped;
}

/**
 * Validate that a DB song has all required fields for frontend display.
 */
export function validateAcousticSongForDisplay(song: AcousticDbSong): boolean {
  return !!(
    song.title &&
    song.singers &&
    song.singers.length > 0 &&
    song.lyrics &&
    Object.keys(song.lyrics).length > 0 &&
    song.verified_key &&
    song.easy_shape &&
    song.strumming_pattern
  );
}
