-- Plectrum cloud-sync schema for Vercel Postgres (Neon).
-- Run this once against your database (e.g. `psql "$DATABASE_URL" -f server/schema.sql`,
-- or paste into the Neon SQL editor). The `songs` table is also created lazily by
-- server/db.ts#ensureSchema, but the Auth.js tables below must exist before first login.

-- ── Auth.js (@auth/pg-adapter) standard tables ────────────────────────────────
CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  expires    TIMESTAMPTZ NOT NULL,
  token      TEXT NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE TABLE IF NOT EXISTS accounts (
  id                  SERIAL,
  "userId"            INTEGER NOT NULL,
  type                VARCHAR(255) NOT NULL,
  provider            VARCHAR(255) NOT NULL,
  "providerAccountId" VARCHAR(255) NOT NULL,
  refresh_token       TEXT,
  access_token        TEXT,
  expires_at          BIGINT,
  id_token            TEXT,
  scope               TEXT,
  session_state       TEXT,
  token_type          TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id             SERIAL,
  "userId"       INTEGER NOT NULL,
  expires        TIMESTAMPTZ NOT NULL,
  "sessionToken" VARCHAR(255) NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL,
  name            VARCHAR(255),
  email           VARCHAR(255),
  "emailVerified" TIMESTAMPTZ,
  image           TEXT,
  PRIMARY KEY (id)
);

-- ── Plectrum song library (one JSONB document per song, per user) ─────────────
CREATE TABLE IF NOT EXISTS songs (
  user_id    TEXT   NOT NULL,
  id         TEXT   NOT NULL,
  data       JSONB  NOT NULL,
  updated_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS songs_user_idx ON songs (user_id);

-- ── Email+password cloud accounts (cross-device login) ────────────────────────
-- Also created lazily by server/db.ts#ensureSchema, so running this by hand is
-- optional — but harmless.
CREATE TABLE IF NOT EXISTS cloud_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    BIGINT NOT NULL DEFAULT 0
);
