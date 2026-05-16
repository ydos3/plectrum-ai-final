/**
 * Private Song Repository
 * Loads and manages the acoustic_setlist_db.json database.
 * Provides search and lookup functionality with confidence scoring.
 */

import {
  AcousticSetlistDatabase,
  AcousticDbSong,
  SongSearchMatch,
  SongSearchOptions,
  DEFAULT_MIN_CONFIDENCE,
} from './songDbTypes';
import {
  normalizeSongQuery,
  isExactTitleMatch,
  isPartialMatch,
  isTitleSingerMatch,
  levenshteinSimilarity,
  removeFillerWords,
} from './privateSongDb';

let cachedDatabase: AcousticSetlistDatabase | null = null;

/**
 * Load the acoustic setlist database from JSON file.
 * Cached in memory after first load.
 */
async function loadDatabase(): Promise<AcousticSetlistDatabase> {
  if (cachedDatabase) return cachedDatabase;

  try {
    const response = await fetch('/data/acoustic_setlist_db.json');
    if (!response.ok) {
      throw new Error(`Failed to load database: ${response.statusText}`);
    }
    cachedDatabase = await response.json();
    console.log(`[PrivateSongDb] Loaded ${cachedDatabase.songs.length} songs`);
    return cachedDatabase;
  } catch (error) {
    console.error('[PrivateSongDb] Failed to load database:', error);
    throw error;
  }
}

/**
 * Calculate confidence score for a song match.
 * Scoring rules based on match type.
 */
function calculateConfidence(
  query: string,
  song: AcousticDbSong,
  matchType: string
): number {
  const norm_query = normalizeSongQuery(query);

  switch (matchType) {
    case 'exact-title':
      return 1.0;

    case 'normalized-title':
      return 0.98;

    case 'title-singer': {
      const singers_str = song.singers.map(normalizeSongQuery).join(' ');
      const has_singer =
        singers_str.includes(norm_query) ||
        norm_query.split(' ').some(word => singers_str.includes(word));
      return has_singer ? 0.95 : 0.88;
    }

    case 'partial-title': {
      const partial_sim = levenshteinSimilarity(query, song.title);
      return Math.max(0.82, Math.min(0.93, 0.82 + partial_sim * 0.1));
    }

    case 'album-film-title': {
      return 0.9;
    }

    case 'fuzzy': {
      return levenshteinSimilarity(query, song.title);
    }

    default:
      return 0.5;
  }
}

/**
 * Find the best match for a song query in the database.
 * Returns the song with the highest confidence, or null if no match meets threshold.
 */
export async function findSongInPrivateDb(
  query: string,
  options?: SongSearchOptions
): Promise<SongSearchMatch | null> {
  if (!query || query.trim().length < 2) return null;

  const minConfidence = options?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const db = await loadDatabase();
  const matches: SongSearchMatch[] = [];

  const norm_query = normalizeSongQuery(query);

  for (const song of db.songs) {
    // Skip unverified songs unless explicitly requested
    if (
      song.verification_flag === 'UNVERIFIED' &&
      !options?.includePartial
    ) {
      continue;
    }

    // Skip if language mismatch
    if (
      options?.languages &&
      !options.languages.some(lang =>
        song.language.map(normalizeSongQuery).includes(lang.toLowerCase())
      )
    ) {
      continue;
    }

    let matchType = '';
    let confidence = 0;

    // 1. Exact title match
    if (isExactTitleMatch(query, song.title)) {
      matchType = 'exact-title';
      confidence = 1.0;
    }

    // 2. Normalized title match
    else if (normalizeSongQuery(song.title) === norm_query) {
      matchType = 'normalized-title';
      confidence = 0.98;
    }

    // 3. Title + Singer match
    else if (isTitleSingerMatch(query, song.title, song.singers)) {
      matchType = 'title-singer';
      confidence = calculateConfidence(query, song, matchType);
    }

    // 4. Partial title match (substring)
    else if (isPartialMatch(query, song.title, 3)) {
      matchType = 'partial-title';
      confidence = calculateConfidence(query, song, matchType);
    }

    // 5. Album or film match
    else if (
      (song.album && normalizeSongQuery(query).includes(normalizeSongQuery(song.album))) ||
      (song.film_show && normalizeSongQuery(query).includes(normalizeSongQuery(song.film_show)))
    ) {
      matchType = 'album-film-title';
      confidence = 0.9;
    }

    // 6. Fuzzy match (Levenshtein similarity)
    else {
      const similarity = levenshteinSimilarity(query, song.title);
      if (similarity > 0.75) {
        matchType = 'fuzzy';
        confidence = similarity;
      }
    }

    if (confidence >= minConfidence) {
      matches.push({ song, confidence, matchType: matchType as any });
    }
  }

  if (matches.length === 0) {
    console.log(`[PrivateSongDb] No matches found for query: "${query}"`);
    return null;
  }

  // Sort by confidence (descending)
  matches.sort((a, b) => b.confidence - a.confidence);

  const bestMatch = matches[0];
  console.log(
    `[PrivateSongDb] Found match: "${bestMatch.song.title}" by "${bestMatch.song.singers.join(', ')}" (confidence: ${bestMatch.confidence.toFixed(2)})`
  );

  return bestMatch;
}

/**
 * Get all songs in the database.
 */
export async function getAllSongs(): Promise<AcousticDbSong[]> {
  const db = await loadDatabase();
  return db.songs;
}

/**
 * Get song metadata (for validation/debugging).
 */
export async function getDatabaseMetadata() {
  const db = await loadDatabase();
  return {
    ...db._meta,
    loaded: true,
    cacheHit: !!cachedDatabase,
  };
}

/**
 * Check if private DB is enabled and ready.
 */
export function isPrivateDbEnabled(): boolean {
  const enabled = import.meta.env.VITE_PRIVATE_SONG_DB_ENABLED ?? 'true';
  return enabled.toLowerCase() === 'true';
}

/**
 * Get the minimum confidence threshold from env.
 */
export function getMinConfidenceThreshold(): number {
  const threshold = import.meta.env.VITE_PRIVATE_SONG_DB_MIN_CONFIDENCE;
  if (!threshold) return DEFAULT_MIN_CONFIDENCE;
  const parsed = parseFloat(threshold);
  return isNaN(parsed) ? DEFAULT_MIN_CONFIDENCE : parsed;
}
