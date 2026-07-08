
import React, { useState, useEffect, useRef } from 'react';
import GuitarFretboard from './GuitarFretboard';
import { Handedness, Song } from '../types';
import { getChordFingering, getAllChords } from '../services/chordService';
import { playStrum, playNote, playPercussion, resumeAudio, stopAllAudio } from '../services/audioService';
import { getSongs } from '../services/storageService';
import { parseFingerstyleTab } from '../services/tabParser';
import { Play, Pause, Square, Hand, Zap, RotateCcw, FolderOpen, Plus, Activity, Info, Trash2, ArrowLeft } from 'lucide-react';

type InputMode = 'CHORDS' | 'FINGERSTYLE';

interface FretboardLabProps {
    initialSong?: Song;
    onBack?: () => void;
}

// PRESETS
const PRESET_CHORDS = {
    title: "Masterpiece Strum",
    mode: 'CHORDS' as InputMode,
    text: "Cmaj7 G6 Dadd9 Em9 Cmaj7 G6 Dadd9 Dadd9",
    pattern: "D D UUD UDU",
    capo: 0
};

const PRESET_PAYPHONE = {
    title: "Payphone Fingerstyle",
    mode: 'FINGERSTYLE' as InputMode,
    // Demo excerpt (riff, not a full arrangement) — labelled honestly below.
    text: "B0-h-B1-s-B3-e5-A5-G0-e3/B3--A5-G0/B3/e3-pulloff-e2-B3-B1- -E3-D0-G0/B1-E3-D0/G0/B1-pulloff-B0-G0-B1-E0-B0-D2-G2-E0-D2-B0-G2-A5-D4-G2-D4-B0-h-B1-s-B3-e5-A5-G0-e3/B3--A5-G0/B3/e3-pulloff-e2-B3-B1- -E3-D0-G0/B1-E3-D0/G0/B1-pulloff-B0-G0-B1-E3-D0-G0/B1-E3-D0/G0/B1-pulloff-B0-E3-B0-h-B1-E0-D2-B0-G2-E0-D2-B0-G2-D0---G0-G0-A3-D2-G0-Slap-E0-B3-B3-A3-B0-G2-Slap-E0-G2",
    pattern: "",
    capo: 3
};

// Original fingerstyle demo arrangement — no copyrighted lyrics. Am–Em–F–C–G–E.
// Capo 5 at ~1.4x for the ballad feel.
const PRESET_CHANNA = {
    title: "Channa Mereya Fingerstyle",
    mode: 'FINGERSTYLE' as InputMode,
    text: "A0-e0-B1-G2-B1-e0-E0-e0-B0-G0-B0-e0-D3-e0-B1-G2-B1-e0-A3-e0-B1-G0-B1-e0-E3-e3-B0-G0-B0-e3-A0-e0-B1-G2-B1-e0-e0-h-e2-B1-s-B3-B3-p-B1-G0-E0/G1/B0/e0-e0-B0-G1-A0/G2/B1/e0-e0-B1-G2-D3/G2/B1/e0-e0-B1-G2-A3/G0/B1/e0-e0-B1-G0-slap-A0-e0",
    pattern: "",
    capo: 5,
    speed: 1.4
};

