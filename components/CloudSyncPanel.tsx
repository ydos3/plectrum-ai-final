import React, { useCallback, useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, LogIn, UserPlus, Check, AlertCircle } from 'lucide-react';
import { cloudSyncEnabled } from '../services/authClient';
import { signUpCloud, signInCloud, signOutCloud, isCloudSignedIn, getCloudEmail } from '../services/emailAuth';
import { syncNow, type SyncOutcome } from '../services/cloudSync';

// Cross-device cloud account panel for the sidebar. Sign in with the SAME email +
// password on any device to carry your whole library everywhere. Renders NOTHING
// unless the build has VITE_CLOUD_SYNC on, so the default product is unchanged.
const CloudSyncPanel: React.FC = () => {
  const enabled = cloudSyncEnabled();
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    if (enabled) setSignedIn(isCloudSignedIn());
  }, [enabled]);

  const runSync = useCallback(async () => {
    try {
      const r: SyncOutcome = await syncNow();
      setStatus({ kind: 'ok', msg: `Synced — ${r.total} songs (↑${r.pushed} ↓${r.pulled})` });
    } catch (e: any) {
      setStatus({ kind: 'err', msg: e?.message === 'not signed in' ? 'Please sign in again' : 'Sync failed — try again' });
    }
  }, []);

  const handleAuth = useCallback(async () => {
    setBusy(true); setStatus(null);
    const fn = mode === 'signup' ? signUpCloud : signInCloud;
    const res = await fn(email.trim(), password);
    if (!res.ok) {
      setStatus({ kind: 'err', msg: res.error || 'Sign-in failed' });
      setBusy(false);
      return;
    }
    setSignedIn(true);
    setPassword('');
    // Immediately pull this account's library onto the device (and push local).
    await runSync();
    setBusy(false);
  }, [mode, email, password, runSync]);

  const handleManualSync = useCallback(async () => {
    setBusy(true); setStatus(null);
    await runSync();
    setBusy(false);
  }, [runSync]);

  const handleSignOut = useCallback(() => {
    signOutCloud();
    setSignedIn(false);
    setStatus(null);
  }, []);

  if (!enabled) return null;

  if (!signedIn) {
    return (
      <div className="flex flex-col gap-2 p-2 rounded-xl bg-black/20 border border-amber-900/40">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300/90 uppercase tracking-wide">
          <Cloud className="w-3.5 h-3.5" /> {mode === 'signup' ? 'Create cloud account' : 'Sign in to sync'}
        </div>
        <input
          type="email" inputMode="email" autoComplete="email" value={email}
          onChange={e => setEmail(e.target.value)} placeholder="email"
          className="w-full bg-[#1a0f0a] border border-[#5d4037] focus:border-amber-500 rounded-lg px-2.5 py-1.5 text-xs text-amber-100 outline-none placeholder-amber-800"
        />
        <input
          type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password}
          onChange={e => setPassword(e.target.value)} placeholder="password (min 6)"
          onKeyDown={e => { if (e.key === 'Enter' && email && password.length >= 6 && !busy) handleAuth(); }}
          className="w-full bg-[#1a0f0a] border border-[#5d4037] focus:border-amber-500 rounded-lg px-2.5 py-1.5 text-xs text-amber-100 outline-none placeholder-amber-800"
        />
        <button
          onClick={(e) => { e.stopPropagation(); handleAuth(); }}
          disabled={busy || !email.trim() || password.length < 6}
          className="w-full flex items-center justify-center gap-2 text-xs font-bold px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-white transition-colors disabled:opacity-50"
        >
          {mode === 'signup' ? <UserPlus className="w-3.5 h-3.5" /> : <LogIn className="w-3.5 h-3.5" />}
          {busy ? 'Working…' : (mode === 'signup' ? 'Create & sync' : 'Sign in & sync')}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setMode(mode === 'signup' ? 'login' : 'signup'); setStatus(null); }}
          className="text-[10px] text-amber-500/80 hover:text-amber-300 transition-colors"
        >
          {mode === 'signup' ? 'Have an account? Sign in' : 'New here? Create an account'}
        </button>
        {status && (
          <p className={`flex items-center gap-1.5 text-[10px] ${status.kind === 'ok' ? 'text-emerald-400/90' : 'text-red-400/90'}`}>
            {status.kind === 'ok' ? <Check className="w-3 h-3 shrink-0" /> : <AlertCircle className="w-3 h-3 shrink-0" />}{status.msg}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={(e) => { e.stopPropagation(); handleManualSync(); }}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-emerald-800/40 border border-emerald-700 text-emerald-100 hover:bg-emerald-700 transition-colors disabled:opacity-60"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
      {status && (
        <p className={`flex items-center gap-1.5 text-[10px] px-1 ${status.kind === 'ok' ? 'text-emerald-400/90' : 'text-red-400/90'}`}>
          {status.kind === 'ok' ? <Check className="w-3 h-3 shrink-0" /> : <AlertCircle className="w-3 h-3 shrink-0" />}{status.msg}
        </p>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); handleSignOut(); }}
        className="w-full flex items-center justify-center gap-1.5 text-[10px] text-amber-600 hover:text-amber-300 transition-colors"
      >
        <CloudOff className="w-3 h-3" /> Sign out of cloud ({getCloudEmail()})
      </button>
    </div>
  );
};

export default CloudSyncPanel;
