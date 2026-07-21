import React, { useEffect, useState } from 'react';
import { X, Share2, Check, Users } from 'lucide-react';
import type { Song } from '../types';
import * as social from '../services/social';

interface Props { song: Song; onClose: () => void; }

// Share a song with one of your connections (view-only; they can save a copy).
// You can only share with people you're connected to — enforced on the server too.
const ShareDialog: React.FC<Props> = ({ song, onClose }) => {
  const [connections, setConnections] = useState<social.PublicUser[]>([]);
  const [sharedTo, setSharedTo] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [list, mine] = await Promise.all([social.listConnections(), social.sharedByMe()]);
        setConnections(list.connections);
        setSharedTo(new Set(mine.filter((s: any) => s.resourceId === song.id && !s.revoked).map((s: any) => s.recipientId)));
      } catch (e: any) { setMsg(e?.message || 'Could not load connections'); }
      finally { setLoading(false); }
    })();
  }, [song.id]);

  const toggle = async (u: social.PublicUser) => {
    setMsg(null);
    try {
      if (sharedTo.has(u.userId)) {
        await social.revokeShare(u.userId, song.id);
        setSharedTo(prev => { const n = new Set(prev); n.delete(u.userId); return n; });
      } else {
        await social.shareSong(u.userId, song.id);
        setSharedTo(prev => new Set(prev).add(u.userId));
      }
    } catch (e: any) { setMsg(e?.message || 'Action failed'); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#1a0f0a] border border-[#5d4037] rounded-2xl max-w-md w-full max-h-[80dvh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-[#5d4037] flex items-center justify-between bg-[#2d1b15]">
          <h3 className="text-amber-100 font-bold flex items-center gap-2"><Share2 className="w-4 h-4 text-amber-400" /> Share “{song.title}”</h3>
          <button onClick={onClose} aria-label="Close" className="text-amber-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-3 overflow-y-auto">
          {msg && <div className="mb-2 text-xs text-amber-300 bg-amber-900/30 border border-amber-800/50 rounded-lg px-3 py-2">{msg}</div>}
          {loading ? <p className="text-sm text-amber-600 p-4 text-center">Loading…</p>
            : connections.length === 0 ? (
              <div className="flex flex-col items-center gap-2 text-center py-8 text-amber-500/70">
                <Users className="w-8 h-8 opacity-40" />
                <p className="text-sm">Connect with musicians first (Connections in the sidebar), then share with them here.</p>
              </div>
            ) : connections.map(u => {
              const shared = sharedTo.has(u.userId);
              return (
                <button key={u.userId} onClick={() => toggle(u)}
                  className="w-full flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-[#2d1b15] text-left border-b border-[#2d1b15]">
                  <div className="min-w-0"><p className="text-sm font-bold text-amber-100 truncate">@{u.username}</p><p className="text-[11px] text-amber-600 truncate">{u.displayName}</p></div>
                  <span className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg shrink-0 ${shared ? 'bg-emerald-800/40 text-emerald-200 border border-emerald-700' : 'bg-amber-600 text-white'}`}>
                    {shared ? <><Check className="w-3.5 h-3.5" /> Shared</> : <><Share2 className="w-3.5 h-3.5" /> Share</>}
                  </span>
                </button>
              );
            })}
        </div>
        <div className="p-3 border-t border-[#5d4037] text-[10px] text-amber-700 text-center">View-only. Recipients can save their own copy.</div>
      </div>
    </div>
  );
};

export default ShareDialog;
