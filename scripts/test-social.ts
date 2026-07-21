import assert from 'node:assert/strict';
import { handleSocial, isValidUsername, normalizeUsername, type SocialDB, type Profile, type ConnectionRequest, type ShareRow, type NotificationRow, type PublicUser } from '../server/socialHandler.ts';
import type { Song } from '../types.ts';

// ── In-memory SocialDB ───────────────────────────────────────────────────────
const makeDb = () => {
  const profiles = new Map<string, Profile>();
  const byUsername = new Map<string, Profile>();
  const requests = new Map<string, ConnectionRequest>();
  const connections = new Set<string>();           // key: sorted "a|b"
  const songs = new Map<string, Song & { ownerId: string }>();
  const shares = new Map<string, ShareRow>();
  const notifications: NotificationRow[] = [];
  let n = 0;
  const pubOf = (p: Profile): PublicUser => ({ userId: p.userId, username: p.username, displayName: p.displayName, avatarUrl: p.avatarUrl });
  const cKey = (a: string, b: string) => [a, b].sort().join('|');

  const db: SocialDB = {
    async getProfile(id) { return profiles.get(id) ?? null; },
    async getProfileByUsername(u) { return byUsername.get(u) ?? null; },
    async upsertProfile(p) { profiles.set(p.userId, p); byUsername.forEach((v, k) => { if (v.userId === p.userId) byUsername.delete(k); }); byUsername.set(p.username, p); },
    async searchProfiles(q, exclude, limit) { return [...profiles.values()].filter(p => p.userId !== exclude && p.username.includes(q)).slice(0, limit).map(pubOf); },
    async getRequestBetween(a, b) { return [...requests.values()].find(r => (r.senderId === a && r.recipientId === b) || (r.senderId === b && r.recipientId === a)) ?? null; },
    async getRequestById(id) { return requests.get(id) ?? null; },
    async createRequest(s, r) { const req = { id: 'r' + (++n), senderId: s, recipientId: r, status: 'pending' as const }; requests.set(req.id, req); return req; },
    async setRequestStatus(id, st) { const r = requests.get(id); if (r) r.status = st; },
    async deleteRequest(id) { requests.delete(id); },
    async listRequests(uid, box) { return [...requests.values()].filter(r => r.status === 'pending' && (box === 'incoming' ? r.recipientId === uid : r.senderId === uid)); },
    async addConnection(a, b) { connections.add(cKey(a, b)); },
    async removeConnection(a, b) { connections.delete(cKey(a, b)); },
    async areConnected(a, b) { return connections.has(cKey(a, b)); },
    async listConnections(uid) { return [...connections].filter(k => k.split('|').includes(uid)).map(k => k.split('|').find(x => x !== uid)!).map(id => pubOf(profiles.get(id)!)); },
    async getSong(id) { return songs.get(id) ?? null; },
    async createShare(o, r, res) { const sh = { id: 's' + (++n), ownerId: o, recipientId: r, resourceType: 'song', resourceId: res, revoked: false }; shares.set(sh.id, sh); return sh; },
    async getShare(o, r, res) { return [...shares.values()].find(s => s.ownerId === o && s.recipientId === r && s.resourceId === res) ?? null; },
    async setShareRevoked(id, rev) { const s = shares.get(id); if (s) s.revoked = rev; },
    async listSharesForRecipient(r) { return [...shares.values()].filter(s => s.recipientId === r && !s.revoked).map(s => ({ ...s, song: songs.get(s.resourceId)!, ownerUsername: profiles.get(s.ownerId)?.username || '' })); },
    async listSharesByOwner(o) { return [...shares.values()].filter(s => s.ownerId === o).map(s => ({ ...s, recipientUsername: profiles.get(s.recipientId)?.username || '' })); },
    async duplicateSongToUser(song, newOwner, attribution) { const copy = { ...song, id: 'dup' + (++n), ownerId: newOwner, title: song.title, artist: song.artist, sharedFrom: attribution } as any; songs.set(copy.id, copy); return copy; },
    async createNotification(nn) { notifications.push({ ...nn, id: 'n' + (++n), read: false }); },
    async listNotifications(uid, limit) { return notifications.filter(x => x.recipientId === uid).slice(0, limit); },
    async markNotificationsRead(uid) { notifications.forEach(x => { if (x.recipientId === uid) x.read = true; }); },
  };
  return { db, profiles, songs, notifications, requests, connections };
};

const ctx = (userId: string | null, action: string, payload?: any) => ({ userId, action, payload, now: 1000, newId: () => 'id' + Math.floor(1) });

// ── username validation ──
{
  assert.ok(isValidUsername('yuval_23'), 'valid username');
  assert.ok(!isValidUsername('ab'), 'too short');
  assert.ok(!isValidUsername('has space'), 'no spaces');
  assert.ok(!isValidUsername('BAD!'), 'no symbols');
  assert.equal(normalizeUsername('  YuVaL '), 'yuval', 'normalized');
}

// ── unauthenticated → 401 ──
{
  const { db } = makeDb();
  assert.equal((await handleSocial(ctx(null, 'profile.me'), db)).status, 401, 'no session → 401');
}

