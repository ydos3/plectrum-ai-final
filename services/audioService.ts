
import { getChordFingering } from "./chordService";

let audioCtx: AudioContext | null = null;
let masterCompressor: DynamicsCompressorNode | null = null;
let masterGain: GainNode | null = null;
let masterLimiter: WaveShaperNode | null = null;
let outputCeiling: GainNode | null = null;
let masterMixBus: GainNode | null = null;
let reverbConvolver: ConvolverNode | null = null;
let reverbWet: GainNode | null = null;
let resonanceAmount = 0.16; // 0..1, controllable via setResonance()
// Lowered from 1.18 → 1.0: combined with the reverb send it was pushing the
// mix past 0 dBFS and cracking (hard clipping) during fast fingerstyle runs.
const MASTER_OUTPUT_GAIN = 1.0;
const OUTPUT_CEILING_GAIN = 0.92;
const MAX_ACTIVE_VOICES = 28;
const MAX_REVERB_WET = 0.6;

// Generate a short, warm plate-style impulse response for the reverb send.
const buildImpulseResponse = (ctx: AudioContext, seconds = 2.2, decay = 3.4) => {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      // Decaying noise → smooth diffuse tail (scaled down for headroom).
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay) * 0.6;
    }
  }
  return impulse;
};

type Voice = {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  stopAt: number;
  cleanupTimer: number;
};

const activeVoices: Voice[] = [];

const cleanupVoice = (voice: Voice) => {
  window.clearTimeout(voice.cleanupTimer);
  voice.nodes.forEach(node => {
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  });
  const index = activeVoices.indexOf(voice);
  if (index >= 0) activeVoices.splice(index, 1);
};

const registerVoice = (voice: Omit<Voice, 'cleanupTimer'>) => {
  if (!audioCtx) return;
  const fullVoice: Voice = {
    ...voice,
    cleanupTimer: window.setTimeout(() => cleanupVoice(fullVoice), Math.max(250, (voice.stopAt - audioCtx.currentTime + 0.2) * 1000))
  };

  activeVoices.push(fullVoice);

  while (activeVoices.length > MAX_ACTIVE_VOICES) {
    const oldest = activeVoices.shift();
    if (!oldest) break;
    oldest.sources.forEach(source => {
      try {
        source.stop();
      } catch {
        // A finished or already stopped source throws; cleanup below still matters.
      }
    });
    cleanupVoice(oldest);
  }
};

const createSoftLimiterCurve = () => {
  const samples = 2048;
  const curve = new Float32Array(samples);
  const drive = 1.8;
  const normalizer = Math.tanh(drive);

  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / normalizer;
  }

  return curve;
};

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
    
    // Master Compressor - raises perceived volume while catching stacked chord peaks.
    masterCompressor = audioCtx.createDynamicsCompressor();
    masterCompressor.threshold.setValueAtTime(-22, audioCtx.currentTime); 
    masterCompressor.knee.setValueAtTime(20, audioCtx.currentTime);
    masterCompressor.ratio.setValueAtTime(7, audioCtx.currentTime);
    masterCompressor.attack.setValueAtTime(0.004, audioCtx.currentTime);
    masterCompressor.release.setValueAtTime(0.16, audioCtx.currentTime);

    masterLimiter = audioCtx.createWaveShaper();
    masterLimiter.curve = createSoftLimiterCurve();
    masterLimiter.oversample = '4x';

    outputCeiling = audioCtx.createGain();
    outputCeiling.gain.value = OUTPUT_CEILING_GAIN;

    // Mix bus where the dry signal and the reverb send are summed BEFORE the
    // soft limiter, so the whole mix (incl. reverb tail) is limited and never
    // hard-clips/cracks.
    masterMixBus = audioCtx.createGain();
    masterMixBus.gain.value = 1;

    masterGain.connect(masterCompressor);
    masterCompressor.connect(masterMixBus);
    masterMixBus.connect(masterLimiter);
    masterLimiter.connect(outputCeiling);
    outputCeiling.connect(audioCtx.destination);

    // Parallel reverb send for resonance/sustain. Feeds the mix bus (pre-limiter)
    // and is defensive — if anything fails the dry signal keeps working.
    try {
      reverbConvolver = audioCtx.createConvolver();
      reverbConvolver.buffer = buildImpulseResponse(audioCtx);
      reverbWet = audioCtx.createGain();
      reverbWet.gain.value = resonanceAmount * MAX_REVERB_WET;
      masterGain.connect(reverbConvolver);
      reverbConvolver.connect(reverbWet);
      reverbWet.connect(masterMixBus);
    } catch {
      reverbConvolver = null;
      reverbWet = null;
    }
  }
  return { ctx: audioCtx, output: masterGain! };
};

// Set the resonance (reverb tail) amount, 0 (dry) .. 1 (lush).
export const setResonance = (amount: number) => {
  resonanceAmount = Math.min(1, Math.max(0, amount));
  if (reverbWet && audioCtx) {
    reverbWet.gain.setTargetAtTime(resonanceAmount * MAX_REVERB_WET, audioCtx.currentTime, 0.05);
  }
};

export const getResonance = () => resonanceAmount;

export const resumeAudio = () => {
    // Mobile browsers (especially iOS) require user interaction to resume/unlock AudioContext
    if (!audioCtx) initAudio();
    // Cast to string to allow checking for 'interrupted' which is an iOS specific state not in standard definitions
    if (audioCtx && (audioCtx.state === 'suspended' || (audioCtx.state as string) === 'interrupted')) {
        audioCtx.resume().catch(e => console.warn("Audio resume failed", e));
    }
};

