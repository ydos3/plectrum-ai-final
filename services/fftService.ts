/**
 * FFT-Based Chord Analysis Service
 * Uses Fourier Transform to detect multiple simultaneous pitches
 * and match them against known chord patterns.
 */

const NOTE_STRINGS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

interface DetectedNote {
  note: string;
  octave: number;
  frequency: number;
  magnitude: number;
}

interface ChordAnalysisResult {
  chord: string;
  confidence: number;
  notes: string[];
  spectrum: number[]; // normalized FFT magnitudes for visualization (64 bars)
}

// ─── Note Detection from FFT ───────────────────────────────────────────

/**
 * Extract prominent notes from FFT frequency data
 */
const detectNotesFromFFT = (
  frequencyData: Float32Array,
  sampleRate: number,
  fftSize: number
): DetectedNote[] => {
  const binWidth = sampleRate / fftSize;
  const detected: DetectedNote[] = [];

  // Guitar range: ~70Hz (Low E) to ~1200Hz (high frets)
  const minBin = Math.ceil(70 / binWidth);
  const maxBin = Math.min(Math.floor(1200 / binWidth), frequencyData.length - 1);

  // Find peaks: local maxima above threshold
  const threshold = -40; // dB threshold
  const peakMinDistance = Math.ceil(20 / binWidth); // minimum 20Hz between peaks

  const peaks: { bin: number; magnitude: number }[] = [];

  for (let i = minBin + 1; i < maxBin - 1; i++) {
    const mag = frequencyData[i];
    if (mag < threshold) continue;

    // Check if local maximum
    if (mag > frequencyData[i - 1] && mag > frequencyData[i + 1]) {
      // Check distance from existing peaks
      const tooClose = peaks.some(p => Math.abs(p.bin - i) < peakMinDistance);
      if (!tooClose) {
        peaks.push({ bin: i, magnitude: mag });
      }
    }
  }

  // Sort by magnitude and take top 6 (max strings on guitar)
  peaks.sort((a, b) => b.magnitude - a.magnitude);
  const topPeaks = peaks.slice(0, 6);

  for (const peak of topPeaks) {
    // Parabolic interpolation for more accurate frequency
    const alpha = frequencyData[peak.bin - 1];
    const beta = frequencyData[peak.bin];
    const gamma = frequencyData[peak.bin + 1];
    const p = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma);
    const interpolatedBin = peak.bin + p;
    const frequency = interpolatedBin * binWidth;

    // Convert frequency to note
    const noteNum = 12 * Math.log2(frequency / 440);
    const roundedNote = Math.round(noteNum) + 69; // MIDI note number
    const noteIndex = ((roundedNote % 12) + 12) % 12;
    const note = NOTE_STRINGS[noteIndex];
    const octave = Math.floor(roundedNote / 12) - 1;

    detected.push({
      note,
      octave,
      frequency,
      magnitude: peak.magnitude
    });
  }

  return detected;
};

// ─── Chord Matching ────────────────────────────────────────────────────

