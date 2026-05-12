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

  // Pick best match (first non-instrumental result)
  let best = results.find(r => !r.instrumental) || results[0];

  // Enforce Exact Match Prioritization if available
  const exactMatch = results.find(r => 
    !r.instrumental && 
    r.trackName.toLowerCase() === query.toLowerCase()
  );
  if (exactMatch) {
    best = exactMatch;
  }

  console.log('[SongDB] LRCLIB hit:', best.trackName, '-', best.artistName);

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
