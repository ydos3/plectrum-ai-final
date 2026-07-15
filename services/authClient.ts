// Thin client for the Auth.js endpoints. Cloud sync is opt-in and only active
// when VITE_CLOUD_SYNC is set at build time, so a stock build makes zero auth
// network calls and the app behaves exactly as before.

export interface SessionUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

/** True only when the app was built with cloud sync enabled. */
export const cloudSyncEnabled = (): boolean => {
  const v = (import.meta as any).env?.VITE_CLOUD_SYNC;
  return v === '1' || v === 'true';
};

/** Returns the signed-in user, or null if not signed in / sync disabled. */
export const getSession = async (): Promise<SessionUser | null> => {
  if (!cloudSyncEnabled()) return null;
  try {
    const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data && data.user ? (data.user as SessionUser) : null;
  } catch {
    return null;
  }
};

/** Full-page navigation to the Auth.js sign-in page (handles CSRF itself). */
export const signIn = (): void => {
  const callbackUrl = encodeURIComponent(window.location.href);
  window.location.href = `/api/auth/signin?callbackUrl=${callbackUrl}`;
};

/** Full-page navigation to the Auth.js sign-out page. */
export const signOut = (): void => {
  const callbackUrl = encodeURIComponent(window.location.href);
  window.location.href = `/api/auth/signout?callbackUrl=${callbackUrl}`;
};
