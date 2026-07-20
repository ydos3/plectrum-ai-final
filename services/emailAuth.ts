// Client for the email+password cloud account API (/api/auth-email). On success
// it stores the Bearer session token; cloudSync.ts sends it with every request.
// All of this is inert unless the build has VITE_CLOUD_SYNC on (cloudSyncEnabled).

import { cloudSyncEnabled } from './authClient';

const TOKEN_KEY = 'plectrum_cloud_token';
const EMAIL_KEY = 'plectrum_cloud_email';

export const getCloudToken = (): string | null => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const getCloudEmail = (): string | null => {
  try { return localStorage.getItem(EMAIL_KEY); } catch { return null; }
};
export const isCloudSignedIn = (): boolean => cloudSyncEnabled() && !!getCloudToken();

/** Authorization header for API calls, or {} when signed out. */
export const cloudAuthHeader = (): Record<string, string> => {
  const t = getCloudToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export interface CloudAuthResult { ok: boolean; email?: string; error?: string; }

const authRequest = async (action: 'signup' | 'login', email: string, password: string): Promise<CloudAuthResult> => {
  if (!cloudSyncEnabled()) return { ok: false, error: 'cloud accounts are not enabled in this build' };
  try {
    const res = await fetch('/api/auth-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.token) {
      if (res.status === 503) return { ok: false, error: 'cloud accounts are not set up yet' };
      return { ok: false, error: data?.error || `request failed (${res.status})` };
    }
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(EMAIL_KEY, data.user?.email || email.trim().toLowerCase());
    return { ok: true, email: data.user?.email };
  } catch {
    return { ok: false, error: 'network error — check your connection' };
  }
};

export const signUpCloud = (email: string, password: string) => authRequest('signup', email, password);
export const signInCloud = (email: string, password: string) => authRequest('login', email, password);

export const signOutCloud = (): void => {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(EMAIL_KEY); } catch { /* ignore */ }
};
