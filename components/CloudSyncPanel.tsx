import React, { useCallback, useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, LogIn, UserPlus, Check, AlertCircle, CloudUpload } from 'lucide-react';
import { cloudSyncEnabled } from '../services/authClient';
import { signUpCloud, signInCloud, signOutCloud, isCloudSignedIn, getCloudEmail } from '../services/emailAuth';
import { startAutoSync, syncNowSafe, setSyncStatusListener, type SyncStatus } from '../services/cloudSync';

// Cross-device cloud account panel. Sign in with the SAME email + password on any
// device to carry your whole library everywhere. After sign-in everything syncs
// AUTOMATICALLY — no manual Save/Sync. Renders NOTHING unless VITE_CLOUD_SYNC is on.
const STATUS_TEXT: Record<SyncStatus, { label: string; cls: string }> = {
  idle:    { label: 'Auto-sync on',       cls: 'text-amber-500/80' },
  saving:  { label: 'Saving…',            cls: 'text-amber-300' },
  saved:   { label: 'All changes saved',  cls: 'text-emerald-400/90' },
  offline: { label: 'Offline — queued',   cls: 'text-amber-400/90' },
  error:   { label: 'Sync failed — retry', cls: 'text-red-400/90' },
};

const CloudSyncPanel: React.FC = () => {
  const enabled = cloudSyncEnabled();
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setSignedIn(isCloudSignedIn());
    setSyncStatusListener(setStatus);
    return () => setSyncStatusListener(null);
  }, [enabled]);

  const handleAuth = useCallback(async () => {
    setBusy(true); setAuthError(null);
    const fn = mode === 'signup' ? signUpCloud : signInCloud;
    const res = await fn(email.trim(), password);
    if (!res.ok) { setAuthError(res.error || 'Sign-in failed'); setBusy(false); return; }
    setSignedIn(true);
    setPassword('');
    startAutoSync();       // wire debounced auto-sync + tab-close flush
    await syncNowSafe();   // immediate first reconcile so this device's library appears
    setBusy(false);
  }, [mode, email, password]);

  const handleSignOut = useCallback(() => {
    signOutCloud();
    setSignedIn(false);
    setStatus('idle');
  }, []);

  if (!enabled) return null;

  if (!signedIn) {
    return (
      <div className="flex flex-col gap-2 p-2 rounded-xl bg-black/20 border border-amber-900/40">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300/90 uppercase tracking-wide">
          <Cloud className="w-3.5 h-3.5" /> {mode === 'signup' ? 'Create cloud account' : 'Sign in to sync'}
        </div>
        <p className="text-[10px] text-amber-500/70 -mt-1">Use the same email on any device to carry your library.</p>
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
          {busy ? 'Working…' : (mode === 'signup' ? 'Create account' : 'Sign in')}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setMode(mode === 'signup' ? 'login' : 'signup'); setAuthError(null); }}
          className="text-[10px] text-amber-500/80 hover:text-amber-300 transition-colors"
        >
          {mode === 'signup' ? 'Have an account? Sign in' : 'New here? Create an account'}
        </button>
        {authError && (
          <p className="flex items-center gap-1.5 text-[10px] text-red-400/90">
            <AlertCircle className="w-3 h-3 shrink-0" />{authError}
          </p>
        )}
      </div>
    );
  }

  const st = STATUS_TEXT[status];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-900/20 border border-emerald-800/50">
        <CloudUpload className="w-4 h-4 text-emerald-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-emerald-100 truncate">Cloud synced</p>
          <p className={`flex items-center gap-1 text-[10px] ${st.cls}`}>
            {status === 'saving' && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
            {status === 'saved' && <Check className="w-2.5 h-2.5" />}
            {st.label}
          </p>
        </div>
        {status === 'error' && (
          <button onClick={(e) => { e.stopPropagation(); void syncNowSafe(); }} className="text-[10px] font-bold text-amber-300 hover:text-white px-1.5 py-1 rounded bg-amber-800/40" title="Retry sync">
            Retry
          </button>
        )}
      </div>
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
