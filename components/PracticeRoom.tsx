
import React, { useState, useRef, useEffect } from 'react';
import { Camera, StopCircle, Mic, Play, Pause, Trash2, Download, Video, List, X, Loader2, Settings2, Music, Minus, Plus, GripVertical, GripHorizontal, EyeOff, Sparkles, Sliders, Wand2, Monitor, ChevronDown, ChevronUp, Sun, ArrowLeft } from 'lucide-react';
import { Song } from '../types';
import { getSongs } from '../services/storageService';
import { saveRecording, getRecordings, deleteRecording, Recording } from '../services/recordingDb';

interface PracticeRoomProps {
    isTourMode?: boolean;
    initialSong?: Song;
    onBack?: () => void;
}

type VideoFilter = 'none' | 'warm' | 'stage' | 'noir' | 'soft';

const PracticeRoom: React.FC<PracticeRoomProps> = ({ isTourMode = false, initialSong, onBack }) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [timer, setTimer] = useState(0);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(initialSong || null);
  const [showSongSelector, setShowSongSelector] = useState(false);
  
  // Studio Settings
  const [showSettings, setShowSettings] = useState(false);
  const [activeFilter, setActiveFilter] = useState<VideoFilter>('none');
  const [bgBlur, setBgBlur] = useState(false);
  const [ringLight, setRingLight] = useState(false);
  
  // Layout State
  const [splitRatio, setSplitRatio] = useState(45); // % for Video
  const [isLandscape, setIsLandscape] = useState(true);
  const [isVaultOpen, setIsVaultOpen] = useState(true); 
  
  // Teleprompter State
  const [isScrolling, setIsScrolling] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(1);
  const [fontSize, setFontSize] = useState(20);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const scrollIntervalRef = useRef<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null); // New Canvas Ref for processing
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
      if (initialSong) setSelectedSong(initialSong);
  }, [initialSong]);

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
    const startCamera = async () => {
      try {
        // High quality constraints
        const s = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, 
            audio: { echoCancellation: true, noiseSuppression: true } 
        });
        activeStream = s;
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      } catch (err) {
        console.error("Camera access denied", err);
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
      window.removeEventListener('resize', checkOrientation);
    };
  }, [isTourMode]);

  useEffect(() => {
      if (isScrolling) {
          let lastFrame = performance.now();
          const scrollLoop = (frameTime: number) => {
              const deltaSeconds = Math.max(0, (frameTime - lastFrame) / 1000);
              lastFrame = frameTime;
              if (lyricsRef.current) {
                  if (lyricsRef.current.scrollTop + lyricsRef.current.clientHeight >= lyricsRef.current.scrollHeight - 1) {
                      setIsScrolling(false);
                      return;
                  }
                  lyricsRef.current.scrollTop += scrollSpeed * 18 * deltaSeconds;
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

  const startRecording = () => {
    if (!stream || !canvasRef.current) return;
    
    // Capture stream from CANVAS (Video + Filters, but NO Ring Light overlay)
    const canvasStream = canvasRef.current.captureStream(30); // 30 FPS
    
    // Add audio tracks from original stream (Canvas has no audio)
    stream.getAudioTracks().forEach(track => {
        canvasStream.addTrack(track);
    });

    chunksRef.current = [];
    // Prioritize high quality codecs
    const options = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') 
        ? { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 2500000 } 
        : { mimeType: 'video/webm', videoBitsPerSecond: 2500000 };
        
    const recorder = new MediaRecorder(canvasStream, options);
    
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
      await saveRecording(newRecording);
      setRecordings(prev => [newRecording, ...prev]);
      setTimer(0);
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
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm("Delete this recording?")) {
      await deleteRecording(id);
      setRecordings(prev => prev.filter(r => r.id !== id));
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
                 <button id="tour-record-btn" onClick={startRecording} disabled={isTourMode} className="w-14 h-14 lg:w-16 lg:h-16 rounded-full bg-red-600 hover:bg-red-500 border-4 border-red-800 shadow-[0_0_40px_rgba(220,38,38,0.5)] flex items-center justify-center transition-all active:scale-90 hover:scale-110 group disabled:opacity-50 disabled:cursor-not-allowed"><div className="w-5 h-5 lg:w-6 lg:h-6 bg-white rounded-full group-hover:scale-90 transition-transform"></div></button>
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
                <button onClick={() => setShowSongSelector(true)} className="text-[10px] font-black text-amber-200/50 hover:text-amber-300 uppercase tracking-widest underline transition-colors">Change Track</button>
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
                     <input type="range" min="0.1" max="5.0" step="0.1" value={scrollSpeed} onChange={e => setScrollSpeed(parseFloat(e.target.value))} className="w-full h-1 bg-slate-800 rounded-lg accent-amber-500 cursor-pointer" />
                </div>
              )}
          </div>

          <div 
            ref={lyricsRef}
            className="flex-1 overflow-y-auto p-4 bg-[#0a0503] relative scroll-smooth custom-scrollbar bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-black via-[#0a0503] to-black"
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
                      <p className="font-black uppercase tracking-widest text-[10px]">No Track Loaded</p>
                      <button onClick={() => setShowSongSelector(true)} className="px-6 py-2 bg-[#2d1b15] border border-[#5d4037] text-amber-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#3e2723] transition-all">Select</button>
                  </div>
              )}
          </div>

          {/* Collapsible Session Vault */}
          <div className={`transition-all duration-300 border-t border-[#3e2723] bg-[#120b08] flex flex-col shadow-inner shrink-0 ${isVaultOpen ? 'h-32 md:h-48' : 'h-8'}`}>
             <div 
                className="p-1.5 border-b border-[#3e2723] bg-[#1a0f0a] flex items-center justify-between cursor-pointer hover:bg-[#221511] transition-colors"
                onClick={() => setIsVaultOpen(!isVaultOpen)}
             >
                 <span className="text-[9px] font-black text-amber-800 uppercase tracking-[0.25em]">Vault</span>
                 {isVaultOpen ? <ChevronDown className="w-3 h-3 text-amber-800" /> : <ChevronUp className="w-3 h-3 text-amber-800" />}
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
                                 <button onClick={() => handleDownload(rec)} className="p-1 text-amber-600 hover:text-white"><Download className="w-3 h-3" /></button>
                                 <button onClick={() => handleDelete(rec.id)} className="p-1 text-red-900 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                             </div>
                         </div>
                     ))}
                     {recordings.length === 0 && <p className="text-[9px] text-amber-900/40 text-center italic mt-2">No recordings.</p>}
                 </div>
             )}
          </div>
      </div>

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
