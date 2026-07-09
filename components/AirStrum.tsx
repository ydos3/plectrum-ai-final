import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, CameraOff, Hand, Sparkles, ShieldCheck, ArrowDown, ArrowUp, Music, Waves } from 'lucide-react';
import { getChordFingering } from '../services/chordService';
import { playStrum, playNote, resumeAudio, stopAllAudio, setResonance, getResonance } from '../services/audioService';
import { ParticleField } from '../services/particleField';

interface AirStrumProps {
  onBack?: () => void;
}

type CameraState = 'idle' | 'unsupported' | 'requesting' | 'active' | 'denied' | 'error';

interface ScalePreset { id: string; label: string; short: string; chords: string[]; }

const SCALE_PRESETS: ScalePreset[] = [
  { id: 'c-major', label: 'C Major', short: 'C', chords: ['C', 'Dm', 'Em', 'F', 'G', 'Am'] },
  { id: 'g-major', label: 'G Major', short: 'G', chords: ['G', 'Am', 'Bm', 'C', 'D', 'Em'] },
  { id: 'd-major', label: 'D Major', short: 'D', chords: ['D', 'Em', 'F#m', 'G', 'A', 'Bm'] },
  { id: 'a-minor', label: 'A Minor', short: 'Am', chords: ['Am', 'Dm', 'Em', 'F', 'G', 'C'] },
  { id: 'e-minor', label: 'E Minor', short: 'Em', chords: ['Em', 'Am', 'Bm', 'C', 'D', 'G'] },
  { id: 'bollywood', label: 'Bollywood', short: 'Bolly', chords: ['Am', 'Fmaj7', 'C', 'G', 'Dm', 'E'] },
];

const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];
const STRINGS_LEFT = 0.10;
const STRINGS_SPAN = 0.80;
const NOTE_ZONE_TOP = 0.36;    // upper portion of the stage = "point to pick a chord"
const NOTE_SELECT_DWELL = 200; // ms of pointing before a chord commits
const MOTION_GATE = 0.004;     // low so gentle hand movement still registers
const HAND_PERSIST_MS = 650;   // treat the hand as still-present briefly after motion stops

