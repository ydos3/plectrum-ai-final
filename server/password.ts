// Password hashing for cloud accounts, using Web Crypto PBKDF2 so it runs on the
// Vercel Edge runtime (no native bcrypt). Format stored in the DB:
//   pbkdf2$<iterations>$<saltHex>$<hashHex>
// Pure + dependency-free, so it is unit-tested headlessly (Node exposes the same
// globalThis.crypto.subtle).

const ITERATIONS = 100_000;
const KEY_LEN = 32; // bytes
const enc = new TextEncoder();

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

const derive = async (password: string, salt: Uint8Array, iterations: number): Promise<string> => {
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_LEN * 8,
  );
  return toHex(bits);
};

/** Hash a password into a self-describing, storable string. */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toHex(salt.buffer)}$${hash}`;
};

/** Constant-time-ish comparison of a candidate password against a stored hash. */
export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = fromHex(parts[2]);
  const expected = parts[3];
  const actual = await derive(password, salt, iterations);
  // Length-safe compare.
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
};
