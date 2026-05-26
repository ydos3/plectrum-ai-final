
export interface TabFrame {
  notes: {
    string: number; // 0 (Low E) to 5 (High e)
    fret: number;
    technique?: 'hammer-on' | 'pull-off' | 'slide' | 'normal';
  }[];
  percussion?: 'slap';
  duration: number; // in ms
}

const STRING_MAP: Record<string, number> = {
  'e': 5, 'B': 4, 'G': 3, 'D': 2, 'A': 1, 'E': 0,
  'b': 4, 'g': 3, 'd': 2, 'a': 1
};

/**
 * Parses input like "B7-G2-G0-G0-B1/A0"
 * - Hyphen (-): Sequential play
 * - Slash (/): Simultaneous play (Chord)
 * - h / hammer / hammeron: Hammer-on (affects next note)
 * - p / pull / pulloff / pull-off: Pull-off (affects next note)
 * - s / slide: Slide into the next note
 * - slap: Percussive hit
 * - Empty tokens from "--" or "---": short rests
 */
export const parseFingerstyleTab = (input: string): TabFrame[] => {
  // Keep delimiters while removing accidental spacing around them.
  const cleanInput = input
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, '')
    .replace(/([eBGDAE]\d+)(h|p|s)([eBGDAE]\d+)/gi, (_, from, technique, to) => {
      const modifier = technique.toLowerCase() === 'h'
        ? 'h'
        : technique.toLowerCase() === 'p'
          ? 'pulloff'
          : 's';
      return `${from}-${modifier}-${to}`;
    });
  
  // Split by hyphen to get time steps
  // Example: "B7-G2/A0-h-G4" -> ["B7", "G2/A0", "h", "G4"]
  const tokens = cleanInput.split('-');
  const frames: TabFrame[] = [];
  
  let nextTechnique: 'hammer-on' | 'pull-off' | 'slide' | 'normal' = 'normal';

  tokens.forEach(token => {
    if (!token) {
      frames.push({ notes: [], duration: 180 });
      return;
    }

    // Check for technique tokens
    const normalizedToken = token.toLowerCase();
    if (normalizedToken === 'h' || normalizedToken === 'hammer' || normalizedToken === 'hammeron' || normalizedToken === 'hammer-on') {
      nextTechnique = 'hammer-on';
      return; // Don't create a frame for the modifier itself
    }
    if (normalizedToken === 'p' || normalizedToken === 'pull' || normalizedToken === 'pulloff' || normalizedToken === 'pull-off') {
      nextTechnique = 'pull-off';
      return;
    }
    if (normalizedToken === 's' || normalizedToken === 'slide') {
      nextTechnique = 'slide';
      return;
    }
    if (normalizedToken === 'slap' || normalizedToken === 'x') {
      frames.push({ notes: [], percussion: 'slap', duration: 220 });
      nextTechnique = 'normal';
      return;
    }

    // Handle Simultaneous notes (Slash)
    const noteParts = token.split('/');
    const frameNotes: TabFrame['notes'] = [];

    noteParts.forEach(part => {
      // Parse "B7" -> String B, Fret 7
      const match = part.match(/^([eBGDAE])(\d+)$/i);
      if (match) {
        const stringChar = match[1];
        const fretStr = match[2];
        const stringIdx = STRING_MAP[stringChar];
        
        if (stringIdx !== undefined) {
          frameNotes.push({
            string: stringIdx,
            fret: parseInt(fretStr),
            technique: nextTechnique
          });
        }
      } else if (part.toLowerCase() === 'slap' || part.toUpperCase() === 'X') {
        frames.push({ notes: [], percussion: 'slap', duration: 220 });
      }
    });

    if (frameNotes.length > 0) {
      // Logic: A hammer/pull usually is faster or connected to previous. 
      // For simplicity in this lab, we give it standard duration but change audio envelope.
      frames.push({
        notes: frameNotes,
        duration: nextTechnique !== 'normal' ? 280 : 460
      });
    }

    // Reset technique after applying
    nextTechnique = 'normal';
  });

  return frames;
};
