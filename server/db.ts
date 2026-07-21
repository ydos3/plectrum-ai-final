// Neon (Vercel Postgres) data layer. Vercel's native Postgres integration is
// Neon; the connection string is provided via DATABASE_URL (or POSTGRES_URL).
// The whole song document is stored as JSONB keyed by (user_id, id) so the
// schema never has to track the evolving Song shape — the app owns that.

import { neon } from '@neondatabase/serverless';
import type { Song } from '../types';
import type { SongsDB } from './songsHandler';
import type { UsersDB, CloudUser } from './emailAuthHandler';
import type { SocialDB, Profile, ConnectionRequest, ShareRow, NotificationRow, PublicUser } from './socialHandler';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

/** True when a Postgres connection string is configured (cloud sync can run). */
export const isDbConfigured = (): boolean => connectionString.length > 0;

// A single HTTP-based Neon client is safe to reuse across serverless invocations.
const sql = connectionString ? neon(connectionString) : null;

const requireSql = () => {
  if (!sql) throw new Error('DATABASE_URL is not configured');
  return sql;
};

/**
 * Create the songs table if it does not exist. Auth.js tables are created by the
 * @auth/pg-adapter migration (see server/schema.sql). Safe to call repeatedly.
 */
export const ensureSchema = async (): Promise<void> => {
  const db = requireSql();
  await db`
    CREATE TABLE IF NOT EXISTS songs (
      user_id    TEXT        NOT NULL,
      id         TEXT        NOT NULL,
      data       JSONB       NOT NULL,
      updated_at BIGINT      NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, id)
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS songs_user_idx ON songs (user_id)`;
  // Email+password accounts (separate from any Auth.js OAuth tables).
  await db`
    CREATE TABLE IF NOT EXISTS cloud_users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    BIGINT NOT NULL DEFAULT 0
    )
  `;
  // ── Social layer ──
  await db`
    CREATE TABLE IF NOT EXISTS profiles (
      user_id      TEXT PRIMARY KEY,
      username     TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      avatar_url   TEXT,
      created_at   BIGINT NOT NULL DEFAULT 0,
      updated_at   BIGINT NOT NULL DEFAULT 0
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS profiles_username_idx ON profiles (username)`;
  await db`
    CREATE TABLE IF NOT EXISTS connection_requests (
      id           TEXT PRIMARY KEY,
      sender_id    TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   BIGINT NOT NULL DEFAULT 0,
      UNIQUE (sender_id, recipient_id)
    )
  `;
  await db`
    CREATE TABLE IF NOT EXISTS connections (
      a_id       TEXT NOT NULL,
      b_id       TEXT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (a_id, b_id)
    )
  `;
  await db`
    CREATE TABLE IF NOT EXISTS shares (
      id            TEXT PRIMARY KEY,
      owner_id      TEXT NOT NULL,
      recipient_id  TEXT NOT NULL,
      resource_type TEXT NOT NULL DEFAULT 'song',
      resource_id   TEXT NOT NULL,
      revoked_at    BIGINT,
      created_at    BIGINT NOT NULL DEFAULT 0,
      UNIQUE (owner_id, recipient_id, resource_id)
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS shares_recipient_idx ON shares (recipient_id)`;
  await db`
    CREATE TABLE IF NOT EXISTS notifications (
      id           TEXT PRIMARY KEY,
      recipient_id TEXT NOT NULL,
      actor_id     TEXT NOT NULL,
      type         TEXT NOT NULL,
      entity_id    TEXT,
      read_at      BIGINT,
      created_at   BIGINT NOT NULL DEFAULT 0
    )
  `;
  await db`CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications (recipient_id, created_at DESC)`;
};

// Sorted pair so a connection is stored once regardless of direction.
const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

export const neonUsersDB: UsersDB = {
  async getUserByEmail(email: string): Promise<CloudUser | null> {
    const db = requireSql();
    const rows = (await db`SELECT id, email, password_hash FROM cloud_users WHERE email = ${email} LIMIT 1`) as
      { id: string; email: string; password_hash: string }[];
    if (rows.length === 0) return null;
    return { id: rows[0].id, email: rows[0].email, passwordHash: rows[0].password_hash };
  },

  async createUser(email: string, passwordHash: string): Promise<CloudUser> {
    const db = requireSql();
    const id = crypto.randomUUID();
    await db`
      INSERT INTO cloud_users (id, email, password_hash, created_at)
      VALUES (${id}, ${email}, ${passwordHash}, ${Date.now()})
    `;
    return { id, email, passwordHash };
  },
};

