// Pure signup/login logic for cloud accounts — no HTTP, no DB driver, no crypto
// wiring. It takes a parsed request, a UsersDB port, and an injected token maker,
// so the whole flow (validation, dedupe, password check, token issue) is unit-
// tested headlessly with a fake DB (scripts/test-email-auth.ts). The Edge function
// (api/auth-email.ts) supplies a Neon-backed UsersDB + a real JWT signer.

import { hashPassword, verifyPassword } from './password.ts';

export interface CloudUser {
  id: string;
  email: string;
  passwordHash: string;
}

export interface UsersDB {
  getUserByEmail(email: string): Promise<CloudUser | null>;
  createUser(email: string, passwordHash: string): Promise<CloudUser>;
}

export interface AuthRequest {
  action?: string;      // 'signup' | 'login'
  email?: unknown;
  password?: unknown;
}

export interface AuthResult {
  status: number;
  body: unknown;
}

/** Issues a session token for a user id + email (async to allow real signing). */
export type TokenMaker = (uid: string, email: string) => Promise<string>;

const normalizeEmail = (e: string) => e.trim().toLowerCase();
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const MIN_PASSWORD = 6;

export const handleEmailAuth = async (req: AuthRequest, db: UsersDB, makeToken: TokenMaker): Promise<AuthResult> => {
  const email = typeof req.email === 'string' ? normalizeEmail(req.email) : '';
  const password = typeof req.password === 'string' ? req.password : '';

  if (!isEmail(email)) return { status: 400, body: { error: 'a valid email is required' } };
  if (password.length < MIN_PASSWORD) return { status: 400, body: { error: `password must be at least ${MIN_PASSWORD} characters` } };

  if (req.action === 'signup') {
    const existing = await db.getUserByEmail(email);
    if (existing) return { status: 409, body: { error: 'an account with this email already exists — sign in instead' } };
    const user = await db.createUser(email, await hashPassword(password));
    const token = await makeToken(user.id, user.email);
    return { status: 200, body: { token, user: { id: user.id, email: user.email } } };
  }

  if (req.action === 'login') {
    const user = await db.getUserByEmail(email);
    // Same generic message whether the email is unknown or the password is wrong.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return { status: 401, body: { error: 'incorrect email or password' } };
    }
    const token = await makeToken(user.id, user.email);
    return { status: 200, body: { token, user: { id: user.id, email: user.email } } };
  }

  return { status: 400, body: { error: 'unknown action' } };
};
