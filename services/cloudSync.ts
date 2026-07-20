// Client-side cloud sync: pull the user's cloud library, merge it with the local
// one (pure logic in songSync.ts), persist the result, and push anything the
// cloud is missing or has an older copy of. Local storage stays the source of
// truth offline — this is the "keep local + optional cloud sync" model.

import type { Song } from '../types';
import { getSongs, replaceLibrary, setSongsChangeListener } from './storageService';
import { mergeLibraries, syncable } from './songSync';
import { cloudSyncEnabled } from './authClient';
import { cloudAuthHeader, isCloudSignedIn } from './emailAuth';

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';
let statusListener: ((s: SyncStatus) => void) | null = null;
export const setSyncStatusListener = (fn: ((s: SyncStatus) => void) | null): void => { statusListener = fn; };
const setStatus = (s: SyncStatus) => { try { statusListener?.(s); } catch { /* ignore */ } };

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

// ─── Automatic background sync ───────────────────────────────────────────────
// No manual "Save"/"Sync": every local edit schedules a debounced push, and we
// pull on start. syncNow's replaceLibrary write does NOT re-fire this (only
// saveSong/deleteSong notify), so there is no loop.
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let queued = false;
let started = false;

const runSyncGuarded = async (): Promise<void> => {
  if (!cloudSyncEnabled() || !isCloudSignedIn()) return;
  if (inFlight) { queued = true; return; }
  inFlight = true;
  setStatus('saving');
  try {
    await syncNow();
    setStatus('saved');
  } catch (e: any) {
    setStatus(e?.message === 'not signed in' ? 'idle' : 'error');
  } finally {
    inFlight = false;
    if (queued) { queued = false; void runSyncGuarded(); }
  }
};

/** Debounced auto-sync trigger — safe to call on every edit. */
export const scheduleAutoSync = (delayMs = 1500): void => {
  if (!cloudSyncEnabled() || !isCloudSignedIn()) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { void runSyncGuarded(); }, delayMs);
};

/** Force an immediate sync (e.g. right after sign-in, or before unload). */
export const syncNowSafe = (): Promise<void> => runSyncGuarded();

/**
 * Wire automatic sync once, at app start. Pulls immediately (if signed in),
 * pushes local edits on a debounce, and flushes on tab close.
 */
export const startAutoSync = (): void => {
  if (started || !cloudSyncEnabled()) return;
  started = true;
  setSongsChangeListener(() => scheduleAutoSync());
  if (typeof window !== 'undefined') {
    // Best-effort flush of pending edits before the tab closes.
    window.addEventListener('pagehide', () => { if (isCloudSignedIn()) void runSyncGuarded(); });
    window.addEventListener('online', () => { if (isCloudSignedIn()) void runSyncGuarded(); });
  }
  // Initial reconcile on load.
  void runSyncGuarded();
};
