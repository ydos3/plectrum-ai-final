// Pure, deterministic library-merge logic for optional cloud sync. It has NO
// network/DOM/storage dependencies so the conflict-resolution rules — the part
// most likely to hide subtle bugs — are unit-testable headlessly (see
// scripts/test-song-sync.ts), the same discipline the Air Strum engine uses.
//
// Model: last-write-wins by `updatedAt` (falling back to `createdAt`). Built-in
// demo songs are bundled with the app, never synced. A user-initiated sync both
// pulls newer remote songs into the local library AND reports which local songs
// are newer/absent remotely so the caller can push them up.

import type { Song } from '../types';

/** Effective modification time for ordering — updatedAt if present, else createdAt, else 0. */
export const songStamp = (s: Song): number =>
  typeof s.updatedAt === 'number' ? s.updatedAt
  : typeof s.createdAt === 'number' ? s.createdAt
  : 0;

/** Songs that participate in sync — everything except bundled built-in demos. */
export const syncable = (songs: Song[]): Song[] => songs.filter(s => !s.isBuiltIn);

export interface MergeResult {
  /** The reconciled library to persist locally (built-ins preserved, newest wins). */
  merged: Song[];
  /** Local songs that are newer than (or absent from) the remote → caller should push these. */
  toPush: Song[];
}

/**
 * Merge a local library with the remote (cloud) library.
 *  • For each id present in both, the newer copy (by songStamp) wins.
 *  • Remote-only songs are pulled into the merged result.
 *  • Local-only or local-newer syncable songs are returned in `toPush`.
 *  • Built-in demos are kept from local and never pushed.
 * Deterministic and side-effect free.
 */
export const mergeLibraries = (local: Song[], remote: Song[]): MergeResult => {
  const builtIns = local.filter(s => s.isBuiltIn);
  const localSync = syncable(local);
  const remoteSync = syncable(remote); // defensive: remote should never hold built-ins

  const remoteById = new Map(remoteSync.map(s => [s.id, s]));
  const localById = new Map(localSync.map(s => [s.id, s]));

  const mergedSync: Song[] = [];
  const toPush: Song[] = [];

  // Every id across both sides, order-stable: local order first, then remote-only.
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const s of localSync) if (!seen.has(s.id)) { seen.add(s.id); ids.push(s.id); }
  for (const s of remoteSync) if (!seen.has(s.id)) { seen.add(s.id); ids.push(s.id); }

  for (const id of ids) {
    const l = localById.get(id);
    const r = remoteById.get(id);
    if (l && r) {
      // Present both sides — newest wins; ties keep remote (already durable in cloud).
      if (songStamp(l) > songStamp(r)) { mergedSync.push(l); toPush.push(l); }
      else mergedSync.push(r);
    } else if (l && !r) {
      // Local only — keep and push up.
      mergedSync.push(l); toPush.push(l);
    } else if (r) {
      // Remote only — pull down.
      mergedSync.push(r);
    }
  }

  return { merged: [...builtIns, ...mergedSync], toPush };
};
