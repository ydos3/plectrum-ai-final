
import React, { useState, useEffect } from 'react';
import { Song } from '../types';
import { getSongs, deleteSong } from '../services/storageService';
import { Play, Edit2, Trash2, Search, Download, Film, Plus, Guitar, Video } from 'lucide-react';

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

  const loadSongs = () => {
    const storedSongs = getSongs().sort((a, b) => b.createdAt - a.createdAt);
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
        console.error("Delete failed", err);
        loadSongs();
      }
    }
  };

  const handleDownloadPDF = (song: Song, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Parse content into lines of {lyrics, chords}
    const lines = song.content.split(/\r?\n/).map(line => {
      const chordMatches = line.match(/\[.*?\]/g);
      const chords = chordMatches ? chordMatches.join('  ') : ''; // Spaced out chords
      const lyrics = line.replace(/\[.*?\]/g, '').trim();
      return { lyrics, chords };
    });

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
        <head>
            <title>${song.title} - Plectrum.ai</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;800&family=JetBrains+Mono:wght@500&display=swap');
                body { font-family: 'Montserrat', sans-serif; padding: 40px; color: #1a0f0a; background: #fff; }
                .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #5d4037; padding-bottom: 20px; margin-bottom: 30px; }
                .logo { color: #d97706; font-weight: 900; font-size: 24px; display: flex; align-items: center; gap: 10px; }
                .logo svg { width: 50px; height: 50px; }
                .meta { text-align: right; font-size: 12px; color: #666; }
                h1 { margin: 0; font-size: 36px; text-transform: uppercase; letter-spacing: 2px; color: #2d1b15; }
                h3 { margin: 5px 0 0; font-size: 18px; color: #d97706; font-weight: 600; }
                
                .content-grid { display: grid; grid-template-columns: 1fr 200px; gap: 30px; font-size: 14px; line-height: 1.8; }
                .line-row { display: contents; }
                .lyrics { padding: 5px 0; border-bottom: 1px solid #f0f0f0; }
                .chords { padding: 5px 0; font-family: 'JetBrains Mono', monospace; color: #d97706; font-weight: bold; text-align: right; border-bottom: 1px solid #f0f0f0; }
                .section-header { grid-column: 1 / -1; font-weight: 800; color: #2d1b15; margin-top: 15px; border-bottom: none; }
                
                .footer { margin-top: 50px; text-align: center; font-size: 10px; color: #999; border-top: 1px solid #eee; padding-top: 20px; text-transform: uppercase; letter-spacing: 1px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <h1>${song.title}</h1>
                    <h3>${song.artist}</h3>
                </div>
                <div class="meta">
                    <div>Key: ${song.key || '-'}</div>
                    <div>Capo: ${song.capo || '0'}</div>
                    <div>Strum: ${song.strummingPattern || '-'}</div>
                    <br/>
                    <div class="logo">
                        <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <defs>
                                <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stop-color="#f59e0b" />
                                <stop offset="100%" stop-color="#d97706" />
                                </linearGradient>
                            </defs>
                            <path d="M100 195C100 195 185 130 185 60C185 25 155 5 100 5C45 5 15 25 15 60C15 130 100 195 100 195Z" fill="#2d1b15" stroke="url(#g)" stroke-width="6"/>
                            <circle cx="100" cy="130" r="8" fill="#f59e0b" />
                            <path d="M100 130L65 80" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" />
                            <path d="M100 130L135 80" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" />
                            <circle cx="65" cy="80" r="6" fill="#fff" />
                            <circle cx="135" cy="80" r="6" fill="#fff" />
                        </svg>
                        Plectrum.ai
                    </div>
                </div>
            </div>

            <div class="content-grid">
                <div class="lyrics" style="font-weight:800; color:#555; text-transform:uppercase; font-size:12px;">Lyrics</div>
                <div class="chords" style="font-weight:800; color:#555; text-transform:uppercase; font-size:12px;">Chords</div>
                ${lines.map(l => {
        if (!l.lyrics && !l.chords) return ''; // Skip empty lines
        return `
                    <div class="line-row">
                        <div class="lyrics">${l.lyrics || '&nbsp;'}</div>
                        <div class="chords">${l.chords}</div>
                    </div>
                `}).join('')}
            </div>

            <div class="footer">
                Generated by Plectrum.ai • The Guitarist's OS
            </div>
            <script>window.print()</script>
        </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  const filteredSongs = songs.filter(song =>
    song.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    song.artist.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto h-full overflow-y-auto">
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
        {/* Primary Action Card */}
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
          filteredSongs.map(song => (
            <div
              key={song.id}
              onClick={() => onPlay(song)}
              className="group relative bg-[#2d1b15]/60 hover:bg-[#3e2723] border border-[#5d4037] hover:border-amber-600/50 rounded-xl p-5 transition-all cursor-pointer hover:shadow-xl hover:shadow-amber-900/20 overflow-hidden flex flex-col h-64"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="pr-2 overflow-hidden">
                  <h3 className="text-lg font-bold text-amber-100 mb-1 truncate">{song.title}</h3>
                  <p className="text-sm text-amber-500 font-medium truncate">{song.artist}</p>
                  {song.movie && <p className="text-[10px] text-amber-500/60 flex items-center gap-1 mt-1"><Film className="w-3 h-3" /> {song.movie}</p>}
                </div>
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
          ))
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
