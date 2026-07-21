// Pure logic for the Plectrum social layer: profiles/usernames, user search,
// follow (connection) requests, sharing songs, duplication, and notifications.
// No HTTP/DB driver — it takes a parsed request + a SocialDB port, so every rule
// (self-request/duplicate/authorization/revocation) is unit-tested with a fake DB
// (scripts/test-social.ts). The Edge function (api/social.ts) supplies a Neon DB.

import type { Song } from '../types';

export interface Profile {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
}

export type RequestStatus = 'pending' | 'accepted' | 'rejected';

export interface ConnectionRequest {
  id: string;
  senderId: string;
  recipientId: string;
  status: RequestStatus;
}

export interface ShareRow {
  id: string;
  ownerId: string;
  recipientId: string;
  resourceType: string; // 'song'
  resourceId: string;
  revoked: boolean;
}

export interface NotificationRow {
  id: string;
  recipientId: string;
  actorId: string;
  type: string;
  entityId?: string | null;
  read: boolean;
  createdAt: number;
}

export interface PublicUser {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
}

export interface SocialDB {
  getProfile(userId: string): Promise<Profile | null>;
  getProfileByUsername(username: string): Promise<Profile | null>;
  upsertProfile(p: Profile): Promise<void>;
  searchProfiles(query: string, excludeUserId: string, limit: number): Promise<PublicUser[]>;

  getRequestBetween(a: string, b: string): Promise<ConnectionRequest | null>;
  getRequestById(id: string): Promise<ConnectionRequest | null>;
  createRequest(senderId: string, recipientId: string): Promise<ConnectionRequest>;
  setRequestStatus(id: string, status: RequestStatus): Promise<void>;
  deleteRequest(id: string): Promise<void>;
  listRequests(userId: string, box: 'incoming' | 'outgoing'): Promise<ConnectionRequest[]>;

  addConnection(a: string, b: string): Promise<void>;
  removeConnection(a: string, b: string): Promise<void>;
  areConnected(a: string, b: string): Promise<boolean>;
  listConnections(userId: string): Promise<PublicUser[]>;

  getSong(resourceId: string): Promise<(Song & { ownerId: string }) | null>;
  createShare(ownerId: string, recipientId: string, resourceId: string): Promise<ShareRow>;
  getShare(ownerId: string, recipientId: string, resourceId: string): Promise<ShareRow | null>;
  setShareRevoked(id: string, revoked: boolean): Promise<void>;
  listSharesForRecipient(recipientId: string): Promise<Array<ShareRow & { song: Song; ownerUsername: string }>>;
  listSharesByOwner(ownerId: string): Promise<Array<ShareRow & { recipientUsername: string }>>;
  duplicateSongToUser(song: Song, newOwnerId: string, attribution: string): Promise<Song>;

  createNotification(n: Omit<NotificationRow, 'id' | 'read' | 'createdAt'> & { createdAt: number }): Promise<void>;
  listNotifications(userId: string, limit: number): Promise<NotificationRow[]>;
  markNotificationsRead(userId: string): Promise<void>;
}

export interface SocialRequest {
  action?: string;
  userId: string | null;           // authenticated caller
  now: number;                     // injected clock (Date.now at the Edge)
  newId: () => string;             // injected id generator (crypto.randomUUID at the Edge)
  payload?: any;
}

export interface SocialResult { status: number; body: unknown; }

const ok = (body: unknown): SocialResult => ({ status: 200, body });
const err = (status: number, error: string): SocialResult => ({ status, body: { error } });

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const normalizeUsername = (u: string): string => String(u ?? '').trim().toLowerCase();
export const isValidUsername = (u: string): boolean => USERNAME_RE.test(normalizeUsername(u));

