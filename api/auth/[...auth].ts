// Auth.js (@auth/core) OAuth route. Vercel routes every /api/auth/* request here
// (sign-in, callback, session, sign-out). @auth/core speaks the Web Request/
// Response API, which Vercel's Node runtime supports directly.
//
// Requires env: AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, DATABASE_URL.
// Set the Google OAuth redirect URI to: https://<host>/api/auth/callback/google

import { Auth } from '@auth/core';
import { authConfig, isAuthConfigured } from '../../server/authConfig';

// @auth/core speaks Web Request/Response → run on Vercel's Edge runtime.
export const config = { runtime: 'edge' };

export default async function handler(request: Request): Promise<Response> {
  if (!isAuthConfigured()) {
    return new Response(JSON.stringify({ error: 'auth not configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
  return Auth(request, authConfig);
}
