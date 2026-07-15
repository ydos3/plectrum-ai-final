// Songs CRUD API — thin Vercel adapter around the pure handler
// (server/songsHandler.ts, unit-tested) backed by Neon Postgres.
//   GET    /api/songs        → { songs: Song[] }   (the caller's library)
//   POST   /api/songs        → { written: number } (upsert array or {songs:[]})
//   DELETE /api/songs?id=ID  → { deleted: id }
// Every route requires a valid Auth.js session cookie.

import { handleSongsRequest } from '../server/songsHandler';
import { neonSongsDB, ensureSchema, isDbConfigured } from '../server/db';
import { getUserId } from '../server/session';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let schemaReady: Promise<void> | null = null;
const ready = () => (schemaReady ??= ensureSchema());

export default async function handler(request: Request): Promise<Response> {
  if (!isDbConfigured()) return json(503, { error: 'cloud sync not configured' });

  try {
    await ready();

    const userId = await getUserId(request);
    const url = new URL(request.url);

    // Only parse a body for methods that carry one.
    let body: unknown;
    if (request.method === 'POST' || request.method === 'PUT') {
      body = await request.json().catch(() => undefined);
    }

    const result = await handleSongsRequest(
      {
        method: request.method,
        userId,
        body,
        query: { id: url.searchParams.get('id') ?? undefined },
      },
      neonSongsDB,
    );
    return json(result.status, result.body);
  } catch (err) {
    console.error('songs api error', err);
    return json(500, { error: 'internal error' });
  }
}