export const handleSocial = async (req: SocialRequest, db: SocialDB): Promise<SocialResult> => {
  if (!req.userId) return err(401, 'unauthorized');
  const me = req.userId;
  const p = req.payload ?? {};

  switch (req.action) {
    // ── Profile ──────────────────────────────────────────────────────────────
    case 'profile.me':
      return ok({ profile: await db.getProfile(me) });

    case 'profile.setUsername': {
      const username = normalizeUsername(p.username);
      const displayName = String(p.displayName ?? '').trim().slice(0, 60) || username;
      if (!isValidUsername(username)) return err(400, 'username must be 3–20 chars: letters, numbers, underscore');
      const existing = await db.getProfileByUsername(username);
      if (existing && existing.userId !== me) return err(409, 'that username is taken');
      await db.upsertProfile({ userId: me, username, displayName, avatarUrl: p.avatarUrl ?? null });
      return ok({ profile: await db.getProfile(me) });
    }

    // ── Search ────────────────────────────────────────────────────────────────
    case 'users.search': {
      const q = normalizeUsername(p.query);
      if (q.length < 2) return ok({ users: [] });
      const users = await db.searchProfiles(q, me, 20);
      return ok({ users });
    }

    // ── Connection requests ─────────────────────────────────────────────────
    case 'connections.request': {
      const recipientId = String(p.recipientId ?? '');
      if (!recipientId) return err(400, 'recipient required');
      if (recipientId === me) return err(400, 'you cannot connect with yourself');
      if (await db.areConnected(me, recipientId)) return err(409, 'already connected');
      const existing = await db.getRequestBetween(me, recipientId);
      if (existing && existing.status === 'pending') return err(409, 'a request is already pending');
      const reqRow = await db.createRequest(me, recipientId);
      await db.createNotification({ recipientId, actorId: me, type: 'connection_request', entityId: reqRow.id, createdAt: req.now });
      return ok({ request: reqRow });
    }

    case 'connections.accept': {
      const request = await db.getRequestById(String(p.requestId ?? ''));
      if (!request || request.recipientId !== me) return err(404, 'request not found');
      if (request.status !== 'pending') return err(409, 'request is not pending');
      await db.setRequestStatus(request.id, 'accepted');
      await db.addConnection(request.senderId, request.recipientId);
      await db.createNotification({ recipientId: request.senderId, actorId: me, type: 'request_accepted', entityId: request.id, createdAt: req.now });
      return ok({ accepted: true });
    }

    case 'connections.reject': {
      const request = await db.getRequestById(String(p.requestId ?? ''));
      if (!request || request.recipientId !== me) return err(404, 'request not found');
      if (request.status !== 'pending') return err(409, 'request is not pending');
      await db.setRequestStatus(request.id, 'rejected');
      return ok({ rejected: true });
    }

    case 'connections.cancel': {
      const request = await db.getRequestById(String(p.requestId ?? ''));
      if (!request || request.senderId !== me) return err(404, 'request not found');
      await db.deleteRequest(request.id);
      return ok({ cancelled: true });
    }

    case 'connections.remove': {
      const other = String(p.userId ?? '');
      if (!other) return err(400, 'user required');
      await db.removeConnection(me, other);
      return ok({ removed: true });
    }

    case 'connections.list':
      return ok({
        connections: await db.listConnections(me),
        incoming: await db.listRequests(me, 'incoming'),
        outgoing: await db.listRequests(me, 'outgoing'),
      });

    // ── Sharing ────────────────────────────────────────────────────────────────
    case 'shares.create': {
      const recipientId = String(p.recipientId ?? '');
      const resourceId = String(p.resourceId ?? '');
      if (!recipientId || !resourceId) return err(400, 'recipient and resource required');
      if (recipientId === me) return err(400, 'you already own this');
      const song = await db.getSong(resourceId);
      if (!song || song.ownerId !== me) return err(403, 'you can only share songs you own'); // ownership check
      // Optional connection gate: only share with accepted connections.
      if (!(await db.areConnected(me, recipientId))) return err(403, 'connect with this user before sharing');
      const existing = await db.getShare(me, recipientId, resourceId);
      if (existing && !existing.revoked) return err(409, 'already shared with this user');
      const share = existing
        ? (await db.setShareRevoked(existing.id, false), existing)
        : await db.createShare(me, recipientId, resourceId);
      await db.createNotification({ recipientId, actorId: me, type: 'song_shared', entityId: resourceId, createdAt: req.now });
      return ok({ share });
    }

    case 'shares.revoke': {
      const recipientId = String(p.recipientId ?? '');
      const resourceId = String(p.resourceId ?? '');
      const share = await db.getShare(me, recipientId, resourceId);
      if (!share || share.ownerId !== me) return err(404, 'share not found'); // only owner may revoke
      await db.setShareRevoked(share.id, true);
      return ok({ revoked: true });
    }

    case 'shares.withMe':
      return ok({ shares: await db.listSharesForRecipient(me) });

    case 'shares.byMe':
      return ok({ shares: await db.listSharesByOwner(me) });

    case 'shares.duplicate': {
      const resourceId = String(p.resourceId ?? '');
      const share = await db.getShare(String(p.ownerId ?? ''), me, resourceId);
      // Recipient may duplicate only if a live (non-revoked) share exists to them.
      if (!share || share.recipientId !== me || share.revoked) return err(403, 'no access to this item');
      const song = await db.getSong(resourceId);
      if (!song) return err(404, 'song not found');
      const owner = await db.getProfile(song.ownerId);
      const copy = await db.duplicateSongToUser(song, me, owner?.username || 'a Plectrum user');
      return ok({ song: copy });
    }

    // ── Notifications ─────────────────────────────────────────────────────────
    case 'notifications.list':
      return ok({ notifications: await db.listNotifications(me, 30) });

    case 'notifications.markRead':
      await db.markNotificationsRead(me);
      return ok({ read: true });

    default:
      return err(400, 'unknown action');
  }
};
