import assert from 'node:assert/strict';
import { handleSongsRequest, type SongsDB } from '../server/songsHandler.ts';
import type { Song } from '../types.ts';

// In-memory fake DB scoped by user, so the handler logic is exercised end-to-end
// (auth guard, routing, validation, built-in stripping) without a real Postgres.
const makeDb = () => {
  const store = new Map<string, Map<string, Song>>();
  const bucket = (u: string) => { if (!store.has(u)) store.set(u, new Map()); return store.get(u)!; };
  const db: SongsDB = {
    async listSongs(u) { return [...bucket(u).values()]; },
    async upsertSongs(u, songs) { const b = bucket(u); songs.forEach(s => b.set(s.id, s)); return songs.length; },
    async deleteSong(u, id) { bucket(u).delete(id); },
  };
  return { db, store };
};

const song = (id: string, extra: Partial<Song> = {}): Song => ({ id, title: id, artist: 'x', content: '', createdAt: 1, ...extra });

// ── unauthenticated requests are rejected ──
{
  const { db } = makeDb();
  for (const method of ['GET', 'POST', 'DELETE']) {
    const r = await handleSongsRequest({ method, userId: null }, db);
    assert.equal(r.status, 401, `${method} without session → 401`);
  }
}

// ── GET returns only the caller's songs ──
{
  const { db } = makeDb();
  await db.upsertSongs('alice', [song('a1')]);
  await db.upsertSongs('bob', [song('b1')]);
  const r = await handleSongsRequest({ method: 'GET', userId: 'alice' }, db);
  assert.equal(r.status, 200);
  assert.deepEqual((r.body as any).songs.map((s: Song) => s.id), ['a1'], 'user isolation: only alice sees a1');
}

// ── POST accepts a bare array and a {songs:[]} envelope ──
{
  const { db, store } = makeDb();
  const r1 = await handleSongsRequest({ method: 'POST', userId: 'u', body: [song('x')] }, db);
  assert.equal(r1.status, 200); assert.equal((r1.body as any).written, 1, 'bare array written');
  const r2 = await handleSongsRequest({ method: 'POST', userId: 'u', body: { songs: [song('y')] } }, db);
  assert.equal((r2.body as any).written, 1, 'envelope written');
  assert.deepEqual([...store.get('u')!.keys()].sort(), ['x', 'y']);
}

// ── POST rejects non-arrays, strips built-ins and malformed rows ──
{
  const { db } = makeDb();
  const bad = await handleSongsRequest({ method: 'POST', userId: 'u', body: { nope: true } }, db);
  assert.equal(bad.status, 400, 'non-array body → 400');

  const mixed = await handleSongsRequest({ method: 'POST', userId: 'u', body: [
    song('ok'),
    song('demo', { isBuiltIn: true }),       // built-in must be stripped
    { id: '', title: 'blank' },              // malformed (empty id)
    { title: 'no-id' },                      // malformed (no id)
    'garbage',
  ] }, db);
  assert.equal(mixed.status, 200);
  assert.equal((mixed.body as any).written, 1, 'only the one valid non-built-in song is written');
  const list = await handleSongsRequest({ method: 'GET', userId: 'u' }, db);
  assert.deepEqual((list.body as any).songs.map((s: Song) => s.id), ['ok']);
}

// ── POST enforces the batch cap ──
{
  const { db } = makeDb();
  const many = Array.from({ length: 501 }, (_, i) => song('s' + i));
  const r = await handleSongsRequest({ method: 'POST', userId: 'u', body: many }, db);
  assert.equal(r.status, 413, 'over-cap push → 413');
}

// ── DELETE removes by id, requires id, scoped to the user ──
{
  const { db } = makeDb();
  await db.upsertSongs('u', [song('d1'), song('d2')]);
  const noId = await handleSongsRequest({ method: 'DELETE', userId: 'u', query: {} }, db);
  assert.equal(noId.status, 400, 'DELETE without id → 400');
  const ok = await handleSongsRequest({ method: 'DELETE', userId: 'u', query: { id: 'd1' } }, db);
  assert.equal(ok.status, 200);
  const list = await handleSongsRequest({ method: 'GET', userId: 'u' }, db);
  assert.deepEqual((list.body as any).songs.map((s: Song) => s.id), ['d2'], 'only d1 removed');
}

// ── unknown method → 405 ──
{
  const { db } = makeDb();
  const r = await handleSongsRequest({ method: 'PUT', userId: 'u' }, db);
  assert.equal(r.status, 405, 'PUT → 405');
}

console.log('songs-api handler tests passed');
