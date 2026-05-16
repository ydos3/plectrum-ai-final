import rawSongDatabase from '../data/acoustic_setlist_db.min.json?raw';
import { AppLanguage, SkillLevel } from '../types';
import { transliterateLyricsForLanguage } from './indicTransliterationService';
import { AcousticDbSong, AcousticSetlistDatabase } from './songDbTypes';

export type SongDatabaseRecord = AcousticDbSong;

export interface SongDatabaseSearchResult {
  found: boolean;
  confidence: number;
  match?: SongDatabaseRecord;
  reason?: string;
  candidates?: Array<{
    title: string;
    artist?: string;
    confidence: number;
  }>;
}

const DATABASE_FILE = 'acoustic_setlist_db.min.json';
const MIN_CONFIDENT_MATCH = 0.82;
const MIN_DOMINANT_MATCH = 0.70;
const DOMINANT_GAP = 0.14;

const NOISE_WORDS = new Set([
  'lyrics', 'lyric', 'chords', 'chord', 'guitar', 'tabs', 'tab', 'karaoke',
  'cover', 'song', 'acoustic', 'strumming', 'capo', 'tutorial', 'lesson',
  'official', 'video', 'audio', 'easy', 'beginner', 'with', 'without',
]);

let cachedDatabase: AcousticSetlistDatabase | null = null;
let loadFailed = false;

const isDevelopment = () => {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
};

const warnDev = (message: string, error?: unknown) => {
  if (isDevelopment()) {
    console.warn(`[SongDatabase] ${message}`, error instanceof Error ? error.message : error || '');
  }
};

const asStringArray = (value: unknown): string[] => (
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
);

const getLyricSections = (song: AcousticDbSong) => (
  song?.lyrics && typeof song.lyrics === 'object'
    ? Object.entries(song.lyrics).filter(([, lines]) => Array.isArray(lines))
    : []
);

export const isDatabaseSongStructurallyComplete = (song: AcousticDbSong) => {
  const sections = getLyricSections(song);
  const sectionKeys = sections.map(([key]) => key);
  const lineCount = sections.reduce((count, [, lines]) => count + lines.length, 0);
  const charCount = sections.reduce((count, [, lines]) => count + lines.join('\n').length, 0);
  const flag = String(song.verification_flag || '').toUpperCase();
  const notes = String(song.verification_notes || '');

  if (flag !== 'VERIFIED') return false;
  if (/partial|incomplete|placeholder|sample|needs/i.test(notes)) return false;
  if (sections.length < 3) return false;
  if (lineCount < 12) return false;
  if (charCount < 450) return false;
  if (!sectionKeys.some(key => /chorus/i.test(key))) return false;
  if (!sectionKeys.some(key => /verse2|verse_2/i.test(key))) return false;

  return true;
};

const compact = (value: string) => value.replace(/\s+/g, '');

const normalizeHinglish = (value: string) => {
  let text = value;
  const phraseReplacements: Array<[RegExp, string]> = [
    [/\bbanale\b/g, 'bana le'],
    [/\bbanaale\b/g, 'bana le'],
    [/\btumhi\b/g, 'tum hi'],
    [/\bapnaa\b/g, 'apna'],
    [/\bkesriya\b/g, 'kesariya'],
    [/\bchana\b/g, 'channa'],
    [/\bmereyaa\b/g, 'mereya'],
    [/\barijeet\b/g, 'arijit'],
    [/\barjit\b/g, 'arijit'],
    [/\bedshiran\b/g, 'ed sheeran'],
    [/\bedsheeran\b/g, 'ed sheeran'],
  ];

  for (const [pattern, replacement] of phraseReplacements) {
    text = text.replace(pattern, replacement);
  }

  return text;
};

export const normalizeSongQuery = (query: string): string => {
  const normalized = normalizeHinglish(
    query
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9\u0900-\u097F]+/gi, ' ')
      .toLowerCase()
  );

  return normalized
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean)
    .filter(token => !NOISE_WORDS.has(token))
    .join(' ')
    .trim()
    .replace(/\s+/g, ' ');
};

const tokenize = (value: string): string[] => (
  normalizeSongQuery(value)
    .split(' ')
    .filter(token => token.length > 1)
);

const uniqueTokens = (value: string) => Array.from(new Set(tokenize(value)));

const tokenOverlap = (queryTokens: string[], target: string): number => {
  if (queryTokens.length === 0) return 0;
  const targetTokens = new Set(tokenize(target));
  const hits = queryTokens.filter(token => targetTokens.has(token)).length;
  return hits / queryTokens.length;
};

