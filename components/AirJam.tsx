import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, CameraOff, Hand, Music, Play, Square, Trophy, Zap, ChevronDown } from 'lucide-react';
import { warmUpHandTracker, type HandTracker } from '../services/handTracking';
import { GestureChordEngine, chordForSlot } from '../services/gestureChordEngine';
import { getChordFingering } from '../services/chordService';
import { playStrum, resumeAudio, stopAllAudio, setResonance } from '../services/audioService';
import { getSongs } from '../services/storageService';
import { buildSingAlongScore, type SingAlongScore } from '../services/singAlongScore';

interface Props { onBack?: () => void }

// ── Progressions ─────────────────────────────────────────────────────────────
// Slot N (N fingers) = Nth chord here. Kept to 4–5 so every finger has a job.
interface Progression { id: string; label: string; chords: string[] }
const PRESETS: Progression[] = [
  { id: 'pop',      label: 'Pop (I–V–vi–IV)', chords: ['C', 'G', 'Am', 'F'] },
  { id: 'sad',      label: 'Emotional',       chords: ['Am', 'F', 'C', 'G'] },
  { id: 'bolly',    label: 'Bollywood',       chords: ['Am', 'Dm', 'G', 'C', 'E'] },
  { id: 'anthem',   label: 'Anthem',          chords: ['G', 'D', 'Em', 'C'] },
];

const STRUM_PATTERN: ('D' | 'U')[] = ['D', 'D', 'U', 'D', 'U', 'D', 'U', 'U'];

