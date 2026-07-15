import assert from 'node:assert/strict';
import { mergeLibraries, songStamp, syncable } from '../services/songSync.ts';
import type { Song } from '../types.ts';

// Minimal Song factory for tests.
const song = (id: string, extra: Partial<Song> = {}): Song => ({
  id, title: id, artist: 'x', content: '', createdAt: 1000, ...extra,
});

// ── songStamp ordering ──
{
  assert.equal(songStamp(song('a')), 1000, 'falls back to createdAt');
  assert.equal(songStamp(song('a', { updatedAt: 5000 })), 5000, 'prefers updatedAt');
  assert.equal(songStamp(song('a', { createdAt: undefined as any, updatedAt: undefined })), 0, 'missing → 0');
}

// ── built-ins never sync ──
{
  const lib = [song('demo', { isBuiltIn: true }), song('mine')];
  assert.deepEqual(syncable(lib).map(s => s.id), ['mine'], 'built-ins excluded from sync set');
}

// ── local-only song is kept and pushed ──
{
  const { merged, toPush } = mergeLibraries([song('a', { updatedAt: 10 })], []);
  assert.deepEqual(merged.map(s => s.id), ['a'], 'local-only kept');
  assert.deepEqual(toPush.map(s => s.id), ['a'], 'local-only pushed');
}

// ── remote-only song is pulled, not pushed ──
{
  const { merged, toPush } = mergeLibraries([], [song('b', { updatedAt: 10 })]);
  assert.deepEqual(merged.map(s => s.id), ['b'], 'remote-only pulled');
  assert.deepEqual(toPush, [], 'remote-only not pushed');
}

// ── conflict: newer local wins and is pushed ──
{
  const local = [song('c', { title: 'LOCAL', updatedAt: 200 })];
  const remote = [song('c', { title: 'REMOTE', updatedAt: 100 })];
  const { merged, toPush } = mergeLibraries(local, remote);
  assert.equal(merged.find(s => s.id === 'c')!.title, 'LOCAL', 'newer local wins');
  assert.deepEqual(toPush.map(s => s.id), ['c'], 'newer local pushed');
}

// ── conflict: newer remote wins and is NOT pushed ──
{
  const local = [song('c', { title: 'LOCAL', updatedAt: 100 })];
  const remote = [song('c', { title: 'REMOTE', updatedAt: 300 })];
  const { merged, toPush } = mergeLibraries(local, remote);
  assert.equal(merged.find(s => s.id === 'c')!.title, 'REMOTE', 'newer remote wins');
  assert.deepEqual(toPush, [], 'remote-newer not pushed');
}

// ── tie prefers remote (already durable) and does not push ──
{
  const local = [song('c', { title: 'LOCAL', updatedAt: 100 })];
  const remote = [song('c', { title: 'REMOTE', updatedAt: 100 })];
  const { merged, toPush } = mergeLibraries(local, remote);
  assert.equal(merged.find(s => s.id === 'c')!.title, 'REMOTE', 'tie → remote');
  assert.deepEqual(toPush, [], 'tie not pushed');
}

// ── built-ins preserved in merged, never pushed ──
{
  const local = [song('demo', { isBuiltIn: true }), song('mine', { updatedAt: 5 })];
  const remote = [song('cloud', { updatedAt: 9 })];
  const { merged, toPush } = mergeLibraries(local, remote);
  assert.ok(merged.some(s => s.id === 'demo' && s.isBuiltIn), 'built-in kept locally');
  assert.ok(merged.some(s => s.id === 'cloud'), 'remote pulled');
  assert.ok(merged.some(s => s.id === 'mine'), 'local kept');
  assert.deepEqual(toPush.map(s => s.id).sort(), ['mine'], 'only real local-new song pushed (no built-ins)');
}

// ── realistic three-way: some local-new, some remote-new, some shared ──
{
  const local = [
    song('shared-lwin', { updatedAt: 500 }),
    song('shared-rwin', { updatedAt: 100 }),
    song('local-new', { updatedAt: 300 }),
    song('demo', { isBuiltIn: true }),
  ];
  const remote = [
    song('shared-lwin', { updatedAt: 200 }),
    song('shared-rwin', { updatedAt: 900 }),
    song('remote-new', { updatedAt: 400 }),
  ];
  const { merged, toPush } = mergeLibraries(local, remote);
  const ids = merged.map(s => s.id).sort();
  assert.deepEqual(ids, ['demo', 'local-new', 'remote-new', 'shared-lwin', 'shared-rwin'], 'union of all ids');
  assert.deepEqual(toPush.map(s => s.id).sort(), ['local-new', 'shared-lwin'], 'push local-new + local-won conflicts');
  // Idempotency: merging the merged result against remote again pushes the same/subset and never loses songs.
  const again = mergeLibraries(merged, remote);
  assert.deepEqual(again.merged.map(s => s.id).sort(), ids, 're-merge preserves the full library');
}

console.log('song-sync tests passed');
