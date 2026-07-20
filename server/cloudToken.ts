// Session tokens for cloud (email+password) accounts. A stateless, encrypted JWT
// (via @auth/core/jwt) carrying the user id + email, signed with AUTH_SECRET. The
// client stores it and sends it as `Authorization: Bearer <token>`; any Edge
// function verifies it without a DB round-trip.

import { encode, decode } from '@auth/core/jwt';

const SALT = 'plectrum-cloud-session';
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export const signCloudToken = (uid: string, email: string, secret: string): Promise<string> =>
  encode({ token: { uid, email }, secret, salt: SALT, maxAge: MAX_AGE });

export const verifyCloudToken = async (token: string, secret: string): Promise<{ uid: string; email: string } | null> => {
  try {
    const payload = await decode({ token, secret, salt: SALT }) as { uid?: string; email?: string } | null;
    if (payload?.uid && payload.email) return { uid: payload.uid, email: payload.email };
    return null;
  } catch {
    return null;
  }
};
