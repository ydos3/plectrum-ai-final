// Email + password cloud accounts. POST { action: 'signup'|'login', email, password }
//   → { token, user } on success. The token is a Bearer session the client stores
// and sends on /api/songs. Thin Edge adapter around the tested pure handler
// (server/emailAuthHandler.ts) backed by Neon + a JWT token signer.

import { handleEmailAuth } from '../server/emailAuthHandler';
import { neonUsersDB, ensureSchema, isDbConfigured } from '../server/db';
import { signCloudToken } from '../server/cloudToken';

export const config = { runtime: 'edge' };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let schemaReady: Promise<void> | null = null;
const ready = () => (schemaReady ??= ensureSchema());

export default async function handler(request: Request): Promise<Response> {
  const secret = process.env.AUTH_SECRET;
  if (!isDbConfigured() || !secret) return json(503, { error: 'cloud accounts not configured' });
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  try {
    await ready();
    const body = await request.json().catch(() => ({}));
    const result = await handleEmailAuth(
      { action: body?.action, email: body?.email, password: body?.password },
      neonUsersDB,
      (uid, email) => signCloudToken(uid, email, secret),
    );
    return json(result.status, result.body);
  } catch (err) {
    console.error('auth-email error', err);
    return json(500, { error: 'internal error' });
  }
}