export const neonSongsDB: SongsDB = {
  async listSongs(userId: string): Promise<Song[]> {
    const db = requireSql();
    const rows = (await db`SELECT data FROM songs WHERE user_id = ${userId} ORDER BY updated_at DESC`) as { data: Song }[];
    return rows.map(r => r.data);
  },

  async upsertSongs(userId: string, songs: Song[]): Promise<number> {
    if (songs.length === 0) return 0;
    const db = requireSql();
    // One upsert per song; the batch is capped upstream (handler) so this stays small.
    for (const s of songs) {
      const updatedAt = typeof s.updatedAt === 'number' ? s.updatedAt : (s.createdAt || 0);
      await db`
        INSERT INTO songs (user_id, id, data, updated_at)
        VALUES (${userId}, ${s.id}, ${JSON.stringify(s)}::jsonb, ${updatedAt})
        ON CONFLICT (user_id, id)
        DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
      `;
    }
    return songs.length;
  },

  async deleteSong(userId: string, id: string): Promise<void> {
    const db = requireSql();
    await db`DELETE FROM songs WHERE user_id = ${userId} AND id = ${id}`;
  },
};

const rowToProfile = (r: any): Profile => ({ userId: r.user_id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url });
const rowToPublic = (r: any): PublicUser => ({ userId: r.user_id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url });
const rowToRequest = (r: any): ConnectionRequest => ({ id: r.id, senderId: r.sender_id, recipientId: r.recipient_id, status: r.status });
const rowToShare = (r: any): ShareRow => ({ id: r.id, ownerId: r.owner_id, recipientId: r.recipient_id, resourceType: r.resource_type, resourceId: r.resource_id, revoked: r.revoked_at != null });
const rowToNotif = (r: any): NotificationRow => ({ id: r.id, recipientId: r.recipient_id, actorId: r.actor_id, type: r.type, entityId: r.entity_id, read: r.read_at != null, createdAt: Number(r.created_at) });

