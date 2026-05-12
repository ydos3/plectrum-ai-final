
export interface ChordFingering {
  name: string;
  // Index 0 = Low E, Index 5 = High E for guitar
  // Value = Fret number, -1 = Muted, 0 = Open
  frets: number[];
  fingers?: number[];
}

// Extensive Chord Dictionary
const chordDb: Record<string, ChordFingering> = {
  // --- Major Open ---
  'C': { name: 'C', frets: [-1, 3, 2, 0, 1, 0] },
  'D': { name: 'D', frets: [-1, -1, 0, 2, 3, 2] },
  'E': { name: 'E', frets: [0, 2, 2, 1, 0, 0] },
  'G': { name: 'G', frets: [3, 2, 0, 0, 0, 3] },
  'A': { name: 'A', frets: [-1, 0, 2, 2, 2, 0] },
  
  // --- Major Barre / Movable Shapes ---
  'F': { name: 'F', frets: [1, 3, 3, 2, 1, 1] }, 
  'B': { name: 'B', frets: [-1, 2, 4, 4, 4, 2] },
  'F#': { name: 'F#', frets: [2, 4, 4, 3, 2, 2] },
  'Gb': { name: 'Gb', frets: [2, 4, 4, 3, 2, 2] },
  'C#': { name: 'C#', frets: [-1, 4, 6, 6, 6, 4] },
  'Db': { name: 'Db', frets: [-1, 4, 6, 6, 6, 4] },
  'G#': { name: 'G#', frets: [4, 6, 6, 5, 4, 4] },
  'Ab': { name: 'Ab', frets: [4, 6, 6, 5, 4, 4] },
  'D#': { name: 'D#', frets: [-1, 6, 8, 8, 8, 6] },
  'Eb': { name: 'Eb', frets: [-1, 6, 8, 8, 8, 6] },
  'A#': { name: 'A#', frets: [-1, 1, 3, 3, 3, 1] },
  'Bb': { name: 'Bb', frets: [-1, 1, 3, 3, 3, 1] },

  // --- Minor Open ---
  'Em': { name: 'Em', frets: [0, 2, 2, 0, 0, 0] },
  'Am': { name: 'Am', frets: [-1, 0, 2, 2, 1, 0] },
  'Dm': { name: 'Dm', frets: [-1, -1, 0, 2, 3, 1] },

  // --- Minor Barre ---
  'Bm': { name: 'Bm', frets: [-1, 2, 4, 4, 3, 2] },
  'Cm': { name: 'Cm', frets: [-1, 3, 5, 5, 4, 3] },
  'Fm': { name: 'Fm', frets: [1, 3, 3, 1, 1, 1] },
  'Gm': { name: 'Gm', frets: [3, 5, 5, 3, 3, 3] },
  'C#m': { name: 'C#m', frets: [-1, 4, 6, 6, 5, 4] },
  'F#m': { name: 'F#m', frets: [2, 4, 4, 2, 2, 2] },
  'G#m': { name: 'G#m', frets: [4, 6, 6, 4, 4, 4] },
  'D#m': { name: 'D#m', frets: [-1, 6, 8, 8, 7, 6] },
  'A#m': { name: 'A#m', frets: [-1, 1, 3, 3, 2, 1] },
  'Bbm': { name: 'Bbm', frets: [-1, 1, 3, 3, 2, 1] },
  'Ebm': { name: 'Ebm', frets: [-1, 6, 8, 8, 7, 6] },
  'Abm': { name: 'Abm', frets: [4, 6, 6, 4, 4, 4] },

  // --- Dominant 7th (Open & Barre) ---
  'C7': { name: 'C7', frets: [-1, 3, 2, 3, 1, 0] },
  'D7': { name: 'D7', frets: [-1, -1, 0, 2, 1, 2] },
  'E7': { name: 'E7', frets: [0, 2, 0, 1, 0, 0] },
  'G7': { name: 'G7', frets: [3, 2, 0, 0, 0, 1] },
  'A7': { name: 'A7', frets: [-1, 0, 2, 0, 2, 0] },
  'B7': { name: 'B7', frets: [-1, 2, 1, 2, 0, 2] },
  'F7': { name: 'F7', frets: [1, 3, 1, 2, 1, 1] },
  
  // Sharp/Flat 7ths
  'F#7': { name: 'F#7', frets: [2, 4, 2, 3, 2, 2] },
  'Gb7': { name: 'Gb7', frets: [2, 4, 2, 3, 2, 2] },
  'G#7': { name: 'G#7', frets: [4, 6, 4, 5, 4, 4] },
  'Ab7': { name: 'Ab7', frets: [4, 6, 4, 5, 4, 4] },
  'C#7': { name: 'C#7', frets: [-1, 4, 6, 4, 6, 4] },
  'Db7': { name: 'Db7', frets: [-1, 4, 6, 4, 6, 4] },
  'D#7': { name: 'D#7', frets: [-1, 6, 8, 6, 8, 6] },
  'Eb7': { name: 'Eb7', frets: [-1, 6, 8, 6, 8, 6] },
  'A#7': { name: 'A#7', frets: [-1, 1, 3, 1, 3, 1] },
  'Bb7': { name: 'Bb7', frets: [-1, 1, 3, 1, 3, 1] },

  // --- Major 7ths ---
  'Cmaj7': { name: 'Cmaj7', frets: [-1, 3, 2, 0, 0, 0] },
  'Fmaj7': { name: 'Fmaj7', frets: [-1, -1, 3, 2, 1, 0] },
  'Gmaj7': { name: 'Gmaj7', frets: [3, 2, 0, 0, 0, 2] },
  'Amaj7': { name: 'Amaj7', frets: [-1, 0, 2, 1, 2, 0] },
  'Dmaj7': { name: 'Dmaj7', frets: [-1, -1, 0, 2, 2, 2] },
  'Emaj7': { name: 'Emaj7', frets: [0, 2, 1, 1, 0, 0] },
  'Bbmaj7': { name: 'Bbmaj7', frets: [-1, 1, 3, 2, 3, 1] },

  // --- Minor 7ths ---
  'Am7': { name: 'Am7', frets: [-1, 0, 2, 0, 1, 0] },
  'Em7': { name: 'Em7', frets: [0, 2, 2, 0, 3, 0] },
  'Dm7': { name: 'Dm7', frets: [-1, -1, 0, 2, 1, 1] },
  'Bm7': { name: 'Bm7', frets: [-1, 2, 0, 2, 0, 2] },
  'F#m7': { name: 'F#m7', frets: [2, 4, 2, 2, 2, 2] },
  'C#m7': { name: 'C#m7', frets: [-1, 4, 6, 4, 5, 4] },
  'Gm7': { name: 'Gm7', frets: [3, 5, 3, 3, 3, 3] },
  'Cm7': { name: 'Cm7', frets: [-1, 3, 5, 3, 4, 3] },

  // --- Sus Chords ---
  'Dsus2': { name: 'Dsus2', frets: [-1, -1, 0, 2, 3, 0] },
  'Dsus4': { name: 'Dsus4', frets: [-1, -1, 0, 2, 3, 3] },
  'Asus2': { name: 'Asus2', frets: [-1, 0, 2, 2, 0, 0] },
  'Asus4': { name: 'Asus4', frets: [-1, 0, 2, 2, 3, 0] },
  'Esus4': { name: 'Esus4', frets: [0, 2, 2, 2, 0, 0] },
  'Gsus4': { name: 'Gsus4', frets: [3, 2, 0, 0, 1, 3] },
  'Csus4': { name: 'Csus4', frets: [-1, 3, 3, 0, 1, 1] },

  // --- Add Chords ---
  'Cadd9': { name: 'Cadd9', frets: [-1, 3, 2, 0, 3, 3] }, 
  'Aadd9': { name: 'Aadd9', frets: [-1, 0, 2, 4, 2, 0] },
  'Gadd9': { name: 'Gadd9', frets: [3, 2, 0, 2, 0, 3] },
  'Fadd9': { name: 'Fadd9', frets: [-1, -1, 3, 2, 1, 3] },

  // --- Slash Chords (simplified base) ---
  'D/F#': { name: 'D/F#', frets: [2, 0, 0, 2, 3, 2] },
  'G/B': { name: 'G/B', frets: [-1, 2, 0, 0, 0, 3] },
  'C/G': { name: 'C/G', frets: [3, 3, 2, 0, 1, 0] },
  'Am/G': { name: 'Am/G', frets: [3, 0, 2, 2, 1, 0] },
};

