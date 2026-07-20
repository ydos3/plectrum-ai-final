import assert from 'node:assert/strict';

// Minimal localStorage polyfill so the browser-oriented storageService runs under
// Node. storageService only touches localStorage inside functions (not at import),
// so installing this before any call is sufficient.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
};

import { storageKeyForUser, setActiveUser, getSongs, saveSong, deleteSong } from '../services/storageService.ts';
import type { Song } from '../types.ts';

const BASE = 'plectrum_songs_db';
const mk = (id: string): Song => ({ id, title: id, artist: 'x', content: '### [x]\n[C] hi', createdAt: 1 });

// ── key computation ──
{
  assert.equal(storageKeyForUser('A@B.com'), `${BASE}::a@b.com`, 'email lowercased + namespaced');
  assert.equal(storageKeyForUser('  Bob@X.io '), `${BASE}::bob@x.io`, 'trimmed + lowercased');
  assert.equal(storageKeyForUser(''), BASE, 'empty → base');
  assert.equal(storageKeyForUser(null), BASE, 'null → base');
  assert.equal(storageKeyForUser(undefined), BASE, 'undefined → base');
}

// ── per-account isolation ──
{
  store.clear();
  setActiveUser('alice@x.com');
  saveSong(mk('alice-only-song'));
  assert.ok(getSongs().some(s => s.id === 'alice-only-song'), 'alice sees her song');

  setActiveUser('bob@x.com');
  assert.ok(!getSongs().some(s => s.id === 'alice-only-song'), 'bob does NOT see alice’s song');
  saveSong(mk('bob-only-song'));
  assert.ok(getSongs().some(s => s.id === 'bob-only-song'), 'bob sees his song');

  setActiveUser('alice@x.com');
  const alice = getSongs();
  assert.ok(alice.some(s => s.id === 'alice-only-song'), 'alice’s song persisted across the switch');
  assert.ok(!alice.some(s => s.id === 'bob-only-song'), 'alice does NOT see bob’s song');
}

// ── first-login migration: existing base library carries into the new account ──
{
  store.clear();
  // Simulate an existing guest library in the base key.
  setActiveUser(null);
  saveSong(mk('legacy-guest-song'));
  assert.ok(getSongs().some(s => s.id === 'legacy-guest-song'), 'guest has the legacy song');

  // First time signing in with an email → account seeded from the base library.
  setActiveUser('newuser@x.com');
  assert.ok(getSongs().some(s => s.id === 'legacy-guest-song'), 'new account inherits existing local songs on first login');

  // But it is now independent: deleting in the account does not touch the base.
  deleteSong('legacy-guest-song');
  assert.ok(!getSongs().some(s => s.id === 'legacy-guest-song'), 'deleted in account');
  setActiveUser(null);
  assert.ok(getSongs().some(s => s.id === 'legacy-guest-song'), 'base library untouched by the account delete');
}

console.log('storage-namespace tests passed');
