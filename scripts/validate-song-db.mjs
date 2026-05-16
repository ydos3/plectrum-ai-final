import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const dbPath = path.join(projectRoot, 'data', 'acoustic_setlist_db.min.json');

const noiseWords = new Set([
  'lyrics', 'lyric', 'chords', 'chord', 'guitar', 'tabs', 'tab', 'karaoke',
  'cover', 'song', 'acoustic', 'strumming', 'capo', 'tutorial', 'lesson',
  'official', 'video', 'audio', 'easy', 'beginner', 'with', 'without',
]);

const normalizeHinglish = value => value
  .replace(/\bbanale\b/g, 'bana le')
  .replace(/\bbanaale\b/g, 'bana le')
  .replace(/\btumhi\b/g, 'tum hi')
  .replace(/\bapnaa\b/g, 'apna')
  .replace(/\bkesriya\b/g, 'kesariya')
  .replace(/\bchana\b/g, 'channa')
  .replace(/\bmereyaa\b/g, 'mereya')
  .replace(/\barijeet\b/g, 'arijit')
  .replace(/\barjit\b/g, 'arijit')
  .replace(/\bedsheeran\b/g, 'ed sheeran');

const normalizeSongQuery = query => normalizeHinglish(
  String(query)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u0900-\u097F]+/gi, ' ')
    .toLowerCase()
)
  .split(/\s+/)
  .map(token => token.trim())
  .filter(Boolean)
  .filter(token => !noiseWords.has(token))
  .join(' ')
  .trim()
  .replace(/\s+/g, ' ');

const tokenize = value => normalizeSongQuery(value).split(' ').filter(token => token.length > 1);
const compact = value => normalizeSongQuery(value).replace(/\s+/g, '');
const uniqueTokens = value => Array.from(new Set(tokenize(value)));

const tokenOverlap = (queryTokens, target) => {
  if (!queryTokens.length) return 0;
  const targetTokens = new Set(tokenize(target));
  return queryTokens.filter(token => targetTokens.has(token)).length / queryTokens.length;
};

const bigrams = value => {
  const clean = compact(value);
  if (clean.length < 2) return clean ? [clean] : [];
  return Array.from({ length: clean.length - 1 }, (_, index) => clean.slice(index, index + 2));
};

const diceSimilarity = (a, b) => {
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  if (!aGrams.length || !bGrams.length) return normalizeSongQuery(a) === normalizeSongQuery(b) ? 1 : 0;
  const bCounts = new Map();
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

const scoreSong = (query, song) => {
  const normalizedQuery = normalizeSongQuery(query);
  const queryTokens = uniqueTokens(query);
  const title = normalizeSongQuery(song.title || '');
  const titleCompact = compact(song.title || '');
  const queryCompact = compact(query);
  const artists = normalizeSongQuery((song.singers || []).join(' '));
  const albumFilm = normalizeSongQuery([song.album, song.film_show].filter(Boolean).join(' '));
  const keywords = normalizeSongQuery([
    song.title,
    ...(song.singers || []),
    song.album,
    song.film_show,
    song.composer,
    song.lyricist,
    ...(song.language || []),
    ...(song.genre || []),
  ].filter(Boolean).join(' '));

  if (normalizedQuery && normalizedQuery === title) return 0.95;
  if (queryCompact && titleCompact && queryCompact === titleCompact) return 0.94;

  const titleOverlap = tokenOverlap(queryTokens, title);
  const artistOverlap = tokenOverlap(queryTokens, artists);
  const keywordOverlap = tokenOverlap(queryTokens, keywords);
  const albumOverlap = tokenOverlap(queryTokens, albumFilm);
  const titleSimilarity = diceSimilarity(normalizedQuery, title);

  let confidence = 0;
  if (title && normalizedQuery.includes(title) && title.length >= 4) confidence = Math.max(confidence, artistOverlap > 0 ? 0.88 : 0.84);
  if (titleCompact && queryCompact.includes(titleCompact) && titleCompact.length >= 5) confidence = Math.max(confidence, artistOverlap > 0 ? 0.89 : 0.85);
  if (titleOverlap >= 1 && artistOverlap > 0) confidence = Math.max(confidence, 0.88);
  else if (titleOverlap >= 1) confidence = Math.max(confidence, 0.84);
  else if (titleOverlap >= 0.67 && queryTokens.length >= 2) confidence = Math.max(confidence, 0.76 + (artistOverlap > 0 ? 0.08 : 0));
  if (keywordOverlap >= 0.8 && queryTokens.length >= 2) confidence = Math.max(confidence, 0.82);
  if (albumOverlap >= 0.8 && queryTokens.length >= 2) confidence = Math.max(confidence, 0.82);
  if (titleSimilarity >= 0.9) confidence = Math.max(confidence, 0.82);
  else if (titleSimilarity >= 0.78) confidence = Math.max(confidence, 0.70 + ((titleSimilarity - 0.78) * 0.55));
  if (artistOverlap > 0 && confidence >= 0.70) confidence = Math.min(0.93, confidence + 0.04);
  return Math.min(0.99, confidence);
};

const search = (songs, query) => {
  const scored = songs
    .map(song => ({ song, confidence: scoreSong(query, song) }))
    .filter(item => item.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
  const best = scored[0];
  const second = scored[1];
  const gap = best ? best.confidence - (second?.confidence || 0) : 0;
  const found = Boolean(best && (best.confidence >= 0.82 || (best.confidence >= 0.70 && gap >= 0.14)));
  return { found, best, second };
};

const samples = [
  'apna bana le chords',
  'apna banale arijit',
  'kesariya guitar tabs',
  'majboor acoustic',
  'perfect ed sheeran chords',
  'finding her guitar',
  'unknown random song not in db',
];

try {
  const raw = fs.readFileSync(dbPath, 'utf8');
  const parsed = JSON.parse(raw);
  const songs = Array.isArray(parsed) ? parsed : parsed.songs;
  if (!Array.isArray(songs)) throw new Error('Database root must be an array or an object with songs[].');
  const usable = songs.filter(song => typeof song?.title === 'string' && song.title.trim());
  if (!usable.length) throw new Error('No usable song title fields were found.');

  console.log(`Parsed ${path.relative(projectRoot, dbPath)} successfully.`);
  console.log(`Usable songs: ${usable.length}`);
  console.log('');

  for (const query of samples) {
    const result = search(usable, query);
    if (result.found) {
      const singers = (result.best.song.singers || []).join(', ');
      console.log(`DB      ${query} -> ${result.best.song.title}${singers ? ` by ${singers}` : ''} (${result.best.confidence.toFixed(2)})`);
    } else {
      const best = result.best ? ` best: ${result.best.song.title} (${result.best.confidence.toFixed(2)})` : '';
      console.log(`GEMINI  ${query} -> would fallback${best}`);
    }
  }
} catch (error) {
  console.error(`Song DB validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
