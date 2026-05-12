
import React, { useMemo, useState } from 'react';
import { getAllChords, getChordFingering } from '../services/chordService';
import GuitarFretboard from './GuitarFretboard';
import { playChordByName } from '../services/audioService';
import { RefreshCw, Eye, EyeOff, Volume2, ArrowLeft } from 'lucide-react';

interface ChordTrainerProps {
    onBack?: () => void;
}

const ChordTrainer: React.FC<ChordTrainerProps> = ({ onBack }) => {
  const chords = useMemo(() => getAllChords(), []);
  const [currentChord, setCurrentChord] = useState('C');
  const [isRevealed, setIsRevealed] = useState(false);
  const [mode, setMode] = useState<'core' | 'barre' | 'color' | 'all'>('core');

  const quizChords = useMemo(() => {
    const core = ['C', 'D', 'E', 'G', 'A', 'Am', 'Dm', 'Em', 'F', 'Bm', 'C7', 'D7', 'E7', 'G7', 'A7', 'B7'];
    if (mode === 'core') return core.filter(chord => chords.includes(chord));
    if (mode === 'barre') return chords.filter(chord => {
      const fingering = getChordFingering(chord);
      return !!fingering && Math.min(...fingering.frets.filter(f => f > 0)) > 0 && Math.max(...fingering.frets) >= 4;
    });
    if (mode === 'color') return chords.filter(chord => /(maj7|m7|7|sus|add9|dim|aug)/.test(chord));
    return chords;
  }, [chords, mode]);

  const nextChord = () => {
    const pool = quizChords.length > 0 ? quizChords : chords;
    let random = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1) {
      while (random === currentChord) random = pool[Math.floor(Math.random() * pool.length)];
    }
    setCurrentChord(random);
    setIsRevealed(false);
  };

  const handleChordClick = () => {
    playChordByName(currentChord);
  };

  const fingering = getChordFingering(currentChord);
  const activeNotes = isRevealed && fingering 
    ? fingering.frets.map((f, i) => ({ string: i, fret: f }))
    : [];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto flex flex-col min-h-full items-center justify-center relative">
       {onBack && (
            <button onClick={onBack} className="absolute top-4 left-4 p-2 hover:bg-white/10 rounded-lg text-amber-200/60 hover:text-white transition-colors">
                <ArrowLeft className="w-6 h-6" />
            </button>
       )}
       
       <div className="text-center mb-6">
         <h2 className="text-3xl font-display font-bold text-amber-100 mb-2">Chord Quiz</h2>
         <p className="text-amber-500/60">Train your ear across open, barre, seventh, sus, add, dim, and augmented chords.</p>
       </div>

       <div className="w-full flex-1 flex flex-col items-center gap-8">
          <div className="grid grid-cols-4 gap-2 w-full max-w-2xl">
            {(['core', 'barre', 'color', 'all'] as const).map(option => (
              <button
                key={option}
                onClick={() => { setMode(option); setIsRevealed(false); }}
                className={`px-3 py-2 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-wider border transition-all ${
                  mode === option
                    ? 'bg-amber-600 text-white border-amber-400 shadow-lg'
                    : 'bg-[#1a0f0a] text-amber-300/70 border-[#5d4037] hover:text-white hover:border-amber-600'
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <div 
             onClick={handleChordClick}
             className="bg-[#2d1b15] px-16 py-10 rounded-3xl border border-[#5d4037] shadow-2xl text-center w-full max-w-lg cursor-pointer hover:bg-[#3e2723] transition-colors group relative"
          >
             <div className="absolute top-4 right-4 text-amber-700 group-hover:text-amber-500">
                 <Volume2 className="w-6 h-6" />
             </div>
             <div className="text-9xl font-bold text-white mb-2 font-mono drop-shadow-lg">{currentChord}</div>
             <p className="text-amber-500/50 text-xs uppercase tracking-widest mt-4">Click to Listen • {quizChords.length} chords in this set</p>
          </div>

          <div className="flex gap-4">
             <button 
               onClick={() => setIsRevealed(!isRevealed)}
               className="px-8 py-4 bg-slate-800 text-white rounded-xl font-bold flex items-center gap-2 hover:bg-slate-700 transition-colors"
             >
               {isRevealed ? <EyeOff className="w-5 h-5"/> : <Eye className="w-5 h-5" />}
               {isRevealed ? 'Hide' : 'Reveal'}
             </button>
             <button 
               onClick={nextChord}
               className="px-8 py-4 bg-amber-600 text-white rounded-xl font-bold flex items-center gap-2 hover:bg-amber-500 transition-colors shadow-lg"
             >
               <RefreshCw className="w-5 h-5" /> Next
             </button>
          </div>

          <div className={`transition-all duration-500 w-full max-w-5xl h-96 ${isRevealed ? 'opacity-100 scale-100' : 'opacity-0 scale-95 h-0 overflow-hidden'}`}>
             <GuitarFretboard activeNotes={activeNotes} />
          </div>
       </div>
    </div>
  );
};

export default ChordTrainer;
