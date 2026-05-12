
import React, { useState, useEffect } from 'react';
import { playNote, playStrum } from '../services/audioService';
import { Handedness } from '../types';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface GuitarFretboardProps {
  activeNotes?: { string: number; fret: number }[];
  handedness?: Handedness;
  interactive?: boolean;
  onStringStrum?: (stringIdx: number) => void;
  capoPosition?: number;
  autoPlay?: boolean;
}

const GuitarFretboard: React.FC<GuitarFretboardProps> = ({ 
  activeNotes = [], 
  handedness = 'Right',
  interactive = true,
  onStringStrum,
  capoPosition = 0,
  autoPlay = false
}) => {
  const [viewOffset, setViewOffset] = useState(0);
  const visibleFrets = 5; 
  const totalFrets = 15; 
  const stringIndices = [0, 1, 2, 3, 4, 5]; 

  const singleDotFrets = [3, 5, 7, 9, 15];
  const doubleDotFrets = [12];

  useEffect(() => {
    const pressedFrets = activeNotes.map(note => note.fret).filter(fret => fret > 0);
    if (pressedFrets.length === 0) {
      setViewOffset(0);
      return;
    }

    const minFret = Math.min(...pressedFrets);
    const maxFret = Math.max(...pressedFrets);
    setViewOffset(currentOffset => {
      if (minFret > currentOffset && maxFret <= currentOffset + visibleFrets) {
        return currentOffset;
      }

      const centeredOffset = Math.max(0, minFret - 1);
      return Math.min(totalFrets - visibleFrets, centeredOffset);
    });
  }, [activeNotes]);

  useEffect(() => {
    if (autoPlay && activeNotes.length > 0) {
        const timer = setTimeout(() => {
            playStrum(activeNotes, 'D', 1);
        }, 300);
        return () => clearTimeout(timer);
    }
  }, [activeNotes, autoPlay]);

  const handleNoteClick = (e: React.MouseEvent, stringIdx: number, fret: number) => {
    e.stopPropagation();
    e.preventDefault();
    if (interactive) playNote(stringIdx, fret);
  };

  const scrollLeft = (e: React.MouseEvent) => { e.stopPropagation(); setViewOffset(Math.max(0, viewOffset - 1)); };
  const scrollRight = (e: React.MouseEvent) => { e.stopPropagation(); setViewOffset(Math.min(totalFrets - visibleFrets, viewOffset + 1)); };

  return (
    <div className="relative w-full h-full flex items-center gap-2 select-none group">
        <button onClick={scrollLeft} disabled={viewOffset === 0} className="flex p-2 bg-amber-900/50 hover:bg-amber-700 text-amber-100 rounded-full disabled:opacity-30 z-30 shrink-0"><ChevronLeft className="w-5 h-5 md:w-6 md:h-6" /></button>

        <div className={`flex-1 h-full flex flex-col items-center justify-center rounded-xl border-y-4 border-[#1a0f0a] overflow-hidden shadow-2xl relative ${handedness === 'Left' ? 'scale-x-[-1]' : ''}`}>
        
            <div className="w-full h-full flex flex-row relative bg-[#3e2723]">
                <div className="absolute inset-0 opacity-40 mix-blend-multiply bg-[url('https://www.transparenttextures.com/patterns/wood-pattern.png')] pointer-events-none"></div>

                {/* NUT */}
                {viewOffset === 0 && (
                    <div className="w-12 md:w-24 h-full bg-[#e3dac9] border-r-4 border-[#8d6e63] relative z-20 flex flex-col flex-shrink-0">
                    <div className="absolute top-0 left-0 w-full text-center text-[8px] font-bold text-[#5d4037] py-1 tracking-widest opacity-50">NUT</div>
                    {stringIndices.map((stringIdx) => {
                        const isOpen = activeNotes.some(n => n.string === stringIdx && n.fret === 0);
                        const isMuted = activeNotes.some(n => n.string === stringIdx && n.fret === -1);
                        return (
                            <div key={`nut-${stringIdx}`} className="flex-1 flex items-center justify-center relative cursor-pointer hover:bg-black/5" onClick={(e) => handleNoteClick(e, stringIdx, 0)}>
                                <div className="absolute w-full h-[3px] bg-[#a1887f] z-0"></div>
                                {isOpen && <div className={`z-10 w-3 h-3 md:w-6 md:h-6 rounded-full bg-emerald-500 border-2 border-white shadow-[0_0_10px_rgba(52,211,153,0.8)] animate-pulse ${handedness === 'Left' ? 'scale-x-[-1]' : ''}`}></div>}
                                {isMuted && <div className={`z-10 text-red-500 font-black text-sm md:text-xl ${handedness === 'Left' ? 'scale-x-[-1]' : ''}`}>✕</div>}
                            </div>
                        );
                    })}
                    </div>
                )}

                {/* FRETS */}
                <div className="flex-1 flex flex-row h-full relative">
                    {Array.from({ length: visibleFrets }).map((_, i) => {
                        const fretNum = viewOffset + i + 1;
                        const isCapoHere = capoPosition === fretNum;
                        return (
                            <div key={`fret-${fretNum}`} className="h-full relative flex-1 flex flex-col justify-center border-r-2 border-[#5d4037]">
                                {isCapoHere && <div className="absolute inset-y-0 left-0 w-8 bg-black/80 z-30 flex items-center justify-center pointer-events-none"><div className="text-white -rotate-90 text-[10px] font-bold tracking-widest">CAPO</div></div>}
                                <div className="absolute right-0 top-0 bottom-0 w-[4px] bg-gray-400 z-10 pointer-events-none shadow-sm"></div>
                                {singleDotFrets.includes(fretNum) && <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 md:w-6 md:h-6 rounded-full bg-[#d7ccc8] opacity-60 pointer-events-none"></div>}
                                {doubleDotFrets.includes(fretNum) && <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-8 opacity-60 pointer-events-none"><div className="w-4 h-4 md:w-6 md:h-6 rounded-full bg-[#d7ccc8]"></div><div className="w-4 h-4 md:w-6 md:h-6 rounded-full bg-[#d7ccc8]"></div></div>}

                                {stringIndices.map(stringIdx => {
                                    const isPressed = activeNotes.some(n => n.string === stringIdx && n.fret === fretNum);
                                    return (
                                        <div key={`fret-${fretNum}-str-${stringIdx}`} className="flex-1 relative w-full cursor-pointer hover:bg-white/5 active:bg-black/10 z-20" onClick={(e) => handleNoteClick(e, stringIdx, fretNum)}>
                                            {isPressed && <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30"><div className={`w-6 h-6 md:w-10 md:h-10 rounded-full bg-amber-500 border-2 border-white shadow-[0_0_15px_rgba(251,191,36,0.9)] ${handedness === 'Left' ? 'scale-x-[-1]' : ''}`}></div></div>}
                                        </div>
                                    )
                                })}
                            </div>
                        )
                    })}
                    
                    {/* Strings Layer */}
                    <div className="absolute inset-0 flex flex-col w-full h-full pointer-events-none z-10">
                        {stringIndices.map((stringIdx) => (
                            <div key={`string-line-${stringIdx}`} className="flex-1 flex items-center w-full relative">
                                <div className="w-full shadow-sm" style={{ height: `${Math.max(1.5, 5 - (stringIdx * 0.8))}px`, background: stringIdx < 3 ? 'repeating-linear-gradient(90deg, #b87333, #b87333 1px, #8d6e63 2px)' : '#cfd8dc' }}></div>
                            </div>
                        ))}
                    </div>

                    <div className="absolute -bottom-6 left-0 right-0 flex text-[10px] font-mono text-amber-500/50 pointer-events-none">
                        {Array.from({ length: visibleFrets }).map((_, i) => <div key={i} className={`flex-1 text-center font-bold text-lg ${handedness === 'Left' ? 'scale-x-[-1]' : ''}`}>{viewOffset + i + 1}</div>)}
                    </div>
                </div>
            </div>
        </div>

        <button onClick={scrollRight} disabled={viewOffset >= totalFrets - visibleFrets} className="flex p-2 bg-amber-900/50 hover:bg-amber-700 text-amber-100 rounded-full disabled:opacity-30 z-30 shrink-0"><ChevronRight className="w-5 h-5 md:w-6 md:h-6" /></button>
    </div>
  );
};

export default GuitarFretboard;
