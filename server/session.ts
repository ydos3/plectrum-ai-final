// Resolve the authenticated user id from an incoming request by decoding the
// Auth.js session-token cookie (a stateless JWT). No DB round-trip — the user id
// was baked into the token by authConfig's jwt callback.

import { decode } from '@auth/core/jwt';
import { SESSION_COOKIE_SECURE, SESSION_COOKIE_INSECURE } from './authConfig';

/** Parse a Cookie header into a name→value map. */
const parseCookies = (header: string | null): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
};

/**
 * Returns the signed-in user id, or null if there is no valid session. Tries the
 * secure cookie first (HTTPS/prod) then the insecure one (local http dev). The
 * cookie name doubles as the JWT salt, so each is decoded with its own salt.
 */
export const getUserId = async (request: Request): Promise<string | null> => {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;

  const cookies = parseCookies(request.headers.get('cookie'));
  const candidates: Array<[string, string]> = [
    [SESSION_COOKIE_SECURE, cookies[SESSION_COOKIE_SECURE]],
    [SESSION_COOKIE_INSECURE, cookies[SESSION_COOKIE_INSECURE]],
  ].filter(([, v]) => !!v) as Array<[string, string]>;

  for (const [salt, token] of candidates) {
    try {
      const payload = await decode({ token, secret, salt });
      const uid = (payload as { uid?: string; sub?: string } | null)?.uid
        ?? (payload as { sub?: string } | null)?.sub;
      if (uid) return uid;
    } catch {
      // Wrong salt / tampered / expired — try the next candidate.
    }
  }
  return null;
};