const bigrams = (value: string) => {
  const clean = compact(normalizeSongQuery(value));
  if (clean.length < 2) return clean ? [clean] : [];
  const grams: string[] = [];
  for (let i = 0; i < clean.length - 1; i += 1) grams.push(clean.slice(i, i + 2));
  return grams;
};

const diceSimilarity = (a: string, b: string): number => {
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  if (!aGrams.length || !bGrams.length) return normalizeSongQuery(a) === normalizeSongQuery(b) ? 1 : 0;

  const bCounts = new Map<string, number>();
  bGrams.forEach(gram => bCounts.set(gram, (bCounts.get(gram) || 0) + 1));

  let intersection = 0;
  for (const gram of aGrams) {
    const count = bCounts.get(gram) || 0;
    if (count > 0) {
      intersection += 1;
      bCounts.set(gram, count - 1);
    }
  }

  return (2 * intersection) / (aGrams.length + bGrams.length);
};

const getSearchFields = (song: AcousticDbSong) => {
  const singers = asStringArray(song.singers);
  const languages = asStringArray(song.language);
  const genres = asStringArray(song.genre);
  return {
    title: song.title || '',
    artists: singers.join(' '),
    album: song.album || '',
    film: song.film_show || '',
    keywords: [
      song.title,
      ...singers,
      song.album,
      song.film_show,
      song.composer,
      song.lyricist,
      ...languages,
      ...genres,
    ].filter(Boolean).join(' '),
  };
};

const scoreSong = (query: string, song: AcousticDbSong) => {
  const normalizedQuery = normalizeSongQuery(query);
  const queryTokens = uniqueTokens(query);
  const queryCompact = compact(normalizedQuery);
  const fields = getSearchFields(song);
  const title = normalizeSongQuery(fields.title);
  const titleCompact = compact(title);
  const artists = normalizeSongQuery(fields.artists);
  const album = normalizeSongQuery(fields.album);
  const film = normalizeSongQuery(fields.film);
  const keywords = normalizeSongQuery(fields.keywords);

  let confidence = 0;
  let reason = 'token-overlap';

  if (normalizedQuery && normalizedQuery === title) {
    return { confidence: 0.95, reason: 'exact-title' };
  }

  if (queryCompact && titleCompact && queryCompact === titleCompact) {
    return { confidence: 0.94, reason: 'exact-compact-title' };
  }

  const titleOverlap = tokenOverlap(queryTokens, title);
  const artistOverlap = tokenOverlap(queryTokens, artists);
  const albumOverlap = Math.max(tokenOverlap(queryTokens, album), tokenOverlap(queryTokens, film));
  const keywordOverlap = tokenOverlap(queryTokens, keywords);
  const titleSimilarity = diceSimilarity(normalizedQuery, title);

  if (title && normalizedQuery.includes(title) && title.length >= 4) {
    confidence = Math.max(confidence, artistOverlap > 0 ? 0.88 : 0.84);
    reason = artistOverlap > 0 ? 'strong-title-artist' : 'title-contained';
  }

  if (titleCompact && queryCompact.includes(titleCompact) && titleCompact.length >= 5) {
    confidence = Math.max(confidence, artistOverlap > 0 ? 0.89 : 0.85);
    reason = artistOverlap > 0 ? 'strong-title-artist' : 'compact-title-contained';
  }

  if (titleOverlap >= 1 && artistOverlap > 0) {
    confidence = Math.max(confidence, 0.88);
    reason = 'strong-title-artist';
  } else if (titleOverlap >= 1) {
    confidence = Math.max(confidence, 0.84);
    reason = 'title-token-match';
  } else if (titleOverlap >= 0.67 && queryTokens.length >= 2) {
    confidence = Math.max(confidence, 0.76 + (artistOverlap > 0 ? 0.08 : 0));
    reason = artistOverlap > 0 ? 'partial-title-artist' : 'partial-title';
  }

  if (keywordOverlap >= 0.8 && queryTokens.length >= 2) {
    confidence = Math.max(confidence, 0.82);
    reason = 'strong-keyword';
  }

  if (albumOverlap >= 0.8 && queryTokens.length >= 2) {
    confidence = Math.max(confidence, 0.82);
    reason = 'album-film';
  }

  if (titleSimilarity >= 0.9) {
    confidence = Math.max(confidence, 0.82);
    reason = 'fuzzy-title';
  } else if (titleSimilarity >= 0.78) {
    confidence = Math.max(confidence, 0.70 + ((titleSimilarity - 0.78) * 0.55));
    reason = 'possible-fuzzy-title';
  }

  if (artistOverlap > 0 && confidence >= 0.70) {
    confidence = Math.min(0.93, confidence + 0.04);
  }

  return { confidence: Math.min(0.99, confidence), reason };
};

