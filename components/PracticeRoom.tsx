
import React, { useState, useRef, useEffect } from 'react';
import { Camera, StopCircle, Mic, Play, Pause, Trash2, Download, Video, List, X, Loader2, Settings2, Music, Minus, Plus, GripVertical, GripHorizontal, EyeOff, Sparkles, Sliders, Wand2, Monitor, ChevronDown, ChevronUp, Sun, ArrowLeft, Eye } from 'lucide-react';
import { Song } from '../types';
import { getSongs } from '../services/storageService';
import { saveRecording, getRecordings, deleteRecording, Recording, MAX_LOCAL_RECORDINGS, RecordingQuotaError } from '../services/recordingDb';

interface PracticeRoomProps {
    isTourMode?: boolean;
    initialSong?: Song;
    onBack?: () => void;
}

type VideoFilter = 'none' | 'warm' | 'stage' | 'noir' | 'soft';
type NoiseReductionLevel = 'low' | 'medium' | 'high';

const PRACTICE_ROOM_STATE_KEY = 'plectrum_practice_room_state_v1';

type PersistedPracticeRoomState = {
  selectedSongId?: string;
  activeFilter?: VideoFilter;
  bgBlur?: boolean;
  ringLight?: boolean;
  studioAudio?: boolean;
  noiseReduction?: NoiseReductionLevel;
  inputBoost?: number;
  deepDenoise?: boolean;
  splitRatio?: number;
  isVaultOpen?: boolean;
  scrollSpeed?: number;
  fontSize?: number;
};

const readPracticeRoomState = (): PersistedPracticeRoomState => {
  try {
    return JSON.parse(localStorage.getItem(PRACTICE_ROOM_STATE_KEY) || '{}');
  } catch {
    return {};
  }
};

const clampNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const formatSpeed = (speed: number) => speed.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');

const resolveInitialSong = (initialSong?: Song) => {
  if (initialSong) return initialSong;
  const persisted = readPracticeRoomState();
  if (!persisted.selectedSongId) return null;
  return getSongs().find(song => String(song.id) === String(persisted.selectedSongId)) || null;
};

