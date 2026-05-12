
import { getChordFingering } from "./chordService";

let audioCtx: AudioContext | null = null;
let masterCompressor: DynamicsCompressorNode | null = null;
let masterGain: GainNode | null = null;
const MASTER_OUTPUT_GAIN = 1.35;

const initAudio = () => {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioContextClass({
      latencyHint: 'interactive',
      sampleRate: 44100 // Force standard sample rate for better compatibility
    });
    
    // Master Gain - Boosted for Mobile
    masterGain = audioCtx.createGain();
    masterGain.gain.value = MASTER_OUTPUT_GAIN;
    
    // Master Compressor - Tuned for "Loudness War" style sustain
    masterCompressor = audioCtx.createDynamicsCompressor();
    masterCompressor.threshold.setValueAtTime(-30, audioCtx.currentTime); 
    masterCompressor.knee.setValueAtTime(24, audioCtx.currentTime);
    masterCompressor.ratio.setValueAtTime(16, audioCtx.currentTime);
    masterCompressor.attack.setValueAtTime(0.002, audioCtx.currentTime);
    masterCompressor.release.setValueAtTime(0.18, audioCtx.currentTime);
    
    masterGain.connect(masterCompressor);
    masterCompressor.connect(audioCtx.destination);
  }
  return { ctx: audioCtx, output: masterGain! };
};

export const resumeAudio = () => {
    // Mobile browsers (especially iOS) require user interaction to resume/unlock AudioContext
    if (!audioCtx) initAudio();
    // Cast to string to allow checking for 'interrupted' which is an iOS specific state not in standard definitions
    if (audioCtx && (audioCtx.state === 'suspended' || (audioCtx.state as string) === 'interrupted')) {
        audioCtx.resume().catch(e => console.warn("Audio resume failed", e));
    }
};

export const BASE_FREQUENCIES = [82.41, 110.00, 146.83, 196.00, 246.94, 329.63];

export const playPercussion = () => {
  const { ctx, output } = initAudio();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  // Punchier kick sound
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.15);
  
  gain.gain.setValueAtTime(0.85, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  
  osc.connect(gain);
  gain.connect(output);
  osc.start(now);
  osc.stop(now + 0.2);
};

export const playNote = (stringIdx: number, fret: number, type: 'normal' | 'hammer' | 'pull' | 'hammer-on' | 'pull-off' = 'normal', tuningOffset: number = 0) => {
  if (fret < 0) return; 
  const { ctx, output } = initAudio();
  const now = ctx.currentTime;
  const freq = BASE_FREQUENCIES[stringIdx] * Math.pow(2, (fret + tuningOffset) / 12);

  const noteGain = ctx.createGain();
  const isBassString = stringIdx <= 2;
  const baseAmplitude = isBassString ? 0.42 : 0.34;
  const attackTime = (type === 'hammer-on' || type === 'pull-off') ? 0.025 : 0.004;
  const decayDuration = isBassString ? 2.8 : 2.15;

  noteGain.gain.setValueAtTime(0, now);
  noteGain.gain.linearRampToValueAtTime(baseAmplitude, now + attackTime);
  noteGain.gain.exponentialRampToValueAtTime(baseAmplitude * 0.38, now + 0.12);
  noteGain.gain.exponentialRampToValueAtTime(0.001, now + decayDuration);

  const bodyFilter = ctx.createBiquadFilter();
  bodyFilter.type = 'lowpass';
  bodyFilter.frequency.setValueAtTime(isBassString ? 1800 : 3600, now);
  bodyFilter.Q.value = 0.65;

  const resonance = ctx.createBiquadFilter();
  resonance.type = 'peaking';
  resonance.frequency.setValueAtTime(isBassString ? 155 : 310, now);
  resonance.gain.setValueAtTime(isBassString ? 5 : 3, now);
  resonance.Q.value = 1.2;

  const partials = [1, 2, 3, 4, 5, 6];
  const amplitudes = isBassString
    ? [1, 0.55, 0.32, 0.18, 0.1, 0.06]
    : [1, 0.42, 0.24, 0.16, 0.08, 0.04];
  const oscillators: OscillatorNode[] = [];

  // Additive Fourier-style synthesis: the harmonic stack makes chord qualities distinct.
  partials.forEach((multiple, index) => {
    const osc = ctx.createOscillator();
    const harmonicGain = ctx.createGain();
    osc.type = index === 0 ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq * multiple, now);
    osc.detune.setValueAtTime((stringIdx - 2.5) * 1.7 + index * 0.4, now);
    harmonicGain.gain.setValueAtTime(amplitudes[index] / partials.length, now);
    osc.connect(harmonicGain);
    harmonicGain.connect(bodyFilter);
    osc.start(now);
    osc.stop(now + decayDuration + 0.08);
    oscillators.push(osc);
  });

  const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.018), ctx.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) {
    noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseData.length);
  }
  const pickNoise = ctx.createBufferSource();
  const pickGain = ctx.createGain();
  const pickFilter = ctx.createBiquadFilter();
  pickFilter.type = 'highpass';
  pickFilter.frequency.value = 1200;
  pickGain.gain.setValueAtTime(isBassString ? 0.07 : 0.05, now);
  pickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
  pickNoise.buffer = noiseBuffer;
  pickNoise.connect(pickFilter);
  pickFilter.connect(pickGain);
  pickGain.connect(bodyFilter);
  pickNoise.start(now);
  pickNoise.stop(now + 0.03);

  bodyFilter.connect(resonance);
  resonance.connect(noteGain);
  noteGain.connect(output);
  
  setTimeout(() => {
      noteGain.disconnect();
      bodyFilter.disconnect();
      resonance.disconnect();
      pickFilter.disconnect();
      pickGain.disconnect();
  }, (decayDuration + 0.5) * 1000);
};

export const playStrum = (notes: {string: number, fret: number}[], direction: 'D' | 'U' | 'X', speed: number = 1) => {
  if (direction === 'X') { playPercussion(); return; }
  const { ctx } = initAudio(); 
  const sortedNotes = [...notes].sort((a, b) => a.string - b.string);
  const sequence = direction === 'D' ? sortedNotes : sortedNotes.reverse();
  const baseStrumDelay = (0.04 / speed); // Slightly tighter strum

  sequence.forEach((note, index) => {
    if (note.fret === -1) return; 
    setTimeout(() => {
        playNote(note.string, note.fret, 'normal');
    }, index * baseStrumDelay * 1000);
  });
};

export const playChordByName = (chordName: string) => {
    resumeAudio();
    const fingering = getChordFingering(chordName);
    if (fingering) {
        const notes = fingering.frets.map((f, i) => ({ string: i, fret: f }));
        playStrum(notes, 'D', 1.0);
    }
};

export const playNavChord = (index: number) => {
    resumeAudio();
    const chords = ['Em', 'D', 'G', 'Am', 'C'];
    const chord = chords[index % chords.length];
    playChordByName(chord);
};

export const playLogoChord = () => { resumeAudio(); playChordByName('E'); };
export const playNextGlobalLoopChord = () => {};