const AirJam: React.FC<Props> = ({ onBack }) => {
  const [cameraOn, setCameraOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [trackerReady, setTrackerReady] = useState(false);
  const [progression, setProgression] = useState<Progression>(PRESETS[1]);
  const [showPicker, setShowPicker] = useState(false);
  // Sing mode: a real song's lyrics with a finger count on every chord.
  const [songScore, setSongScore] = useState<SingAlongScore | null>(null);
  const [autoStrum, setAutoStrum] = useState(true);
  const [bpm, setBpm] = useState(92);

  // Live gesture state (throttled into React for the HUD).
  const [slot, setSlot] = useState<number | null>(null);
  const [rawSlot, setRawSlot] = useState<number | null>(null);
  const [commitProgress, setCommitProgress] = useState(0);
  const [volume, setVolume] = useState(0);
  const [handsSeen, setHandsSeen] = useState(false);

  // Challenge mode — the shareable game loop.
  const [challenge, setChallenge] = useState(false);
  const [target, setTarget] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(() => {
    try { return Number(localStorage.getItem('plectrum_airjam_best') || 0); } catch { return 0; }
  });
  const [hitFlash, setHitFlash] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const engineRef = useRef(new GestureChordEngine());
  const lastInferRef = useRef(0);
  const lastStrumRef = useRef(0);
  const strumIdxRef = useRef(0);

  // Live refs so the rAF loop never reads stale state.
  const slotRef = useRef<number | null>(null);
  const volumeRef = useRef(0);
  const progRef = useRef(progression);   useEffect(() => { progRef.current = progression; }, [progression]);
  const autoRef = useRef(autoStrum);     useEffect(() => { autoRef.current = autoStrum; }, [autoStrum]);
  const bpmRef = useRef(bpm);            useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  const targetRef = useRef<number | null>(null);
  const challengeRef = useRef(false);    useEffect(() => { challengeRef.current = challenge; }, [challenge]);

  const chordName = useMemo(() => chordForSlot(progression.chords, slot), [progression, slot]);

  // Songs from the user's library whose chords we can jam over.
  const librarySongs = useMemo(() => {
    try {
      return getSongs().map(s => ({ id: s.id, title: s.title, score: buildSingAlongScore(s.content || '') }))
        .filter(s => s.score.chords.length >= 2);
    } catch { return []; }
  }, []);

  /** Load a real song: its chords become the finger slots, its lyrics the score. */
  const loadSong = useCallback((title: string, sc: SingAlongScore, id: string) => {
    setSongScore(sc);
    setProgression({ id, label: title, chords: sc.chords });
    setShowPicker(false);
  }, []);

  useEffect(() => { setResonance(0.35); }, []);

  // Persist the best streak as a plain effect (no nested state updates).
  useEffect(() => {
    if (streak > best) {
      setBest(streak);
      try { localStorage.setItem('plectrum_airjam_best', String(streak)); } catch { /* storage unavailable */ }
    }
  }, [streak, best]);

  // Warm the shared hand model (already prefetched from the nav in most cases).
  useEffect(() => {
    let cancelled = false;
    warmUpHandTracker().then(t => {
      if (cancelled) return;
      trackerRef.current = t;
      setTrackerReady(!!t);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const strumChord = useCallback((name: string, dir: 'D' | 'U', intensity: number) => {
    const fingering = getChordFingering(name);
    if (!fingering) return;
    const notes = fingering.frets.map((fret, string) => ({ string, fret })).filter(n => n.fret >= 0);
    if (notes.length) playStrum(notes, dir, Math.max(0.35, intensity));
  }, []);

  const pickTarget = useCallback((avoid: number | null) => {
    const n = progRef.current.chords.length;
    let next = 1 + Math.floor(Math.random() * n);
    if (n > 1) { let guard = 0; while (next === avoid && guard++ < 8) next = 1 + Math.floor(Math.random() * n); }
    targetRef.current = next;
    setTarget(next);
  }, []);

  // ── Main loop: detect hands → engine → audio + HUD ──
  const loop = useCallback(() => {
    const video = videoRef.current;
    const now = performance.now();

    if (video && video.readyState >= 2 && trackerRef.current && now - lastInferRef.current >= 24) {
      lastInferRef.current = now;
      const frames = trackerRef.current.detectFull(video, now);
      const r = engineRef.current.step(frames);

      slotRef.current = r.slot;
      volumeRef.current = r.volume;
      setSlot(r.slot);
      setRawSlot(r.rawSlot);
      setCommitProgress(r.commitProgress);
      setVolume(r.volume);
      setHandsSeen(r.chordHandPresent);

      const name = chordForSlot(progRef.current.chords, r.slot);

      // A new chord always strums immediately — that's the satisfying "hit".
      if (r.changed && name) {
        strumIdxRef.current = 0;
        lastStrumRef.current = now;
        strumChord(name, 'D', 0.6 + r.volume * 0.5);

        if (challengeRef.current && targetRef.current === r.slot) {
          setScore(s => s + 1);
          setStreak(s => s + 1);
          setHitFlash(true);
          window.setTimeout(() => setHitFlash(false), 260);
          pickTarget(r.slot);
        }
      } else if (r.changed && !name) {
        stopAllAudio();
      }
    }

    // Auto-strum keeps a held chord sounding like a song, not a single beep.
    if (autoRef.current && slotRef.current) {
      const interval = 60000 / Math.max(40, bpmRef.current) / 2; // 8th notes
      if (now - lastStrumRef.current >= interval) {
        lastStrumRef.current = now;
        const name = chordForSlot(progRef.current.chords, slotRef.current);
        const dir = STRUM_PATTERN[strumIdxRef.current % STRUM_PATTERN.length];
        strumIdxRef.current += 1;
        if (name && volumeRef.current > 0.06) strumChord(name, dir, 0.3 + volumeRef.current * 0.6);
      }
    }

    rafRef.current = requestAnimationFrame(loop);
  }, [strumChord, pickTarget]);

  const stopCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    engineRef.current.reset();
    stopAllAudio();
    setCameraOn(false);
    setSlot(null); setRawSlot(null); setHandsSeen(false); setVolume(0);
  }, []);

  const startCamera = useCallback(async () => {
    setCamError(null);
    if (!navigator.mediaDevices?.getUserMedia) { setCamError('Camera is not supported in this browser.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
      resumeAudio();
      setCameraOn(true);
      rafRef.current = requestAnimationFrame(loop);
    } catch (e: any) {
      setCamError(e?.name === 'NotAllowedError' ? 'Camera permission denied — allow it to play.' : 'Could not start the camera.');
    }
  }, [loop]);

  useEffect(() => () => { stopCamera(); }, [stopCamera]);

  const startChallenge = () => {
    setChallenge(true); setScore(0); setStreak(0);
    pickTarget(null);
  };
  const endChallenge = () => { setChallenge(false); setTarget(null); targetRef.current = null; };

  const targetChord = chordForSlot(progression.chords, target);

  return (
    <div className="flex flex-col h-[100dvh] bg-[#07040a] overflow-hidden relative no-global-click">
      {/* Top bar */}
      <div className="bg-[#120a18]/90 backdrop-blur border-b border-violet-950/60 px-3 md:px-4 flex justify-between items-center shadow-lg relative z-30 shrink-0 h-14">
        <div className="flex items-center gap-2">
          {onBack && <button onClick={onBack} aria-label="Back" className="p-2 hover:bg-white/10 rounded-lg text-violet-200/70 hover:text-white transition-colors"><ArrowLeft className="w-5 h-5" /></button>}
          <Zap className="w-4 h-4 text-violet-400" />
          <h2 className="text-sm md:text-lg font-bold text-violet-200 uppercase tracking-[0.2em] font-display">Air Jam</h2>
        </div>
        <div className="flex items-center gap-2">
          {!challenge ? (
            <button onClick={startChallenge} disabled={!cameraOn} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors">
              <Trophy className="w-3.5 h-3.5" /> Challenge
            </button>
          ) : (
            <button onClick={endChallenge} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white transition-colors">
              <Square className="w-3.5 h-3.5" /> End
            </button>
          )}
          <button onClick={() => (cameraOn ? stopCamera() : startCamera())} className={`flex items-center gap-2 text-[11px] font-bold px-3 py-2 rounded-lg border transition-colors ${cameraOn ? 'bg-rose-900/40 border-rose-800 text-rose-200' : 'bg-violet-800/40 border-violet-700 text-violet-100 hover:bg-violet-700'}`}>
            {cameraOn ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
            <span className="hidden sm:inline">{cameraOn ? 'Stop' : 'Camera'}</span>
          </button>
        </div>
      </div>

      {/* Stage */}
      <div className="relative flex-1 min-h-0 overflow-hidden" style={{ background: 'radial-gradient(ellipse at 50% 35%, #1b0f2b 0%, #0d0714 55%, #05030a 100%)' }}>
        <video ref={videoRef} playsInline muted autoPlay className={`absolute inset-0 w-full h-full object-cover -scale-x-100 transition-opacity duration-500 ${cameraOn ? 'opacity-60' : 'opacity-0'}`} />
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(7,4,10,.6), rgba(7,4,10,.15) 35%, rgba(7,4,10,.75))' }} />

        {/* Hit flash for challenge feedback */}
        {hitFlash && <div className="absolute inset-0 bg-emerald-400/20 pointer-events-none animate-in fade-in duration-100" />}

        {/* Challenge banner */}
        {challenge && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-black/60 backdrop-blur-md border border-violet-700/60 rounded-2xl px-4 py-2">
            <div className="text-center">
              <p className="text-[9px] uppercase tracking-widest text-violet-400 font-bold">Play</p>
              <p className="text-2xl font-black text-white leading-none">{targetChord}</p>
            </div>
            <div className="h-8 w-px bg-white/15" />
            <div className="text-center"><p className="text-[9px] uppercase tracking-widest text-violet-400 font-bold">Hold</p><p className="text-2xl font-black text-violet-200 leading-none">{target}</p></div>
            <div className="h-8 w-px bg-white/15" />
            <div className="text-center"><p className="text-[9px] uppercase tracking-widest text-violet-400 font-bold">Streak</p><p className="text-2xl font-black text-emerald-300 leading-none">{streak}</p></div>
            <div className="text-center"><p className="text-[9px] uppercase tracking-widest text-violet-400 font-bold">Best</p><p className="text-2xl font-black text-amber-300 leading-none">{best}</p></div>
          </div>
        )}

        {/* Sing mode: lyrics with a finger count on every chord. You sing, your
            hand changes chords, the app keeps the rhythm. */}
        {songScore && (
          <div className="absolute z-20 left-0 right-0 bottom-40 top-16 md:top-20 md:right-auto md:w-[46%] px-3 overflow-y-auto custom-scrollbar">
            <div className="bg-black/55 backdrop-blur-md rounded-2xl border border-violet-900/50 p-4 space-y-1">
              {songScore.lines.map((line, i) => {
                if (line.kind === 'blank') return <div key={i} className="h-3" />;
                if (line.kind === 'section') return (
                  <div key={i} className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-400/90 pt-3 pb-1">{line.label}</div>
                );
                return (
                  <p key={i} className="text-[15px] md:text-base leading-relaxed text-violet-50/90">
                    {line.tokens.map((tk, j) => (
                      <React.Fragment key={j}>
                        {tk.chord && (
                          <span className={`inline-flex items-baseline gap-1 mx-1 px-1.5 py-0.5 rounded-md text-[11px] font-black align-baseline transition-colors ${
                            slot === tk.slot ? 'bg-emerald-400 text-emerald-950' : 'bg-violet-500/25 text-violet-200'
                          }`}>
                            {tk.chord}
                            <span className="text-[9px] opacity-80">{tk.slot}&#402;</span>
                          </span>
                        )}
                        {tk.text}
                      </React.Fragment>
                    ))}
                  </p>
                );
              })}
              {songScore.overflow.length > 0 && (
                <p className="pt-3 text-[10px] text-amber-400/80">
                  Not mapped to fingers (song has more than 7 chords): {songScore.overflow.join(', ')}
                </p>
              )}
            </div>
          </div>
        )}

        {/* THE money shot: huge chord name, legible in a 3-second clip */}
        <div className={`absolute inset-0 flex items-center justify-center pointer-events-none z-10 ${songScore ? 'md:justify-end md:pr-[6%] items-start pt-4 md:items-center md:pt-0' : ''}`}>
          {chordName ? (
            <div className="text-center animate-in zoom-in-95 fade-in duration-150">
              <div className={`${songScore ? 'text-[14vw] md:text-[10vw]' : 'text-[22vw] md:text-[16vw]'} leading-none font-black text-white drop-shadow-[0_0_40px_rgba(167,139,250,0.65)]`}>{chordName}</div>
              <div className="mt-1 text-sm font-bold tracking-[0.3em] uppercase text-violet-300/80">{slot} finger{slot === 1 ? '' : 's'}</div>
            </div>
          ) : cameraOn ? (
            <div className="text-center">
              <div className="text-[10vw] md:text-[7vw] leading-none font-black text-white/15">{handsSeen ? 'OPEN A CHORD' : 'SHOW YOUR HAND'}</div>
              {rawSlot !== null && commitProgress > 0 && (
                <div className="mt-4 w-40 h-1.5 mx-auto bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-400 transition-[width] duration-75" style={{ width: `${commitProgress * 100}%` }} />
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Chord slots — the visual key that makes the mechanic obvious on video */}
        <div className="absolute bottom-24 left-0 right-0 z-20 px-3">
          <div className="flex justify-center gap-2 flex-wrap">
            {progression.chords.map((c, i) => {
              const n = i + 1;
              const active = slot === n;
              const isTarget = challenge && target === n;
              return (
                <div key={c + i} className={`flex flex-col items-center gap-1 px-3 py-2 rounded-2xl border-2 transition-all ${
                  active ? 'bg-violet-500 border-violet-300 scale-110 shadow-[0_0_28px_rgba(167,139,250,0.7)]'
                  : isTarget ? 'bg-emerald-600/30 border-emerald-400 animate-pulse'
                  : 'bg-black/45 border-white/10'}`}>
                  <span className={`text-lg font-black leading-none ${active ? 'text-white' : 'text-violet-100/80'}`}>{c}</span>
                  <span className="flex gap-0.5">
                    {Array.from({ length: n }).map((_, k) => (
                      <span key={k} className={`w-1.5 h-3 rounded-full ${active ? 'bg-white' : 'bg-violet-400/50'}`} />
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Volume meter — cheap, but it makes the "expression hand" readable on camera */}
        {cameraOn && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex flex-col-reverse gap-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <span key={i} className={`w-2 h-4 rounded-sm transition-colors ${volume * 8 > i ? 'bg-violet-400' : 'bg-white/10'}`} />
            ))}
          </div>
        )}

        {/* Footer controls */}
        <div className="absolute bottom-0 left-0 right-0 z-20 h-20 px-3 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent">
          <div className="relative">
            <button onClick={() => setShowPicker(v => !v)} className="flex items-center gap-2 text-[11px] font-bold px-3 py-2 rounded-lg bg-black/50 border border-white/10 text-violet-100">
              <Music className="w-3.5 h-3.5" /> {progression.label} <ChevronDown className="w-3 h-3" />
            </button>
            {showPicker && (
              <div className="absolute bottom-full mb-2 left-0 w-56 max-h-64 overflow-y-auto bg-[#120a18] border border-violet-900/60 rounded-xl shadow-2xl">
                {PRESETS.map(p => (
                  <button key={p.id} onClick={() => { setSongScore(null); setProgression(p); setShowPicker(false); }} className="w-full text-left px-3 py-2 hover:bg-violet-900/40">
                    <div className="text-xs font-bold text-violet-100">{p.label}</div>
                    <div className="text-[10px] text-violet-400">{p.chords.join(' · ')}</div>
                  </button>
                ))}
                {librarySongs.length > 0 && <div className="px-3 py-1.5 text-[9px] uppercase tracking-widest text-violet-600 font-bold border-t border-violet-900/60">Sing along</div>}
                {librarySongs.map(s => (
                  <button key={s.id} onClick={() => loadSong(s.title, s.score, s.id)} className="w-full text-left px-3 py-2 hover:bg-violet-900/40">
                    <div className="text-xs font-bold text-violet-100 truncate">{s.title}</div>
                    <div className="text-[10px] text-violet-400 truncate">{s.score.chords.join(' · ')}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setAutoStrum(v => !v)} className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-lg border transition-colors ${autoStrum ? 'bg-violet-600 border-violet-400 text-white' : 'bg-black/50 border-white/10 text-violet-300'}`}>
              <Play className="w-3.5 h-3.5" /> Rhythm
            </button>
            <div className="flex items-center gap-1.5 bg-black/50 border border-white/10 rounded-lg px-2 py-1.5">
              <span className="text-[9px] uppercase tracking-wider text-violet-400 font-bold">BPM</span>
              <input type="range" min={50} max={160} step={1} value={bpm} onChange={e => setBpm(parseInt(e.target.value, 10))} className="w-16 md:w-24 accent-violet-500" aria-label="Tempo" />
              <span className="text-[11px] font-black text-violet-100 tabular-nums w-7">{bpm}</span>
            </div>
          </div>
        </div>

        {/* Idle / permission overlay */}
        {!cameraOn && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center text-center gap-3 p-6 bg-gradient-to-b from-transparent via-black/40 to-black/80">
            <Hand className="w-12 h-12 text-violet-400" />
            <p className="text-white font-black text-2xl font-display">Play chords with your fingers</p>
            <p className="text-violet-300/80 text-sm max-w-sm">Hold up <b>1 finger</b> for the first chord, <b>2</b> for the second, and so on. Your other hand controls the volume — open palm loud, fist silent.</p>
            {camError && <p className="text-rose-300 text-xs">{camError}</p>}
            <button onClick={startCamera} className="mt-2 px-6 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-sm font-bold shadow-lg">
              {trackerReady ? 'Start jamming' : 'Start (loading hand model…)'}
            </button>
            <p className="text-[10px] text-emerald-400/70">Camera stays on your device. Nothing is uploaded.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AirJam;
