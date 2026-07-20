import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../server/password.ts';
import { handleEmailAuth, type UsersDB, type CloudUser } from '../server/emailAuthHandler.ts';
import { signCloudToken, verifyCloudToken } from '../server/cloudToken.ts';

// ── password hashing round-trip ──
{
  const stored = await hashPassword('correct horse battery');
  assert.ok(stored.startsWith('pbkdf2$'), 'self-describing hash format');
  assert.ok(await verifyPassword('correct horse battery', stored), 'correct password verifies');
  assert.ok(!(await verifyPassword('wrong password', stored)), 'wrong password rejected');
  const a = await hashPassword('samepass');
  const b = await hashPassword('samepass');
  assert.notEqual(a, b, 'same password → different salted hashes');
  assert.ok(!(await verifyPassword('x', 'garbage-not-a-hash')), 'malformed stored hash → false, no throw');
}

// In-memory UsersDB + a fake token maker.
const makeDb = () => {
  const byEmail = new Map<string, CloudUser>();
  let n = 0;
  const db: UsersDB = {
    async getUserByEmail(email) { return byEmail.get(email) ?? null; },
    async createUser(email, passwordHash) {
      const u: CloudUser = { id: 'u' + (++n), email, passwordHash };
      byEmail.set(email, u);
      return u;
    },
  };
  return db;
};
const makeToken = async (uid: string, email: string) => `tok:${uid}:${email}`;
// Real password fns injected into the handler (the module no longer imports them).
const deps = { hashPassword, verifyPassword, makeToken };

// ── signup ──
{
  const db = makeDb();
  const r = await handleEmailAuth({ action: 'signup', email: 'Yuval@Example.com', password: 'hunter2' }, db, deps);
  assert.equal(r.status, 200, 'signup ok');
  assert.equal((r.body as any).user.email, 'yuval@example.com', 'email normalized (lowercased)');
  assert.ok((r.body as any).token, 'token issued');
}

// ── duplicate signup rejected ──
{
  const db = makeDb();
  await handleEmailAuth({ action: 'signup', email: 'a@b.com', password: 'hunter2' }, db, deps);
  const dup = await handleEmailAuth({ action: 'signup', email: 'a@b.com', password: 'hunter2' }, db, deps);
  assert.equal(dup.status, 409, 'duplicate email → 409');
}

// ── login: correct, wrong password, unknown user ──
{
  const db = makeDb();
  await handleEmailAuth({ action: 'signup', email: 'a@b.com', password: 'hunter2' }, db, deps);

  const ok = await handleEmailAuth({ action: 'login', email: 'A@B.com', password: 'hunter2' }, db, deps);
  assert.equal(ok.status, 200, 'correct login (case-insensitive email)');
  assert.ok((ok.body as any).token, 'login issues token');

  const wrong = await handleEmailAuth({ action: 'login', email: 'a@b.com', password: 'wrongpass' }, db, deps);
  assert.equal(wrong.status, 401, 'wrong password → 401');

  const unknown = await handleEmailAuth({ action: 'login', email: 'ghost@b.com', password: 'whatever' }, db, deps);
  assert.equal(unknown.status, 401, 'unknown user → 401 (same generic message)');
  assert.equal((wrong.body as any).error, (unknown.body as any).error, 'no user-enumeration leak');
}

// ── validation ──
{
  const db = makeDb();
  assert.equal((await handleEmailAuth({ action: 'signup', email: 'notanemail', password: 'hunter2' }, db, deps)).status, 400, 'bad email → 400');
  assert.equal((await handleEmailAuth({ action: 'signup', email: 'a@b.com', password: '123' }, db, deps)).status, 400, 'short password → 400');
  assert.equal((await handleEmailAuth({ action: 'frobnicate', email: 'a@b.com', password: 'hunter2' }, db, deps)).status, 400, 'unknown action → 400');
}

// ── session token round-trip (the real signer used in production) ──
{
  const secret = 'test-secret-at-least-32-chars-long-abcdef';
  const token = await signCloudToken('u123', 'a@b.com', secret);
  const ok = await verifyCloudToken(token, secret);
  assert.deepEqual(ok, { uid: 'u123', email: 'a@b.com' }, 'valid token verifies to its payload');
  assert.equal(await verifyCloudToken(token, 'a-different-secret-abcdefghijklmnop'), null, 'wrong secret → null');
  assert.equal(await verifyCloudToken('not.a.token', secret), null, 'garbage token → null, no throw');
}

console.log('email-auth tests passed');
