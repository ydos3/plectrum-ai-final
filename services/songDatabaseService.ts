/**
 * Song Database Service - LRCLIB + Uberchord Integration
 * DB-first approach: try free APIs before falling back to AI
 */

export interface LRCLibTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface SyncedLine {
  time: number;   // seconds
  text: string;
}

// ─── LRCLIB: Free Synced Lyrics Database ───────────────────────────────

const COMMON_SEARCH_WORDS = new Set([
  'a', 'an', 'and', 'by', 'for', 'from', 'in', 'is', 'me', 'my', 'of', 'on', 'song', 'the', 'to',
  'lyrics', 'lyric', 'chords', 'guitar', 'karaoke', 'official', 'audio', 'video', 'make', 'easy',
  'easier', 'beginner', 'open', 'barre', 'capo', 'with', 'without', 'use',
  'hai', 'hain', 'ka', 'ke', 'ki', 'ko', 'se', 'mein', 'main', 'mai', 'tu', 'tere', 'liye'
]);

export const normalizeSongSearchText = (value: string = '') => (
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u0900-\u097F]+/gi, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
);

const tokenize = (value: string) => (
  normalizeSongSearchText(value)
    .split(' ')
    .filter(Boolean)
);

const significantTokens = (value: string) => (
  tokenize(value).filter(token => token.length > 2 && !COMMON_SEARCH_WORDS.has(token))
);

const compact = (value: string) => normalizeSongSearchText(value).replace(/\s+/g, '');

const bigrams = (value: string) => {
  const clean = compact(value);
  const grams: string[] = [];
  for (let i = 0; i < clean.length - 1; i += 1) grams.push(clean.slice(i, i + 2));
  return grams;
};