export const loadSongDatabase = (): AcousticSetlistDatabase | null => {
  if (cachedDatabase) return cachedDatabase;
  if (loadFailed) return null;

  try {
    const parsed = JSON.parse(rawSongDatabase);
    const songs = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.songs)
        ? parsed.songs
        : Array.isArray(parsed?.data)
          ? parsed.data
          : null;

    if (!songs) {
      throw new Error('Unsupported database root shape.');
    }

    const usableSongs = songs.filter((song: Partial<AcousticDbSong>) => (
      song && typeof song.title === 'string' && song.title.trim().length > 0
    ));

    if (usableSongs.length === 0) {
      throw new Error('Database contains no records with usable title fields.');
    }

    cachedDatabase = {
      _meta: parsed?._meta || {
        schema_version: 'unknown',
        created: '',
        description: 'Acoustic setlist database',
        total_songs: usableSongs.length,
      },
      songs: usableSongs as AcousticDbSong[],
    };

    return cachedDatabase;
  } catch (error) {
    loadFailed = true;
    warnDev(`Could not load ${DATABASE_FILE}; Gemini fallback will be used.`, error);
    return null;
  }
};

export const searchSongDatabase = (query: string): SongDatabaseSearchResult => {
  if (!query || query.trim().length < 2) {
    return { found: false, confidence: 0, reason: 'empty-query' };
  }

  const db = loadSongDatabase();
  if (!db) {
    return { found: false, confidence: 0, reason: 'database-unavailable' };
  }

  const scored = db.songs
    .map(song => {
      const score = scoreSong(query, song);
      return { song, confidence: score.confidence, reason: score.reason };
    })
    .filter(item => item.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  const candidates = scored.slice(0, 5).map(item => ({
    title: item.song.title,
    artist: asStringArray(item.song.singers).join(', ') || undefined,
    confidence: Number(item.confidence.toFixed(3)),
  }));

  const best = scored[0];
  if (!best) {
    return { found: false, confidence: 0, reason: 'no-candidates', candidates };
  }

  const second = scored[1];
  const gap = best.confidence - (second?.confidence || 0);
  const isConfident = best.confidence >= MIN_CONFIDENT_MATCH;
  const isDominant = best.confidence >= MIN_DOMINANT_MATCH && gap >= DOMINANT_GAP;

  if (!isConfident && !isDominant) {
    return {
      found: false,
      confidence: Number(best.confidence.toFixed(3)),
      reason: second && gap < DOMINANT_GAP ? 'ambiguous-candidates' : 'low-confidence',
      candidates,
    };
  }

  return {
    found: true,
    confidence: Number(best.confidence.toFixed(3)),
    match: best.song,
    reason: isConfident ? best.reason : `${best.reason}-dominant`,
    candidates,
  };
};

const sectionName = (key: string) => (
  key
    .replace(/_/g, ' ')
    .replace(/([a-z])([0-9])/gi, '$1 $2')
    .replace(/\b\w/g, letter => letter.toUpperCase())
);

const buildContent = (song: AcousticDbSong) => {
  const lyrics = song.lyrics || {};
  const preferredOrder = ['intro', 'verse1', 'verse2', 'verse3', 'pre_chorus', 'chorus', 'chorus2', 'bridge', 'outro'];
  const keys = [
    ...preferredOrder.filter(key => Array.isArray(lyrics[key])),
    ...Object.keys(lyrics).filter(key => !preferredOrder.includes(key) && Array.isArray(lyrics[key])),
  ];

  return keys
    .map(key => `### [${sectionName(key)}]\n${lyrics[key].join('\n')}`)
    .join('\n\n')
    .trim();
};

const countContentLyricLines = (content: string) => (
  content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('###')).length
);

