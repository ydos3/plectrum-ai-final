import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, AlertCircle, Check, ChevronDown, Mic, MicOff, RotateCcw, HelpCircle } from 'lucide-react';
import {
  detectPitch, getNoteFromFrequency, getTuningGuidance, InTuneConfirmer,
  TUNINGS, type TunerResult,
} from '../services/tunerService';

interface GuitarTunerProps { onBack: () => void }
type MicStatus = 'starting' | 'listening' | 'denied' | 'unsupported' | 'error';

// Needle sweep: ±50 cents maps to ±52°, the range real tuners show.
const MAX_CENTS = 50;
const MAX_ANGLE = 52;

const GuitarTuner: React.FC<GuitarTunerProps> = ({ onBack }) => {
  const [tuningName, setTuningName] = useState<keyof typeof TUNINGS>('Standard');
  const [showTuningMenu, setShowTuningMenu] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [micStatus, setMicStatus] = useState<MicStatus>('starting');
  const [errorText, setErrorText] = useState<string | null>(null);

  const [result, setResult] = useState<TunerResult | null>(null);
  const [uiCents, setUiCents] = useState(0);          // smoothed needle position
  const [confirmed, setConfirmed] = useState(false);   // held in tune long enough
  const [holdProgress, setHoldProgress] = useState(0);
  const [tunedStrings, setTunedStrings] = useState<Set<number>>(new Set());
  const [lockedString, setLockedString] = useState<string | null>(null); // manual mode

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const confirmerRef = useRef(new InTuneConfirmer(700));
  const smoothedRef = useRef(0);
  const lastSoundRef = useRef(0);

  // Live refs so the audio loop never reads stale state.
  const tuningRef = useRef(TUNINGS[tuningName]);
  useEffect(() => { tuningRef.current = TUNINGS[tuningName]; }, [tuningName]);
  const lockedRef = useRef<string | null>(null);
  useEffect(() => { lockedRef.current = lockedString; }, [lockedString]);

  const tuning = TUNINGS[tuningName];
  const guidance = useMemo(() => getTuningGuidance(result?.cents ?? 0), [result?.cents]);

  const loop = useCallback(() => {
    const analyser = analyserRef.current, ctx = ctxRef.current;
    if (!analyser || !ctx) return;

    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    const freq = detectPitch(buf, ctx.sampleRate);
    const now = performance.now();

    if (freq) {
      lastSoundRef.current = now;
      const r = getNoteFromFrequency(freq, tuningRef.current, lockedRef.current);
      setResult(r);

      // Ease the needle so it glides instead of twitching, but stay responsive.
      const target = Math.max(-MAX_CENTS, Math.min(MAX_CENTS, r.cents));
      smoothedRef.current += (target - smoothedRef.current) * 0.25;
      setUiCents(smoothedRef.current);

      const ok = confirmerRef.current.update(r.isInTune, now);
      setHoldProgress(confirmerRef.current.progress(now));
      setConfirmed(ok);
      if (ok) setTunedStrings(prev => prev.has(r.stringIndex) ? prev : new Set(prev).add(r.stringIndex));
    } else if (now - lastSoundRef.current > 900) {
      // Signal gone: clear rather than freeze on a stale reading.
      setResult(null);
      setConfirmed(false);
      setHoldProgress(0);
      confirmerRef.current.reset();
      smoothedRef.current += (0 - smoothedRef.current) * 0.12;
      setUiCents(smoothedRef.current);
    }

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (ctxRef.current && ctxRef.current.state !== 'closed') ctxRef.current.close().catch(() => {});
    ctxRef.current = null;
    analyserRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setErrorText(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus('unsupported');
      setErrorText('This browser cannot access the microphone.');
      return;
    }
    setMicStatus('starting');
    try {
      // AGC/noise-suppression must stay OFF — they distort pitch and amplitude.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AC();
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') await ctx.resume();

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 8192;             // ~186ms window: enough periods for low E
      analyser.smoothingTimeConstant = 0;  // we do our own smoothing on cents
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;

      setMicStatus('listening');
      rafRef.current = requestAnimationFrame(loop);
    } catch (err: any) {
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      setMicStatus(denied ? 'denied' : 'error');
      setErrorText(denied
        ? 'Microphone blocked. Allow mic access in your browser, then tap retry.'
        : (err?.message || 'Could not start the microphone.'));
    }
  }, [loop]);

  // Auto-start on open — no Start button. Cleans up on exit.
  useEffect(() => { start(); return () => stop(); }, [start, stop]);

  const listening = micStatus === 'listening';
  const inTune = !!result?.isInTune;
  const accent = confirmed ? '#22c55e' : inTune ? '#4ade80' : result ? '#f59e0b' : '#6b7280';

  // Headstock layout: low strings on the left, high on the right, as on a guitar.
  const leftPegs = [0, 1, 2];
  const rightPegs = [5, 4, 3];

  const Peg: React.FC<{ i: number; side: 'l' | 'r' }> = ({ i, side }) => {
    const name = tuning.notes[i];
    const isActive = result?.stringIndex === i && listening;
    const isTuned = tunedStrings.has(i);
    const isLocked = lockedString === name;
    return (
      <button
        onClick={() => { setLockedString(isLocked ? null : name); confirmerRef.current.reset(); }}
        title={isLocked ? `${name} locked — tap to unlock` : `Lock to ${name}`}
        className={`flex items-center gap-2 ${side === 'r' ? 'flex-row-reverse' : ''}`}
      >
        <span className={`h-1 w-5 rounded-full transition-colors ${isActive ? 'bg-emerald-400' : 'bg-white/20'}`} />
        <span className={`relative flex h-12 w-12 items-center justify-center rounded-full border-2 text-base font-black transition-all
          ${isLocked ? 'border-sky-400 bg-sky-500/20 text-sky-200 scale-110'
            : isActive ? 'border-emerald-400 bg-emerald-500/25 text-white scale-110 shadow-[0_0_22px_rgba(52,211,153,0.55)]'
            : isTuned ? 'border-emerald-700/60 bg-emerald-900/25 text-emerald-300'
            : 'border-white/15 bg-white/[0.04] text-gray-300'}`}>
          {name.replace(/\d/, '')}
          {isTuned && <Check className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-emerald-500 p-0.5 text-black" />}
        </span>
      </button>
    );
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#0b0f14] text-white no-global-click">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
        <div className="flex items-center gap-2">
          <button onClick={onBack} aria-label="Back" className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white"><ArrowLeft className="h-5 w-5" /></button>
          <h2 className="font-display text-sm font-bold uppercase tracking-[0.2em] text-gray-300">Tuner</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowHelp(v => !v)} aria-label="How to tune" className={`rounded-lg p-2 transition-colors ${showHelp ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}><HelpCircle className="h-5 w-5" /></button>
          <div className="relative">
            <button onClick={() => setShowTuningMenu(v => !v)} className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-amber-300">
              {tuningName} <ChevronDown className="h-3 w-3 text-gray-500" />
            </button>
            {showTuningMenu && (
              <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-xl border border-white/10 bg-[#141a22] shadow-2xl">
                {(Object.keys(TUNINGS) as (keyof typeof TUNINGS)[]).map(k => (
                  <button key={k} onClick={() => { setTuningName(k); setShowTuningMenu(false); setTunedStrings(new Set()); setLockedString(null); }}
                    className={`block w-full px-3 py-2 text-left text-xs hover:bg-white/10 ${k === tuningName ? 'text-amber-300' : 'text-gray-300'}`}>
                    <div className="font-bold">{TUNINGS[k].name}</div>
                    <div className="text-[10px] text-gray-500">{TUNINGS[k].notes.join(' ')}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showHelp && (
        <div className="shrink-0 border-b border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[12px] leading-relaxed text-gray-300">
          <p className="mb-1"><b className="text-white">1.</b> Start with the thickest string (low E) and work down to the thinnest.</p>
          <p className="mb-1"><b className="text-white">2.</b> Pluck firmly once and let it ring — don't keep strumming.</p>
          <p className="mb-1"><b className="text-white">3.</b> Too <b>flat</b>? Turn the peg <b>away from you</b>. Too <b>sharp</b>? Turn it <b>toward you</b>.</p>
          <p className="text-gray-500">Tap a peg to lock onto one string — the most accurate way to tune.</p>
        </div>
      )}

      {/* SAFETY: auto mode can match a pitch to a string the player isn't holding. */}
      {!lockedString && result && (result.ambiguous || result.risky) && (
        <div className="mx-3 mt-2 flex shrink-0 items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-[11px] leading-snug text-amber-200">
            <b>Check you're on the right string.</b> This pitch sits between strings — tap the peg
            you're tuning to lock it before tightening.
          </p>
        </div>
      )}

      {/* Gauge */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
        <div className="relative w-full max-w-sm">
          <svg viewBox="0 0 300 170" className="w-full">
            {/* tick marks every 10 cents */}
            {Array.from({ length: 11 }).map((_, i) => {
              const c = -50 + i * 10;
              const a = (c / MAX_CENTS) * MAX_ANGLE;
              const rad = (a - 90) * Math.PI / 180;
              const isZero = c === 0;
              const r1 = isZero ? 96 : 106, r2 = 124;
              return (
                <g key={c}>
                  <line
                    x1={150 + Math.cos(rad) * r1} y1={150 + Math.sin(rad) * r1}
                    x2={150 + Math.cos(rad) * r2} y2={150 + Math.sin(rad) * r2}
                    stroke={isZero ? accent : 'rgba(255,255,255,0.22)'} strokeWidth={isZero ? 3 : 1.5} strokeLinecap="round"
                  />
                  {(c === -50 || c === 0 || c === 50) && (
                    <text x={150 + Math.cos(rad) * 138} y={150 + Math.sin(rad) * 138 + 4}
                      textAnchor="middle" className="fill-gray-600" style={{ fontSize: 11, fontWeight: 700 }}>
                      {c === 0 ? '0' : c > 0 ? '+50' : '-50'}
                    </text>
                  )}
                </g>
              );
            })}
            {/* in-tune zone */}
            <path d={describeArc(150, 150, 100, -MAX_ANGLE * (5 / MAX_CENTS), MAX_ANGLE * (5 / MAX_CENTS))}
              fill="none" stroke={inTune ? '#22c55e' : 'rgba(255,255,255,0.12)'} strokeWidth={4} strokeLinecap="round" />
            {/* needle */}
            <g style={{ transform: `rotate(${(uiCents / MAX_CENTS) * MAX_ANGLE}deg)`, transformOrigin: '150px 150px', transition: 'transform 90ms linear' }}>
              <line x1="150" y1="150" x2="150" y2="42" stroke={accent} strokeWidth="4" strokeLinecap="round" />
              <circle cx="150" cy="150" r="8" fill={accent} />
            </g>
          </svg>

          {/* Note + readout, centred under the arc */}
          <div className="pointer-events-none absolute inset-x-0 top-[52%] flex flex-col items-center">
            <div className="text-[68px] font-black leading-none tracking-tight" style={{ color: accent }}>
              {result ? result.targetNote.replace(/\d/, '') : '–'}
            </div>
            <div className="mt-1 h-4 text-xs font-bold tabular-nums text-gray-500">
              {result ? `${result.frequency.toFixed(1)} Hz · ${result.cents > 0 ? '+' : ''}${result.cents}¢` : ''}
            </div>
          </div>
        </div>

        {/* Guidance */}
        <div className="mt-3 flex h-16 flex-col items-center justify-center">
          {!listening ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-gray-400">{errorText || 'Starting microphone…'}</p>
              {(micStatus === 'denied' || micStatus === 'error') && (
                <button onClick={start} className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-500">
                  <RotateCcw className="h-3.5 w-3.5" /> Retry
                </button>
              )}
            </div>
          ) : confirmed ? (
            <div className="flex items-center gap-2 rounded-full bg-emerald-500/15 px-5 py-2 text-emerald-300">
              <Check className="h-5 w-5" /> <span className="text-lg font-black">In tune</span>
            </div>
          ) : result ? (
            <>
              <div className="flex items-center gap-3">
                <span className={`text-2xl font-black transition-opacity ${guidance.action === 'tighten' ? 'text-amber-400' : 'text-gray-700'}`}>▲</span>
                <span className="text-base font-bold text-gray-200">{guidance.text}</span>
                <span className={`text-2xl font-black transition-opacity ${guidance.action === 'loosen' ? 'text-amber-400' : 'text-gray-700'}`}>▼</span>
              </div>
              <p className="mt-0.5 text-[11px] text-gray-500">{guidance.pegHint}</p>
              {holdProgress > 0 && (
                <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-emerald-400 transition-[width] duration-100" style={{ width: `${holdProgress * 100}%` }} />
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500">Pluck a string…</p>
          )}
        </div>
      </div>

      {/* Headstock */}
      <div className="shrink-0 px-4 pb-6">
        <div className="mx-auto flex max-w-sm items-center justify-between gap-3">
          <div className="flex flex-col gap-3">{leftPegs.map(i => <Peg key={i} i={i} side="l" />)}</div>
          <div className="mx-1 h-36 w-8 rounded-lg bg-gradient-to-b from-[#3a2a1d] to-[#241a12] shadow-inner" />
          <div className="flex flex-col gap-3">{rightPegs.map(i => <Peg key={i} i={i} side="r" />)}</div>
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-gray-500">
          {listening ? <Mic className="h-3.5 w-3.5 text-emerald-400" /> : <MicOff className="h-3.5 w-3.5" />}
          {lockedString
            ? <>Locked to <b className="text-sky-300">{lockedString}</b> — tap again to unlock</>
            : <>Auto-detecting · {tunedStrings.size}/{tuning.notes.length} tuned</>}
        </div>
      </div>
    </div>
  );
};

/** SVG arc helper for the in-tune zone. */
function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const p = (deg: number) => {
    const rad = (deg - 90) * Math.PI / 180;
    return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r];
  };
  const [x1, y1] = p(startDeg), [x2, y2] = p(endDeg);
  return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
}

export default GuitarTuner;