const diceCoefficient = (a: string, b: string) => {
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  if (aGrams.length === 0 || bGrams.length === 0) return a === b ? 1 : 0;

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

const includesAllTokens = (haystack: string, tokens: string[]) => {
  const haystackTokens = new Set(tokenize(haystack));
  return tokens.length > 0 && tokens.every(token => haystackTokens.has(token));
};

const lyricMatchScore = (query: string, lyrics?: string | null) => {
  if (!lyrics) return 0;
  const queryText = normalizeSongSearchText(query);
  const lyricsText = normalizeSongSearchText(lyrics);
  if (!queryText || !lyricsText) return 0;

  const queryCompact = compact(queryText);
  const lyricsCompact = compact(lyricsText);
  if (queryCompact.length >= 14 && lyricsCompact.includes(queryCompact)) return 0.86;

  const tokens = significantTokens(queryText);
  if (tokens.length >= 3) {
    const lyricTokens = new Set(tokenize(lyricsText));
    const exactMatches = tokens.filter(token => lyricTokens.has(token)).length;
    const ratio = exactMatches / tokens.length;
    if (ratio >= 0.75) return 0.72;
    if (ratio >= 0.5 && tokens.length >= 4) return 0.56;
  }

  if (queryCompact.length >= 14) {
    const windowSize = Math.min(Math.max(queryCompact.length + 6, 18), 90);
    let bestSimilarity = 0;
    for (let i = 0; i < lyricsCompact.length; i += Math.max(1, Math.floor(windowSize / 3))) {
      const window = lyricsCompact.slice(i, i + windowSize);
      bestSimilarity = Math.max(bestSimilarity, diceCoefficient(queryCompact, window));
      if (bestSimilarity >= 0.72) return 0.62;
    }
  }

  return 0;
};

const scoreTrackForQuery = (query: string, track: LRCLibTrack) => {
  const normalizedQuery = normalizeSongSearchText(query);
  const normalizedTitle = normalizeSongSearchText(track.trackName);
  const titleTokens = significantTokens(track.trackName);
  const artistTokens = significantTokens(track.artistName);

  let score = 0;
  if (normalizedQuery === normalizedTitle) score += 0.8;
  if (normalizedTitle.length > 1 && normalizedQuery.includes(normalizedTitle)) score += 0.48;
  if (includesAllTokens(normalizedQuery, titleTokens)) score += 0.22;
  if (artistTokens.length > 0 && includesAllTokens(normalizedQuery, artistTokens)) score += 0.28;

  const titleSimilarity = diceCoefficient(normalizedQuery, normalizedTitle);
  if (titleSimilarity >= 0.9) score += 0.42;
  else if (titleSimilarity >= 0.75) score += 0.22;

  score += lyricMatchScore(query, track.plainLyrics);
  if (track.syncedLyrics) score += 0.04;
  if (!track.instrumental && track.plainLyrics) score += 0.04;

  return Math.min(score, 1);
};

const hasArtistQualifier = (query: string, track: LRCLibTrack) => {
  const queryTokens = significantTokens(query);
  const titleTokens = new Set(significantTokens(track.trackName));
  const artistTokens = new Set(significantTokens(track.artistName));
  const extraTokens = queryTokens.filter(token => !titleTokens.has(token));
  return extraTokens.length > 0 && extraTokens.every(token => artistTokens.has(token));
};

const hasUnmatchedQualifier = (query: string, track: LRCLibTrack) => {
  const queryTokens = significantTokens(query);
  const titleTokens = new Set(significantTokens(track.trackName));
  const artistTokens = new Set(significantTokens(track.artistName));
  const lyricScore = lyricMatchScore(query, track.plainLyrics);
  const extraTokens = queryTokens.filter(token => !titleTokens.has(token));
  return extraTokens.length > 0 &&
    !extraTokens.every(token => artistTokens.has(token)) &&
    lyricScore < 0.5;
};

const LRCLIB_BASE = 'https://lrclib.net/api';

export const searchLRCLIB = async (query: string): Promise<LRCLibTrack[]> => {
  try {
    const url = `${LRCLIB_BASE}/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PlectrumAI/1.0 (https://plectrum.ai)' }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data as LRCLibTrack[];
  } catch (e) {
    console.warn('[LRCLIB] Search failed:', e);
    return [];
  }
};

export const getLRCLIBByMatch = async (
  title: string,
  artist: string
): Promise<LRCLibTrack | null> => {
  try {
    const url = `${LRCLIB_BASE}/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PlectrumAI/1.0 (https://plectrum.ai)' }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('[LRCLIB] Match failed:', e);
    return null;
  }
};

/**
 * Parse LRC format "[mm:ss.xx] lyric text" into timed lines
 */
export const parseSyncedLyrics = (lrc: string): SyncedLine[] => {
  const lines = lrc.split('\n');
  const result: SyncedLine[] = [];

  for (const line of lines) {
    const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const ms = parseInt(match[3]);
      const time = minutes * 60 + seconds + ms / (match[3].length === 3 ? 1000 : 100);
      const text = match[4].trim();
      if (text) { // skip empty lines
        result.push({ time, text });
      }
    }
  }

  return result;
};

// ─── Uberchord: Free Chord Voicing API ─────────────────────────────────

export interface UberchordResult {
  chordName: string;
  strings: string;
  fingering: string;
  tones: string;
}

export const searchChordAPI = async (chordName: string): Promise<UberchordResult | null> => {
  try {
    // Uberchord API format: GET /v1/chords/Am
    const cleanName = chordName.replace(/[\[\]]/g, '').trim();
    const url = `https://api.uberchord.com/v1/chords/${encodeURIComponent(cleanName)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.[0] || null;
  } catch (e) {
    console.warn('[Uberchord] Lookup failed:', e);
    return null;
  }
};

// ─── Orchestrator: DB-First Song Lookup ────────────────────────────────

export interface DatabaseSongResult {
  source: 'lrclib' | 'ai';
  title: string;
  artist: string;
  duration?: number;
  plainLyrics?: string;
  syncedLyrics?: SyncedLine[];
  album?: string;
}

export const searchSongDatabase = async (query: string): Promise<DatabaseSongResult | null> => {
  console.log('[SongDB] Searching LRCLIB for:', query);

  // Step 1: Search LRCLIB
  const results = await searchLRCLIB(query);
  if (results.length === 0) {
    console.log('[SongDB] No LRCLIB results, falling back to AI');
    return null;
  }

  const scored = results
    .filter(r => !r.instrumental && (r.plainLyrics || r.syncedLyrics))
    .map(track => ({ track, score: scoreTrackForQuery(query, track) }))
    .sort((a, b) => b.score - a.score);

  const bestScored = scored[0];
  if (!bestScored || bestScored.score < 0.45) {
    console.log('[SongDB] LRCLIB results were too uncertain, falling back to AI identity resolution');
    return null;
  }

  const best = bestScored.track;
  const normalizedQuery = normalizeSongSearchText(query);
  const normalizedBestTitle = normalizeSongSearchText(best.trackName);
  const exactTitleMatches = scored.filter(({ track }) => normalizeSongSearchText(track.trackName) === normalizedBestTitle).length;
  const hasOnlyTitleInQuery = normalizedQuery === normalizedBestTitle || includesAllTokens(normalizedQuery, significantTokens(best.trackName));
  const secondScore = scored[1]?.score || 0;

  if (hasUnmatchedQualifier(query, best)) {
    console.log('[SongDB] Best LRCLIB result did not match the requested artist/qualifier, falling back to identity resolution');
    return null;
  }

  if (!hasArtistQualifier(query, best) && hasOnlyTitleInQuery && exactTitleMatches > 1 && bestScored.score - secondScore < 0.2) {
    console.log('[SongDB] Exact title is ambiguous in LRCLIB, falling back to AI identity resolution');
    return null;
  }

  console.log('[SongDB] LRCLIB hit:', best.trackName, '-', best.artistName, `(score ${bestScored.score.toFixed(2)})`);

  const songResult: DatabaseSongResult = {
    source: 'lrclib',
    title: best.trackName,
    artist: best.artistName,
    duration: best.duration,
    plainLyrics: best.plainLyrics || undefined,
    album: best.albumName,
  };

  // Parse synced lyrics if available
  if (best.syncedLyrics) {
    songResult.syncedLyrics = parseSyncedLyrics(best.syncedLyrics);
  }

  return songResult;
};