const AirStrum: React.FC<AirStrumProps> = ({ onBack }) => {
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [scaleIndex, setScaleIndex] = useState(5);
  const [chordIndex, setChordIndex] = useState(0);
  const [resonance, setResonanceState] = useState(() => getResonance());
  const [handInFrame, setHandInFrame] = useState(false);
  const [hoverNote, setHoverNote] = useState(-1);
  const [hoverProgress, setHoverProgress] = useState(0);
  const [playingString, setPlayingString] = useState(-1);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const procCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<ParticleField | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const prevLumaRef = useRef<Float32Array | null>(null);
  const lumaRef = useRef<Float32Array | null>(null);
  const activityRef = useRef<{ x: number; y: number; mode: 'note' | 'strum' | null; string: number; mag: number; t: number; progress: number }>({ x: 0.5, y: 0.5, mode: null, string: -1, mag: 0, t: 0, progress: 0 });
  const perStringLastRef = useRef<number[]>(Array(6).fill(0));
  const lastHandStringRef = useRef(-1);
  // Last position where motion was seen — lets a still "point" keep registering
  // for a moment so holding a finger on a chord selects reliably.
  const lastSeenRef = useRef<{ x: number; y: number; t: number }>({ x: 0.5, y: 0.5, t: 0 });
  const hoverNoteRef = useRef<{ idx: number; since: number; committed: number }>({ idx: -1, since: 0, committed: -1 });

  const scale = SCALE_PRESETS[scaleIndex];
  const currentChordName = scale.chords[Math.min(chordIndex, scale.chords.length - 1)];
  const fingering = useMemo(() => getChordFingering(currentChordName), [currentChordName]);

  const supportsCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';

  // ─── Stage engine (strings + particles) ─────────────────────────────────────
  useEffect(() => {
    const canvas = stageCanvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const field = new ParticleField(canvas);
    field.configureStrings(6, STRINGS_LEFT, STRINGS_SPAN);
    fieldRef.current = field;
    const sync = () => {
      const rect = stage.getBoundingClientRect();
      field.resize(rect.width, rect.height, Math.min(2, window.devicePixelRatio || 1));
    };
    sync();
    field.start();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      field.destroy();
      fieldRef.current = null;
    };
  }, []);

  const pluckString = useCallback((stringIdx: number) => {
    if (stringIdx < 0 || stringIdx > 5) return;
    resumeAudio();
    if (fingering) {
      const fret = fingering.frets[stringIdx];
      if (fret >= 0) playNote(stringIdx, fret, 'normal', 0);
    }
    fieldRef.current?.pluck(stringIdx, 1);
  }, [fingering]);

  const strum = useCallback((direction: 'D' | 'U') => {
    resumeAudio();
    if (fingering) {
      const notes = fingering.frets.map((fret, string) => ({ string, fret })).filter(n => n.fret >= 0);
      playStrum(notes, direction, 1);
    }
    const order = direction === 'D' ? [0, 1, 2, 3, 4, 5] : [5, 4, 3, 2, 1, 0];
    order.forEach((s, k) => window.setTimeout(() => fieldRef.current?.pluck(s, 1), k * 32));
  }, [fingering]);

  // Live refs so the rAF camera loop always calls the latest handlers/state.
  const pluckRef = useRef(pluckString); useEffect(() => { pluckRef.current = pluckString; }, [pluckString]);
  const selectChordRef = useRef(setChordIndex);
  const scaleLenRef = useRef(scale.chords.length); useEffect(() => { scaleLenRef.current = scale.chords.length; }, [scale.chords.length]);

  const handleResonance = (v: number) => { setResonanceState(v); setResonance(v); };

  // ─── Camera + gesture processing ─────────────────────────────────────────────
  const processFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = procCanvasRef.current;
    if (video && canvas && video.readyState >= 2) {
      const w = canvas.width, h = canvas.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        if (!lumaRef.current || lumaRef.current.length !== w * h) { lumaRef.current = new Float32Array(w * h); prevLumaRef.current = null; }
        const luma = lumaRef.current, prev = prevLumaRef.current;
        let sumMotion = 0, sumX = 0, sumY = 0;
        for (let p = 0, i = 0; p < w * h; p++, i += 4) {
          const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          luma[p] = l;
          if (prev) { const d = Math.abs(l - prev[p]); if (d > 13) { sumMotion += d; sumX += (p % w) * d; sumY += ((p / w) | 0) * d; } }
        }
        prevLumaRef.current = luma;
        lumaRef.current = prev || new Float32Array(w * h);

        const mag = sumMotion / (w * h * 255);
        const cx = sumMotion > 0 ? 1 - ((sumX / sumMotion) / w) : 0.5; // mirror to match view
        const cy = sumMotion > 0 ? (sumY / sumMotion) / h : 0.5;
        const now = performance.now();

        const seen = mag > MOTION_GATE;
        if (seen) lastSeenRef.current = { x: cx, y: cy, t: now };
        const recent = now - lastSeenRef.current.t < HAND_PERSIST_MS;
        // Effective position: live when moving, last-known when briefly still,
        // so pointing at a chord and holding still keeps registering.
        const ex = seen ? cx : lastSeenRef.current.x;
        const ey = seen ? cy : lastSeenRef.current.y;

        if (seen || recent) {
          if (ey < NOTE_ZONE_TOP) {
            // Point-and-hold to pick a chord: map X across the chord chips.
            const len = scaleLenRef.current;
            const idx = Math.max(0, Math.min(len - 1, Math.round(ex * (len - 1))));
            const hv = hoverNoteRef.current;
            if (idx !== hv.idx) { hv.idx = idx; hv.since = now; }
            const progress = Math.min(1, (now - hv.since) / NOTE_SELECT_DWELL);
            if (progress >= 1 && hv.committed !== idx) {
              hv.committed = idx;
              selectChordRef.current(idx);
            }
            lastHandStringRef.current = -1;
            activityRef.current = { x: ex, y: ey, mode: 'note', string: -1, mag, t: now, progress };
          } else {
            // Strum zone: pluck ONLY the string the hand is over — and only on
            // real motion, so a resting hand doesn't machine-gun a string.
            hoverNoteRef.current.idx = -1; hoverNoteRef.current.committed = -1;
            let s = -1;
            if (seen) {
              const frac = (ex - STRINGS_LEFT) / STRINGS_SPAN;
              s = Math.max(0, Math.min(5, Math.round(frac * 5)));
              if (s !== lastHandStringRef.current && now - perStringLastRef.current[s] > 90) {
                perStringLastRef.current[s] = now;
                pluckRef.current(s);
              }
              lastHandStringRef.current = s;
            }
            activityRef.current = { x: ex, y: ey, mode: 'strum', string: s, mag, t: now, progress: 0 };
          }
        } else {
          lastHandStringRef.current = -1;
          hoverNoteRef.current.committed = -1; // allow re-picking the same chord after the hand leaves
        }
      }
    }
    rafRef.current = requestAnimationFrame(processFrame);
  }, []);

  const stopCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    prevLumaRef.current = null;
    lastHandStringRef.current = -1;
    setHandInFrame(false); setHoverNote(-1); setPlayingString(-1);
  }, []);

  const startCamera = useCallback(async () => {
    if (!supportsCamera) { setCameraState('unsupported'); return; }
    setCameraState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
      resumeAudio();
      setCameraState('active');
      rafRef.current = requestAnimationFrame(processFrame);
    } catch (err: any) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) setCameraState('denied');
      else setCameraState('error');
      stopCamera();
    }
  }, [supportsCamera, processFrame, stopCamera]);

  useEffect(() => {
    if (cameraState !== 'active') return;
    const interval = window.setInterval(() => {
      const a = activityRef.current;
      const fresh = performance.now() - a.t < 320;
      if (fresh && a.mode) { setHandInFrame(true); setHoverNote(a.mode === 'note' ? hoverNoteRef.current.idx : -1); setHoverProgress(a.mode === 'note' ? a.progress : 0); setPlayingString(a.string); }
      else { setHandInFrame(false); setHoverNote(-1); setHoverProgress(0); setPlayingString(-1); }
    }, 100);
    return () => window.clearInterval(interval);
  }, [cameraState]);

  useEffect(() => { if (!supportsCamera) setCameraState('unsupported'); }, [supportsCamera]);
  useEffect(() => () => { stopCamera(); stopAllAudio(); }, [stopCamera]);
  useEffect(() => { setChordIndex(i => Math.min(i, SCALE_PRESETS[scaleIndex].chords.length - 1)); }, [scaleIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key >= '1' && e.key <= '6') pluckString(parseInt(e.key, 10) - 1);
      else if (e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); strum('D'); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); strum('U'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pluckString, strum]);

  // Tap / swipe strings in the lower stage zone.
  const swipeStringRef = useRef(-1);
  const stringFromClientX = (clientX: number) => {
    const stage = stageRef.current; if (!stage) return -1;
    const rect = stage.getBoundingClientRect();
    const frac = ((clientX - rect.left) / rect.width - STRINGS_LEFT) / STRINGS_SPAN;
    return Math.max(0, Math.min(5, Math.round(frac * 5)));
  };
  const onStrumPointerDown = (e: React.PointerEvent) => { const s = stringFromClientX(e.clientX); swipeStringRef.current = s; pluckString(s); };
  const onStrumPointerMove = (e: React.PointerEvent) => { if (e.buttons !== 1) return; const s = stringFromClientX(e.clientX); if (s !== swipeStringRef.current) { swipeStringRef.current = s; pluckString(s); } };
  const onStrumPointerUp = () => { swipeStringRef.current = -1; };

  const cameraOn = cameraState === 'active';

  return (
    <div className="flex flex-col h-[100dvh] bg-[#0a0503] overflow-hidden relative no-global-click">
      {/* Top bar */}
      <div className="bg-[#160d0a]/90 backdrop-blur border-b border-amber-950/60 px-3 md:px-4 flex justify-between items-center shadow-lg relative z-30 shrink-0 h-14">
        <div className="flex items-center gap-2 md:gap-3">
          {onBack && <button onClick={onBack} aria-label="Back" className="p-2 hover:bg-white/10 rounded-lg text-amber-200/70 hover:text-white transition-colors"><ArrowLeft className="w-5 h-5" /></button>}
          <Sparkles className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm md:text-lg font-bold text-amber-300 uppercase tracking-[0.2em] font-display">Air Strum</h2>
        </div>
        <button
          onClick={() => (cameraOn ? (stopCamera(), setCameraState('idle')) : startCamera())}
          className={`flex items-center gap-2 text-[11px] md:text-xs font-bold px-3 py-2 rounded-lg border transition-colors ${cameraOn ? 'bg-red-900/40 border-red-800 text-red-200 hover:bg-red-800' : 'bg-amber-800/40 border-amber-700 text-amber-100 hover:bg-amber-700'}`}
        >
          {cameraOn ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
          <span className="hidden sm:inline">{cameraOn ? 'Stop' : 'Camera'}</span>
        </button>
      </div>

      {/* ─── Full-stage: camera + strings + everything overlaid ─── */}
      <div
        ref={stageRef}
        className="relative flex-1 min-h-0 overflow-hidden touch-none"
        style={{ background: 'radial-gradient(ellipse at 50% 40%, #23110a 0%, #120a06 55%, #060302 100%)' }}
      >
        {/* Camera: shows the full you */}
        <video ref={videoRef} playsInline muted autoPlay className={`absolute inset-0 w-full h-full object-cover -scale-x-100 transition-opacity duration-500 ${cameraOn ? 'opacity-[0.55]' : 'opacity-0'}`} />
        <canvas ref={procCanvasRef} width={112} height={84} className="hidden" />
        {/* subtle darken for contrast against overlays */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(6,3,2,0.55), rgba(6,3,2,0.15) 30%, rgba(6,3,2,0.35))' }} />

        {/* Strings + particles */}
        <canvas ref={stageCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" />

        {/* Chord chips (point-to-pick zone, top) */}
        <div className="absolute top-2 left-0 right-0 z-20 px-2">
          {/* scale selector */}
          <div className="flex justify-center gap-1.5 mb-2 flex-wrap">
            {SCALE_PRESETS.map((s, i) => (
              <button key={s.id} onClick={() => setScaleIndex(i)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all ${i === scaleIndex ? 'bg-amber-500 text-amber-950 border-amber-400' : 'bg-black/40 text-amber-300/80 border-amber-900/50 hover:bg-amber-900/40'}`}>
                {s.short}
              </button>
            ))}
          </div>
          {/* chord chips */}
          <div className="flex justify-between gap-1.5 max-w-2xl mx-auto">
            {scale.chords.map((c, i) => {
              const selected = i === Math.min(chordIndex, scale.chords.length - 1);
              const hovered = i === hoverNote;
              return (
                <button key={c + i} onClick={() => setChordIndex(i)}
                  className={`relative overflow-hidden flex-1 py-2.5 rounded-xl font-display font-bold text-base md:text-lg border-2 transition-all active:scale-95 ${
                    selected ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-amber-950 border-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.6)] scale-105'
                    : hovered ? 'bg-violet-500/30 text-violet-100 border-violet-400 shadow-[0_0_18px_rgba(167,139,250,0.6)]'
                    : 'bg-black/45 text-amber-200/90 border-amber-900/50 hover:bg-amber-900/40'}`}>
                  {/* point-and-hold dwell fill */}
                  {hovered && !selected && (
                    <span className="absolute left-0 bottom-0 h-1 bg-violet-300 transition-[width] duration-100" style={{ width: `${hoverProgress * 100}%` }} />
                  )}
                  <span className="relative z-10">{c}</span>
                </button>
              );
            })}
          </div>
          {cameraOn && (
            <p className="text-center text-[10px] text-violet-300/80 mt-1">Point &amp; hold on a chord (up here) to pick it</p>
          )}
        </div>

        {/* Strum hit zone (lower) */}
        <div
          className="absolute left-0 right-0 bottom-0 z-20"
          style={{ top: `${NOTE_ZONE_TOP * 100}%` }}
          onPointerDown={onStrumPointerDown}
          onPointerMove={onStrumPointerMove}
          onPointerUp={onStrumPointerUp}
          onPointerLeave={onStrumPointerUp}
        >
          <div className="absolute inset-0 flex justify-between px-[10%] pb-6">
            {STRING_LABELS.map((lbl, i) => (
              <div key={i} className="flex-1 flex items-end justify-center">
                <span className={`text-sm md:text-base font-mono font-bold ${playingString === i ? 'text-amber-200' : 'text-amber-500/50'}`}>{lbl}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Current chord badge */}
        <div className="absolute bottom-2 left-3 z-20 flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-amber-900/40">
          <Music className="w-4 h-4 text-amber-400" />
          <span className="text-amber-100 font-display font-bold text-base">{currentChordName}</span>
        </div>

        {/* Resonance control */}
        <div className="absolute bottom-2 right-3 z-20 flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-amber-900/40">
          <Waves className="w-4 h-4 text-amber-400" />
          <input type="range" min={0} max={1} step={0.05} value={resonance} onChange={e => handleResonance(parseFloat(e.target.value))}
            aria-label="Resonance" className="w-20 md:w-28 accent-amber-500 cursor-pointer" />
        </div>

        {/* Idle / camera-state overlay */}
        {!cameraOn && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center text-center gap-3 p-6 bg-gradient-to-b from-transparent via-[#0a0503]/30 to-[#0a0503]/70 pointer-events-none">
            <div className="pointer-events-auto flex flex-col items-center gap-3">
              {cameraState === 'unsupported' ? (
                <><CameraOff className="w-9 h-9 text-amber-600" /><p className="text-amber-200 font-bold text-lg">Camera not supported here</p><p className="text-amber-500/70 text-sm max-w-xs">Tap or swipe the strings, tap chords above — it still sounds magical.</p></>
              ) : cameraState === 'denied' ? (
                <><CameraOff className="w-9 h-9 text-red-400" /><p className="text-amber-100 font-bold text-lg">Camera permission denied</p><button onClick={startCamera} className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-sm font-bold">Try again</button></>
              ) : cameraState === 'error' ? (
                <><CameraOff className="w-9 h-9 text-red-400" /><p className="text-amber-100 font-bold text-lg">Couldn't start the camera</p><button onClick={startCamera} className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-sm font-bold">Retry</button></>
              ) : cameraState === 'requesting' ? (
                <><Camera className="w-9 h-9 text-amber-500 animate-pulse" /><p className="text-amber-100 font-bold text-lg">Requesting camera…</p></>
              ) : (
                <><Sparkles className="w-10 h-10 text-amber-400" /><p className="text-amber-100 font-black text-xl font-display">Play in the air</p>
                  <p className="text-amber-500/80 text-sm max-w-sm">Enable the camera to see yourself and play with your hands: point &amp; hold on a chord up top to pick it, then move your hand across the strings below to play them. Or just tap.</p>
                  <button onClick={startCamera} className="mt-1 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white text-sm font-bold shadow-lg">Enable Camera</button></>
              )}
            </div>
          </div>
        )}

        {cameraOn && !handInFrame && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 bg-black/55 text-amber-200 text-[11px] px-4 py-2 rounded-full border border-amber-900/40 pointer-events-none text-center backdrop-blur-sm">
            Point &amp; hold a chord up top · move your hand across the strings below to play
          </div>
        )}
      </div>

      {/* Bottom strum controls */}
      <div className="relative z-30 shrink-0 pb-safe pt-2">
        <div className="flex items-center justify-center gap-3 md:gap-4 px-3">
          <button onClick={() => strum('D')} className="flex items-center gap-2 px-6 md:px-8 py-3 rounded-xl bg-[#241611] border border-amber-900/60 hover:border-amber-500 text-amber-100 font-bold shadow-lg active:scale-95 transition-all"><ArrowDown className="w-5 h-5 text-amber-400" /> Strum Down</button>
          <button onClick={() => strum('U')} className="flex items-center gap-2 px-6 md:px-8 py-3 rounded-xl bg-[#241611] border border-amber-900/60 hover:border-amber-500 text-amber-100 font-bold shadow-lg active:scale-95 transition-all"><ArrowUp className="w-5 h-5 text-amber-400" /> Strum Up</button>
        </div>
        <div className="flex flex-col items-center gap-0.5 py-2 text-center">
          <p className="flex items-center gap-1.5 text-[10px] text-emerald-400/80"><ShieldCheck className="w-3 h-3" /> Camera stays on your device. No video uploaded.</p>
          <p className="flex items-center gap-1.5 text-[10px] text-amber-600/70"><Hand className="w-3 h-3" /> Point &amp; hold to pick a chord · move across the strings to play · or tap</p>
        </div>
      </div>
    </div>
  );
};

export default AirStrum;
