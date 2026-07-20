// Neon (Vercel Postgres) data layer. Vercel's native Postgres integration is
// Neon; the connection string is provided via DATABASE_URL (or POSTGRES_URL).
// The whole song document is stored as JSONB keyed by (user_id, id) so the
// schema never has to track the evolving Song shape — the app owns that.

import { neon } from '@neondatabase/serverless';
import type { Song } from '../types';
import type { SongsDB } from './songsHandler';
import type { UsersDB, CloudUser } from './emailAuthHandler';

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
};

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