const FretboardLab: React.FC<FretboardLabProps> = ({ initialSong, onBack }) => {
  const [handedness, setHandedness] = useState<Handedness>('Right');
  const [inputMode, setInputMode] = useState<InputMode>('FINGERSTYLE');
  const [inputText, setInputText] = useState(PRESET_CHANNA.text);
  const [strumPattern, setStrumPattern] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(PRESET_CHANNA.speed);
  const [capoPosition, setCapoPosition] = useState(PRESET_CHANNA.capo);

  const [activeNotes, setActiveNotes] = useState<{string: number, fret: number}[]>([]);
  
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [songs, setSongs] = useState<Song[]>([]);

  // Refs for loop control to avoid state closure traps
  const playbackTimeout = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const previousFretsRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    setSongs(getSongs());
  }, []);

  const loadSongIntoLab = (song: Song) => {
      // Fingerstyle tab songs (e.g. the Channa Mereya demo) load their playable
      // tab directly so selecting them always shows their tabs.
      if (song.fingerstyleTab) {
          setInputMode('FINGERSTYLE');
          setInputText(song.fingerstyleTab);
          setStrumPattern('');
          setCapoPosition(song.capo ?? 0);
          setPlaybackSpeed(1.4); // ballad feel for the fingerstyle demos
          setShowLoadModal(false);
          return;
      }
      const matches = song.content.match(/\[.*?\]/g);
      if (matches) {
          const chords = matches.map(c => c.replace(/[\[\]]/g, ''));
          setInputText(chords.join(' '));
          setInputMode('CHORDS');
          if (song.strummingPattern) {
              const fmt = song.strummingPattern.replace(/-/g, ' ').split('').join(' ');
              setStrumPattern(fmt);
          }
          if (song.capo) setCapoPosition(song.capo);
      } else {
          if(!initialSong) alert("No chords found in this song (look for [brackets]).");
      }
      setShowLoadModal(false);
  };

  const loadPreset = (preset: typeof PRESET_CHORDS | typeof PRESET_PAYPHONE | typeof PRESET_CHANNA) => {
      setInputMode(preset.mode);
      setInputText(preset.text);
      setStrumPattern(preset.pattern);
      setCapoPosition(preset.capo);
      const presetSpeed = (preset as { speed?: number }).speed;
      setPlaybackSpeed(typeof presetSpeed === 'number' ? presetSpeed : 1);
      setShowLoadModal(false);
  };

  useEffect(() => {
      if (initialSong) {
          loadSongIntoLab(initialSong);
      } else {
          loadPreset(PRESET_CHANNA);
      }
  }, [initialSong]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
        if (playbackTimeout.current) window.clearTimeout(playbackTimeout.current);
        isPlayingRef.current = false;
        stopAllAudio();
    };
  }, []);

  // EXECUTION ENGINE
  const executeSequence = (stepIndex: number, patternIndex: number = 0, steps: any[]) => {
      // Check ref current value to ensure we have latest state
      if (stepIndex >= steps.length || !isPlayingRef.current) {
          if (isPlayingRef.current && steps.length > 0) {
              executeSequence(0, 0, steps);
              return;
          }
          stopPlayback();
          return;
      }

      let nextDelay = 500;
      let nextStep = stepIndex + 1;
      let nextPattern = 0;

      if (inputMode === 'CHORDS') {
          const token = steps[stepIndex];
          const fingering = getChordFingering(token);
          const patternSteps = strumPattern ? strumPattern.toUpperCase().split(/[\s,]+/).filter(t => t) : ['D'];
          
          if (fingering) {
              const notesToPlay = fingering.frets.map((f, i) => ({ 
                  string: i, 
                  fret: f === -1 ? -1 : (f === 0 ? capoPosition : f + capoPosition) 
              }));
              setActiveNotes(notesToPlay);

              const direction = patternSteps[patternIndex] as 'D' | 'U' | 'X';
              if (direction === 'X') playPercussion();
              else playStrum(notesToPlay, direction, 1);

              if (patternIndex < patternSteps.length - 1) {
                  nextStep = stepIndex; // Stay on chord
                  nextPattern = patternIndex + 1;
                  nextDelay = 500 / playbackSpeed;
              } else {
                  nextStep = stepIndex + 1;
                  nextPattern = 0;
                  nextDelay = 500 / playbackSpeed;
              }
          } else {
              // Not a known chord, skip
              nextDelay = 100;
          }
      } else {
          // FINGERSTYLE LOGIC
          const frame = steps[stepIndex];
          if (frame) {
              if (frame.percussion === 'slap') {
                  setActiveNotes([]);
                  playPercussion();
                  nextDelay = frame.duration / playbackSpeed;
              } else {
              // Apply Capo to frame notes
              const playedNotes = frame.notes.map((n: any) => ({
                  string: n.string,
                  fret: n.fret === 0 ? capoPosition : n.fret + capoPosition,
                  technique: n.technique,
                  fromFret: ['hammer-on', 'pull-off', 'slide'].includes(n.technique)
                    ? previousFretsRef.current.get(n.string)
                    : undefined
              }));
              
              setActiveNotes(playedNotes);
              
              // Play notes
              playedNotes.forEach((n: any) => {
                  playNote(n.string, n.fret, n.technique || 'normal', 0, n.fromFret);
              });
              playedNotes.forEach((n: any) => previousFretsRef.current.set(n.string, n.fret));
              
              nextDelay = frame.duration / playbackSpeed;
              }
          }
      }

      playbackTimeout.current = window.setTimeout(() => {
          executeSequence(nextStep, nextPattern, steps);
      }, nextDelay);
  };

  const startPlayback = () => {
      if (playbackTimeout.current) window.clearTimeout(playbackTimeout.current);
      resumeAudio(); // Ensure audio context is ready
      previousFretsRef.current.clear();
      isPlayingRef.current = true;
      setIsPlaying(true);

      if (inputMode === 'CHORDS') {
          const steps = inputText.replace(/\n/g, ' ').split(/[\s,]+/).filter(t => t.trim().length > 0);
          if (steps.length > 0) executeSequence(0, 0, steps);
      } else {
          const frames = parseFingerstyleTab(inputText);
          if (frames.length > 0) executeSequence(0, 0, frames);
      }
  };

  const stopPlayback = () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      if (playbackTimeout.current) window.clearTimeout(playbackTimeout.current);
      playbackTimeout.current = null;
      stopAllAudio();
      setActiveNotes([]);
      previousFretsRef.current.clear();
  };

  const insertChord = (chord: string) => {
      setInputText(prev => (prev + " " + chord).trim());
  };

  const availableChords = getAllChords();

  return (
    <div className="flex flex-col h-[100dvh] bg-[#0a0503] overflow-hidden relative no-global-click">
       {/* Top Control Bar */}
       <div className="bg-[#1a0f0a] border-b border-[#3e2723] p-3 md:p-4 flex justify-between items-center shadow-lg relative z-20 shrink-0 h-16 md:h-20">
            <div className="flex items-center gap-2 md:gap-4">
                {onBack && (
                     <button onClick={onBack} className="p-2 hover:bg-white/10 rounded-lg text-amber-200/60 hover:text-white transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                )}
                <div className="bg-gradient-to-br from-amber-900 to-amber-700 p-1.5 md:p-2 rounded-lg shadow-inner">
                    <Zap className="w-4 h-4 md:w-5 md:h-5 text-amber-100" />
                </div>
                <div>
                    <h2 className="text-sm md:text-xl font-bold text-amber-500 uppercase tracking-widest font-display">Lab</h2>
                </div>
            </div>
            
            <div className="flex gap-2 md:gap-3">
                 <button onClick={() => setShowLoadModal(true)} className="btn-secondary flex items-center gap-2 text-[10px] md:text-xs font-bold text-amber-200 hover:text-white px-2 md:px-3 py-2 rounded bg-[#2d1b15] border border-[#5d4037]">
                    <FolderOpen className="w-3 h-3 md:w-4 md:h-4" /> Load
                 </button>
                 <button onClick={() => setHandedness(h => h === 'Right' ? 'Left' : 'Right')} className="btn-secondary flex items-center gap-2 text-[10px] md:text-xs font-bold text-amber-200 hover:text-white px-2 md:px-3 py-2 rounded bg-[#2d1b15] border border-[#5d4037]">
                     <Hand className="w-3 h-3 md:w-4 md:h-4" /> {handedness === 'Right' ? 'R' : 'L'}
                 </button>
            </div>
       </div>

       {/* Main Content */}
       <div className="flex-1 flex overflow-hidden" id="tour-fretboard">
            
            {/* Left: Chord Library (Desktop Only) */}
            <div className="w-48 bg-[#120b08] border-r border-[#3e2723] flex flex-col hidden md:flex">
                <div className="p-4 border-b border-[#3e2723] bg-[#1a0f0a]">
                    <h3 className="text-xs font-bold text-amber-600 uppercase tracking-wider">Chord Library</h3>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                    {availableChords.map(chord => (
                        <button 
                            key={chord} 
                            onClick={() => insertChord(chord)}
                            className="w-full text-left px-3 py-2 rounded text-amber-200 hover:bg-[#2d1b15] hover:text-white text-sm font-mono flex justify-between items-center group transition-colors"
                        >
                            {chord}
                            <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 text-amber-500" />
                        </button>
                    ))}
                </div>
            </div>

            {/* Center: Stage */}
            <div className="flex-1 flex flex-col relative">
                <div className="flex-1 flex flex-col items-center justify-center p-2 md:p-8 z-10 w-full overflow-hidden">
                     <p className="text-amber-500/60 text-xs mb-2 font-medium flex items-center gap-2">
                         <Info className="w-3 h-3" />
                         Tap fretboard or run sequencer.
                     </p>
                     <div className="w-full h-full max-h-[220px] md:max-h-[400px] shadow-2xl">
                        <GuitarFretboard activeNotes={activeNotes} handedness={handedness} interactive={true} capoPosition={capoPosition} />
                     </div>
                </div>

                {/* Bottom Deck - Optimized for Mobile */}
                <div className="h-auto md:h-72 bg-[#1a0f0a] border-t-4 border-[#3e2723] relative z-20 flex flex-col md:flex-row shadow-[0_-10px_40px_rgba(0,0,0,0.5)] pb-safe shrink-0">
                    
                    {/* Input Area */}
                    <div className="flex-1 p-2 md:p-6 border-b border-[#3e2723] md:border-b-0 md:border-r flex flex-col gap-2 relative h-40 md:h-auto">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] font-bold text-amber-700 uppercase">Sequencer {initialSong && <span className="text-amber-500 truncate max-w-[100px] inline-block align-bottom">- {initialSong.title}</span>}</span>
                            <div className="flex gap-2">
                                <div className="flex items-center gap-1 md:gap-2 px-2 bg-black/40 rounded border border-[#3e2723]">
                                    <span className="text-[9px] text-amber-600 font-bold">CAPO</span>
                                    <input 
                                        type="number" min="0" max="12" 
                                        value={capoPosition} 
                                        onChange={(e) => setCapoPosition(parseInt(e.target.value))}
                                        className="w-6 md:w-8 bg-transparent text-amber-500 text-xs font-bold text-center outline-none" 
                                    />
                                </div>
                                <div className="flex bg-black/40 rounded p-1">
                                    <button onClick={() => setInputMode('CHORDS')} className={`px-2 md:px-3 py-1 text-[9px] font-bold rounded ${inputMode === 'CHORDS' ? 'bg-amber-700 text-white' : 'text-amber-500'}`}>CHORDS</button>
                                    <button onClick={() => setInputMode('FINGERSTYLE')} className={`px-2 md:px-3 py-1 text-[9px] font-bold rounded ${inputMode === 'FINGERSTYLE' ? 'bg-amber-700 text-white' : 'text-amber-500'}`}>TABS</button>
                                </div>
                            </div>
                        </div>
                        <div className="relative flex-1">
                            <textarea 
                                value={inputText}
                                onChange={(e) => setInputText(e.target.value)}
                                className="w-full h-full bg-[#0a0503] border border-[#3e2723] rounded p-2 md:p-3 text-green-500 font-mono text-sm md:text-lg outline-none resize-none shadow-inner focus:border-amber-700 transition-colors pr-10"
                                placeholder={inputMode === 'CHORDS' ? "C G Am F" : "e.g. A0-h-A2 (Hammer) or A0/E0 (Pluck)..."}
                                spellCheck={false}
                            />
                            {/* Prominent Clear Button */}
                            <button 
                                onClick={() => { setInputText(''); stopPlayback(); }}
                                className="absolute top-2 right-2 p-1.5 bg-red-900/30 hover:bg-red-600 text-red-400 hover:text-white rounded-lg transition-colors border border-red-900/50"
                                title="Clear All"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Controls Area - Height adjusted for mobile visibility */}
                    <div className="w-full md:w-80 p-2 md:p-6 bg-[#160d0a] flex md:flex-col items-center justify-between md:justify-center gap-4 md:gap-6 min-h-[80px]">
                        
                        <div className="flex-1 md:w-full space-y-2">
                            {inputMode === 'CHORDS' && (
                                <div className="w-full hidden md:block">
                                    <label className="flex items-center gap-2 text-[10px] font-bold text-amber-600 mb-2">
                                        <Activity className="w-3 h-3" /> STRUM PATTERN
                                    </label>
                                    <input 
                                        type="text" 
                                        value={strumPattern}
                                        onChange={(e) => setStrumPattern(e.target.value)}
                                        className="w-full bg-[#0f0a08] border border-[#3e2723] rounded p-2 text-amber-100 font-mono text-xs tracking-widest uppercase placeholder-amber-900/50"
                                        placeholder="D U X U"
                                    />
                                </div>
                            )}

                            <div className="w-full">
                                <div className="flex justify-between text-[10px] text-amber-600 font-bold mb-1">
                                    <span>SPEED</span>
                                    <span>{playbackSpeed}x</span>
                                </div>
                                <input 
                                    type="range" min="0.1" max="3.0" step="0.1" 
                                    value={playbackSpeed}
                                    onChange={e => setPlaybackSpeed(parseFloat(e.target.value))}
                                    className="w-full h-1 bg-[#2d1b15] rounded-lg appearance-none cursor-pointer accent-amber-600"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-center gap-4 pl-4 md:pl-0 border-l md:border-l-0 border-[#3e2723]">
                            <button onClick={() => { setInputText(''); stopPlayback(); }} className="p-2 md:p-3 rounded-full text-amber-700 hover:text-amber-500 hover:bg-[#2d1b15] transition-all" title="Reset">
                                <RotateCcw className="w-4 h-4 md:w-5 md:h-5" />
                            </button>

                            <button 
                                onClick={() => { isPlaying ? stopPlayback() : startPlayback() }}
                                className={`w-12 h-12 md:w-16 md:h-16 rounded-full flex items-center justify-center border-4 shadow-xl transition-all transform active:scale-95 ${
                                    isPlaying 
                                    ? 'bg-amber-600 border-amber-400 text-white shadow-amber-900/50' 
                                    : 'bg-[#2d1b15] border-[#3e2723] text-amber-600 hover:border-amber-600'
                                }`}
                            >
                                {isPlaying ? <Square className="w-5 h-5 md:w-6 md:h-6 fill-current" /> : <Play className="w-6 h-6 md:w-8 md:h-8 fill-current ml-1" />}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
       </div>

       {showLoadModal && (
           <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
               <div className="bg-[#1a0f0a] border border-[#5d4037] rounded-xl max-w-lg w-full max-h-[80dvh] flex flex-col shadow-2xl">
                   <div className="p-4 border-b border-[#5d4037] flex justify-between items-center bg-[#2d1b15]">
                       <h3 className="text-amber-100 font-bold">Load Composition</h3>
                       <button onClick={() => setShowLoadModal(false)} className="text-amber-500"><RotateCcw className="w-4 h-4 rotate-45" /></button>
                   </div>
                   <div className="p-4 bg-[#2d1b15] border-b border-[#3e2723] space-y-2">
                       <h4 className="text-xs font-bold text-amber-600 uppercase">Quick Presets</h4>
                       <div className="grid grid-cols-2 gap-2">
                           <button onClick={() => loadPreset(PRESET_CHANNA)} className="p-3 bg-gradient-to-br from-amber-800/50 to-amber-900/30 hover:from-amber-700 hover:to-amber-800 rounded border border-amber-600 text-left col-span-2">
                               <div className="flex items-center justify-between">
                                   <div className="text-amber-100 font-bold text-sm">Channa Mereya — Fingerstyle</div>
                                   <span className="text-[9px] font-black uppercase tracking-wider text-amber-950 bg-amber-400 rounded px-1.5 py-0.5">Demo</span>
                               </div>
                               <div className="text-[10px] text-amber-300/80">Bollywood Fingerstyle Demos · Capo 5 · 1.4x · original arrangement</div>
                           </button>
                           <button onClick={() => loadPreset(PRESET_CHORDS)} className="p-3 bg-amber-900/30 hover:bg-amber-800 rounded border border-amber-800 text-left">
                               <div className="text-amber-200 font-bold text-sm">Chords w/ Strumming</div>
                               <div className="text-[10px] text-amber-500">Masterpiece (Complex Chords)</div>
                           </button>
                           <button onClick={() => loadPreset(PRESET_PAYPHONE)} className="p-3 bg-amber-900/30 hover:bg-amber-800 rounded border border-amber-800 text-left">
                               <div className="text-amber-200 font-bold text-sm">Payphone Fingerstyle <span className="text-[9px] text-amber-500/70">(demo riff)</span></div>
                               <div className="text-[10px] text-amber-500">Slides, pull-offs, slaps · excerpt only</div>
                           </button>
                       </div>
                   </div>
                   <div className="p-2 overflow-y-auto">
                       <h4 className="text-xs font-bold text-amber-600 uppercase px-2 py-2">Your Library</h4>
                       {songs.map(song => (
                           <button key={song.id} onClick={() => loadSongIntoLab(song)} className="w-full p-3 hover:bg-[#2d1b15] text-left border-b border-[#2d1b15] group">
                               <div className="text-amber-200 font-bold group-hover:text-white">{song.title}</div>
                               <div className="text-xs text-amber-700">{song.artist}</div>
                           </button>
                       ))}
                   </div>
               </div>
           </div>
       )}
    </div>
  );
};

export default FretboardLab;
