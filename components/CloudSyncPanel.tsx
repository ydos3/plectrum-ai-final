import React, { useCallback, useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, LogIn, Check, AlertCircle } from 'lucide-react';
import { cloudSyncEnabled, getSession, signIn, signOut, type SessionUser } from '../services/authClient';
import { syncNow, type SyncOutcome } from '../services/cloudSync';

// Optional cloud-sync control for the sidebar. Renders NOTHING unless the build
// has VITE_CLOUD_SYNC enabled, so the default product is completely unchanged.
const CloudSyncPanel: React.FC = () => {
  const enabled = cloudSyncEnabled();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    if (!enabled) { setChecking(false); return; }
    let alive = true;
    getSession().then(u => { if (alive) { setUser(u); setChecking(false); } });
    return () => { alive = false; };
  }, [enabled]);

  const handleSync = useCallback(async () => {
    setSyncing(true); setStatus(null);
    try {
      const r: SyncOutcome = await syncNow();
      setStatus({ kind: 'ok', msg: `Synced — ${r.total} songs (↑${r.pushed} ↓${r.pulled})` });
    } catch (e: any) {
      setStatus({ kind: 'err', msg: e?.message === 'not signed in' ? 'Please sign in first' : 'Sync failed — try again' });
    } finally {
      setSyncing(false);
    }
  }, []);

  if (!enabled) return null;

  if (checking) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-amber-500/70">
        <Cloud className="w-3.5 h-3.5 animate-pulse" /> Checking cloud…
      </div>
    );
  }

  if (!user) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); signIn(); }}
        className="w-full flex items-center justify-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-amber-800/40 border border-amber-700 text-amber-100 hover:bg-amber-700 transition-colors"
      >
        <LogIn className="w-3.5 h-3.5" /> Sign in to sync
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={(e) => { e.stopPropagation(); handleSync(); }}
        disabled={syncing}
        className="w-full flex items-center justify-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-emerald-800/40 border border-emerald-700 text-emerald-100 hover:bg-emerald-700 transition-colors disabled:opacity-60"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
        {syncing ? 'Syncing…' : 'Sync to cloud'}
      </button>
      {status && (
        <p className={`flex items-center gap-1.5 text-[10px] px-1 ${status.kind === 'ok' ? 'text-emerald-400/90' : 'text-red-400/90'}`}>
          {status.kind === 'ok' ? <Check className="w-3 h-3 shrink-0" /> : <AlertCircle className="w-3 h-3 shrink-0" />}
          {status.msg}
        </p>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); signOut(); }}
        className="w-full flex items-center justify-center gap-1.5 text-[10px] text-amber-600 hover:text-amber-300 transition-colors"
      >
        <CloudOff className="w-3 h-3" /> Sign out of cloud ({user.email || user.name})
      </button>
    </div>
  );
};

export default CloudSyncPanel;
