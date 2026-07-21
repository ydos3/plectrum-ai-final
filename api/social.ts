// Social layer API — one Edge endpoint that routes { action, payload } through the
// tested pure handler (server/socialHandler.ts) backed by Neon. Every action is
// scoped to the Bearer-authenticated caller; there is no client-supplied user id.

import { handleSocial } from '../server/socialHandler';
import { neonSocialDB, ensureSchema, isDbConfigured } from '../server/db';
import { getUserId } from '../server/session';

export const config = { runtime: 'edge' };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let schemaReady: Promise<void> | null = null;
const ready = () => (schemaReady ??= ensureSchema());

export default async function handler(request: Request): Promise<Response> {
  if (!isDbConfigured() || !process.env.AUTH_SECRET) return json(503, { error: 'social features not configured' });
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  try {
    await ready();
    const userId = await getUserId(request); // verified server-side from the session token
    const body = await request.json().catch(() => ({}));
    const result = await handleSocial(
      { action: body?.action, payload: body?.payload, userId, now: Date.now(), newId: () => crypto.randomUUID() },
      neonSocialDB,
    );
    return json(result.status, result.body);
  } catch (err) {
    console.error('social api error', err);
    return json(500, { error: 'internal error' });
  }
}
