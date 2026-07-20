// Client-side cloud sync: pull the user's cloud library, merge it with the local
// one (pure logic in songSync.ts), persist the result, and push anything the
// cloud is missing or has an older copy of. Local storage stays the source of
// truth offline — this is the "keep local + optional cloud sync" model.

import type { Song } from '../types';
import { getSongs, replaceLibrary } from './storageService';
import { mergeLibraries, syncable } from './songSync';
import { cloudSyncEnabled } from './authClient';
import { cloudAuthHeader, isCloudSignedIn } from './emailAuth';

export interface SyncOutcome {
  pulled: number;   // songs that came from the cloud into the merged library
  pushed: number;   // songs uploaded to the cloud
  total: number;    // size of the reconciled library (excl. built-ins)
}

const getRemoteSongs = async (): Promise<Song[]> => {
  const res = await fetch('/api/songs', { headers: { ...cloudAuthHeader() } });
  if (res.status === 401) throw new Error('not signed in');
  if (!res.ok) throw new Error(`sync failed (${res.status})`);
  const data = await res.json().catch(() => ({ songs: [] }));
  return Array.isArray(data.songs) ? (data.songs as Song[]) : [];
};

const pushSongs = async (songs: Song[]): Promise<number> => {
  if (songs.length === 0) return 0;
  const res = await fetch('/api/songs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...cloudAuthHeader() },
    body: JSON.stringify({ songs }),
  });
  if (!res.ok) throw new Error(`push failed (${res.status})`);
  const data = await res.json().catch(() => ({ written: 0 }));
  return typeof data.written === 'number' ? data.written : 0;
};

/**
 * Run a full two-way sync. Throws if sync is disabled or the user is not signed
 * in, so callers can surface a clear message. Safe to call repeatedly.
 */
export const syncNow = async (): Promise<SyncOutcome> => {
  if (!cloudSyncEnabled()) throw new Error('cloud sync is not enabled');
  if (!isCloudSignedIn()) throw new Error('not signed in');

  const local = getSongs();
  const remote = await getRemoteSongs();
  const { merged, toPush } = mergeLibraries(local, remote);

  // Persist the reconciled library locally without re-stamping timestamps.
  replaceLibrary(merged);

  const pushed = await pushSongs(toPush);

  const remoteIds = new Set(remote.map(s => s.id));
  const pulled = syncable(merged).filter(s => remoteIds.has(s.id) && !local.some(l => l.id === s.id)).length;

  return { pulled, pushed, total: syncable(merged).length };
};
