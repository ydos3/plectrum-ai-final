import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Search, UserPlus, Check, X, Users, Inbox, Send, Copy, Music2 } from 'lucide-react';
import { cloudSyncEnabled } from '../services/authClient';
import { isCloudSignedIn } from '../services/emailAuth';
import { syncNowSafe } from '../services/cloudSync';
import * as social from '../services/social';

interface Props { onBack?: () => void; }

// Musician network: set a username, find people, send/accept connection requests,
// and pick up songs others have shared with you. Requires being signed into the
// cloud (email account); shows a clear prompt otherwise.
const Connections: React.FC<Props> = ({ onBack }) => {
  const [tab, setTab] = useState<'people' | 'shared'>('people');
  const [profile, setProfile] = useState<social.Profile | null>(null);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<social.PublicUser[]>([]);
  const [connections, setConnections] = useState<social.PublicUser[]>([]);
  const [incoming, setIncoming] = useState<social.ConnReq[]>([]);
  const [outgoing, setOutgoing] = useState<social.ConnReq[]>([]);
  const [shared, setShared] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signedIn = cloudSyncEnabled() && isCloudSignedIn();

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    try {
      const [p, list, sh] = await Promise.all([social.getMyProfile(), social.listConnections(), social.sharedWithMe()]);
      setProfile(p); setConnections(list.connections); setIncoming(list.incoming); setOutgoing(list.outgoing); setShared(sh);
    } catch (e: any) { setMsg(e?.message || 'Could not load'); }
  }, [signedIn]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Debounced user search.
  useEffect(() => {
    if (!signedIn || query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try { setResults(await social.searchUsers(query.trim())); } catch { /* ignore */ }
    }, 350);
    return () => clearTimeout(t);
  }, [query, signedIn]);

  const act = async (fn: () => Promise<any>, okMsg?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (okMsg) setMsg(okMsg); await refresh(); }
    catch (e: any) { setMsg(e?.message || 'Something went wrong'); }
    finally { setBusy(false); }
  };

  const connectedIds = new Set(connections.map(c => c.userId));
  const outgoingIds = new Set(outgoing.map(r => r.recipientId));

  if (!cloudSyncEnabled()) {
    return <Shell onBack={onBack}><Empty icon={Users} text="Connections aren’t enabled in this build." /></Shell>;
  }
  if (!signedIn) {
    return <Shell onBack={onBack}><Empty icon={Users} text="Sign in to the cloud (sidebar → Account & settings) to connect with other musicians." /></Shell>;
  }

  return (
    <Shell onBack={onBack}>
      {/* Username setup */}
      {!profile && (
        <div className="mb-6 p-4 rounded-2xl bg-[#2d1b15] border border-amber-800/50">
          <p className="text-amber-200 font-bold text-sm mb-2">Pick a username so others can find you</p>
          <div className="flex gap-2">
            <input value={usernameDraft} onChange={e => setUsernameDraft(e.target.value)} placeholder="username (3–20, a–z 0–9 _)"
              className="flex-1 bg-[#1a0f0a] border border-[#5d4037] focus:border-amber-500 rounded-lg px-3 py-2 text-sm text-amber-100 outline-none" />
            <button disabled={busy} onClick={() => act(async () => setProfile(await social.setUsername(usernameDraft, usernameDraft)), 'Username set!')}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold disabled:opacity-50">Save</button>
          </div>
        </div>
      )}
      {profile && <p className="text-[11px] text-amber-500/70 mb-4">You are <span className="font-bold text-amber-300">@{profile.username}</span></p>}

      <div className="flex gap-2 mb-5">
        <TabBtn active={tab==='people'} onClick={() => setTab('people')} icon={Users} label="People" />
        <TabBtn active={tab==='shared'} onClick={() => setTab('shared')} icon={Music2} label={`Shared with me${shared.length?` (${shared.length})`:''}`} />
      </div>

      {msg && <div className="mb-4 text-xs text-amber-300 bg-amber-900/30 border border-amber-800/50 rounded-lg px-3 py-2">{msg}</div>}

      {tab === 'people' && (
        <div className="space-y-6">
          <section>
            <div className="relative mb-2">
              <Search className="w-4 h-4 text-amber-600 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search musicians by username…"
                className="w-full bg-[#1a0f0a] border border-[#5d4037] focus:border-amber-500 rounded-lg pl-9 pr-3 py-2 text-sm text-amber-100 outline-none" />
            </div>
            {results.map(u => (
              <Row key={u.userId} title={`@${u.username}`} subtitle={u.displayName}>
                {connectedIds.has(u.userId) ? <Tag text="Connected" />
                  : outgoingIds.has(u.userId) ? <Tag text="Requested" />
                  : <IconBtn onClick={() => act(() => social.sendConnectionRequest(u.userId), 'Request sent')} icon={UserPlus} label="Connect" />}
              </Row>
            ))}
            {query.trim().length >= 2 && results.length === 0 && <p className="text-xs text-amber-700 px-1 py-2">No musicians found.</p>}
          </section>

          {incoming.length > 0 && (
            <Section title="Requests to you" icon={Inbox}>
              {incoming.map(r => (
                <Row key={r.id} title="Connection request" subtitle={r.senderId.slice(0, 8)}>
                  <IconBtn onClick={() => act(() => social.acceptRequest(r.id), 'Connected!')} icon={Check} label="Accept" />
                  <IconBtn onClick={() => act(() => social.rejectRequest(r.id))} icon={X} label="Reject" subtle />
                </Row>
              ))}
            </Section>
          )}

          {outgoing.length > 0 && (
            <Section title="Sent requests" icon={Send}>
              {outgoing.map(r => (
                <Row key={r.id} title="Pending…" subtitle={r.recipientId.slice(0, 8)}>
                  <IconBtn onClick={() => act(() => social.cancelRequest(r.id))} icon={X} label="Cancel" subtle />
                </Row>
              ))}
            </Section>
          )}

          <Section title="Your connections" icon={Users}>
            {connections.length === 0 ? <p className="text-xs text-amber-700 px-1">No connections yet — search above.</p>
              : connections.map(c => (
                <Row key={c.userId} title={`@${c.username}`} subtitle={c.displayName}>
                  <IconBtn onClick={() => act(() => social.removeConnection(c.userId))} icon={X} label="Remove" subtle />
                </Row>
              ))}
          </Section>
        </div>
      )}

      {tab === 'shared' && (
        <div className="space-y-2">
          {shared.length === 0 ? <Empty icon={Music2} text="Nothing shared with you yet." />
            : shared.map(s => (
              <Row key={s.id} title={s.song?.title || 'Song'} subtitle={`from @${s.ownerUsername || 'user'}`}>
                <IconBtn
                  onClick={() => act(async () => { await social.duplicateSharedSong(s.ownerId, s.resourceId); await syncNowSafe(); }, 'Saved to your library')}
                  icon={Copy} label="Save copy" />
              </Row>
            ))}
        </div>
      )}
    </Shell>
  );
};