const PracticeRoom: React.FC<PracticeRoomProps> = ({ isTourMode = false, initialSong, onBack }) => {
  const persistedState = useRef<PersistedPracticeRoomState>(readPracticeRoomState());
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [timer, setTimer] = useState(0);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [previewRecording, setPreviewRecording] = useState<Recording | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [selectedSong, setSelectedSong] = useState<Song | null>(() => resolveInitialSong(initialSong));
  const [showSongSelector, setShowSongSelector] = useState(false);
  
  // Studio Settings
  const [showSettings, setShowSettings] = useState(false);
  const [activeFilter, setActiveFilter] = useState<VideoFilter>(() => persistedState.current.activeFilter || 'none');
  const [bgBlur, setBgBlur] = useState(() => Boolean(persistedState.current.bgBlur));
  const [ringLight, setRingLight] = useState(() => Boolean(persistedState.current.ringLight));
  const [studioAudio, setStudioAudio] = useState(() => persistedState.current.studioAudio !== false);
  const [noiseReduction, setNoiseReduction] = useState<NoiseReductionLevel>(() => persistedState.current.noiseReduction || (persistedState.current.deepDenoise ? 'high' : 'medium'));
  const [inputBoost, setInputBoost] = useState(() => clampNumber(persistedState.current.inputBoost, 1.08, 0.75, 1.6));
  const [studioWarning, setStudioWarning] = useState('');
  
  // Layout State
  const [splitRatio, setSplitRatio] = useState(() => clampNumber(persistedState.current.splitRatio, 45, 20, 80)); // % for Video
  const [isLandscape, setIsLandscape] = useState(true);
  const [isVaultOpen, setIsVaultOpen] = useState(() => persistedState.current.isVaultOpen !== false); 
  
  // Teleprompter State
  const [isScrolling, setIsScrolling] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(() => clampNumber(persistedState.current.scrollSpeed, 1, 0.5, 3));
  const [fontSize, setFontSize] = useState(() => clampNumber(persistedState.current.fontSize, 20, 12, 32));
  const lyricsRef = useRef<HTMLDivElement>(null);
  const scrollIntervalRef = useRef<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null); // New Canvas Ref for processing
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const recordingAudioContextRef = useRef<AudioContext | null>(null);
  const recordingAudioNodesRef = useRef<AudioNode[]>([]);
  const recordingAnimationFrameRef = useRef<number | null>(null);
  const recordingOutputStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
      if (initialSong) setSelectedSong(initialSong);
  }, [initialSong]);

  useEffect(() => {
      localStorage.setItem(PRACTICE_ROOM_STATE_KEY, JSON.stringify({
          selectedSongId: selectedSong?.id,
          activeFilter,
          bgBlur,
          ringLight,
          studioAudio,
          noiseReduction,
          inputBoost,
          splitRatio,
          isVaultOpen,
          scrollSpeed,
          fontSize
      }));
  }, [selectedSong?.id, activeFilter, bgBlur, ringLight, studioAudio, noiseReduction, inputBoost, splitRatio, isVaultOpen, scrollSpeed, fontSize]);

  useEffect(() => {
      if (lyricsRef.current) lyricsRef.current.scrollTop = 0;
      setIsScrolling(false);
  }, [selectedSong?.id]);

  useEffect(() => {
      if (!previewRecording) {
          setPreviewUrl('');
          return;
      }

      const url = URL.createObjectURL(previewRecording.blob);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
  }, [previewRecording]);

  // Canvas Drawing Loop (The Magic for Filters)
  useEffect(() => {
    const draw = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        
        if (video && canvas && stream && video.readyState === 4) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                // Resize canvas to match video stream resolution
                if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                }

                const w = canvas.width;
                const h = canvas.height;

                // 1. CLEAR
                ctx.clearRect(0, 0, w, h);

                // 2. DEFINE FILTERS
                let filterString = 'none';
                if (activeFilter === 'warm') filterString = 'sepia(0.3) saturate(1.4) contrast(1.1)';
                else if (activeFilter === 'stage') filterString = 'hue-rotate(190deg) saturate(0.6) contrast(1.2)';
                else if (activeFilter === 'noir') filterString = 'grayscale(100%) contrast(1.2)';
                else if (activeFilter === 'soft') filterString = 'brightness(1.1) contrast(0.9) saturate(0.8)';

                // 3. DRAW VIDEO
                ctx.save();
                
                // Mirror effect
                ctx.translate(w, 0);
                ctx.scale(-1, 1);
                
                if (bgBlur) {
                    // Portrait Mode Simulation
                    // A. Draw Blurred Background
                    ctx.filter = `${filterString} blur(8px)`;
                    ctx.drawImage(video, 0, 0, w, h);
                    
                    // B. Draw Sharp Center Circle (Focus Area)
                    ctx.filter = filterString;
                    ctx.beginPath();
                    // Oval shape for portrait focus
                    ctx.ellipse(w / 2, h / 2, w / 2.5, h / 1.8, 0, 0, Math.PI * 2);
                    ctx.clip();
                    ctx.drawImage(video, 0, 0, w, h);
                } else {
                    // Standard Draw
                    ctx.filter = filterString;
                    ctx.drawImage(video, 0, 0, w, h);
                }
                
                ctx.restore();

                // NOTE: Ring Light logic removed from here so it is NOT recorded.
                // It is now handled via a CSS overlay in the render return.
            }
        }
        animationFrameRef.current = requestAnimationFrame(draw);
    };

    if (stream) {
        draw();
    }

    return () => {
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [stream, activeFilter, bgBlur]); // Removed ringLight dependency from draw loop

  useEffect(() => {
    const checkOrientation = () => {
        const hasTabletWidth = window.innerWidth >= 768;
        const landscapeLayout = hasTabletWidth && window.innerWidth > window.innerHeight;
        setIsLandscape(landscapeLayout);
        if (!landscapeLayout) {
            setSplitRatio(ratio => Math.min(65, Math.max(35, ratio)));
        }
    };
    
    checkOrientation();
    window.addEventListener('resize', checkOrientation);

    if (isTourMode) return () => window.removeEventListener('resize', checkOrientation);

    let activeStream: MediaStream | null = null;
    const getCameraStream = async () => {
      const audioConstraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48000 },
          sampleSize: { ideal: 16 }
      };

      const attempts: MediaStreamConstraints[] = [
        {
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30, max: 30 },
            aspectRatio: { ideal: 16 / 9 },
            facingMode: 'user'
          },
          audio: audioConstraints
        },
        {
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
            aspectRatio: { ideal: 16 / 9 },
            facingMode: 'user'
          },
          audio: audioConstraints
        },
        {
          video: { facingMode: 'user' },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        },
        { video: true, audio: true }
      ];

      let lastError: unknown = null;
      for (const constraints of attempts) {
        try {
          return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    };

    const startCamera = async () => {
      try {
        const s = await getCameraStream();
        activeStream = s;
        setStream(s);
        setStudioWarning('');
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      } catch (err) {
        setStudioWarning('Camera or microphone access failed. Check browser permissions and try again.');
        if (import.meta.env.DEV) console.warn("Camera access denied", err);
      }
    };
    
    startCamera();
    loadRecordings();

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
      setStream(null);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (scrollIntervalRef.current) cancelAnimationFrame(scrollIntervalRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      cleanupRecordingAudio();
      window.removeEventListener('resize', checkOrientation);
    };
  }, [isTourMode]);

  useEffect(() => {
      if (isScrolling) {
          let lastFrame = performance.now();
          const scrollLoop = (frameTime: number) => {
              const deltaSeconds = Math.min(Math.max(0, (frameTime - lastFrame) / 1000), 0.05);
              lastFrame = frameTime;
              if (lyricsRef.current) {
                  if (lyricsRef.current.scrollTop + lyricsRef.current.clientHeight >= lyricsRef.current.scrollHeight - 1) {
                      setIsScrolling(false);
                      return;
                  }
                  lyricsRef.current.scrollTop += scrollSpeed * 42 * deltaSeconds;
              }
              scrollIntervalRef.current = requestAnimationFrame(scrollLoop);
          };
          scrollIntervalRef.current = requestAnimationFrame(scrollLoop);
      } else {
          if (scrollIntervalRef.current) cancelAnimationFrame(scrollIntervalRef.current);
      }
      return () => { if (scrollIntervalRef.current) cancelAnimationFrame(scrollIntervalRef.current); };
  }, [isScrolling, scrollSpeed]);

  const loadRecordings = async () => {
    const recs = await getRecordings();
    setRecordings(recs.sort((a, b) => b.createdAt - a.createdAt));
  };

  const createSoftLimiterCurve = () => {
      const samples = 2048;
      const curve = new Float32Array(samples);
      const drive = 2.1;
      const normalizer = Math.tanh(drive);
      for (let i = 0; i < samples; i += 1) {
          const x = (i / (samples - 1)) * 2 - 1;
          curve[i] = Math.tanh(x * drive) / normalizer;
      }
      return curve;
  };

  const cleanupRecordingAudio = () => {
      if (recordingAnimationFrameRef.current) {
          cancelAnimationFrame(recordingAnimationFrameRef.current);
          recordingAnimationFrameRef.current = null;
      }
      if (recordingOutputStreamRef.current) {
          recordingOutputStreamRef.current.getTracks().forEach(track => track.stop());
          recordingOutputStreamRef.current = null;
      }
      recordingAudioNodesRef.current.forEach(node => {
          try { node.disconnect(); } catch {}
      });
      recordingAudioNodesRef.current = [];
      if (recordingAudioContextRef.current && recordingAudioContextRef.current.state !== 'closed') {
          recordingAudioContextRef.current.close().catch(() => {});
      }
      recordingAudioContextRef.current = null;
  };

  const getNoiseProfile = () => {
      if (noiseReduction === 'high') {
          return { threshold: 0.017, floor: 0.42, attack: 0.035, release: 0.36, highPass: 88, compressorThreshold: -25, ratio: 3.4 };
      }
      if (noiseReduction === 'low') {
          return { threshold: 0.009, floor: 0.68, attack: 0.025, release: 0.5, highPass: 72, compressorThreshold: -20, ratio: 2.4 };
      }
      return { threshold: 0.013, floor: 0.55, attack: 0.03, release: 0.42, highPass: 80, compressorThreshold: -23, ratio: 2.9 };
  };

  const startGentleExpander = (ctx: AudioContext, analyser: AnalyserNode, gateGain: GainNode) => {
      const profile = getNoiseProfile();
      const samples = new Float32Array(analyser.fftSize);
      let smoothedGain = 1;

      const tick = () => {
          analyser.getFloatTimeDomainData(samples);
          let sumSquares = 0;
          for (let i = 0; i < samples.length; i += 1) {
              sumSquares += samples[i] * samples[i];
          }
          const rms = Math.sqrt(sumSquares / samples.length);
          const targetGain = rms < profile.threshold ? profile.floor : 1;
          const coefficient = targetGain > smoothedGain ? profile.attack : profile.release;
          smoothedGain += (targetGain - smoothedGain) * coefficient;
          gateGain.gain.setTargetAtTime(smoothedGain, ctx.currentTime, 0.035);
          recordingAnimationFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
  };

  const createEnhancedAudioStream = (inputStream: MediaStream): MediaStream | null => {
      const audioTrack = inputStream.getAudioTracks()[0];
      if (!audioTrack) return null;

      cleanupRecordingAudio();
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return null;

      try {
          const ctx = new AudioContextClass({ latencyHint: 'interactive', sampleRate: 48000 });
          recordingAudioContextRef.current = ctx;
          const profile = getNoiseProfile();

          const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
          const highPass = ctx.createBiquadFilter();
          highPass.type = 'highpass';
          highPass.frequency.value = profile.highPass;
          highPass.Q.value = 0.72;

          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          analyser.smoothingTimeConstant = 0.72;

          const gateGain = ctx.createGain();
          gateGain.gain.value = 1;

          const hum50 = ctx.createBiquadFilter();
          hum50.type = 'notch';
          hum50.frequency.value = 50;
          hum50.Q.value = 16;

          const hum60 = ctx.createBiquadFilter();
          hum60.type = 'notch';
          hum60.frequency.value = 60;
          hum60.Q.value = 16;

          const lowShelf = ctx.createBiquadFilter();
          lowShelf.type = 'lowshelf';
          lowShelf.frequency.value = 170;
          lowShelf.gain.value = noiseReduction === 'high' ? -1.8 : -1;

          const presence = ctx.createBiquadFilter();
          presence.type = 'peaking';
          presence.frequency.value = 3100;
          presence.Q.value = 0.9;
          presence.gain.value = 1.35;

          const air = ctx.createBiquadFilter();
          air.type = 'highshelf';
          air.frequency.value = 7600;
          air.gain.value = noiseReduction === 'high' ? 0.7 : 1.1;

          const lowPass = ctx.createBiquadFilter();
          lowPass.type = 'lowpass';
          lowPass.frequency.value = noiseReduction === 'high' ? 15000 : 17000;
          lowPass.Q.value = 0.65;

          const compressor = ctx.createDynamicsCompressor();
          compressor.threshold.value = profile.compressorThreshold;
          compressor.knee.value = 24;
          compressor.ratio.value = profile.ratio;
          compressor.attack.value = 0.008;
          compressor.release.value = 0.22;

          const makeup = ctx.createGain();
          makeup.gain.value = inputBoost;

          const limiter = ctx.createWaveShaper();
          limiter.curve = createSoftLimiterCurve();
          limiter.oversample = '2x';

          const ceiling = ctx.createGain();
          ceiling.gain.value = 0.92;

          const destination = ctx.createMediaStreamDestination();
          source.connect(highPass);
          highPass.connect(analyser);
          highPass
              .connect(gateGain)
              .connect(hum50)
              .connect(hum60)
              .connect(lowShelf)
              .connect(presence)
              .connect(air)
              .connect(lowPass)
              .connect(compressor)
              .connect(makeup)
              .connect(limiter)
              .connect(ceiling)
              .connect(destination);

          recordingAudioNodesRef.current = [
              source, highPass, analyser, gateGain, hum50, hum60, lowShelf, presence, air, lowPass,
              compressor, makeup, limiter, ceiling, destination
          ];

          startGentleExpander(ctx, analyser, gateGain);
          if (ctx.state === 'suspended') ctx.resume().catch(() => {});
          recordingOutputStreamRef.current = destination.stream;
          setStudioWarning('');
          return destination.stream;
      } catch (error) {
          cleanupRecordingAudio();
          setStudioWarning('Advanced studio processing is not available in this browser. Recording with normal mic audio.');
          if (import.meta.env.DEV) console.warn('Studio audio setup failed', error);
          return null;
      }
  };

  const startRecording = async () => {
    if (!stream || !canvasRef.current) return;
    const latestRecordings = await getRecordings();
    if (latestRecordings.length >= MAX_LOCAL_RECORDINGS) {
      setRecordings(latestRecordings.sort((a, b) => b.createdAt - a.createdAt));
      setIsVaultOpen(true);
      alert(`Local recording storage is full (${MAX_LOCAL_RECORDINGS}/${MAX_LOCAL_RECORDINGS}). Delete a recording before saving a new take.`);
      return;
    }
    
    // Capture stream from CANVAS (Video + Filters, but NO Ring Light overlay)
    const canvasStream = canvasRef.current.captureStream(30); // 30 FPS
    
    try {
        const audioStream = studioAudio ? createEnhancedAudioStream(stream) : null;
        const audioTracks = audioStream?.getAudioTracks().length ? audioStream.getAudioTracks() : stream.getAudioTracks();
        audioTracks.forEach(track => {
            canvasStream.addTrack(track);
        });
    } catch (error) {
        stream.getAudioTracks().forEach(track => canvasStream.addTrack(track));
        setStudioWarning('Studio audio could not be attached. Recording with normal mic audio.');
        if (import.meta.env.DEV) console.warn('Could not attach processed audio track', error);
    }

    chunksRef.current = [];
    const recorderOptions = [
        { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 5200000, audioBitsPerSecond: 192000 },
        { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 4200000, audioBitsPerSecond: 160000 },
        { mimeType: 'video/webm', videoBitsPerSecond: 3600000, audioBitsPerSecond: 160000 }
    ];
    const options = recorderOptions.find(option => MediaRecorder.isTypeSupported(option.mimeType)) || {
        videoBitsPerSecond: 3200000,
        audioBitsPerSecond: 128000
    };
        
    let recorder: MediaRecorder;
    try {
        recorder = new MediaRecorder(canvasStream, options);
    } catch (error) {
        if (import.meta.env.DEV) console.warn('High-quality MediaRecorder options failed, using browser defaults', error);
        recorder = new MediaRecorder(canvasStream);
        setStudioWarning('This browser ignored the high-quality recorder settings. Recording continues normally.');
    }
    
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      const newRecording: Recording = {
        id: Date.now().toString(),
        blob,
        createdAt: Date.now(),
        duration: timer,
        songTitle: selectedSong?.title || 'Freestyle Session'
      };
      try {
        await saveRecording(newRecording);
        await loadRecordings();
        setPreviewRecording(newRecording);
        setIsVaultOpen(true);
      } catch (error) {
        if (error instanceof RecordingQuotaError || String((error as Error)?.message || error).toLowerCase().includes('recording limit')) {
          await loadRecordings();
          setIsVaultOpen(true);
          alert(`Local recording storage is full (${MAX_LOCAL_RECORDINGS}/${MAX_LOCAL_RECORDINGS}). Delete a recording before saving a new take.`);
        } else {
          alert('Could not save this recording. Please try again.');
          if (import.meta.env.DEV) console.warn('Recording save failed', error);
        }
      }
      setTimer(0);
      cleanupRecordingAudio();
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
    if (selectedSong) setIsScrolling(true);
    setTimer(0);
    timerIntervalRef.current = window.setInterval(() => {
      setTimer(t => t + 1); 
    }, 1000);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsScrolling(false); 
      cleanupRecordingAudio();
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm("Delete this recording?")) {
      await deleteRecording(id);
      setRecordings(prev => prev.filter(r => r.id !== id));
      if (previewRecording?.id === id) setPreviewRecording(null);
    }
  };

  const handleDownload = (rec: Recording) => {
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `practice_${rec.songTitle}_${new Date(rec.createdAt).toISOString().slice(0,10)}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
      const isTouch = 'touches' in e;
      const startX = isTouch ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
      const startY = isTouch ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
      const startRatio = splitRatio;
      
      const onMove = (moveEvent: MouseEvent | TouchEvent) => {
          const currentX = 'touches' in moveEvent ? moveEvent.touches[0].clientX : (moveEvent as MouseEvent).clientX;
          const currentY = 'touches' in moveEvent ? moveEvent.touches[0].clientY : (moveEvent as MouseEvent).clientY;
          
          let deltaPercent = 0;
          
          if (isLandscape) {
             const deltaX = currentX - startX;
             deltaPercent = (deltaX / window.innerWidth) * 100;
          } else {
             const deltaY = currentY - startY;
             deltaPercent = (deltaY / window.innerHeight) * 100;
          }
          
          const minRatio = isLandscape ? 20 : 35;
          const maxRatio = isLandscape ? 80 : 65;
          setSplitRatio(Math.min(maxRatio, Math.max(minRatio, startRatio + deltaPercent)));
      };

      const onEnd = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onEnd);
          document.removeEventListener('touchmove', onMove);
          document.removeEventListener('touchend', onEnd);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove);
      document.addEventListener('touchend', onEnd);
  };

  interface SplitLine {
      lyrics: string;
      chords: string[];
  }

  const parseLineSplit = (line: string): SplitLine => {
      const chordMatches = line.match(/\[(.*?)\]/g);
      const chords = chordMatches ? chordMatches.map(c => c.replace(/[\[\]]/g, '')) : [];
      const lyrics = line.replace(/\[.*?\]/g, '').trim();
      return { lyrics, chords };
  };

  const renderSplitContent = (content: string) => {
      const lines = content.split(/\r?\n/);
      return lines.map((line, idx) => {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('###') || trimmedLine.endsWith(':')) {
               return (
                   <div key={idx} className="mt-8 mb-4 border-b-2 border-amber-900/50 pb-2">
                       <h3 className="text-amber-500 font-black uppercase tracking-[0.2em] text-sm font-display">{trimmedLine.replace(/###/g, '').replace(/:/g, '')}</h3>
                   </div>
               );
          }
          if (!trimmedLine) return <div key={idx} className="h-4"></div>;

          const split = parseLineSplit(line);

          return (
              <div key={idx} className="py-3 px-3 border-b border-white/5 hover:bg-white/5 transition-colors mb-2 rounded-xl flex gap-4 items-center">
                  <div 
                     className="w-[65%] font-sans whitespace-pre-wrap leading-relaxed tracking-wide text-amber-100"
                     style={{ fontSize: `${fontSize}px`, fontWeight: 700 }} 
                  >
                      {split.lyrics || '\u00A0'}
                  </div>

                  <div className="w-[35%] flex flex-wrap gap-2 justify-end items-center border-l-2 border-white/10 pl-3">
                      {split.chords.map((chord, cIdx) => (
                           <div 
                             key={cIdx}
                             className="px-2 py-1 bg-amber-950/50 text-amber-500 rounded border border-amber-900/50 font-mono font-bold text-center"
                             style={{ fontSize: `${Math.max(14, fontSize * 0.7)}px` }}
                           >
                               {chord}
                           </div>
                      ))}
                  </div>
              </div>
          );
      });
  };

  return (
    <div className={`flex h-[100dvh] w-full min-h-0 bg-[#0a0503] text-white overflow-hidden relative ${isLandscape ? 'flex-row' : 'flex-col'}`}>
      
      {/* Settings Backdrop - Click to Close */}
      {showSettings && (
         <div className="absolute inset-0 z-20" onClick={() => setShowSettings(false)}></div>
      )}

      {/* VIDEO SECTION */}
      <div 
        className="flex flex-col relative shrink-0 transition-all duration-75 ease-linear overflow-hidden min-h-0" 
        style={{ 
            width: isLandscape ? `${splitRatio}%` : '100%', 
            height: isLandscape ? '100%' : `${splitRatio}%` 
        }}
      >
        {/* Ring Light Overlay (Warm White, High Brightness) - OUTSIDE Canvas, INSIDE Container */}
        {ringLight && (
            <div 
                className="absolute inset-0 z-10 pointer-events-none transition-all duration-500"
                style={{
                    boxShadow: 'inset 0 0 40px 10px rgba(255, 248, 220, 0.6), inset 0 0 100px 30px rgba(255, 230, 200, 0.3)',
                    border: '20px solid rgba(255, 250, 240, 0.9)', // Warm White
                }}
            ></div>
        )}

        <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-start pointer-events-none">
             {onBack && (
                 <button 
                    onClick={onBack} 
                    className="bg-black/50 backdrop-blur-lg p-2 rounded-full border border-white/20 hover:bg-black/70 transition-colors pointer-events-auto mr-auto"
                 >
                     <ArrowLeft className="w-5 h-5 text-amber-100" />
                 </button>
             )}

             <div className="bg-red-900/90 px-5 py-2.5 rounded-full border-2 border-red-500/60 flex items-center gap-3 pointer-events-auto shadow-2xl backdrop-blur-sm scale-75 lg:scale-100 origin-top-left ml-auto mr-2">
                 <div className={`w-3.5 h-3.5 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-slate-600'}`}></div>
                 <span className="font-mono font-black text-lg">{formatTime(timer)}</span>
             </div>
             
             <div className="flex gap-2 pointer-events-auto scale-75 lg:scale-100 origin-top-right">
                 <button onClick={() => setShowSettings(!showSettings)} className="bg-black/50 backdrop-blur-lg p-2.5 rounded-xl border border-white/20 hover:bg-black/70 transition-colors">
                     <Sliders className="w-5 h-5 text-amber-100" />
                 </button>
             </div>
        </div>

        {/* Studio Settings Panel */}
        {showSettings && (
            <div className="absolute top-16 lg:top-20 right-4 z-30 bg-[#1a0f0a]/95 backdrop-blur-xl border border-[#5d4037] p-4 rounded-2xl shadow-2xl w-56 lg:w-64 animate-in slide-in-from-top-4 max-h-[60vh] overflow-y-auto custom-scrollbar" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4 pb-2 border-b border-[#3e2723]">
                    <h3 className="text-xs font-black uppercase text-amber-500 tracking-widest">Studio FX</h3>
                    <button onClick={() => setShowSettings(false)}><X className="w-4 h-4 text-amber-700 hover:text-white" /></button>
                </div>
                <div className="space-y-4">
                    <div>
                        <label className="text-[10px] uppercase font-bold text-amber-200/60 mb-2 block">Video Filters</label>
                        <div className="grid grid-cols-2 gap-2">
                             {(['none', 'warm', 'stage', 'noir', 'soft'] as VideoFilter[]).map(f => (
                                 <button 
                                    key={f}
                                    onClick={() => setActiveFilter(f)}
                                    className={`px-2 py-1.5 text-xs font-bold rounded border capitalize ${activeFilter === f ? 'bg-amber-600 border-amber-400 text-white' : 'bg-[#0f0a08] border-[#3e2723] text-amber-500 hover:border-amber-600'}`}
                                 >
                                     {f}
                                 </button>
                             ))}
                        </div>
                    </div>
                    <div>
                         <label className="text-[10px] uppercase font-bold text-amber-200/60 mb-2 block">Lighting & Privacy</label>
                         <div className="space-y-2">
                             <button onClick={() => setRingLight(!ringLight)} className={`w-full flex items-center justify-between px-3 py-2 rounded border text-xs font-bold transition-all ${ringLight ? 'bg-amber-900/40 border-amber-500 text-amber-200' : 'bg-[#0f0a08] border-[#3e2723] text-amber-700'}`}>
                                <span className="flex items-center gap-2"><Sun className="w-3 h-3"/> Ring Light (Warm)</span>
                                <div className={`w-8 h-4 rounded-full relative ${ringLight ? 'bg-amber-500' : 'bg-slate-700'}`}><div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${ringLight ? 'left-4.5' : 'left-0.5'}`}></div></div>
                             </button>
                             <button onClick={() => setBgBlur(!bgBlur)} className={`w-full flex items-center justify-between px-3 py-2 rounded border text-xs font-bold transition-all ${bgBlur ? 'bg-blue-900/40 border-blue-500 text-blue-400' : 'bg-[#0f0a08] border-[#3e2723] text-amber-700'}`}>
                                <span className="flex items-center gap-2"><Wand2 className="w-3 h-3"/> Portrait Blur</span>
                                <div className={`w-8 h-4 rounded-full relative ${bgBlur ? 'bg-blue-500' : 'bg-slate-700'}`}><div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${bgBlur ? 'left-4.5' : 'left-0.5'}`}></div></div>
                            </button>
                        </div>
                    </div>
                    <div>
                         <label className="text-[10px] uppercase font-bold text-amber-200/60 mb-2 block">Audio Studio</label>
                         <div className="space-y-2">
                             <button onClick={() => setStudioAudio(!studioAudio)} className={`w-full flex items-center justify-between px-3 py-2 rounded border text-xs font-bold transition-all ${studioAudio ? 'bg-emerald-900/40 border-emerald-500 text-emerald-300' : 'bg-[#0f0a08] border-[#3e2723] text-amber-700'}`}>
                                <span className="flex items-center gap-2"><Sparkles className="w-3 h-3"/> Studio Mode</span>
                                <div className={`w-8 h-4 rounded-full relative ${studioAudio ? 'bg-emerald-500' : 'bg-slate-700'}`}><div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${studioAudio ? 'left-4.5' : 'left-0.5'}`}></div></div>
                             </button>
                             <div className={`grid grid-cols-3 gap-1 ${!studioAudio ? 'opacity-40 pointer-events-none' : ''}`}>
                                {(['low', 'medium', 'high'] as NoiseReductionLevel[]).map(level => (
                                    <button
                                      key={level}
                                      onClick={() => setNoiseReduction(level)}
                                      className={`px-2 py-1.5 rounded border text-[10px] font-black uppercase transition-all ${noiseReduction === level ? 'bg-cyan-900/50 border-cyan-400 text-cyan-200' : 'bg-[#0f0a08] border-[#3e2723] text-amber-700'}`}
                                    >
                                      {level}
                                    </button>
                                ))}
                             </div>
                             <div className={`${!studioAudio ? 'opacity-40 pointer-events-none' : ''}`}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] uppercase font-bold text-amber-200/50">Input Boost</span>
                                    <span className="text-[10px] font-mono text-emerald-300">{inputBoost.toFixed(2)}x</span>
                                </div>
                                <input type="range" min="0.75" max="1.6" step="0.01" value={inputBoost} onChange={e => setInputBoost(clampNumber(e.target.value, 1.08, 0.75, 1.6))} className="w-full h-1 bg-slate-800 rounded-lg accent-emerald-500 cursor-pointer" />
                             </div>
                             {studioWarning && (
                                <p className="text-[10px] leading-relaxed text-amber-300/70 bg-amber-950/30 border border-amber-500/20 rounded-lg p-2">
                                    {studioWarning}
                                </p>
                             )}
                         </div>
                    </div>
                </div>
            </div>
        )}

        <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden border-b lg:border-b-0 lg:border-r border-[#3e2723]">
             {isTourMode ? (
                 <div className="flex flex-col items-center justify-center text-amber-500/50 gap-4">
                     <EyeOff className="w-16 h-16" />
                     <p className="text-sm font-bold uppercase tracking-widest">Camera Inactive During Tour</p>
                 </div>
             ) : (
                 <>
                    {/* Raw Video is hidden but playing to feed canvas */}
                    <video ref={videoRef} autoPlay muted playsInline className="absolute opacity-0 pointer-events-none w-1 h-1" />
                    
                    {/* Canvas draws the processed frames (WITH filters, WITHOUT ring light) */}
                    <canvas ref={canvasRef} className="w-full h-full object-cover" />

                    {!stream && <div className="absolute text-slate-500 text-sm">Camera Off</div>}
                 </>
             )}
        </div>

        <div className="h-16 sm:h-20 lg:h-24 bg-gradient-to-t from-[#0a0503] to-[#1a0f0a] border-t border-[#3e2723] flex items-center justify-center gap-4 sm:gap-8 relative z-30 shadow-[0_-10px_40px_rgba(0,0,0,0.6)] shrink-0">
             {!isRecording ? (
                 <button
                   id="tour-record-btn"
                   onClick={startRecording}
                   disabled={isTourMode || recordings.length >= MAX_LOCAL_RECORDINGS}
                   title={recordings.length >= MAX_LOCAL_RECORDINGS ? `Delete a recording to save a new take (${MAX_LOCAL_RECORDINGS}/${MAX_LOCAL_RECORDINGS} used)` : 'Start recording'}
                   className="w-14 h-14 lg:w-16 lg:h-16 rounded-full bg-red-600 hover:bg-red-500 border-4 border-red-800 shadow-[0_0_40px_rgba(220,38,38,0.5)] flex items-center justify-center transition-all active:scale-90 hover:scale-110 group disabled:opacity-50 disabled:cursor-not-allowed"
                 ><div className="w-5 h-5 lg:w-6 lg:h-6 bg-white rounded-full group-hover:scale-90 transition-transform"></div></button>
             ) : (
                 <button onClick={stopRecording} className="w-14 h-14 lg:w-16 lg:h-16 rounded-full bg-slate-800 border-4 border-red-500 flex items-center justify-center transition-all active:scale-90 hover:scale-110 shadow-[0_0_30px_rgba(239,68,68,0.3)]"><div className="w-5 h-5 lg:w-6 lg:h-6 bg-red-500 rounded-sm"></div></button>
             )}
        </div>
      </div>

      {/* RESIZER HANDLE */}
      <div 
         onMouseDown={handleDragStart}
         onTouchStart={handleDragStart}
         className={`z-50 bg-[#1a0f0a] border-[#3e2723] hover:bg-amber-600 cursor-pointer flex items-center justify-center transition-colors group touch-none select-none
            ${isLandscape ? 'w-3 border-l border-r cursor-col-resize h-full' : 'h-3 border-t border-b cursor-row-resize w-full'}
         `}
      >
          {isLandscape ? <GripVertical className="w-3 h-3 text-amber-900 group-hover:text-white" /> : <GripHorizontal className="w-3 h-3 text-amber-900 group-hover:text-white" />}
      </div>

      {/* TELEPROMPTER SECTION */}
      <div 
        className="flex flex-col shadow-2xl z-10 bg-[#160d0a] min-h-0" 
        style={{ 
            width: isLandscape ? `${100 - splitRatio}%` : '100%', 
            height: isLandscape ? '100%' : `${100 - splitRatio}%` 
        }}
      >
          <div className="p-2 border-b border-[#3e2723] bg-[#1a0f0a] flex flex-col gap-2 shadow-md shrink-0">
              <div className="flex justify-between items-center">
                <h3 className="font-black text-amber-500 uppercase tracking-[0.15em] text-[10px] flex items-center gap-2">
                    <List className="w-3.5 h-3.5" /> Teleprompter
                </h3>
                <button onClick={() => setShowSongSelector(true)} title="Change track" className="flex items-center gap-1.5 text-[10px] font-black text-amber-950 bg-amber-500 hover:bg-amber-400 uppercase tracking-widest px-3 py-1.5 rounded-lg shadow-md transition-colors active:scale-95">
                    <List className="w-3.5 h-3.5" /> {selectedSong ? 'Change Track' : 'Choose Track'}
                </button>
              </div>

              {selectedSong && (
                <div className="bg-black/70 p-2 rounded-xl border border-[#5d4037]/50 shadow-inner flex flex-col gap-2">
                     <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2">
                             <button onClick={() => setFontSize(Math.max(12, fontSize - 2))} className="p-1 bg-white/5 rounded text-amber-500"><Minus className="w-3 h-3"/></button>
                             <span className="text-[10px] text-amber-200 uppercase font-bold">Size</span>
                             <button onClick={() => setFontSize(Math.min(32, fontSize + 2))} className="p-1 bg-white/5 rounded text-amber-500"><Plus className="w-3 h-3"/></button>
                         </div>
                         <button 
                            onClick={() => setIsScrolling(!isScrolling)} 
                            className={`p-2 rounded-full transition-all active:scale-90 ${isScrolling ? 'bg-amber-600 text-white shadow-xl scale-105' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
                         >
                            {isScrolling ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                         </button>
                     </div>
                     <div className="flex items-center gap-3">
                        <input type="range" min="0.5" max="3" step="0.05" value={scrollSpeed} onChange={e => setScrollSpeed(clampNumber(e.target.value, 1, 0.5, 3))} aria-label="Scroll speed" className="w-full h-1 bg-slate-800 rounded-lg accent-amber-500 cursor-pointer" />
                        <span className="w-12 text-right text-[10px] font-black text-amber-400 tabular-nums">{formatSpeed(scrollSpeed)}x</span>
                     </div>
                </div>
              )}
          </div>

          <div 
            ref={lyricsRef}
            className="flex-1 overflow-y-auto overscroll-contain p-4 bg-[#0a0503] relative custom-scrollbar bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-black via-[#0a0503] to-black"
          >
              {selectedSong ? (
                  <div className="pb-[80vh]">
                      <div className="sticky top-0 bg-[#0a0503]/95 py-3 z-10 backdrop-blur-lg border-b border-amber-900/30 mb-4 text-center shadow-lg">
                          <h2 className="text-lg font-black text-amber-500 tracking-tight uppercase drop-shadow-sm truncate">{selectedSong.title}</h2>
                      </div>
                      <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                        {renderSplitContent(selectedSong.content)}
                      </div>
                  </div>
              ) : (
                  <div className="text-amber-900/30 text-center mt-10 flex flex-col items-center gap-4">
                      <div className="p-6 rounded-full bg-amber-950/10 border-2 border-dashed border-amber-900/20">
                        <Music className="w-10 h-10 opacity-30" />
                      </div>
                      <p className="font-black uppercase tracking-widest text-[10px] text-amber-500/70">No Track Loaded</p>
                      <button onClick={() => setShowSongSelector(true)} className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-amber-950 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg active:scale-95"><List className="w-4 h-4" /> Choose a song</button>
                  </div>
              )}
          </div>

          {/* Collapsible Practice Recordings */}
          <div className={`transition-all duration-300 border-t border-[#3e2723] bg-[#120b08] flex flex-col shadow-inner shrink-0 ${isVaultOpen ? 'h-44 md:h-60' : 'h-11'}`}>
             <div 
                className="px-3 py-2 border-b border-[#3e2723] bg-[#1a0f0a] flex items-center justify-between cursor-pointer hover:bg-[#221511] transition-colors"
                onClick={() => setIsVaultOpen(!isVaultOpen)}
             >
                 <div className="min-w-0">
                     <div className="text-[10px] font-black text-amber-500 uppercase tracking-[0.2em]">Practice Recordings</div>
                     <div className="text-[9px] text-amber-800/90 font-bold truncate">Preview or download saved takes • {recordings.length}/{MAX_LOCAL_RECORDINGS} stored locally</div>
                 </div>
                 {isVaultOpen ? <ChevronDown className="w-4 h-4 text-amber-700 shrink-0" /> : <ChevronUp className="w-4 h-4 text-amber-700 shrink-0" />}
             </div>
             
             {isVaultOpen && (
                 <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar animate-in fade-in">
                     {recordings.map(rec => (
                         <div key={rec.id} className="flex items-center justify-between p-2 bg-[#1a0f0a] rounded-lg border border-[#3e2723] group">
                             <div className="overflow-hidden">
                                 <div className="text-amber-200 text-[10px] font-bold truncate">{rec.songTitle}</div>
                                 <div className="text-[8px] text-amber-900 font-bold uppercase">{new Date(rec.createdAt).toLocaleDateString()} • {formatTime(rec.duration)}</div>
                             </div>
                             <div className="flex gap-1">
                                 <button onClick={() => setPreviewRecording(rec)} className="p-1.5 text-sky-400/80 hover:text-white rounded-md hover:bg-white/5" title="Preview recording"><Eye className="w-3.5 h-3.5" /></button>
                                 <button onClick={() => handleDownload(rec)} className="p-1.5 text-amber-500 hover:text-white rounded-md hover:bg-white/5" title="Download recording"><Download className="w-3.5 h-3.5" /></button>
                                 <button onClick={() => handleDelete(rec.id)} className="p-1.5 text-red-900 hover:text-red-500 rounded-md hover:bg-white/5" title="Delete recording"><Trash2 className="w-3.5 h-3.5" /></button>
                             </div>
                         </div>
                     ))}
                     {recordings.length === 0 && <p className="text-[10px] text-amber-900/60 text-center italic mt-4">No saved practice takes yet. Record once, then preview and download it here.</p>}
                 </div>
             )}
          </div>
      </div>

      {previewRecording && (
          <div className="absolute inset-0 z-[70] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4" onClick={() => setPreviewRecording(null)}>
              <div className="w-full max-w-3xl bg-[#120b08] border border-[#5d4037] rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  <div className="p-4 bg-[#1a0f0a] border-b border-[#3e2723] flex items-center justify-between gap-4">
                      <div className="min-w-0">
                          <h3 className="text-sm font-black text-amber-100 uppercase tracking-[0.18em] truncate">Preview Recording</h3>
                          <p className="text-[10px] text-amber-700 font-bold truncate">{previewRecording.songTitle || 'Practice Take'} • {formatTime(previewRecording.duration)}</p>
                      </div>
                      <button onClick={() => setPreviewRecording(null)} className="p-2 text-amber-600 hover:text-white rounded-lg hover:bg-white/5 transition-colors"><X className="w-5 h-5" /></button>
                  </div>
                  <div className="bg-black">
                      {previewUrl && (
                          <video src={previewUrl} controls playsInline className="w-full max-h-[70vh] bg-black" />
                      )}
                  </div>
                  <div className="p-4 bg-[#1a0f0a] border-t border-[#3e2723] flex justify-end gap-3">
                      <button onClick={() => setPreviewRecording(null)} className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-amber-200 text-xs font-black uppercase tracking-widest transition-colors">Close</button>
                      <button onClick={() => handleDownload(previewRecording)} className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-black uppercase tracking-widest transition-colors flex items-center gap-2"><Download className="w-4 h-4" /> Download</button>
                  </div>
              </div>
          </div>
      )}

      {showSongSelector && (
          <div className="absolute inset-0 z-50 bg-black/95 backdrop-blur-xl flex items-center justify-center p-4">
              <div className="bg-[#1a0f0a] border border-[#5d4037] rounded-3xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl">
                  <div className="p-4 border-b border-[#5d4037] flex justify-between items-center bg-[#2d1b15] rounded-t-3xl">
                      <h3 className="font-black text-amber-100 uppercase tracking-[0.2em] text-xs">Library</h3>
                      <button onClick={() => setShowSongSelector(false)} className="text-amber-700 hover:text-white"><X className="w-5 h-5" /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                      {getSongs().map(song => (
                          <button 
                            key={song.id}
                            onClick={() => { setSelectedSong(song); setShowSongSelector(false); }}
                            className="w-full text-left p-4 hover:bg-[#3e2723] rounded-2xl border-b border-[#2d1b15] mb-2"
                          >
                              <div className="text-amber-200 font-bold text-sm">{song.title}</div>
                              <div className="text-[10px] text-amber-700 font-bold uppercase tracking-widest">{song.artist}</div>
                          </button>
                      ))}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default PracticeRoom;