export const neonSocialDB: SocialDB = {
  async getProfile(userId) {
    const db = requireSql();
    const rows = (await db`SELECT * FROM profiles WHERE user_id = ${userId} LIMIT 1`) as any[];
    return rows[0] ? rowToProfile(rows[0]) : null;
  },
  async getProfileByUsername(username) {
    const db = requireSql();
    const rows = (await db`SELECT * FROM profiles WHERE username = ${username} LIMIT 1`) as any[];
    return rows[0] ? rowToProfile(rows[0]) : null;
  },
  async upsertProfile(p) {
    const db = requireSql();
    await db`
      INSERT INTO profiles (user_id, username, display_name, avatar_url, created_at, updated_at)
      VALUES (${p.userId}, ${p.username}, ${p.displayName}, ${p.avatarUrl ?? null}, ${Date.now()}, ${Date.now()})
      ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username, display_name = EXCLUDED.display_name, avatar_url = EXCLUDED.avatar_url, updated_at = EXCLUDED.updated_at
    `;
  },
  async searchProfiles(query, excludeUserId, limit) {
    const db = requireSql();
    const like = `%${query}%`;
    const rows = (await db`
      SELECT user_id, username, display_name, avatar_url FROM profiles
      WHERE user_id <> ${excludeUserId} AND (username ILIKE ${like} OR display_name ILIKE ${like})
      ORDER BY username LIMIT ${limit}
    `) as any[];
    return rows.map(rowToPublic);
  },

  async getRequestBetween(a, b) {
    const db = requireSql();
    const rows = (await db`SELECT * FROM connection_requests WHERE (sender_id = ${a} AND recipient_id = ${b}) OR (sender_id = ${b} AND recipient_id = ${a}) LIMIT 1`) as any[];
    return rows[0] ? rowToRequest(rows[0]) : null;
  },
  async getRequestById(id) {
    const db = requireSql();
    const rows = (await db`SELECT * FROM connection_requests WHERE id = ${id} LIMIT 1`) as any[];
    return rows[0] ? rowToRequest(rows[0]) : null;
  },
  async createRequest(senderId, recipientId) {
    const db = requireSql();
    const id = crypto.randomUUID();
    await db`
      INSERT INTO connection_requests (id, sender_id, recipient_id, status, created_at)
      VALUES (${id}, ${senderId}, ${recipientId}, 'pending', ${Date.now()})
      ON CONFLICT (sender_id, recipient_id) DO UPDATE SET status = 'pending', created_at = ${Date.now()}
    `;
    const rows = (await db`SELECT * FROM connection_requests WHERE sender_id = ${senderId} AND recipient_id = ${recipientId} LIMIT 1`) as any[];
    return rowToRequest(rows[0]);
  },
  async setRequestStatus(id, status) {
    const db = requireSql();
    await db`UPDATE connection_requests SET status = ${status} WHERE id = ${id}`;
  },
  async deleteRequest(id) {
    const db = requireSql();
    await db`DELETE FROM connection_requests WHERE id = ${id}`;
  },
  async listRequests(userId, box) {
    const db = requireSql();
    const rows = box === 'incoming'
      ? (await db`SELECT * FROM connection_requests WHERE recipient_id = ${userId} AND status = 'pending' ORDER BY created_at DESC`) as any[]
      : (await db`SELECT * FROM connection_requests WHERE sender_id = ${userId} AND status = 'pending' ORDER BY created_at DESC`) as any[];
    return rows.map(rowToRequest);
  },

  async addConnection(a, b) {
    const db = requireSql();
    const [x, y] = pair(a, b);
    await db`INSERT INTO connections (a_id, b_id, created_at) VALUES (${x}, ${y}, ${Date.now()}) ON CONFLICT (a_id, b_id) DO NOTHING`;
  },
  async removeConnection(a, b) {
    const db = requireSql();
    const [x, y] = pair(a, b);
    await db`DELETE FROM connections WHERE a_id = ${x} AND b_id = ${y}`;
  },
  async areConnected(a, b) {
    const db = requireSql();
    const [x, y] = pair(a, b);
    const rows = (await db`SELECT 1 FROM connections WHERE a_id = ${x} AND b_id = ${y} LIMIT 1`) as any[];
    return rows.length > 0;
  },
  async listConnections(userId) {
    const db = requireSql();
    const rows = (await db`
      SELECT p.user_id, p.username, p.display_name, p.avatar_url
      FROM connections c
      JOIN profiles p ON p.user_id = CASE WHEN c.a_id = ${userId} THEN c.b_id ELSE c.a_id END
      WHERE c.a_id = ${userId} OR c.b_id = ${userId}
      ORDER BY p.username
    `) as any[];
    return rows.map(rowToPublic);
  },

  async getSong(resourceId) {
    const db = requireSql();
    const rows = (await db`SELECT user_id, data FROM songs WHERE id = ${resourceId} LIMIT 1`) as { user_id: string; data: Song }[];
    return rows[0] ? { ...rows[0].data, ownerId: rows[0].user_id } : null;
  },
  async createShare(ownerId, recipientId, resourceId) {
    const db = requireSql();
    const id = crypto.randomUUID();
    await db`
      INSERT INTO shares (id, owner_id, recipient_id, resource_type, resource_id, revoked_at, created_at)
      VALUES (${id}, ${ownerId}, ${recipientId}, 'song', ${resourceId}, NULL, ${Date.now()})
      ON CONFLICT (owner_id, recipient_id, resource_id) DO UPDATE SET revoked_at = NULL
    `;
    const rows = (await db`SELECT * FROM shares WHERE owner_id = ${ownerId} AND recipient_id = ${recipientId} AND resource_id = ${resourceId} LIMIT 1`) as any[];
    return rowToShare(rows[0]);
  },
  async getShare(ownerId, recipientId, resourceId) {
    const db = requireSql();
    const rows = (await db`SELECT * FROM shares WHERE owner_id = ${ownerId} AND recipient_id = ${recipientId} AND resource_id = ${resourceId} LIMIT 1`) as any[];
    return rows[0] ? rowToShare(rows[0]) : null;
  },
  async setShareRevoked(id, revoked) {
    const db = requireSql();
    await db`UPDATE shares SET revoked_at = ${revoked ? Date.now() : null} WHERE id = ${id}`;
  },
  async listSharesForRecipient(recipientId) {
    const db = requireSql();
    const rows = (await db`
      SELECT s.*, so.data AS song_data, p.username AS owner_username
      FROM shares s
      JOIN songs so ON so.id = s.resource_id AND so.user_id = s.owner_id
      LEFT JOIN profiles p ON p.user_id = s.owner_id
      WHERE s.recipient_id = ${recipientId} AND s.revoked_at IS NULL
      ORDER BY s.created_at DESC
    `) as any[];
    return rows.map(r => ({ ...rowToShare(r), song: r.song_data as Song, ownerUsername: r.owner_username || '' }));
  },
  async listSharesByOwner(ownerId) {
    const db = requireSql();
    const rows = (await db`
      SELECT s.*, p.username AS recipient_username
      FROM shares s LEFT JOIN profiles p ON p.user_id = s.recipient_id
      WHERE s.owner_id = ${ownerId} ORDER BY s.created_at DESC
    `) as any[];
    return rows.map(r => ({ ...rowToShare(r), recipientUsername: r.recipient_username || '' }));
  },
  async duplicateSongToUser(song, newOwnerId, attribution) {
    const db = requireSql();
    const now = Date.now();
    const copy: Song = { ...song, id: crypto.randomUUID(), title: song.title, createdAt: now, updatedAt: now };
    (copy as any).sharedFrom = attribution;
    delete (copy as any).ownerId;
    await db`
      INSERT INTO songs (user_id, id, data, updated_at)
      VALUES (${newOwnerId}, ${copy.id}, ${JSON.stringify(copy)}::jsonb, ${now})
    `;
    return copy;
  },

  async createNotification(n) {
    const db = requireSql();
    await db`
      INSERT INTO notifications (id, recipient_id, actor_id, type, entity_id, read_at, created_at)
      VALUES (${crypto.randomUUID()}, ${n.recipientId}, ${n.actorId}, ${n.type}, ${n.entityId ?? null}, NULL, ${n.createdAt})
    `;
  },
  async listNotifications(userId, limit) {
    const db = requireSql();
    const rows = (await db`SELECT * FROM notifications WHERE recipient_id = ${userId} ORDER BY created_at DESC LIMIT ${limit}`) as any[];
    return rows.map(rowToNotif);
  },
  async markNotificationsRead(userId) {
    const db = requireSql();
    await db`UPDATE notifications SET read_at = ${Date.now()} WHERE recipient_id = ${userId} AND read_at IS NULL`;
  },
};
