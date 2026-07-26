import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Mic, Settings, AlertCircle, ChevronDown, Check, X, Waves, Guitar } from 'lucide-react';
import { detectPitch, getNoteFromFrequency, TUNINGS, TunerResult } from '../services/tunerService';
import { analyzeChord, ChordAnalysisResult } from '../services/fftService';
import { speak } from '../services/speechService';

interface GuitarTunerProps {
    onBack: () => void;
}

type MicStatus = 'not-started' | 'requesting' | 'listening' | 'permission-denied' | 'no-signal' | 'unsupported';

const GuitarTuner: React.FC<GuitarTunerProps> = ({ onBack }) => {
    const [tuningName, setTuningName] = useState<string>('Standard');
    const [currentResult, setCurrentResult] = useState<TunerResult | null>(null);
    const [streamError, setStreamError] = useState<string | null>(null);
    const [micStatus, setMicStatus] = useState<MicStatus>('not-started');
    const [showSettings, setShowSettings] = useState(false);
    const [showTuningMenu, setShowTuningMenu] = useState(false);

    // Physics State for Needle
    const smoothedCentsRef = useRef<number>(0);
    const velocityRef = useRef<number>(0);
    const [uiCents, setUiCents] = useState(0);

    // Vibration State (0-1 intensity)
    const [vibrations, setVibrations] = useState<number[]>([0, 0, 0, 0, 0, 0]);

    // Mode State: Auto | Manual | Chord Detect
    const [mode, setMode] = useState<'auto' | 'manual' | 'chord'>('auto');
    const [selectedStringNote, setSelectedStringNote] = useState<string | null>(null);
    const currentTuning = TUNINGS[tuningName as keyof typeof TUNINGS];

    // FFT Chord Detection State
    const [chordResult, setChordResult] = useState<ChordAnalysisResult | null>(null);
    const [spectrum, setSpectrum] = useState<number[]>(new Array(64).fill(0));

    // 3D Parallax State
    const [tilt, setTilt] = useState({ x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);

    // Audio Refs
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const rafRef = useRef<number | null>(null);
    const lastNoteTimeRef = useRef<number>(0);
    const lastChordAnnounceRef = useRef<string>('');
    const modeRef = useRef(mode);
    const selectedStringRef = useRef<string | null>(selectedStringNote);
    const tuningRef = useRef(currentTuning);

    useEffect(() => {
        return () => stopListening();
    }, []);

    useEffect(() => { modeRef.current = mode; }, [mode]);
    useEffect(() => { selectedStringRef.current = selectedStringNote; }, [selectedStringNote]);
    useEffect(() => { tuningRef.current = currentTuning; }, [currentTuning]);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
        const y = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
        setTilt({ x: x * 8, y: y * -8 });
    };

    const handleMouseLeave = () => setTilt({ x: 0, y: 0 });

    const startListening = async () => {
        try {
            if (!navigator.mediaDevices?.getUserMedia) {
                setMicStatus('unsupported');
                setStreamError('This browser does not support microphone tuning.');
                return;
            }
            setStreamError(null);
            setMicStatus('requesting');
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                }
            });
            streamRef.current = stream;

            const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
            if (!AudioContextClass) {
                setMicStatus('unsupported');
                setStreamError('This browser does not support Web Audio tuning.');
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            const audioCtx = new AudioContextClass();
            audioContextRef.current = audioCtx;
            if (audioCtx.state === 'suspended') await audioCtx.resume();

            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 8192;
            analyser.smoothingTimeConstant = 0.35;
            analyserRef.current = analyser;

            const source = audioCtx.createMediaStreamSource(stream);
            source.connect(analyser);
            sourceRef.current = source;

            setMicStatus('listening');
            lastNoteTimeRef.current = Date.now();
            updateLoop();
        } catch (err: any) {
            console.error("Mic Error:", err);
            const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
            setMicStatus(denied ? 'permission-denied' : 'not-started');
            setStreamError(denied ? 'Microphone permission was denied.' : (err.message || "Could not access microphone."));
        }
    };

    const stopListening = () => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (sourceRef.current) sourceRef.current.disconnect();
        if (analyserRef.current) analyserRef.current.disconnect();
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close().catch(e => console.error(e));
        }
        sourceRef.current = null;
        analyserRef.current = null;
        audioContextRef.current = null;
        setCurrentResult(null);
        setChordResult(null);
        setVibrations([0, 0, 0, 0, 0, 0]);
        setMicStatus('not-started');
    };

    const updateLoop = () => {
        if (!analyserRef.current || !audioContextRef.current) return;

        const bufferLength = analyserRef.current.fftSize;
        const dataArray = new Float32Array(bufferLength);
        analyserRef.current.getFloatTimeDomainData(dataArray);

        let rms = 0;
        for (let i = 0; i < bufferLength; i++) rms += dataArray[i] * dataArray[i];
        rms = Math.sqrt(rms / bufferLength);

        let targetCents = 0;
        let hasSignal = false;

        const activeMode = modeRef.current;
        const activeTuning = tuningRef.current;
        const selectedTarget = selectedStringRef.current;

        if (activeMode === 'chord') {
            // FFT Chord Detection Mode
            const result = analyzeChord(analyserRef.current, audioContextRef.current.sampleRate);
            if (result) {
                setChordResult(result);
                setSpectrum(result.spectrum);
                hasSignal = true;
                lastNoteTimeRef.current = Date.now();
                setMicStatus('listening');

                // Announce chord via TTS (debounced)
                if (result.chord !== lastChordAnnounceRef.current && result.confidence > 0.7) {
                    lastChordAnnounceRef.current = result.chord;
                    speak(result.chord, 1.2); // Fast announcement
                }
            } else if (rms < 0.008) {
                setChordResult(null);
                setSpectrum(prev => prev.map(v => v * 0.9)); // Smooth decay
                if (Date.now() - lastNoteTimeRef.current > 500) setMicStatus('no-signal');
            }
        } else {
            // Standard Pitch Detection (Single Note)
            if (rms > 0.008) {
                const frequency = detectPitch(dataArray, audioContextRef.current.sampleRate);
                if (frequency) {
                    const nextResult = getNoteFromFrequency(
                        frequency,
                        activeTuning,
                        activeMode === 'manual' ? selectedTarget : null
                    );
                    setCurrentResult(prev => {
                        if (!prev) return nextResult;
                        return {
                            ...nextResult,
                            frequency: prev.frequency * 0.72 + nextResult.frequency * 0.28,
                            cents: Math.round(prev.cents * 0.65 + nextResult.cents * 0.35),
                        };
                    });
                    lastNoteTimeRef.current = Date.now();
                    setMicStatus('listening');
                    targetCents = nextResult.cents;
                    hasSignal = true;

                    const newVibrations = activeTuning.notes.map((_, index) => {
                        return index === nextResult.stringIndex ? Math.min(rms * 18, 1) : 0;
                    });
                    setVibrations(newVibrations);
                }
            } else {
                if (Date.now() - lastNoteTimeRef.current > 400) {
                    setCurrentResult(null);
                    setVibrations([0, 0, 0, 0, 0, 0]);
                    setMicStatus('no-signal');
                }
            }
        }

        // Physics: Spring Damping for Needle
        if (!hasSignal && Date.now() - lastNoteTimeRef.current > 400) {
            targetCents = 0;
        }

        const k = 0.15;
        const d = 0.8;
        const acceleration = (targetCents - smoothedCentsRef.current) * k;
        velocityRef.current = (velocityRef.current + acceleration) * d;
        smoothedCentsRef.current += velocityRef.current;
        setUiCents(smoothedCentsRef.current);

        rafRef.current = requestAnimationFrame(updateLoop);
    };

    const getPegState = (noteStr: string) => {
        const root = noteStr.replace(/[0-9]/, '');
        let isActive = false;
        if (mode === 'manual' && selectedStringNote) {
            isActive = selectedStringNote === noteStr;
        } else if (currentResult && mode === 'auto') {
            isActive = currentResult.targetNote === noteStr;
        }
        const isLocked = isActive && currentResult?.isInTune;
        return { isActive, isLocked, root };
    };

    const micStatusLabel: Record<MicStatus, string> = {
        'not-started': 'Not Started',
        requesting: 'Permission Requested',
        listening: 'Listening',
        'permission-denied': 'Permission Denied',
        'no-signal': 'No Signal Detected',
        unsupported: 'Unsupported Browser',
    };

    const feedbackLabel = currentResult
        ? currentResult.status === 'in-tune' ? 'In Tune' : currentResult.status === 'sharp' ? 'Sharp' : 'Flat'
        : micStatusLabel[micStatus];

    return (
        <div
            className="h-full flex flex-col bg-[#050505] text-white relative overflow-hidden font-sans select-none"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            ref={containerRef}
            style={{ perspective: '1000px' }}
        >
            {/* Ambient Background Glow */}
            <div className="absolute inset-0 pointer-events-none">
                <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[200px] transition-colors duration-1000 ${
                    currentResult?.isInTune ? 'bg-emerald-500/15' :
                    chordResult ? 'bg-purple-500/15' :
                    currentResult ? 'bg-amber-500/10' : 'bg-white/5'
                }`}></div>
            </div>

            {/* Header - Glassmorphic */}
            <div className="z-30 flex items-center justify-between px-4 md:px-6 py-3 bg-white/[0.03] backdrop-blur-2xl border-b border-white/[0.06] shrink-0">
                <button onClick={onBack} className="p-2.5 rounded-xl hover:bg-white/10 transition-all active:scale-95">
                    <ArrowLeft className="w-5 h-5 text-gray-400" />
                </button>

                {/* Mode Toggles - Pill Design */}
                <div className="flex bg-white/[0.04] rounded-full p-1 border border-white/[0.08] backdrop-blur-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                    <button onClick={() => { setMode('auto'); setSelectedStringNote(null); }} className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${mode === 'auto' ? 'bg-amber-500 text-black shadow-[0_0_20px_rgba(245,158,11,0.3)]' : 'text-gray-500 hover:text-gray-300'}`}>Auto</button>
                    <button onClick={() => setMode('manual')} className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${mode === 'manual' ? 'bg-amber-500 text-black shadow-[0_0_20px_rgba(245,158,11,0.3)]' : 'text-gray-500 hover:text-gray-300'}`}>Manual</button>
                    <button onClick={() => setMode('chord')} className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${mode === 'chord' ? 'bg-purple-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.4)]' : 'text-gray-500 hover:text-gray-300'}`}>
                        <Waves className="w-3 h-3" /> Chord
                    </button>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={micStatus === 'listening' || micStatus === 'no-signal' ? stopListening : startListening}
                        disabled={micStatus === 'requesting' || micStatus === 'unsupported'}
                        className={`flex items-center gap-2 px-3 py-2 border rounded-xl transition-all active:scale-95 backdrop-blur-lg text-xs font-black uppercase tracking-wider ${
                            micStatus === 'listening' || micStatus === 'no-signal'
                                ? 'bg-red-500/15 text-red-200 border-red-500/30 hover:bg-red-500/25'
                                : 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30 hover:bg-emerald-500/25'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        <Mic className="w-4 h-4" />
                        <span className="hidden sm:inline">{micStatus === 'listening' || micStatus === 'no-signal' ? 'Stop' : micStatus === 'requesting' ? 'Requesting' : 'Start'}</span>
                    </button>
                    <button
                        onClick={() => setShowTuningMenu(true)}
                        className="flex items-center gap-2 px-3 py-2 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-xl transition-all active:scale-95 backdrop-blur-lg"
                    >
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider hidden sm:inline">Tuning</span>
                        <div className="text-sm font-bold text-amber-400 uppercase flex items-center gap-1">
                            {tuningName} <ChevronDown className="w-3 h-3 text-gray-500" />
                        </div>
                    </button>

                    <button
                        onClick={(e) => { e.stopPropagation(); setShowSettings(true); }}
                        className="p-2.5 rounded-xl hover:bg-white/10 transition-all active:scale-95"
                    >
                        <Settings className="w-5 h-5 text-gray-400 hover:text-white transition-colors" />
                    </button>
                </div>
            </div>

            {/* SAFETY: in auto mode a pitch can sit nearest a string the player is
                NOT holding (a sharp low E reads as a flat A2). Following that would
                mean tightening a 4th too far — tension rises with the square of
                pitch — so we warn and steer them to lock the string manually. */}
            {mode === 'auto' && currentResult && (currentResult.ambiguous || currentResult.risky) && (
                <div className="mx-3 mb-2 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 backdrop-blur-lg">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <p className="text-[11px] leading-snug text-amber-200">
                        <b>Check you're on the right string.</b> This pitch sits between strings — the
                        tuner guessed <b>{currentResult.targetNote}</b>. Tap your string below to lock it
                        before tightening.
                    </p>
                </div>
            )}

            {/* 3D Stage */}
            <div className="flex-1 relative flex flex-col items-center justify-start w-full overflow-hidden"
                style={{ perspective: '1000px' }}
            >
                <div className="relative w-full h-full flex flex-col items-center justify-center transition-transform duration-100 ease-out"
                    style={{
                        transform: `rotateX(${tilt.y}deg) rotateY(${tilt.x}deg)`,
                        transformStyle: 'preserve-3d'
                    }}
                >
                    {/* Note/Chord Indicator */}
                    <div className="z-30 mb-8 shrink-0 transition-all duration-300" style={{ transform: 'translateZ(60px)' }}>
                        {mode === 'chord' ? (
                            /* Chord Detection Display */
                            <div className="flex flex-col items-center gap-4">
                                <div className={`
                                    w-32 h-32 rounded-3xl border-[3px] flex flex-col items-center justify-center
                                    bg-white/[0.03] backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]
                                    transition-all duration-300
                                    ${chordResult ? 'border-purple-400/60 shadow-[0_0_60px_rgba(168,85,247,0.2)]' : 'border-white/10'}
                                `}>
                                    <div className={`text-5xl font-black transition-colors ${chordResult ? 'text-purple-300' : 'text-white/20'}`}>
                                        {chordResult ? chordResult.chord : '—'}
                                    </div>
                                    {chordResult && (
                                        <div className="text-[10px] font-bold text-purple-400/80 uppercase tracking-widest mt-1">
                                            {Math.round(chordResult.confidence * 100)}% match
                                        </div>
                                    )}
                                </div>
                                {chordResult && (
                                    <div className="flex gap-1.5 animate-in fade-in">
                                        {chordResult.notes.map((note, i) => (
                                            <span key={i} className="px-2.5 py-1 bg-purple-500/20 border border-purple-500/30 rounded-lg text-[10px] font-bold text-purple-200 uppercase tracking-wider">
                                                {note}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            /* Single Note Display */
                            <div className={`
                                w-28 h-28 rounded-full border-[5px] flex flex-col items-center justify-center
                                bg-white/[0.03] backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]
                                transition-all duration-300
                                ${currentResult?.isInTune ? 'border-emerald-400 shadow-[0_0_60px_rgba(52,211,153,0.3)] scale-110' : 'border-white/10'}
                            `}>
                                <div className={`text-5xl font-black ${currentResult?.isInTune ? 'text-emerald-400' : 'text-white'}`}>
                                    {currentResult ? currentResult.targetNote.replace(/[0-9]/, '') : (selectedStringNote?.replace(/[0-9]/, '') || '-')}
                                </div>
                                {currentResult && <div className="text-xs font-bold text-gray-500">{currentResult.targetNote.replace(/^[A-G]#?/, '')}</div>}
                            </div>
                        )}
                    </div>

                    {mode !== 'chord' && (
                        <div className="z-30 -mt-4 mb-6 grid grid-cols-3 gap-2 w-full max-w-md px-6" style={{ transform: 'translateZ(50px)' }}>
                            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-3 text-center backdrop-blur-xl">
                                <div className="text-[9px] text-gray-500 font-black uppercase tracking-widest mb-1">Frequency</div>
                                <div className="text-lg font-black text-white">{currentResult ? `${currentResult.frequency.toFixed(1)} Hz` : '--'}</div>
                            </div>
                            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-3 text-center backdrop-blur-xl">
                                <div className="text-[9px] text-gray-500 font-black uppercase tracking-widest mb-1">Target</div>
                                <div className="text-lg font-black text-amber-300">{currentResult ? currentResult.targetNote : (selectedStringNote || 'Auto')}</div>
                            </div>
                            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-3 text-center backdrop-blur-xl">
                                <div className="text-[9px] text-gray-500 font-black uppercase tracking-widest mb-1">Cents</div>
                                <div className={`text-lg font-black ${currentResult?.isInTune ? 'text-emerald-400' : 'text-amber-300'}`}>
                                    {currentResult ? `${currentResult.cents > 0 ? '+' : ''}${currentResult.cents}` : '--'}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* FFT Spectrum Visualizer (Chord Mode) */}
                    {mode === 'chord' && (
                        <div className="w-full max-w-xl px-8 flex items-end justify-center gap-[2px] h-24 mb-4" style={{ transform: 'translateZ(30px)' }}>
                            {spectrum.map((val, i) => (
                                <div
                                    key={i}
                                    className="flex-1 rounded-t-sm transition-all duration-75"
                                    style={{
                                        height: `${Math.max(2, val * 100)}%`,
                                        background: `linear-gradient(to top, rgba(168,85,247,${0.3 + val * 0.7}), rgba(139,92,246,${0.1 + val * 0.5}))`,
                                        boxShadow: val > 0.5 ? `0 0 8px rgba(168,85,247,${val * 0.5})` : 'none',
                                    }}
                                ></div>
                            ))}
                        </div>
                    )}

                    {/* Guitar Headstock Visual (pitch modes only) */}
                    {mode !== 'chord' && (
                        <div className="relative h-full flex justify-center items-start pb-4" style={{ maxHeight: 'calc(100% - 100px)' }}>
                            <div className="relative h-full w-auto">
                                <div className="absolute top-[10%] bottom-[10%] left-[20%] right-[20%] bg-black/80 blur-3xl rounded-full" style={{ transform: 'translateZ(-50px)' }}></div>
                                <img
                                    src="/guitar_headstock_front_dynamic.png"
                                    alt="Guitar Headstock"
                                    className="h-full w-auto object-contain filter drop-shadow-2xl pointer-events-none block"
                                    style={{ transform: 'scaleX(-1)' }}
                                />
                                <div className="absolute inset-0 z-20">
                                    <div className="absolute top-0 bottom-0 left-[38%] right-[38%] flex justify-between pointer-events-none">
                                        {vibrations.map((amp, i) => (
                                            <div key={i} className="relative w-[1px] h-full">
                                                <div
                                                    className="absolute inset-0 bg-amber-400 w-[2px] opacity-0 transition-opacity duration-100"
                                                    style={{
                                                        opacity: amp > 0.1 ? 0.8 : 0,
                                                        transform: `translateX(${Math.sin(Date.now() / 5) * amp * 3}px)`
                                                    }}
                                                ></div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="absolute left-[5%] top-[8%] w-[35%] h-[55%] flex flex-col justify-between py-6 pr-4">
                                        <PegZone note={currentTuning.notes[2]} state={getPegState(currentTuning.notes[2])} onClick={() => { setMode('manual'); setSelectedStringNote(currentTuning.notes[2]); }} />
                                        <PegZone note={currentTuning.notes[1]} state={getPegState(currentTuning.notes[1])} onClick={() => { setMode('manual'); setSelectedStringNote(currentTuning.notes[1]); }} />
                                        <PegZone note={currentTuning.notes[0]} state={getPegState(currentTuning.notes[0])} onClick={() => { setMode('manual'); setSelectedStringNote(currentTuning.notes[0]); }} />
                                    </div>
                                    <div className="absolute right-[5%] top-[8%] w-[35%] h-[55%] flex flex-col justify-between py-6 pl-4 items-end">
                                        <PegZone note={currentTuning.notes[3]} state={getPegState(currentTuning.notes[3])} onClick={() => { setMode('manual'); setSelectedStringNote(currentTuning.notes[3]); }} isRight />
                                        <PegZone note={currentTuning.notes[4]} state={getPegState(currentTuning.notes[4])} onClick={() => { setMode('manual'); setSelectedStringNote(currentTuning.notes[4]); }} isRight />
                                        <PegZone note={currentTuning.notes[5]} state={getPegState(currentTuning.notes[5])} onClick={() => { setMode('manual'); setSelectedStringNote(currentTuning.notes[5]); }} isRight />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {mode !== 'chord' && (
                <div className="z-20 px-4 pb-3 flex justify-center gap-2 flex-wrap">
                    {currentTuning.notes.map((note, index) => {
                        const active = currentResult?.stringIndex === index || (mode === 'manual' && selectedStringNote === note);
                        return (
                            <button
                                key={`${note}-${index}`}
                                onClick={() => { setMode('manual'); setSelectedStringNote(note); }}
                                className={`min-w-12 px-3 py-2 rounded-xl border text-sm font-black transition-all ${
                                    active
                                        ? currentResult?.isInTune
                                            ? 'bg-emerald-400 text-black border-emerald-200 shadow-[0_0_20px_rgba(52,211,153,0.35)]'
                                            : 'bg-amber-400 text-black border-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.25)]'
                                        : 'bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.08] hover:text-white'
                                }`}
                            >
                                {note}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* METER FOOTER - Glassmorphic */}
            <div className="shrink-0 h-28 w-full bg-white/[0.02] backdrop-blur-2xl border-t border-white/[0.06] rounded-t-[30px] flex flex-col items-center justify-center relative z-20 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
                {mode !== 'chord' ? (
                    <>
                        <div className="text-[10px] font-black text-gray-500 uppercase tracking-[0.35em] mb-2">Standard E A D G B E</div>
                        <div className="relative w-full max-w-lg h-10">
                            <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                            <div className="absolute top-1/2 left-1/2 h-4 w-[2px] bg-white/40 -translate-y-1/2 z-10"></div>
                            {[-40, -20, 20, 40].map(p => (
                                <div key={p} className="absolute top-1/2 w-[1px] h-2.5 bg-white/15 -translate-y-1/2" style={{ left: `calc(50% + ${p}%)` }}></div>
                            ))}
                            <div
                                className={`absolute top-1/2 w-7 h-7 rounded-full border-[2px] shadow-lg -translate-x-1/2 -translate-y-1/2 transition-all duration-100 ease-linear
                                    ${currentResult?.isInTune
                                        ? 'bg-emerald-400 border-white scale-125 shadow-[0_0_20px_rgba(52,211,153,0.5)]'
                                        : 'bg-amber-400 border-white shadow-[0_0_15px_rgba(245,158,11,0.3)]'}`}
                                style={{ left: `calc(50% + ${Math.max(-48, Math.min(48, uiCents))}%)` }}
                            ></div>
                        </div>
                        {currentResult ? (
                            <span className={`text-lg font-black tracking-[0.2em] uppercase ${currentResult.isInTune ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {currentResult.isInTune ? 'In Tune' : (currentResult.cents > 0 ? 'Sharp' : 'Flat')}
                            </span>
                        ) : <span className="text-gray-600 text-xs font-bold tracking-widest uppercase">{feedbackLabel}</span>}
                    </>
                ) : (
                    <div className="text-center">
                        <div className="text-[10px] font-bold text-purple-400/60 uppercase tracking-[0.3em] mb-1">Fourier Analysis</div>
                        <div className="text-gray-500 text-xs">
                            {chordResult ? `Detected ${chordResult.notes.length} notes` : 'Play a chord near the mic...'}
                        </div>
                    </div>
                )}
            </div>

            {/* Tuning Menu Modal */}
            {showTuningMenu && (
                <div className="absolute inset-0 z-50 bg-black/90 backdrop-blur-2xl flex flex-col p-6 animate-in fade-in slide-in-from-bottom-5">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold text-white">Select Tuning</h2>
                        <button onClick={() => setShowTuningMenu(false)} className="p-2.5 bg-white/10 rounded-full hover:bg-white/20 transition-colors"><X className="w-5 h-5" /></button>
                    </div>
                    <div className="space-y-3 overflow-y-auto pb-10">
                        {Object.entries(TUNINGS).map(([key, data]) => (
                            <button
                                key={key}
                                onClick={() => { setTuningName(key); setShowTuningMenu(false); }}
                                className={`w-full p-4 rounded-2xl flex items-center justify-between border transition-all group backdrop-blur-lg
                                ${tuningName === key
                                    ? 'bg-amber-500/20 text-amber-100 border-amber-500/50 shadow-[0_0_30px_rgba(245,158,11,0.1)]'
                                    : 'bg-white/[0.03] border-white/[0.06] hover:border-white/20 hover:bg-white/[0.06]'}`}
                            >
                                <div className="text-left">
                                    <div className="font-bold text-lg">{data.name}</div>
                                    <div className={`text-xs font-mono mt-1 ${tuningName === key ? 'text-amber-400/70' : 'text-gray-500'}`}>{data.notes.join(' • ')}</div>
                                </div>
                                {tuningName === key && <Check className="w-6 h-6 text-amber-400" />}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Settings Modal */}
            {showSettings && (
                <div onClick={() => setShowSettings(false)} className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 cursor-pointer">
                    <div onClick={e => e.stopPropagation()} className="bg-[#111]/90 backdrop-blur-2xl border border-white/[0.08] rounded-3xl w-full max-w-sm p-6 shadow-2xl cursor-default animate-in zoom-in-95">
                        <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">Settings</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2 block">Input Source</label>
                                <div className="flex items-center gap-3 p-3 bg-white/[0.04] rounded-xl border border-white/[0.06]">
                                    <Mic className="w-4 h-4 text-amber-400" />
                                    <span className="text-sm font-medium text-gray-200">Default Microphone</span>
                                </div>
                            </div>
                        </div>
                        <button onClick={() => setShowSettings(false)} className="w-full mt-8 py-3 bg-white text-black font-bold rounded-xl hover:bg-gray-200 transition-colors">Close</button>
                    </div>
                </div>
            )}

            {/* Error */}
            {streamError && (
                <div className="absolute inset-0 bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center z-50 p-8 text-center">
                    <AlertCircle className="w-16 h-16 text-red-500 mb-6" />
                    <h3 className="text-xl font-bold text-white mb-2">Microphone Error</h3>
                    <p className="text-gray-400 mb-8 max-w-xs">{streamError}</p>
                    <div className="flex gap-3">
                        <button onClick={() => { setStreamError(null); startListening(); }} className="px-6 py-3 bg-white text-black font-bold rounded-full hover:scale-105 transition-transform">Try Again</button>
                        <button onClick={() => { setStreamError(null); setMicStatus('not-started'); }} className="px-6 py-3 bg-white/10 text-white font-bold rounded-full hover:bg-white/15 transition-colors border border-white/10">Close</button>
                    </div>
                </div>
            )}
        </div>
    );
};

const PegZone = ({ note, state, onClick, isRight }: { note: string, state: any, onClick: () => void, isRight?: boolean }) => {
    return (
        <button
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className={`
                relative w-14 h-14 rounded-full flex items-center justify-center group font-black text-lg transition-all active:scale-95
                ${state.isActive
                    ? (state.isLocked
                        ? 'bg-emerald-400/90 text-black shadow-[0_0_30px_rgba(52,211,153,0.5)]'
                        : 'bg-amber-400/90 text-black shadow-[0_0_30px_rgba(245,158,11,0.4)]')
                    : 'bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white border border-white/[0.08] hover:border-white/20 backdrop-blur-lg'}
                ${isRight ? 'ml-auto' : 'mr-auto'}
             `}
            style={{
                transform: state.isActive ? 'rotate(15deg)' : 'rotate(0deg)',
                transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
            }}
        >
            {note.replace(/[0-9]/, '')}
        </button>
    )
}

export default GuitarTuner;