// Chord templates: sets of note names (without octave)
const CHORD_TEMPLATES: Record<string, string[]> = {
  // Major
  'C': ['C', 'E', 'G'],
  'D': ['D', 'F#', 'A'],
  'E': ['E', 'G#', 'B'],
  'F': ['F', 'A', 'C'],
  'G': ['G', 'B', 'D'],
  'A': ['A', 'C#', 'E'],
  'B': ['B', 'D#', 'F#'],

  // Minor
  'Am': ['A', 'C', 'E'],
  'Bm': ['B', 'D', 'F#'],
  'Cm': ['C', 'D#', 'G'],
  'Dm': ['D', 'F', 'A'],
  'Em': ['E', 'G', 'B'],
  'Fm': ['F', 'G#', 'C'],
  'Gm': ['G', 'A#', 'D'],

  // 7th
  'C7': ['C', 'E', 'G', 'A#'],
  'D7': ['D', 'F#', 'A', 'C'],
  'E7': ['E', 'G#', 'B', 'D'],
  'G7': ['G', 'B', 'D', 'F'],
  'A7': ['A', 'C#', 'E', 'G'],
  'B7': ['B', 'D#', 'F#', 'A'],

  // Major 7th
  'Cmaj7': ['C', 'E', 'G', 'B'],
  'Fmaj7': ['F', 'A', 'C', 'E'],
  'Gmaj7': ['G', 'B', 'D', 'F#'],
  'Amaj7': ['A', 'C#', 'E', 'G#'],

  // Minor 7th
  'Am7': ['A', 'C', 'E', 'G'],
  'Dm7': ['D', 'F', 'A', 'C'],
  'Em7': ['E', 'G', 'B', 'D'],
  'Bm7': ['B', 'D', 'F#', 'A'],

  // Sharp/Flat Majors
  'F#': ['F#', 'A#', 'C#'],
  'Bb': ['A#', 'D', 'F'],
  'Eb': ['D#', 'G', 'A#'],
  'Ab': ['G#', 'C', 'D#'],

  // Sharp/Flat Minors
  'F#m': ['F#', 'A', 'C#'],
  'C#m': ['C#', 'E', 'G#'],
  'G#m': ['G#', 'B', 'D#'],
  'Bbm': ['A#', 'C#', 'F'],
};

const matchChord = (detectedNotes: DetectedNote[]): { chord: string; confidence: number } => {
  if (detectedNotes.length === 0) return { chord: '', confidence: 0 };

  const noteSet = new Set(detectedNotes.map(n => n.note));
  let bestMatch = '';
  let bestScore = 0;

  for (const [chordName, template] of Object.entries(CHORD_TEMPLATES)) {
    // Count how many template notes are present
    const matchedNotes = template.filter(n => noteSet.has(n));
    const matchRatio = matchedNotes.length / template.length;

    // Bonus for having root note as strongest
    const rootBonus = detectedNotes[0]?.note === template[0] ? 0.15 : 0;

    const score = matchRatio + rootBonus;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = chordName;
    }
  }

  // Minimum 60% match required
  const confidence = Math.min(bestScore, 1);
  if (confidence < 0.6) return { chord: '', confidence: 0 };

  return { chord: bestMatch, confidence };
};

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Analyze audio for chord detection using FFT
 * @param analyser - Web Audio AnalyserNode
 * @param sampleRate - Audio context sample rate
 * @returns Chord analysis result with spectrum data
 */
export const analyzeChord = (
  analyser: AnalyserNode,
  sampleRate: number
): ChordAnalysisResult | null => {
  const fftSize = analyser.fftSize;
  const frequencyData = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(frequencyData);

  // Check if there's enough signal
  let maxMag = -Infinity;
  for (let i = 0; i < frequencyData.length; i++) {
    if (frequencyData[i] > maxMag) maxMag = frequencyData[i];
  }
  if (maxMag < -50) return null; // Too quiet

  // Detect individual notes
  const notes = detectNotesFromFFT(frequencyData, sampleRate, fftSize);
  if (notes.length < 2) return null; // Need at least 2 notes for a chord

  // Match chord pattern
  const { chord, confidence } = matchChord(notes);
  if (!chord) return null;

  // Generate visualization spectrum (64 bars)
  const spectrum: number[] = [];
  const barsCount = 64;
  const binWidth = sampleRate / fftSize;
  const visMinBin = Math.ceil(50 / binWidth);
  const visMaxBin = Math.min(Math.floor(2000 / binWidth), frequencyData.length - 1);
  const binsPerBar = Math.floor((visMaxBin - visMinBin) / barsCount);

  for (let i = 0; i < barsCount; i++) {
    const startBin = visMinBin + i * binsPerBar;
    let sum = 0;
    for (let j = startBin; j < startBin + binsPerBar && j < frequencyData.length; j++) {
      sum += Math.max(0, (frequencyData[j] + 100) / 100); // Normalize to 0-1
    }
    spectrum.push(sum / binsPerBar);
  }

  return {
    chord,
    confidence,
    notes: notes.map(n => `${n.note}${n.octave}`),
    spectrum
  };
};

export type { ChordAnalysisResult, DetectedNote };