export const stopAllAudio = () => {
  activeVoices.splice(0).forEach(voice => {
    window.clearTimeout(voice.cleanupTimer);
    voice.sources.forEach(source => {
      try {
        source.stop();
      } catch {
        // Source may already be stopped.
      }
    });
    voice.nodes.forEach(node => {
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
    });
  });
};

export const BASE_FREQUENCIES = [82.41, 110.00, 146.83, 196.00, 246.94, 329.63];
type NoteTechnique = 'normal' | 'hammer' | 'pull' | 'hammer-on' | 'pull-off' | 'slide';

export const playPercussion = () => {
  const { ctx, output } = initAudio();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  // Punchier kick sound
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.15);
  
  gain.gain.setValueAtTime(0.68, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  
  osc.connect(gain);
  gain.connect(output);
  osc.start(now);
  osc.stop(now + 0.2);

  registerVoice({
    sources: [osc],
    nodes: [osc, gain],
    stopAt: now + 0.22
  });
};

const scheduleNote = (
  ctx: AudioContext,
  output: AudioNode,
  stringIdx: number,
  fret: number,
  type: NoteTechnique = 'normal',
  tuningOffset: number = 0,
  startTime: number = ctx.currentTime,
  fromFret?: number
) => {
  if (fret < 0) return; 
  const now = Math.max(ctx.currentTime, startTime);
  const freq = BASE_FREQUENCIES[stringIdx] * Math.pow(2, (fret + tuningOffset) / 12);
  const fromFreq = typeof fromFret === 'number' && fromFret >= 0
    ? BASE_FREQUENCIES[stringIdx] * Math.pow(2, (fromFret + tuningOffset) / 12)
    : freq;
  if (!Number.isFinite(freq)) return;

  const noteGain = ctx.createGain();
  const isBassString = stringIdx <= 2;
  const isHammer = type === 'hammer' || type === 'hammer-on';
  const isPull = type === 'pull' || type === 'pull-off';
  const isSlide = type === 'slide';
  const isLegato = isHammer || isPull || isSlide;
  const baseAmplitude = (isBassString ? 0.31 : 0.26) * (isHammer ? 0.72 : isPull ? 0.62 : isSlide ? 0.78 : 1);
  const attackTime = isSlide ? 0.012 : isHammer ? 0.024 : isPull ? 0.014 : 0.006;
  const decayDuration = (isBassString ? 1.55 : 1.25) * (isLegato ? 0.86 : 1);

  noteGain.gain.cancelScheduledValues(now);
  noteGain.gain.setValueAtTime(0.0001, now);
  noteGain.gain.linearRampToValueAtTime(baseAmplitude, now + attackTime);
  noteGain.gain.exponentialRampToValueAtTime(baseAmplitude * (isPull ? 0.26 : 0.34), now + (isSlide ? 0.18 : 0.11));
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

  const partials = [1, 2, 3, 4];
  const amplitudes = isBassString
    ? [1, 0.5, 0.28, 0.14]
    : [1, 0.4, 0.22, 0.12];
  const oscillators: OscillatorNode[] = [];
  const harmonicGains: GainNode[] = [];

  // Additive Fourier-style synthesis: the harmonic stack makes chord qualities distinct.
  partials.forEach((multiple, index) => {
    const osc = ctx.createOscillator();
    const harmonicGain = ctx.createGain();
    osc.type = index === 0 ? 'triangle' : 'sine';
    if (isSlide && fromFreq !== freq) {
      osc.frequency.setValueAtTime(fromFreq * multiple, now);
      osc.frequency.exponentialRampToValueAtTime(freq * multiple, now + 0.13);
    } else {
      osc.frequency.setValueAtTime(freq * multiple, now);
    }
    osc.detune.setValueAtTime((stringIdx - 2.5) * 1.7 + index * 0.4, now);
    harmonicGain.gain.setValueAtTime(amplitudes[index] / partials.length, now);
    osc.connect(harmonicGain);
    harmonicGain.connect(bodyFilter);
    osc.start(now);
    osc.stop(now + decayDuration + 0.08);
    oscillators.push(osc);
    harmonicGains.push(harmonicGain);
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
  const pickLevel = isLegato
    ? isSlide
      ? 0.014
      : isPull
        ? 0.018
        : 0.012
    : isBassString
      ? 0.055
      : 0.045;
  pickGain.gain.setValueAtTime(pickLevel, now);
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

  registerVoice({
    sources: [...oscillators, pickNoise],
    nodes: [noteGain, bodyFilter, resonance, pickFilter, pickGain, ...harmonicGains, ...oscillators, pickNoise],
    stopAt: now + decayDuration + 0.1
  });
};

export const playNote = (stringIdx: number, fret: number, type: NoteTechnique = 'normal', tuningOffset: number = 0, fromFret?: number) => {
  const { ctx, output } = initAudio();
  scheduleNote(ctx, output, stringIdx, fret, type, tuningOffset, ctx.currentTime, fromFret);
};

export const playStrum = (notes: {string: number, fret: number}[], direction: 'D' | 'U' | 'X', speed: number = 1) => {
  if (direction === 'X') { playPercussion(); return; }
  const { ctx, output } = initAudio(); 
  const sortedNotes = [...notes].sort((a, b) => a.string - b.string);
  const sequence = direction === 'D' ? sortedNotes : sortedNotes.reverse();
  const safeSpeed = Math.max(0.1, speed);
  const baseStrumDelay = (0.032 / safeSpeed);
  const startAt = ctx.currentTime + 0.006;

  sequence.forEach((note, index) => {
    if (note.fret === -1) return; 
    scheduleNote(ctx, output, note.string, note.fret, 'normal', 0, startAt + index * baseStrumDelay);
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
