// Client for the social API (/api/social). All calls carry the Bearer session
// token; the server derives the user from it. Inert unless signed into the cloud.

import { cloudAuthHeader, isCloudSignedIn } from './emailAuth';

export interface PublicUser { userId: string; username: string; displayName: string; avatarUrl?: string | null; }
export interface Profile extends PublicUser {}
export interface ConnReq { id: string; senderId: string; recipientId: string; status: string; }

const call = async (action: string, payload?: any): Promise<any> => {
  if (!isCloudSignedIn()) throw new Error('not signed in');
  const res = await fetch('/api/social', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...cloudAuthHeader() },
    body: JSON.stringify({ action, payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `request failed (${res.status})`);
  return data;
};

export const getMyProfile = () => call('profile.me').then(d => d.profile as Profile | null);
export const setUsername = (username: string, displayName?: string) => call('profile.setUsername', { username, displayName }).then(d => d.profile as Profile);
export const searchUsers = (query: string) => call('users.search', { query }).then(d => d.users as PublicUser[]);

export const sendConnectionRequest = (recipientId: string) => call('connections.request', { recipientId });
export const acceptRequest = (requestId: string) => call('connections.accept', { requestId });
export const rejectRequest = (requestId: string) => call('connections.reject', { requestId });
export const cancelRequest = (requestId: string) => call('connections.cancel', { requestId });
export const removeConnection = (userId: string) => call('connections.remove', { userId });
export const listConnections = () => call('connections.list') as Promise<{ connections: PublicUser[]; incoming: ConnReq[]; outgoing: ConnReq[] }>;

export const shareSong = (recipientId: string, resourceId: string) => call('shares.create', { recipientId, resourceId });
export const revokeShare = (recipientId: string, resourceId: string) => call('shares.revoke', { recipientId, resourceId });
export const sharedWithMe = () => call('shares.withMe').then(d => d.shares as any[]);
export const sharedByMe = () => call('shares.byMe').then(d => d.shares as any[]);
export const duplicateSharedSong = (ownerId: string, resourceId: string) => call('shares.duplicate', { ownerId, resourceId }).then(d => d.song);

export const listNotifications = () => call('notifications.list').then(d => d.notifications as any[]);
export const markNotificationsRead = () => call('notifications.markRead');