const CHROMATIC_ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
const ROOT_TO_SEMITONE: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11
};

const ENHARMONIC_ROOTS: Record<string, string> = {
  'D#': 'Eb', 'A#': 'Bb', 'G#': 'Ab', 'C#': 'Db', 'F#': 'Gb', 'E#': 'F', 'B#': 'C',
  Eb: 'D#', Bb: 'A#', Ab: 'G#', Db: 'C#', Gb: 'F#', Cb: 'B', Fb: 'E'
};

const transposeShape = (shape: number[], semitones: number) => (
  shape.map(fret => fret < 0 ? -1 : fret + semitones)
);

const addGeneratedChord = (name: string, frets: number[]) => {
  if (!chordDb[name] && Math.max(...frets) <= 12) {
    chordDb[name] = { name, frets };
  }
};

// Fill common barre and movable shapes across all roots so quiz/training has broad coverage.
CHROMATIC_ROOTS.forEach(root => {
  const semitone = ROOT_TO_SEMITONE[root];
  addGeneratedChord(root, transposeShape([0, 2, 2, 1, 0, 0], (semitone - ROOT_TO_SEMITONE.E + 12) % 12));
  addGeneratedChord(`${root}m`, transposeShape([0, 2, 2, 0, 0, 0], (semitone - ROOT_TO_SEMITONE.E + 12) % 12));
  addGeneratedChord(`${root}7`, transposeShape([0, 2, 0, 1, 0, 0], (semitone - ROOT_TO_SEMITONE.E + 12) % 12));
  addGeneratedChord(`${root}maj7`, transposeShape([0, 2, 1, 1, 0, 0], (semitone - ROOT_TO_SEMITONE.E + 12) % 12));
  addGeneratedChord(`${root}m7`, transposeShape([0, 2, 0, 0, 0, 0], (semitone - ROOT_TO_SEMITONE.E + 12) % 12));
  addGeneratedChord(`${root}sus4`, transposeShape([0, 2, 2, 2, 0, 0], (semitone - ROOT_TO_SEMITONE.E + 12) % 12));
  addGeneratedChord(`${root}sus2`, transposeShape([-1, 0, 2, 2, 0, 0], (semitone - ROOT_TO_SEMITONE.A + 12) % 12));
  addGeneratedChord(`${root}add9`, transposeShape([-1, 0, 2, 4, 2, 0], (semitone - ROOT_TO_SEMITONE.A + 12) % 12));
  addGeneratedChord(`${root}dim`, transposeShape([-1, 1, 2, 0, 2, -1], (semitone - ROOT_TO_SEMITONE.B + 12) % 12));
  addGeneratedChord(`${root}aug`, transposeShape([-1, 0, 3, 2, 2, 1], (semitone - ROOT_TO_SEMITONE.A + 12) % 12));
});

