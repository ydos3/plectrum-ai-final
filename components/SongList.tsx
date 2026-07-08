import React, { useEffect, useState } from 'react';
import { Song, SongStatus } from '../types';
import { deleteSong, getSongs } from '../services/storageService';
import { Download, Edit2, Film, Guitar, Play, Plus, Search, Trash2, Video } from 'lucide-react';

// Honest completeness badges so demo/incomplete songs are never shown as polished.
const STATUS_BADGES: Record<Exclude<SongStatus, 'complete'>, { label: string; className: string }> = {
  demo: { label: 'Demo', className: 'bg-amber-400 text-amber-950' },
  'tabs-only': { label: 'Tabs only', className: 'bg-sky-400/90 text-sky-950' },
  'lyrics-only': { label: 'Lyrics only', className: 'bg-violet-400/90 text-violet-950' },
  'needs-sync': { label: 'Needs sync', className: 'bg-orange-400/90 text-orange-950' },
  incomplete: { label: 'Incomplete', className: 'bg-rose-400/90 text-rose-950' },
};

interface SongListProps {
  onEdit: (song: Song) => void;
  onPlay: (song: Song) => void;
  onOpenLab?: (song: Song) => void;
  onOpenPractice?: (song: Song) => void;
  onCreateNew?: () => void;
}