// ── profile setup + username uniqueness ──
{
  const { db } = makeDb();
  const r = await handleSocial(ctx('u1', 'profile.setUsername', { username: 'Alice', displayName: 'Alice' }), db);
  assert.equal(r.status, 200); assert.equal((r.body as any).profile.username, 'alice');
  await handleSocial(ctx('u2', 'profile.setUsername', { username: 'bob' }), db);
  const dup = await handleSocial(ctx('u2', 'profile.setUsername', { username: 'alice' }), db);
  assert.equal(dup.status, 409, 'taken username → 409');
  const bad = await handleSocial(ctx('u2', 'profile.setUsername', { username: 'x' }), db);
  assert.equal(bad.status, 400, 'invalid username → 400');
}

// ── connection request lifecycle + guards ──
{
  const { db } = makeDb();
  await handleSocial(ctx('alice', 'profile.setUsername', { username: 'alice' }), db);
  await handleSocial(ctx('bob', 'profile.setUsername', { username: 'bob' }), db);

  assert.equal((await handleSocial(ctx('alice', 'connections.request', { recipientId: 'alice' }), db)).status, 400, 'no self-request');

  const req1 = await handleSocial(ctx('alice', 'connections.request', { recipientId: 'bob' }), db);
  assert.equal(req1.status, 200, 'request sent');
  const reqId = (req1.body as any).request.id;

  assert.equal((await handleSocial(ctx('alice', 'connections.request', { recipientId: 'bob' }), db)).status, 409, 'no duplicate pending');

  // bob sees it incoming
  const bobList = await handleSocial(ctx('bob', 'connections.list'), db);
  assert.equal((bobList.body as any).incoming.length, 1, 'bob has 1 incoming');

  // alice cannot accept her own outgoing (only recipient can)
  assert.equal((await handleSocial(ctx('alice', 'connections.accept', { requestId: reqId }), db)).status, 404, 'sender cannot accept');

  const acc = await handleSocial(ctx('bob', 'connections.accept', { requestId: reqId }), db);
  assert.equal(acc.status, 200, 'bob accepts');
  assert.ok(await db.areConnected('alice', 'bob'), 'now connected');

  // alice got a "request_accepted" notification
  const aliceNotifs = await handleSocial(ctx('alice', 'notifications.list'), db);
  assert.ok((aliceNotifs.body as any).notifications.some((x: any) => x.type === 'request_accepted'), 'accept notification');
}

// ── sharing: ownership + connection gate + revoke + duplicate ──
{
  const { db, songs } = makeDb();
  await handleSocial(ctx('owner', 'profile.setUsername', { username: 'owner' }), db);
  await handleSocial(ctx('friend', 'profile.setUsername', { username: 'friend' }), db);
  await handleSocial(ctx('stranger', 'profile.setUsername', { username: 'stranger' }), db);
  songs.set('song1', { id: 'song1', ownerId: 'owner', title: 'My Song', artist: 'Owner', content: '### [V]', createdAt: 1 } as any);

  // cannot share a song you do not own
  assert.equal((await handleSocial(ctx('friend', 'shares.create', { recipientId: 'stranger', resourceId: 'song1' }), db)).status, 403, 'non-owner cannot share');

  // cannot share before connecting
  assert.equal((await handleSocial(ctx('owner', 'shares.create', { recipientId: 'friend', resourceId: 'song1' }), db)).status, 403, 'must connect first');

  // connect owner<->friend, then share
  await db.addConnection('owner', 'friend');
  const share = await handleSocial(ctx('owner', 'shares.create', { recipientId: 'friend', resourceId: 'song1' }), db);
  assert.equal(share.status, 200, 'share created');

  // friend sees it in Shared With Me; stranger does not
  assert.equal(((await handleSocial(ctx('friend', 'shares.withMe'), db)).body as any).shares.length, 1, 'friend sees shared');
  assert.equal(((await handleSocial(ctx('stranger', 'shares.withMe'), db)).body as any).shares.length, 0, 'stranger sees none');

  // stranger cannot duplicate (no share)
  assert.equal((await handleSocial(ctx('stranger', 'shares.duplicate', { ownerId: 'owner', resourceId: 'song1' }), db)).status, 403, 'stranger cannot duplicate');

  // friend duplicates → owns a copy, original unchanged
  const dup = await handleSocial(ctx('friend', 'shares.duplicate', { ownerId: 'owner', resourceId: 'song1' }), db);
  assert.equal(dup.status, 200, 'friend duplicates');
  assert.equal((dup.body as any).song.ownerId, 'friend', 'copy owned by friend');
  assert.notEqual((dup.body as any).song.id, 'song1', 'copy has a new id');
  assert.equal(songs.get('song1')!.ownerId, 'owner', 'original still owned by owner');

  // owner revokes → friend loses access
  await handleSocial(ctx('owner', 'shares.revoke', { recipientId: 'friend', resourceId: 'song1' }), db);
  assert.equal(((await handleSocial(ctx('friend', 'shares.withMe'), db)).body as any).shares.length, 0, 'friend lost access after revoke');
  assert.equal((await handleSocial(ctx('friend', 'shares.duplicate', { ownerId: 'owner', resourceId: 'song1' }), db)).status, 403, 'cannot duplicate after revoke');

  // non-owner cannot revoke
  await db.setShareRevoked((await db.getShare('owner', 'friend', 'song1'))!.id, false); // re-open
  assert.equal((await handleSocial(ctx('stranger', 'shares.revoke', { recipientId: 'friend', resourceId: 'song1' }), db)).status, 404, 'stranger cannot revoke');
}

console.log('social tests passed');
