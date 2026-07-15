// Shared Auth.js (@auth/core) configuration. Used by the auth route handler
// (api/auth/[...auth].ts) and, indirectly, by session decoding (server/session.ts).
//
// Identity: Google OAuth. Accounts/users are persisted in Postgres via the
// @auth/pg-adapter; sessions are stateless JWTs so any serverless invocation can
// verify them by decoding the cookie with AUTH_SECRET (no DB round-trip needed).
//
// Required env: AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, DATABASE_URL.

import type { AuthConfig } from '@auth/core';
import Google from '@auth/core/providers/google';
import PostgresAdapter from '@auth/pg-adapter';
import { Pool } from '@neondatabase/serverless';
import type { Pool as PgPool } from 'pg';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

// Name of the session-token cookie Auth.js sets. It is also the JWT "salt", so
// session.ts must decode with the same value. Secure prefix is used over HTTPS.
export const SESSION_COOKIE_SECURE = '__Secure-authjs.session-token';
export const SESSION_COOKIE_INSECURE = 'authjs.session-token';

/** True when all env needed for OAuth + DB-backed accounts is present. */
export const isAuthConfigured = (): boolean =>
  !!process.env.AUTH_SECRET && !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_GOOGLE_SECRET && !!connectionString;

export const authConfig: AuthConfig = {
  // A pg-compatible pool (Neon over WebSocket) for account/user persistence. The
  // Neon Pool satisfies the adapter's `pg.Pool` surface at runtime; the cast just
  // bridges a minor structural difference in the two packages' type declarations.
  adapter: connectionString
    ? PostgresAdapter(new Pool({ connectionString }) as unknown as PgPool)
    : undefined,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt' },
  // We run behind Vercel's proxy; trust the forwarded host for callback URLs.
  trustHost: true,
  callbacks: {
    // Persist the stable user id onto the JWT so the songs API can read it
    // straight from the cookie without a DB lookup.
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.uid) (session.user as { id?: string }).id = token.uid as string;
      return session;
    },
  },
};