// ── little presentational helpers ──
const Shell: React.FC<{ onBack?: () => void; children: React.ReactNode }> = ({ onBack, children }) => (
  <div className="p-4 md:p-8 max-w-3xl mx-auto min-h-full">
    <div className="flex items-center gap-3 mb-6">
      {onBack && <button onClick={onBack} aria-label="Back" className="p-2 hover:bg-white/10 rounded-lg text-amber-200/70 hover:text-white"><ArrowLeft className="w-5 h-5" /></button>}
      <h2 className="text-2xl font-display font-bold text-amber-100 flex items-center gap-2"><Users className="w-6 h-6 text-amber-400" /> Connections</h2>
    </div>
    {children}
  </div>
);
const Empty: React.FC<{ icon: any; text: string }> = ({ icon: Icon, text }) => (
  <div className="flex flex-col items-center gap-3 text-center mt-12 text-amber-500/70">
    <Icon className="w-10 h-10 opacity-40" /><p className="text-sm max-w-xs">{text}</p>
  </div>
);
const TabBtn: React.FC<{ active: boolean; onClick: () => void; icon: any; label: string }> = ({ active, onClick, icon: Icon, label }) => (
  <button onClick={onClick} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${active ? 'bg-amber-500 text-amber-950 border-amber-400' : 'bg-black/30 text-amber-300/80 border-amber-900/50 hover:bg-amber-900/40'}`}><Icon className="w-3.5 h-3.5" /> {label}</button>
);
const Section: React.FC<{ title: string; icon: any; children: React.ReactNode }> = ({ title, icon: Icon, children }) => (
  <section><h3 className="flex items-center gap-2 text-[10px] font-black text-amber-700 uppercase tracking-widest mb-2"><Icon className="w-3.5 h-3.5" /> {title}</h3><div className="space-y-1.5">{children}</div></section>
);
const Row: React.FC<{ title: string; subtitle?: string; children?: React.ReactNode }> = ({ title, subtitle, children }) => (
  <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#2d1b15]/70 border border-[#5d4037]/50">
    <div className="min-w-0"><p className="text-sm font-bold text-amber-100 truncate">{title}</p>{subtitle && <p className="text-[11px] text-amber-600 truncate">{subtitle}</p>}</div>
    <div className="flex items-center gap-1.5 shrink-0">{children}</div>
  </div>
);
const Tag: React.FC<{ text: string }> = ({ text }) => <span className="text-[10px] font-bold text-emerald-400/90 bg-emerald-900/20 border border-emerald-800/40 rounded-full px-2.5 py-1">{text}</span>;
const IconBtn: React.FC<{ onClick: () => void; icon: any; label: string; subtle?: boolean }> = ({ onClick, icon: Icon, label, subtle }) => (
  <button onClick={onClick} title={label} className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-colors ${subtle ? 'text-amber-500 hover:text-red-400 hover:bg-red-900/20' : 'bg-amber-600 hover:bg-amber-500 text-white'}`}><Icon className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{label}</span></button>
);

export default Connections;
