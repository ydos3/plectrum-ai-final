// Pure request-handling logic for the songs API — no HTTP, no DB driver, no
// framework. It takes a parsed request + a SongsDB port and returns a status +
// JSON body. This lets the auth guard, method routing and payload validation be
// unit-tested with a fake DB (scripts/test-songs-api.ts), so the logic most
// likely to hide bugs is verified without a live Postgres. The Vercel function
// (api/songs.ts) is a thin adapter that supplies a real Neon-backed SongsDB.

import type { Song } from '../types';

export interface SongsDB {
  listSongs(userId: string): Promise<Song[]>;
  /** Upsert the given songs for the user; returns the count written. */
  upsertSongs(userId: string, songs: Song[]): Promise<number>;
  deleteSong(userId: string, id: string): Promise<void>;
}

export interface ParsedRequest {
  method: string;
  /** Authenticated user id, or null when there is no valid session. */
  userId: string | null;
  /** Parsed JSON body (already validated as JSON upstream), or undefined. */
  body?: unknown;
  /** Query params (e.g. ?id=…). */
  query?: Record<string, string | undefined>;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

const MAX_SONGS_PER_PUSH = 500;

/** True when x looks like a persistable Song (has a non-empty string id + title). */
const isSong = (x: unknown): x is Song =>
  !!x && typeof x === 'object'
  && typeof (x as any).id === 'string' && (x as any).id.length > 0
  && typeof (x as any).title === 'string';

export const handleSongsRequest = async (req: ParsedRequest, db: SongsDB): Promise<HandlerResult> => {
  // Every songs operation requires a signed-in user.
  if (!req.userId) return { status: 401, body: { error: 'unauthorized' } };

  switch (req.method) {
    case 'GET': {
      const songs = await db.listSongs(req.userId);
      return { status: 200, body: { songs } };
    }

    case 'POST': {
      // Body may be a bare array of songs or { songs: [...] }.
      const raw = Array.isArray(req.body) ? req.body : (req.body as any)?.songs;
      if (!Array.isArray(raw)) return { status: 400, body: { error: 'expected an array of songs' } };
      // Never let a client persist built-in demo content or malformed rows.
      const songs = raw.filter(isSong).filter(s => !(s as Song).isBuiltIn) as Song[];
      if (songs.length > MAX_SONGS_PER_PUSH) {
        return { status: 413, body: { error: `too many songs (max ${MAX_SONGS_PER_PUSH})` } };
      }
      const written = await db.upsertSongs(req.userId, songs);
      return { status: 200, body: { written } };
    }

    case 'DELETE': {
      const id = req.query?.id;
      if (!id) return { status: 400, body: { error: 'missing id' } };
      await db.deleteSong(req.userId, id);
      return { status: 200, body: { deleted: id } };
    }

    default:
      return { status: 405, body: { error: 'method not allowed' } };
  }
};