const SongList: React.FC<SongListProps> = ({ onEdit, onPlay, onOpenLab, onOpenPractice, onCreateNew }) => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeLetter, setActiveLetter] = useState('All');

  const loadSongs = () => {
    const storedSongs = getSongs().sort((a, b) => (
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true })
    ));
    setSongs(storedSongs);
  };

  useEffect(() => {
    loadSongs();
  }, []);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this song?')) {
      try {
        deleteSong(id);
        setSongs(prev => prev.filter(s => s.id !== id));
      } catch (err) {
        console.error('Delete failed', err);
        loadSongs();
      }
    }
  };

  const escapeHtml = (value: string) => (
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  );

  const formatSheetContent = (content: string) => (
    content.split(/\r?\n/).map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '<div class="spacer"></div>';

      if (trimmed.startsWith('###') || trimmed.endsWith(':')) {
        return `<div class="section">${escapeHtml(trimmed.replace(/###/g, '').replace(/[\[\]:]/g, '').trim())}</div>`;
      }

      const chordMatches = Array.from(trimmed.matchAll(/\[(.*?)\]/g)).map(match => match[1].trim()).filter(Boolean);
      const lyricText = trimmed.replace(/\[[^\]]+\]/g, '').replace(/\s{2,}/g, ' ').trim();

      const chordRail = chordMatches.length
        ? `<div class="chord-rail">${chordMatches.map(chord => `<span>${escapeHtml(chord)}</span>`).join('')}</div>`
        : '<div class="chord-rail"></div>';

      return `<div class="song-line"><div class="lyric-line">${escapeHtml(lyricText) || '&nbsp;'}</div>${chordRail}</div>`;
    }).join('')
  );

  const handleDownloadPDF = (song: Song, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const safeTitle = escapeHtml(song.title);
    const safeArtist = escapeHtml(song.artist);
    const generatedOn = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

    printWindow.document.write(`
      <html>
      <head>
        <title>${safeTitle} - Plectrum</title>
        <style>
          @page { size: A4; margin: 10mm; }
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; }
          body { font-family: Arial, Helvetica, sans-serif; color: #211813; background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .sheet { position: relative; padding: 5mm; background: #fffaf2; border: 1.5px solid #d97706; border-radius: 6px; }
          .header { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px; align-items: end; padding: 9px 10px; margin-bottom: 9px; background: linear-gradient(135deg, #2d1b15 0%, #5d2f12 100%); border: 1px solid #d97706; border-radius: 5px; break-after: avoid; page-break-after: avoid; }
          h1 { margin: 0; color: #fff7ed; font-size: 25px; line-height: 1.05; font-weight: 900; }
          h2 { margin: 3px 0 0; color: #fbbf24; font-size: 13px; font-weight: 800; }
          .meta { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; max-width: 285px; font-size: 9.5px; color: #fff7ed; text-align: right; }
          .pill { border: 1px solid rgba(251,191,36,0.55); background: rgba(255,247,237,0.1); border-radius: 5px; padding: 3px 6px; font-weight: 800; white-space: nowrap; }
          .brand { width: 100%; color: #fbbf24; font-size: 8.5px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; }
          .content { position: relative; z-index: 1; display: grid; gap: 2px; }
          .section { margin: 8px 0 3px; padding: 2px 0 3px; color: #b45309; border-bottom: 1.5px solid #f4c06a; font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; page-break-after: avoid; break-after: avoid; }
          .song-line { display: grid; grid-template-columns: minmax(0,1fr) minmax(82px,25%); gap: 9px; align-items: baseline; min-height: 17px; padding: 2px 5px; border-bottom: 1px solid #f1dfc0; break-inside: avoid; page-break-inside: avoid; }
          .song-line:nth-child(even) { background: #fff3dd; }
          .lyric-line { font-size: 12px; line-height: 1.25; color: #211813; word-break: break-word; }
          .chord-rail { display: flex; justify-content: flex-end; align-items: baseline; flex-wrap: wrap; gap: 3px; min-width: 0; }
          .chord-rail span { font-family: Consolas, 'Courier New', monospace; font-size: 10px; line-height: 1.05; font-weight: 900; color: #2d1b15; background: #fbbf24; border: 1px solid #d97706; border-radius: 4px; padding: 1px 4px; }
          .spacer { height: 3px; }
          .footer { display: flex; justify-content: space-between; margin-top: 8px; border-top: 1px solid #f4c06a; padding-top: 4px; color: #92400e; font-size: 8px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; background: #fffaf2; }
          @media screen { body { background: #2d1b15; } .sheet { max-width: 210mm; min-height: 297mm; margin: 18px auto; padding: 10mm; box-shadow: 0 20px 70px rgba(0,0,0,0.3); } }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="header">
            <div>
              <h1>${safeTitle}</h1>
              <h2>${safeArtist}</h2>
            </div>
            <div class="meta">
              <div class="pill">Key ${escapeHtml(song.key || '-')}</div>
              <div class="pill">Capo ${escapeHtml(String(song.capo ?? 0))}</div>
              <div class="pill">Strum ${escapeHtml(song.strummingPattern || '-')}</div>
              <div class="pill">${escapeHtml(song.difficulty || 'Practice')}</div>
              <div class="brand">Plectrum Practice Sheet</div>
            </div>
          </div>
          <div class="content">${formatSheetContent(song.content)}</div>
          <div class="footer">
            <span>Generated by Plectrum</span>
            <span>${generatedOn}</span>
          </div>
        </div>
        <script>
          window.addEventListener('load', () => setTimeout(() => window.print(), 100));
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const getSongLetter = (song: Song): string => {
    const first = (song.title || '#').trim().charAt(0).toUpperCase();
    return /^[A-Z]$/.test(first) ? first : '#';
  };

  const songLetters = Array.from(new Set<string>(songs.map(getSongLetter))).sort((a, b) => {
    if (a === '#') return 1;
    if (b === '#') return -1;
    return a.localeCompare(b);
  });

  const filteredSongs = songs.filter(song => {
    const matchesSearch =
      song.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      song.artist.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLetter = activeLetter === 'All' || getSongLetter(song) === activeLetter;
    return matchesSearch && matchesLetter;
  });

  return (
    <div className="relative p-6 md:p-8 max-w-7xl mx-auto h-full overflow-y-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-display font-bold text-amber-100 mb-2 drop-shadow-sm">
            My Song Library
          </h2>
          <p className="text-amber-200/60">Manage your setlist and tabs</p>
        </div>
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-amber-500/50 w-5 h-5" />
          <input
            type="text"
            placeholder="Search songs, artists..."
            className="w-full bg-[#2d1b15]/80 border border-[#5d4037] text-amber-100 pl-10 pr-4 py-2.5 rounded-lg focus:ring-2 focus:ring-amber-600 focus:border-transparent outline-none transition-all placeholder-amber-700/50"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {songLetters.length > 1 && (
        <div className="fixed right-2 md:right-5 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-1 rounded-full border border-amber-700/40 bg-[#1a0f0a]/85 px-1.5 py-2 shadow-2xl backdrop-blur-md no-global-click">
          {['All', ...songLetters].map(letter => (
            <button
              key={letter}
              onClick={() => setActiveLetter(letter)}
              className={`min-w-7 h-6 rounded-full px-1 text-[10px] font-black transition-all ${
                activeLetter === letter
                  ? 'bg-amber-600 text-white shadow-[0_0_18px_rgba(217,119,6,0.35)]'
                  : 'text-amber-500 hover:bg-amber-900/40 hover:text-amber-100'
              }`}
              title={letter === 'All' ? 'Show all songs' : `Show ${letter} songs`}
            >
              {letter}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20 pr-7 md:pr-2">
        <div
          onClick={onCreateNew}
          className="group relative bg-gradient-to-br from-amber-900/40 to-[#2d1b15] hover:from-amber-800/50 hover:to-[#3e2723] border-2 border-dashed border-amber-600/50 hover:border-amber-500 rounded-xl p-5 transition-all cursor-pointer flex flex-col items-center justify-center h-64 shadow-inner"
        >
          <div className="w-16 h-16 rounded-full bg-amber-600/20 group-hover:bg-amber-600 flex items-center justify-center mb-4 transition-colors">
            <Plus className="w-8 h-8 text-amber-500 group-hover:text-white" />
          </div>
          <h3 className="text-xl font-bold text-amber-100 mb-1">Create New Song</h3>
          <p className="text-sm text-amber-500/70 text-center px-4">AI Lyrics, Chords, and Magic</p>
        </div>

        {filteredSongs.length > 0 ? (
          filteredSongs.map(song => {
            const isTabOnly = Boolean(song.fingerstyleTab) || song.status === 'tabs-only';
            const badge = song.status && song.status !== 'complete' ? STATUS_BADGES[song.status] : null;
            const handleCardOpen = () => {
              // Tab-only songs open straight into the Fretboard Lab where their
              // tabs live, instead of the (empty) karaoke teleprompter.
              if (isTabOnly && onOpenLab) onOpenLab(song);
              else onPlay(song);
            };
            return (
            <div
              key={song.id}
              onClick={handleCardOpen}
              className="group relative bg-[#2d1b15]/60 hover:bg-[#3e2723] border border-[#5d4037] hover:border-amber-600/50 rounded-xl p-5 transition-all cursor-pointer hover:shadow-xl hover:shadow-amber-900/20 overflow-hidden flex flex-col h-64"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="pr-2 overflow-hidden">
                  <h3 className="text-lg font-bold text-amber-100 mb-1 truncate">{song.title}</h3>
                  <p className="text-sm text-amber-500 font-medium truncate">{song.artist}</p>
                  {song.collection
                    ? <p className="text-[10px] text-amber-500/60 flex items-center gap-1 mt-1"><Film className="w-3 h-3" /> {song.collection}</p>
                    : song.movie && <p className="text-[10px] text-amber-500/60 flex items-center gap-1 mt-1"><Film className="w-3 h-3" /> {song.movie}</p>}
                </div>
                {badge && (
                  <span className={`shrink-0 text-[9px] font-black uppercase tracking-wider rounded px-1.5 py-0.5 ${badge.className}`}>
                    {badge.label}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-[#1a110d]/50 p-2 rounded text-[10px] border border-[#5d4037]/30">
                  <div className="text-amber-700 font-bold uppercase">Key</div>
                  <div className="text-amber-200">{song.key || '-'}</div>
                </div>
                <div className="bg-[#1a110d]/50 p-2 rounded text-[10px] border border-[#5d4037]/30">
                  <div className="text-amber-700 font-bold uppercase">Capo</div>
                  <div className="text-amber-200">{song.capo || '0'}</div>
                </div>
              </div>

              <div className="text-xs text-amber-200/50 font-mono mb-4 bg-[#1a110d]/30 p-2 rounded border border-[#5d4037]/20 flex-1 overflow-hidden relative">
                <pre className="whitespace-pre-wrap font-sans opacity-70">{song.content.slice(0, 100)}...</pre>
                <div className="absolute inset-0 bg-gradient-to-t from-[#2d1b15] to-transparent"></div>
              </div>

              <div className="flex flex-col gap-3 mt-auto">
                <div className="flex items-center justify-between pt-2 border-t border-[#5d4037]/50">
                  <div className="flex gap-2">
                    <button onClick={(e) => handleDownloadPDF(song, e)} className="p-2 text-amber-500 hover:text-white hover:bg-amber-800 rounded-lg" title="Download PDF"><Download className="w-4 h-4" /></button>
                    {onOpenPractice && (
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenPractice(song); }}
                        className="p-2 text-amber-500 hover:text-white hover:bg-amber-800 rounded-lg"
                        title="Practice Room"
                      >
                        <Video className="w-4 h-4" />
                      </button>
                    )}
                    {onOpenLab && <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenLab(song); }} className="p-2 text-amber-500 hover:text-white hover:bg-amber-800 rounded-lg" title="Fretboard Lab"><Guitar className="w-4 h-4" /></button>}
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(song); }} className="p-2 text-amber-500 hover:text-white hover:bg-amber-800 rounded-lg" title="Edit"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={(e) => handleDelete(song.id, e)} className="p-2 text-amber-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <button className="p-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg shadow-lg">
                    <Play className="w-4 h-4 fill-current" />
                  </button>
                </div>
              </div>
            </div>
            );
          })
        ) : (
          <div className="col-span-1 md:col-span-2 flex items-center justify-center p-8 bg-[#2d1b15]/20 rounded-xl border border-[#5d4037]/50 border-dashed">
            <p className="text-amber-500/60 italic">Your songs will appear here once you start creating.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SongList;
