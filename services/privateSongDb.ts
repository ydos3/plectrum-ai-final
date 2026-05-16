/**
 * Song search query normalization and matching utilities.
 * Handles case normalization, punctuation removal, and fuzzy matching.
 */

/**
 * Normalize a search query for comparison.
 * - lowercase
 * - remove punctuation
 * - collapse whitespace
 * - light handling of Indic transliterations
 */
export const normalizeSongQuery = (query: string): string => {
  return (
    query
      .toLowerCase()
      .trim()
      // Remove common punctuation
      .replace(/[!?.,'"-]/g, ' ')
      // Remove diacritics/accents (basic)
      .replace(/[\u0300-\u036f]/g, '')
      // Collapse multiple spaces
      .replace(/\s+/g, ' ')
      .trim()
  );
};

/**
 * Simple Levenshtein distance for fuzzy matching.
 * Returns similarity score from 0 to 1.
 */
export const levenshteinSimilarity = (a: string, b: string): number => {
  const normalized_a = normalizeSongQuery(a);
  const normalized_b = normalizeSongQuery(b);

  if (normalized_a === normalized_b) return 1;
  if (!normalized_a || !normalized_b) return 0;

  const maxLen = Math.max(normalized_a.length, normalized_b.length);
  const distance = levenshteinDistance(normalized_a, normalized_b);
  return 1 - distance / maxLen;
};

/**
 * Calculate Levenshtein distance between two strings.
 */
const levenshteinDistance = (a: string, b: string): number => {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
};

/**
 * Check if a query string is contained in a target string (normalized).
 * At least 3 characters of query must match.
 */
export const isPartialMatch = (
  query: string,
  target: string,
  minChars: number = 3
): boolean => {
  const norm_query = normalizeSongQuery(query);
  const norm_target = normalizeSongQuery(target);

  if (norm_query.length < minChars) return false;
  return norm_target.includes(norm_query);
};

/**
 * Exact title match (after normalization).
 */
export const isExactTitleMatch = (query: string, title: string): boolean => {
  return normalizeSongQuery(query) === normalizeSongQuery(title);
};

/**
 * Check if query matches title + singer combination.
 */
export const isTitleSingerMatch = (
  query: string,
  title: string,
  singers: string[]
): boolean => {
  const norm_query = normalizeSongQuery(query);
  const combined = `${normalizeSongQuery(title)} ${singers
    .map(normalizeSongQuery)
    .join(' ')}`;

  return combined.includes(norm_query) || norm_query.includes(normalizeSongQuery(title));
};

/**
 * Filter out common filler words to improve matching quality.
 */
export const removeFillerWords = (query: string): string => {
  const fillerWords = ['the', 'a', 'an', 'by', 'by', 'from', 'and', 'or'];
  return normalizeSongQuery(query)
    .split(' ')
    .filter(word => !fillerWords.includes(word))
    .join(' ');
};