const getSectionLabel = (header: string) => {
  const match = header.match(/^###\s*\[([^\]]+)\]/);
  return (match?.[1] || header.replace(/^#+\s*/, '')).trim();
};

const relabelSection = (block: string, label: string) => (
  block.replace(/^###\s*\[[^\]]+\]/, `### [${label}]`)
);

const completePerformanceArrangement = (content: string, minimumLines = 24) => {
  if (countContentLyricLines(content) >= minimumLines) return content;

  const blocks = content
    .split(/\n(?=###\s*\[[^\]]+\])/)
    .map(block => block.trim())
    .filter(Boolean);

  if (blocks.length < 2) return content;

  const findBlock = (pattern: RegExp) => blocks.find(block => pattern.test(getSectionLabel(block)));
  const intro = findBlock(/intro/i);
  const verse1 = findBlock(/verse\s*1/i) || findBlock(/verse/i);
  const verse2 = findBlock(/verse\s*2/i);
  const preChorus = findBlock(/pre/i);
  const chorus = findBlock(/chorus/i);
  const bridge = findBlock(/bridge/i);
  const outro = findBlock(/outro/i);

  if (!verse1 || !chorus) return content;

  const arranged = [
    intro && relabelSection(intro, 'Intro'),
    relabelSection(verse1, 'Verse 1'),
    preChorus && relabelSection(preChorus, 'Pre-Chorus 1'),
    relabelSection(chorus, 'Chorus 1'),
    relabelSection(verse2 || verse1, 'Verse 2'),
    preChorus && relabelSection(preChorus, 'Pre-Chorus 2'),
    relabelSection(chorus, 'Chorus 2'),
    bridge && relabelSection(bridge, 'Bridge'),
    relabelSection(chorus, 'Final Chorus'),
    outro && relabelSection(outro, 'Outro'),
  ].filter(Boolean) as string[];

  const arrangedContent = arranged.join('\n\n');
  return countContentLyricLines(arrangedContent) > countContentLyricLines(content)
    ? arrangedContent
    : content;
};

const transliterateContentForLanguage = (content: string, language: AppLanguage) => {
  if (language === 'English') return content;

  return content
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('###')) return line;
      return transliterateLyricsForLanguage(line, language);
    })
    .join('\n');
};

const practiceSkill = (songDifficulty: string | undefined, requestedSkill: SkillLevel): string => (
  songDifficulty || (requestedSkill === 'Professional' ? 'Advanced' : requestedSkill)
);

const buildPracticeTips = (song: AcousticDbSong, difficulty: string): string[] => {
  const tips = [
    'Start slowly and keep the chord changes even.',
    song.capo > 0 ? `Use a capo on fret ${song.capo} for the intended easy shape.` : '',
    song.strumming_pattern ? `Practice the strumming pattern: ${song.strumming_pattern}.` : '',
  ].filter(Boolean);

  if (/beginner/i.test(difficulty)) {
    tips.unshift('Loop each section before playing the full song.');
  }

  return tips.slice(0, 4);
};

const buildChordSimplifications = (song: AcousticDbSong, difficulty: string) => {
  if (!/beginner/i.test(difficulty)) return [];

  const substitutions: Record<string, string> = {
    F: 'Fmaj7',
    Bm: 'Bm7',
    'F#m': 'F#m7',
    Bb: 'Bbmaj7',
  };

  return asStringArray(song.chords_no_capo)
    .filter(chord => substitutions[chord])
    .map(chord => ({
      from: chord,
      to: substitutions[chord],
      reason: 'Easier fingering for practice',
    }));
};

export const mapDatabaseSongToExistingGeminiFormat = (
  song: AcousticDbSong,
  confidence: number,
  language: AppLanguage = 'English',
  skillLevel: SkillLevel = 'Intermediate'
) => {
  const romanizedContent = completePerformanceArrangement(buildContent(song));
  const content = transliterateContentForLanguage(romanizedContent, language);
  const artist = asStringArray(song.singers).join(', ') || 'Unknown';
  const difficulty = practiceSkill(song.cover_difficulty, skillLevel);

  if (!song.title || !content) {
    throw new Error('Database record cannot be mapped safely.');
  }

  return {
    found: true,
    title: song.title,
    artist,
    movie: song.film_show || song.album || '',
    releaseDate: song.release_date || (song.release_year ? String(song.release_year) : ''),
    key: song.verified_key || '',
    recommendedKey: song.easy_shape || song.verified_key || '',
    capo: typeof song.capo === 'number' ? song.capo : 0,
    strummingPattern: song.strumming_pattern || '',
    difficulty,
    skillLevel: difficulty,
    practiceTips: buildPracticeTips(song, difficulty),
    chordSimplifications: buildChordSimplifications(song, difficulty),
    karaokeUrl: '',
    language,
    languageFallbackReason: language === 'English' ? '' : 'Local Hinglish/Roman lyrics transliterated without AI.',
    duration: song.duration_sec || 0,
    timedLyrics: undefined,
    content,
    source: 'database',
    metadata: {
      source: 'database',
      databaseFile: DATABASE_FILE,
      confidence,
      matchedSongId: song.id,
    },
  };
};

export const debugSongLookup = (details: {
  query: string;
  matched: boolean;
  title?: string;
  confidence?: number;
  source: 'database' | 'gemini';
}) => {
  if (!isDevelopment()) return;
  console.log('[SongLookup]', {
    query: details.query,
    databaseMatch: details.matched,
    matchedTitle: details.title || '',
    confidence: details.confidence,
    sourceUsed: details.source,
  });
};