const resolveExtendedChord = (cleanName: string): ChordFingering | undefined => {
  const slashBaseName = cleanName.split('/')[0];
  if (slashBaseName !== cleanName && chordDb[slashBaseName]) {
    return { ...chordDb[slashBaseName], name: cleanName };
  }

  const match = slashBaseName.match(/^([A-G](?:#|b)?)(.*)$/);
  if (!match) return undefined;

  const [, root, rawQuality] = match;
  const normalizedQuality = rawQuality
    .replace(/^maj9$/i, 'maj7')
    .replace(/^maj11$/i, 'maj7')
    .replace(/^maj13$/i, 'maj7')
    .replace(/^M7$/, 'maj7')
    .replace(/^mmaj7$/i, 'm7')
    .replace(/^m9$/i, 'm7')
    .replace(/^m11$/i, 'm7')
    .replace(/^m13$/i, 'm7')
    .replace(/^m6$/i, 'm7')
    .replace(/^m7b5$/i, 'dim')
    .replace(/^9$/i, '7')
    .replace(/^11$/i, '7')
    .replace(/^13$/i, '7')
    .replace(/^6$/i, '7')
    .replace(/^69$/i, '7')
    .replace(/^7sus4$/i, 'sus4')
    .replace(/^7sus$/i, 'sus4')
    .replace(/^sus$/i, 'sus4')
    .replace(/^add11$/i, 'sus4')
    .replace(/^add2$/i, 'sus2')
    .replace(/^5$/i, '')
    .replace(/no5$/i, '')
    .replace(/b5$/i, 'dim')
    .replace(/#5$/i, 'aug');

  const rootCandidates = [root, ENHARMONIC_ROOTS[root]].filter(Boolean);
  for (const candidateRoot of rootCandidates) {
    const candidateName = `${candidateRoot}${normalizedQuality}`;
    if (chordDb[candidateName]) {
      return { ...chordDb[candidateName], name: cleanName };
    }
  }

  return undefined;
};

export const getChordFingering = (name: string): ChordFingering | undefined => {
  if (!name) return undefined;
  let cleanName = name.replace(/[\[\]]/g, '').trim();
  cleanName = cleanName.replace(/[()]/g, '').replace(/\s+/g, '');
  
  // Normalize variations
  if (cleanName === 'CM7') cleanName = 'Cmaj7';
  cleanName = cleanName.replace(/Δ/g, 'maj').replace(/°/g, 'dim');
  cleanName = cleanName.replace(/major/gi, '').replace(/minor/gi, 'm');
  cleanName = cleanName.replace(/min7$/i, 'm7').replace(/min$/i, 'm');
  cleanName = cleanName.replace(/Maj/g, 'maj');
  if (cleanName.endsWith('min')) cleanName = cleanName.replace('min', 'm');
  
  if (chordDb[cleanName]) return chordDb[cleanName];
  
  // Try to find enharmonic equivalents
  const enharmonics: Record<string, string> = {
    // Basic
    'D#': 'Eb', 'A#': 'Bb', 'G#': 'Ab', 'C#': 'Db', 'F#': 'Gb', 'E#': 'F', 'B#': 'C',
    'Eb': 'D#', 'Bb': 'A#', 'Ab': 'G#', 'Db': 'C#', 'Gb': 'F#',
    
    // Minors
    'D#m': 'Ebm', 'A#m': 'Bbm', 'G#m': 'Abm', 'C#m': 'Dbm', 'F#m': 'Gbm',
    'Ebm': 'D#m', 'Bbm': 'A#m', 'Abm': 'G#m', 'Dbm': 'C#m', 'Gbm': 'F#m',

    // 7ths
    'A#7': 'Bb7', 'C#7': 'Db7', 'D#7': 'Eb7', 'F#7': 'Gb7', 'G#7': 'Ab7',
    'Bb7': 'A#7', 'Db7': 'C#7', 'Eb7': 'D#7', 'Gb7': 'F#7', 'Ab7': 'G#7'
  };
  
  if (enharmonics[cleanName] && chordDb[enharmonics[cleanName]]) {
      return { ...chordDb[enharmonics[cleanName]], name: cleanName }; // Return with original name
  }

  const extendedChord = resolveExtendedChord(cleanName);
  if (extendedChord) return extendedChord;

  return undefined;
};

export const getAllChords = () => Object.keys(chordDb).sort();
