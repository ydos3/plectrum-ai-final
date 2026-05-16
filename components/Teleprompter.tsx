
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Song, Handedness } from '../types';
import { Play, Pause, X, Layout, Search, ExternalLink, ArrowRight, AlertCircle, Youtube, Minus, Plus, Loader2, Music, RefreshCw, Mic2, Merge, ArrowLeft, Activity, Timer } from 'lucide-react';
import { getChordFingering } from '../services/chordService';
import { getYouTubeVideoId } from '../services/geminiService';
import { extractYouTubeVideoId, getYouTubeSearchUrl, searchYouTubeSource, toYouTubeWatchUrl, YouTubeSource, YouTubeSourceType } from '../services/youtubeService';
import GuitarFretboard from './GuitarFretboard';

interface TeleprompterProps {
  song: Song;
  onClose: () => void;
}

const TELEPROMPTER_STATE_KEY = 'plectrum_teleprompter_state_v1';

type SourceStep = {
  level: number;
  sourceType: YouTubeSourceType;
  label: string;
  buildQuery: (song: Song) => string;
};

const SOURCE_STEPS: SourceStep[] = [
  { level: 1, sourceType: 'Original', label: 'Original', buildQuery: song => `${song.title} ${song.artist} official video` },
  { level: 2, sourceType: 'Official Audio', label: 'Official Audio', buildQuery: song => `${song.title} ${song.artist} official audio` },
  { level: 3, sourceType: 'Lyric Video', label: 'Lyric Video', buildQuery: song => `${song.title} ${song.artist} lyric video` },
  { level: 4, sourceType: 'Original', label: 'Verified Music', buildQuery: song => `${song.title} ${song.artist} official music` },
  { level: 5, sourceType: 'Karaoke', label: 'Karaoke', buildQuery: song => `${song.title} ${song.artist} karaoke` },
  { level: 6, sourceType: 'Instrumental', label: 'Instrumental', buildQuery: song => `${song.title} ${song.artist} instrumental` },
  { level: 7, sourceType: 'Cover', label: 'Backing Track', buildQuery: song => `${song.title} ${song.artist} backing track` },
  { level: 8, sourceType: 'Fallback', label: 'Fallback', buildQuery: song => `${song.title} ${song.artist}` }
];

const DIRECT_SOURCE_LEVEL = 0;

type PersistedTeleprompterState = {
  karaokeEnabled?: boolean;
  playbackSpeed?: number;
  fontSize?: number;
  handedness?: Handedness;
  syncOffset?: number;
  splitRatio?: number;
};

const readTeleprompterState = (): PersistedTeleprompterState => {
  try {
    return JSON.parse(localStorage.getItem(TELEPROMPTER_STATE_KEY) || '{}');
  } catch {
    return {};
  }
};

const clampNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const parseDurationSeconds = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds > 0 ? seconds : null;
  }

  const parts = trimmed.split(':').map(part => Number(part));
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some(part => !Number.isFinite(part) || part < 0)
  ) {
    return null;
  }

  const seconds = parts.reduce((total, part) => (total * 60) + part, 0);
  return seconds > 0 ? seconds : null;
};

const getSongMetadataDuration = (song: Song): number | null => {
  const data = song as any;
  return [
    data.duration,
    data.durationSeconds,
    data.songDuration,
    data.videoDuration,
    data.metadata?.duration,
    data.metadata?.durationSeconds,
    data.extractedMetadata?.duration,
    data.extractedMetadata?.durationSeconds
  ].map(parseDurationSeconds).find((duration): duration is number => !!duration) || null;
};

const estimateDurationFromLyrics = (content: string) => {
  const lyricLines = content
    .split(/\r?\n/)
    .map(line => line.replace(/\[.*?\]/g, '').replace(/^#+\s*/, '').trim())
    .filter(Boolean);
  const wordCount = lyricLines.join(' ').split(/\s+/).filter(Boolean).length;
  return Math.max(240, lyricLines.length * 5.5, wordCount * 0.75);
};

const getInitialDuration = (song: Song) => (
  getSongMetadataDuration(song) || estimateDurationFromLyrics(song.content || '')
);

const Teleprompter: React.FC<TeleprompterProps> = ({ song, onClose }) => {
  const persistedState = useRef<PersistedTeleprompterState>(readTeleprompterState());
  const [karaokeEnabled, setKaraokeEnabled] = useState(() => Boolean(persistedState.current.karaokeEnabled));
  const [playbackSpeed, setPlaybackSpeed] = useState(() => clampNumber(persistedState.current.playbackSpeed, 1, 0.1, 3));
  
  // SPOTIFY-STYLE SCROLL STATE
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const [fontSize, setFontSize] = useState(() => clampNumber(persistedState.current.fontSize, 24, 16, 72)); 
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  const [handedness, setHandedness] = useState<Handedness>(() => persistedState.current.handedness === 'Left' ? 'Left' : 'Right');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lineFillRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollTimerRef = useRef<number | null>(null);
  const currentTimeRef = useRef<number>(0);
  const activeLineIndexRef = useRef<number>(-1);
  const manualScrollHoldUntilRef = useRef(0);
  const programmaticScrollUntilRef = useRef(0);
  const autoScrollCurrentRef = useRef<number | null>(null);
  const lineCenterCacheRef = useRef<Map<number, number>>(new Map());
  const lastClockStateSyncRef = useRef(0);
  const videoAnchorRef = useRef({ videoTime: 0, lyricTime: 0 });

  // KARAOKE/YOUTUBE STATE
  const [currentTime, setCurrentTime] = useState(0);
  const [actualDuration, setActualDuration] = useState(() => getInitialDuration(song));
  const [videoUrl, setVideoUrl] = useState(song.karaokeUrl || '');
  const [searchQuery, setSearchQuery] = useState(`${song.title} ${song.artist} karaoke`);
  const [videoError, setVideoError] = useState(false);
  const [videoErrorMessage, setVideoErrorMessage] = useState('');
  const [playerReady, setPlayerReady] = useState(false);
  const [isMashupMode, setIsMashupMode] = useState(false);
  const [syncOffset, setSyncOffset] = useState(() => clampNumber(persistedState.current.syncOffset, 0, -30, 30));

  // Resizable split pane: ratio is the lyrics panel width (0.3 – 0.8)
  const [splitRatio, setSplitRatio] = useState(() => clampNumber(persistedState.current.splitRatio, 0.67, 0.3, 0.8));
  const isDraggingSplitRef = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  const [fallbackLevel, setFallbackLevel] = useState(1); 
  const [iframeKey, setIframeKey] = useState(0); 
  const [dynamicVideoId, setDynamicVideoId] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<YouTubeSource | null>(null);
  const [isFetchingId, setIsFetchingId] = useState(false);
  
  const playerRef = useRef<any>(null);
  const intervalRef = useRef<number | null>(null);
  const youtubeHostRef = useRef<HTMLDivElement | null>(null);
  const activeVideoId = (fallbackLevel === DIRECT_SOURCE_LEVEL && !isMashupMode)
    ? extractYouTubeVideoId(videoUrl)
    : dynamicVideoId;
  const activeStep = SOURCE_STEPS.find(step => step.level === fallbackLevel);
  const sourceLabel = fallbackLevel === DIRECT_SOURCE_LEVEL ? 'Original' : (activeSource?.sourceType || activeStep?.label || 'Fallback');
  const sourceChannelName = fallbackLevel === DIRECT_SOURCE_LEVEL
    ? 'Direct YouTube link'
    : (activeSource?.channelName || 'YouTube');

  useEffect(() => {
    localStorage.setItem(TELEPROMPTER_STATE_KEY, JSON.stringify({
      karaokeEnabled,
      playbackSpeed,
      fontSize,
      handedness,
      syncOffset,
      splitRatio
    }));
  }, [karaokeEnabled, playbackSpeed, fontSize, handedness, syncOffset, splitRatio]);

  // ─── Resizable Split Drag Handlers ─────────────────────────────────

  const handleSplitPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDraggingSplitRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleSplitPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingSplitRef.current || !splitContainerRef.current) return;
    const rect = splitContainerRef.current.getBoundingClientRect();
    const ratio = Math.min(0.8, Math.max(0.3, (e.clientX - rect.left) / rect.width));
    setSplitRatio(ratio);
  }, []);

  const handleSplitPointerUp = useCallback(() => {
    isDraggingSplitRef.current = false;
  }, []);

  useEffect(() => {
    activeLineIndexRef.current = activeLineIndex;
  }, [activeLineIndex]);

  // ─── Parse Song Content ────────────────────────────────────────────

  interface ParsedLine {
    type: 'header' | 'lyrics' | 'empty';
    text: string;
    chords: string[];
    lyricsOnly: string;
  }

  const parsedLines = useRef<ParsedLine[]>([]);

  const parseContent = useCallback(() => {
    if (!song?.content) return [];
    
    const rawLines = song.content.split(/\r?\n/);
    const result: ParsedLine[] = [];

    for (const line of rawLines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('###') || trimmed.endsWith(':')) {
        result.push({
          type: 'header',
          text: trimmed.replace(/###/g, '').replace(/:/g, '').trim(),
          chords: [],
          lyricsOnly: ''
        });
      } else if (!trimmed) {
        result.push({ type: 'empty', text: '', chords: [], lyricsOnly: '' });
      } else {
        const chordMatches = trimmed.match(/\[(.*?)\]/g);
        const chords = chordMatches ? chordMatches.map(c => c.replace(/[\[\]]/g, '')) : [];
        const lyricsOnly = trimmed.replace(/\[.*?\]/g, '').trim();
        result.push({ type: 'lyrics', text: trimmed, chords, lyricsOnly });
      }
    }

    parsedLines.current = result;
    return result;
  }, [song.content]);

  useEffect(() => {
    parseContent();
    lineRefs.current = new Array(parsedLines.current.length).fill(null);
    lineFillRefs.current = new Array(parsedLines.current.length).fill(null);
    lineCenterCacheRef.current.clear();
  }, [parseContent]);

  // ─── Timed Lyrics Support ──────────────────────────────────────────

  const timedLyrics = song.timedLyrics;
  const hasTimedLyrics = timedLyrics && timedLyrics.length > 0;

  // ─── Spotify-Style Auto-Scroll Engine ──────────────────────────────

  const getLineTimings = useCallback((): number[] => {
    const lines = parsedLines.current;
    const totalLyricLines = lines.filter(l => l.type === 'lyrics').length;
    if (totalLyricLines === 0) return [];

    if (hasTimedLyrics && timedLyrics) {
      const normalize = (text: string) => text
        .replace(/\[.*?\]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      let lyricIdx = 0;
      const normalizedTimedLyrics = timedLyrics.map(item => ({
        ...item,
        normalizedText: normalize(item.text)
      }));

      return lines.map(line => {
        if (line.type !== 'lyrics') return -1;

        const normalizedLine = normalize(line.lyricsOnly || line.text);
        const matchingIdx = normalizedTimedLyrics.findIndex((item, idx) => (
          idx >= lyricIdx &&
          item.normalizedText &&
          normalizedLine &&
          (item.normalizedText === normalizedLine ||
            item.normalizedText.includes(normalizedLine) ||
            normalizedLine.includes(item.normalizedText))
        ));

        if (matchingIdx >= 0) {
          lyricIdx = matchingIdx + 1;
          return timedLyrics[matchingIdx].time;
        }

        if (lyricIdx < timedLyrics.length) {
          return timedLyrics[lyricIdx++].time;
        }
        return -1;
      });
    }

    // Uniform distribution with section pauses
    const duration = actualDuration;
    const introTime = Math.min(duration * 0.04, 8);
    const outroTime = Math.min(duration * 0.03, 6);
    const sectionCount = lines.filter(line => line.type === 'header').length;
    const effectiveDuration = Math.max(10, duration - introTime - outroTime);
    
    let currentTime = introTime;
    const baseDuration = effectiveDuration / (totalLyricLines + (sectionCount * 0.5));

    return lines.map(line => {
      if (line.type === 'header') {
        currentTime += baseDuration * 0.5;
        return -1; // Headers don't get timestamps
      }
      if (line.type === 'empty') return -1;
      
      const t = currentTime;
      currentTime += baseDuration;
      return t;
    });
  }, [actualDuration, hasTimedLyrics, timedLyrics]);

  const getCenteredScrollTop = useCallback((index: number) => {
    const el = lineRefs.current[index];
    if (el && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const containerHeight = container.clientHeight;
      const elTop = el.offsetTop;
      const elHeight = el.clientHeight;
      return Math.max(0, elTop - (containerHeight / 2) + (elHeight / 2));
    }
    return null;
  }, []);

  const getCachedCenteredScrollTop = useCallback((index: number) => {
    if (lineCenterCacheRef.current.has(index)) {
      return lineCenterCacheRef.current.get(index)!;
    }

    const target = getCenteredScrollTop(index);
    if (target !== null) {
      lineCenterCacheRef.current.set(index, target);
    }
    return target;
  }, [getCenteredScrollTop]);

  useEffect(() => {
    lineCenterCacheRef.current.clear();
    autoScrollCurrentRef.current = null;
  }, [fontSize, karaokeEnabled, splitRatio, song.content]);

  useEffect(() => {
    const clearLayoutCache = () => {
      lineCenterCacheRef.current.clear();
      autoScrollCurrentRef.current = scrollContainerRef.current?.scrollTop ?? null;
    };
    window.addEventListener('resize', clearLayoutCache);
    window.addEventListener('orientationchange', clearLayoutCache);
    return () => {
      window.removeEventListener('resize', clearLayoutCache);
      window.removeEventListener('orientationchange', clearLayoutCache);
    };
  }, []);

  const scrollToLine = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    const targetScroll = getCenteredScrollTop(index);
    if (targetScroll !== null && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      programmaticScrollUntilRef.current = Date.now() + 300;
      autoScrollCurrentRef.current = targetScroll;
      container.scrollTo({
        top: targetScroll,
        behavior
      });
    }
  }, [getCenteredScrollTop]);

  const getAutoScrollTarget = useCallback((time: number, timings?: number[], activeIdx?: number) => {
    const container = scrollContainerRef.current;
    if (!container) return null;

    if (timings && typeof activeIdx === 'number' && activeIdx >= 0) {
      const currentTarget = getCachedCenteredScrollTop(activeIdx);
      if (currentTarget !== null) {
        const lineStart = timings[activeIdx] >= 0 ? timings[activeIdx] : time;
        let nextIdx = -1;
        for (let i = activeIdx + 1; i < timings.length; i++) {
          if (timings[i] >= 0) {
            nextIdx = i;
            break;
          }
        }

        if (nextIdx >= 0) {
          const nextTarget = getCachedCenteredScrollTop(nextIdx);
          const lineEnd = timings[nextIdx];
          const lineDuration = Math.max(0.25, lineEnd - lineStart);
          const rawProgress = Math.min(1, Math.max(0, (time - lineStart) / lineDuration));
          if (nextTarget !== null) {
            return currentTarget + ((nextTarget - currentTarget) * rawProgress);
          }
        }

        return currentTarget;
      }
    }

    const scrollableDistance = Math.max(0, container.scrollHeight - container.clientHeight);
    if (scrollableDistance <= 0) return null;

    const progress = Math.min(1, Math.max(0, time / Math.max(1, actualDuration)));
    return scrollableDistance * progress;
  }, [actualDuration, getCachedCenteredScrollTop]);

  const easeScrollTo = useCallback((target: number, immediate = false) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    const clampedTarget = Math.min(maxScroll, Math.max(0, target));
    const current = autoScrollCurrentRef.current ?? container.scrollTop;
    const next = immediate ? clampedTarget : current + ((clampedTarget - current) * 0.22);
    const settled = Math.abs(clampedTarget - next) < 0.5 ? clampedTarget : next;

    programmaticScrollUntilRef.current = Date.now() + 120;
    container.scrollTop = settled;
    autoScrollCurrentRef.current = settled;
  }, []);

  const scrollToProgress = useCallback((time: number, timings?: number[], activeIdx?: number, immediate = false) => {
    if (Date.now() < manualScrollHoldUntilRef.current) return;
    const target = getAutoScrollTarget(time, timings, activeIdx);
    if (target !== null) easeScrollTo(target, immediate);
  }, [easeScrollTo, getAutoScrollTarget]);

  const updateKaraokeFill = useCallback((time: number, timings: number[], activeIdx: number) => {
    if (!karaokeEnabled || activeIdx < 0 || timings[activeIdx] < 0) return;

    const activeEl = lineFillRefs.current[activeIdx];
    if (!activeEl) return;

    let lineEnd = timings[activeIdx] + 3;
    for (let i = activeIdx + 1; i < timings.length; i++) {
      if (timings[i] >= 0) {
        lineEnd = timings[i];
        break;
      }
    }

    const lineDuration = Math.max(0.25, lineEnd - timings[activeIdx]);
    const fillPercentage = Math.min(100, Math.max(0, ((time - timings[activeIdx]) / lineDuration) * 100));
    activeEl.style.setProperty('--karaoke-fill', `${fillPercentage}%`);
  }, [karaokeEnabled]);

  const getActiveLineForTime = useCallback((time: number, timings: number[]) => {
    let activeIdx = -1;
    for (let i = timings.length - 1; i >= 0; i--) {
      if (timings[i] >= 0 && time >= timings[i]) {
        activeIdx = i;
        break;
      }
    }
    return activeIdx;
  }, []);

  // Manual scroll hold: suppress forced auto-scroll for 3s after the
  // last wheel/touch/pointer-drag so the teleprompter doesn't fight
  // the user. The clock and active-line highlight still update so
  // karaoke playback keeps running.
  const MANUAL_SCROLL_HOLD_MS = 3000;

  const holdAutoScrollForManualInput = useCallback(() => {
    if (Date.now() < programmaticScrollUntilRef.current) return;
    const container = scrollContainerRef.current;
    manualScrollHoldUntilRef.current = Date.now() + MANUAL_SCROLL_HOLD_MS;
    autoScrollCurrentRef.current = container?.scrollTop ?? null;
  }, []);

  const syncClockToManualScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    holdAutoScrollForManualInput();

    // In karaoke mode, the video player is the source of truth for time.
    // Manual scrolling should just pause auto-scroll (done above) so the user can read.
    // It should NOT overwrite the current playback time or active line highlight.
    if (karaokeEnabled) return;

    const scrollableDistance = Math.max(1, container.scrollHeight - container.clientHeight);
    const progress = Math.min(1, Math.max(0, container.scrollTop / scrollableDistance));
    const nextTime = progress * actualDuration;
    currentTimeRef.current = nextTime;
    setCurrentTime(nextTime);

    const timings = getLineTimings();
    const newActiveIdx = getActiveLineForTime(nextTime, timings);
    if (newActiveIdx >= 0) {
      activeLineIndexRef.current = newActiveIdx;
      setActiveLineIndex(newActiveIdx);
    }
  }, [actualDuration, getActiveLineForTime, getLineTimings, holdAutoScrollForManualInput, karaokeEnabled]);

  useEffect(() => {
    if (!isPlaying) {
      if (scrollTimerRef.current) cancelAnimationFrame(scrollTimerRef.current);
      return;
    }

    const timings = getLineTimings();
    let lastFrameTime = performance.now();

    const scrollLoop = (frameTime: number) => {
      // Cap delta time to 100ms so backgrounding the tab doesn't instantly finish the song or skip huge chunks
      const deltaTime = Math.min(Math.max(0, (frameTime - lastFrameTime) / 1000), 0.1);
      lastFrameTime = frameTime;

      const rawVideoTime = karaokeEnabled && playerReady && playerRef.current?.getCurrentTime
        ? playerRef.current.getCurrentTime() + syncOffset
        : null;
      const nextTime = typeof rawVideoTime === 'number' && Number.isFinite(rawVideoTime)
        ? videoAnchorRef.current.lyricTime + ((rawVideoTime - videoAnchorRef.current.videoTime) * playbackSpeed)
        : currentTimeRef.current + (deltaTime * playbackSpeed);
      const clampedTime = Math.min(actualDuration, Math.max(0, nextTime));
      currentTimeRef.current = clampedTime;

      const newActiveIdx = getActiveLineForTime(clampedTime, timings);
      if (newActiveIdx >= 0 && newActiveIdx !== activeLineIndexRef.current) {
        const previousLine = activeLineIndexRef.current;
        if (previousLine >= 0) {
          lineFillRefs.current[previousLine]?.style.setProperty('--karaoke-fill', '100%');
        }
        activeLineIndexRef.current = newActiveIdx;
        setActiveLineIndex(newActiveIdx);
      }
      updateKaraokeFill(clampedTime, timings, activeLineIndexRef.current);
      scrollToProgress(clampedTime, timings, activeLineIndexRef.current);

      if (frameTime - lastClockStateSyncRef.current > 250 || clampedTime >= actualDuration) {
        lastClockStateSyncRef.current = frameTime;
        setCurrentTime(clampedTime);
      }

      if (clampedTime < actualDuration) {
        scrollTimerRef.current = requestAnimationFrame(scrollLoop);
      } else {
        setIsPlaying(false);
      }
    };

    scrollTimerRef.current = requestAnimationFrame(scrollLoop);

    return () => {
      if (scrollTimerRef.current) cancelAnimationFrame(scrollTimerRef.current);
    };
  }, [isPlaying, playbackSpeed, actualDuration, karaokeEnabled, playerReady, syncOffset, getLineTimings, getActiveLineForTime, scrollToProgress, updateKaraokeFill]);

  // Keep the lyric clock aligned to YouTube while paused. During karaoke playback, the main loop follows YouTube time.
  // Respects manualScrollHoldUntilRef so user scroll is not overridden.
  useEffect(() => {
    if (!karaokeEnabled || !playerReady || isPlaying) return;

    const timings = getLineTimings();

    let rafId: number | null = null;
    let lastSync = 0;

    const syncWhilePaused = (frameTime: number) => {
      if (frameTime - lastSync < 120) {
        rafId = requestAnimationFrame(syncWhilePaused);
        return;
      }
      lastSync = frameTime;

      if (playerRef.current?.getCurrentTime) {
        const videoTime = playerRef.current.getCurrentTime() + syncOffset;
        const clampedTime = Math.min(actualDuration, Math.max(0, videoTime));
        currentTimeRef.current = clampedTime;
        
        const newActiveIdx = getActiveLineForTime(clampedTime, timings);

        if (newActiveIdx !== activeLineIndexRef.current && newActiveIdx >= 0) {
          const previousLine = activeLineIndexRef.current;
          if (previousLine >= 0 && previousLine < newActiveIdx) {
            lineFillRefs.current[previousLine]?.style.setProperty('--karaoke-fill', '100%');
          }
          activeLineIndexRef.current = newActiveIdx;
          setActiveLineIndex(newActiveIdx);
        }
        updateKaraokeFill(clampedTime, timings, activeLineIndexRef.current);
        setCurrentTime(clampedTime);
        // Only auto-scroll if the user is not actively scrolling
        if (Date.now() >= manualScrollHoldUntilRef.current) {
          scrollToProgress(clampedTime, timings, activeLineIndexRef.current);
        }
      }
      rafId = requestAnimationFrame(syncWhilePaused);
    };

    rafId = requestAnimationFrame(syncWhilePaused);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [karaokeEnabled, playerReady, isPlaying, syncOffset, actualDuration, getLineTimings, getActiveLineForTime, scrollToProgress, updateKaraokeFill]);

  // ─── YouTube Setup ─────────────────────────────────────────────────

  useEffect(() => {
    setVideoUrl(song.karaokeUrl || '');
    const titleLower = song.title.toLowerCase();
    const detectedMashup = titleLower.includes('mashup') || titleLower.includes('medley') || titleLower.includes(' vs ');
    setIsMashupMode(detectedMashup);
    setActualDuration(getInitialDuration(song));
    currentTimeRef.current = 0;
    videoAnchorRef.current = { videoTime: 0, lyricTime: 0 };
    
    const initialQuery = detectedMashup
        ? `${song.title} mashup`
        : `${song.title} ${song.artist} official video`;
        
    setSearchQuery(initialQuery);
    setVideoError(false);
    setVideoErrorMessage('');
    setPlayerReady(false);
    setIsFetchingId(false);
    setDynamicVideoId(null);
    setActiveSource(null);
    
    if (song.karaokeUrl && extractYouTubeVideoId(song.karaokeUrl)) {
        setFallbackLevel(DIRECT_SOURCE_LEVEL);
    } else {
        setFallbackLevel(1);
    }
  }, [song]);

  // ─── Gemini YouTube ID Fetcher ─────────────────────────────────────
  
  useEffect(() => {
    if (!karaokeEnabled) return;
    
    const metadataId = extractYouTubeVideoId(videoUrl);
    if (fallbackLevel === DIRECT_SOURCE_LEVEL && metadataId && !isMashupMode) {
       // We have a direct URL, no need to ask Gemini
       setDynamicVideoId(null);
       setActiveSource({
         id: metadataId,
         sourceType: 'Original',
         channelName: 'Direct YouTube link'
       });
       setIsFetchingId(false);
       setVideoError(false);
       setVideoErrorMessage('');
       return; 
    }

    let isMounted = true;
    setIsFetchingId(true);
    setPlayerReady(false);
    
    const step = SOURCE_STEPS.find(item => item.level === fallbackLevel) || SOURCE_STEPS[0];
    const term = fallbackLevel === 1 && searchQuery.trim()
      ? searchQuery.trim()
      : (isMashupMode ? `${song.title} ${song.artist} official mashup` : step.buildQuery(song));

    const findVideo = async () => (
      await searchYouTubeSource(term, step.sourceType)
    );

    findVideo().then(async source => {
       if (!isMounted) return;
       if (source?.id) {
          setDynamicVideoId(source.id);
          setActiveSource(source);
          setVideoError(false);
          setVideoErrorMessage('');
       } else {
          const fallbackId = await getYouTubeVideoId(term);
          if (!isMounted) return;
          if (fallbackId) {
             setDynamicVideoId(fallbackId);
             setActiveSource({ id: fallbackId, sourceType: step.sourceType, channelName: 'YouTube' });
             setVideoError(false);
             setVideoErrorMessage('');
          } else {
             handleVideoError();
          }
       }
       setIsFetchingId(false);
    }).catch(error => {
       if (!isMounted) return;
       if (import.meta.env.DEV) console.warn('YouTube source search failed', error);
       setIsFetchingId(false);
       handleVideoError();
    });

    return () => { isMounted = false; };
  }, [karaokeEnabled, fallbackLevel, videoUrl, isMashupMode, song, searchQuery, iframeKey]);

  useEffect(() => {
    if (!karaokeEnabled) {
       setPlayerReady(false);
       return;
    }
    setVideoError(false);
    setVideoErrorMessage('');
    
    const metadataId = extractYouTubeVideoId(videoUrl);
    const hasTarget = (fallbackLevel === DIRECT_SOURCE_LEVEL && metadataId && !isMashupMode) || dynamicVideoId;
    
    if (!hasTarget) return; // Wait for a video ID

    setPlayerReady(false);
    if (!(window as any).YT) {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(tag);
        (window as any).onYouTubeIframeAPIReady = () => loadPlayer();
    } else {
        loadPlayer();
    }
    return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (playerRef.current?.destroy) {
            try { playerRef.current.destroy(); } catch(e) {}
            playerRef.current = null;
        }
        if (youtubeHostRef.current) youtubeHostRef.current.innerHTML = '';
    };
  }, [karaokeEnabled, iframeKey, dynamicVideoId, fallbackLevel, videoUrl, isMashupMode]);

  const loadPlayer = () => {
      const host = youtubeHostRef.current;
      if (!host) return;
      if (playerRef.current) {
          try { playerRef.current.destroy(); } catch(e) {}
          playerRef.current = null;
      }
      host.innerHTML = '';
      const target = document.createElement('div');
      target.className = 'w-full h-full';
      host.appendChild(target);

      const metadataId = extractYouTubeVideoId(videoUrl);
      
      const playerConfig: any = {
          height: '100%',
          width: '100%',
          playerVars: {
              autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1,
              origin: window.location.origin, controls: 1,
          },
          events: {
              onReady: (event: any) => {
                  setPlayerReady(true);
                  if (event.target.getDuration) {
                      const d = event.target.getDuration();
                      if (d > 0 && !getSongMetadataDuration(song)) setActualDuration(d);
                  }
                  event.target.playVideo();
              },
              onError: (event: any) => handleVideoError(event?.data),
              onStateChange: (event: any) => {
                  if (event.data === 1) {
                       setPlayerReady(true);
                       setVideoError(false);
                       const videoTime = event.target?.getCurrentTime ? event.target.getCurrentTime() + syncOffset : currentTimeRef.current;
                       const clampedTime = Math.min(actualDuration, Math.max(0, videoTime));
                       videoAnchorRef.current = {
                         videoTime: clampedTime,
                         lyricTime: currentTimeRef.current || clampedTime
                       };
                       currentTimeRef.current = currentTimeRef.current || clampedTime;
                       setCurrentTime(currentTimeRef.current);
                       setIsPlaying(true);
                  } else if (event.data === 2 || event.data === 0) {
                       if (event.data === 0) {
                         currentTimeRef.current = actualDuration;
                         setCurrentTime(actualDuration);
                         scrollToProgress(actualDuration);
                       }
                       setIsPlaying(false);
                  }
              }
          }
      };

      const targetId = (fallbackLevel === DIRECT_SOURCE_LEVEL && metadataId && !isMashupMode) ? metadataId : dynamicVideoId;
      if (!targetId) return;

      playerConfig.videoId = targetId;

      try {
        if ((window as any).YT?.Player) {
            playerRef.current = new (window as any).YT.Player(target, playerConfig);
        } else {
            setTimeout(() => {
                 if ((window as any).YT?.Player && youtubeHostRef.current?.contains(target)) {
                     playerRef.current = new (window as any).YT.Player(target, playerConfig);
                 }
            }, 500);
        }
      } catch (e) {
          if (import.meta.env.DEV) console.warn("Failed to init player", e);
          setVideoError(true);
          setVideoErrorMessage('Could not embed this video.');
      }
  };

  const handleVideoError = (code?: number) => {
      setPlayerReady(false);
      setIsFetchingId(false);
      if (code) {
          setVideoErrorMessage(`Could not embed this video. YouTube returned error ${code}.`);
      }
      const nextStep = SOURCE_STEPS.find(step => step.level > fallbackLevel);
      if (fallbackLevel === DIRECT_SOURCE_LEVEL || nextStep) {
        setFallbackLevel(fallbackLevel === DIRECT_SOURCE_LEVEL ? 1 : nextStep!.level);
        setDynamicVideoId(null);
        setActiveSource(null);
        setVideoError(false);
        setIframeKey(k => k + 1);
      } else {
        setVideoError(true);
        setVideoErrorMessage(prev => prev || 'No playable YouTube source was found. Lyrics, chords, and scrolling still work.');
      }
  };

  const handleUpdateVideo = () => {
    if (!extractYouTubeVideoId(videoUrl)) {
      setVideoError(true);
      setVideoErrorMessage('Could not read a valid YouTube video ID from that URL.');
      return;
    }
    setVideoError(false);
    setVideoErrorMessage('');
    setPlayerReady(false);
    setIsFetchingId(false);
    setDynamicVideoId(null);
    setActiveSource({
      id: extractYouTubeVideoId(videoUrl)!,
      sourceType: 'Original',
      channelName: 'Direct YouTube link'
    });
    setIframeKey(k => k + 1);
    setFallbackLevel(DIRECT_SOURCE_LEVEL);
  };
  const handleInternalSearch = () => {
    setVideoError(false);
    setVideoErrorMessage('');
    setPlayerReady(false);
    setIsFetchingId(false);
    setDynamicVideoId(null);
    setActiveSource(null);
    setFallbackLevel(1);
    setIframeKey(k => k + 1);
  };

  const updatePlaybackSpeed = (delta: number) => {
    setPlaybackSpeed(speed => {
      const nextSpeed = Math.max(0.1, Math.min(3, Math.round((speed + delta) * 20) / 20));
      if (karaokeEnabled && playerReady && playerRef.current?.getCurrentTime) {
        const videoTime = Math.min(actualDuration, Math.max(0, playerRef.current.getCurrentTime() + syncOffset));
        videoAnchorRef.current = {
          videoTime,
          lyricTime: currentTimeRef.current
        };
      }
      return nextSpeed;
    });
  };
  // ─── Spotify-Style Line Rendering ──────────────────────────────────

  const renderStructuredContent = () => {
      const lines = parsedLines.current;
      if (lines.length === 0) return null;

      const timings = getLineTimings();

      return lines.map((line, idx) => {
          if (line.type === 'header') {
              return (
                  <div key={idx} ref={el => { lineRefs.current[idx] = el; }}
                    className="mt-16 mb-8 w-full text-center"
                  >
                      <div className="inline-block px-6 py-2 bg-white/[0.03] backdrop-blur-lg border border-white/[0.06] rounded-full">
                          <h3 className="text-amber-400/80 font-bold uppercase tracking-[0.4em] text-sm">{line.text}</h3>
                      </div>
                  </div>
              );
          }

          if (line.type === 'empty') {
              return <div key={idx} ref={el => { lineRefs.current[idx] = el; }} className="h-8"></div>;
          }

          const isActive = idx === activeLineIndex;
          const isPast = activeLineIndex >= 0 && idx < activeLineIndex;
          const isUpcoming = activeLineIndex >= 0 && idx > activeLineIndex;
          const distance = Math.abs(idx - activeLineIndex);

          // Keep emphasis on compositor-friendly properties. Changing font size
          // here causes reflow and makes lyric changes feel blocky.
          const scale = isActive ? 1.025 : Math.max(0.96, 1 - distance * 0.006);
          const opacity = isActive ? 1 : isPast ?
            Math.max(0.48, 0.82 - distance * 0.025) :
            Math.max(0.58, 0.9 - distance * 0.025);

          // Karaoke fill is animated imperatively via --karaoke-fill so playback
          // does not re-render the entire lyric list every frame.
          let initialFillPercentage = 0;
          if (isActive && karaokeEnabled && timings[idx] >= 0) {
            const lineStart = timings[idx];
            let lineEnd = lineStart + 3; // Default 3s per line
            for (let j = idx + 1; j < timings.length; j++) {
              if (timings[j] >= 0) { lineEnd = timings[j]; break; }
            }
            const lineDuration = Math.max(0.25, lineEnd - lineStart);
            const elapsed = currentTimeRef.current - lineStart;
            initialFillPercentage = Math.min(100, Math.max(0, (elapsed / lineDuration) * 100));
          }

          return (
              <div 
                key={idx}
                ref={el => { lineRefs.current[idx] = el; }}
                className={`w-full py-3 px-4 md:px-6 rounded-2xl transition-[background-color,box-shadow,opacity,transform] duration-700 ease-out mb-1 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-0 cursor-pointer hover:bg-white/[0.04]
                  ${isActive && karaokeEnabled ? 'bg-white/[0.04] shadow-[0_0_40px_rgba(255,255,255,0.03)]' : ''}
                `}
                style={{
                  opacity,
                  transform: `translate3d(0, 0, 0) scale(${scale})`,
                  transformOrigin: 'center center',
                  willChange: 'transform, opacity'
                }}
                onClick={() => {
                  const timings = getLineTimings();
                  const lineTime = timings[idx];
                  if (karaokeEnabled) {
                    setActiveLineIndex(idx);
                    if (lineTime >= 0) {
                      currentTimeRef.current = lineTime;
                      setCurrentTime(lineTime);
                      videoAnchorRef.current = { videoTime: lineTime, lyricTime: lineTime };
                      scrollToProgress(lineTime);
                    }
                    if (lineTime >= 0 && playerRef.current?.seekTo) {
                      playerRef.current.seekTo(Math.max(0, lineTime - syncOffset), true);
                    }
                  } else if (lineTime >= 0) {
                    currentTimeRef.current = lineTime;
                    setCurrentTime(lineTime);
                    setActiveLineIndex(idx);
                    scrollToProgress(lineTime);
                  }
                }}
              >
                  {/* Lyrics */}
                  <div 
                     ref={el => { lineFillRefs.current[idx] = el; }}
                     className={`flex-1 font-sans whitespace-pre-wrap leading-relaxed tracking-wide transition-[color,opacity,filter,text-shadow] duration-700 ease-out ${
                       isActive ? 'font-bold' : 'font-medium'
                     }`}
                     style={{ 
                         fontSize: `${fontSize}px`,
                         ...(isActive && karaokeEnabled ? {
                             '--karaoke-fill': `${initialFillPercentage}%`,
                             backgroundImage: `linear-gradient(90deg, #fbbf24 var(--karaoke-fill, 0%), rgba(255,255,255,0.9) var(--karaoke-fill, 0%))`,
                             WebkitBackgroundClip: 'text',
                             WebkitTextFillColor: 'transparent',
                             backgroundClip: 'text',
                             color: 'transparent',
                             willChange: 'background-image',
                             textShadow: '0 0 18px rgba(251,191,36,0.12)',
                         } : {
                             color: karaokeEnabled 
                               ? (isActive ? '#ffffff' : isPast ? 'rgba(251,191,36,0.85)' : 'rgba(241,245,249,0.85)')
                               : 'rgba(241,245,249,0.95)' // Constant white/gray for standard teleprompter mode
                         })
                     }} 
                  >
                      {line.lyricsOnly || '\u00A0'}
                  </div>

                  {/* Chords Column */}
                  <div className="flex flex-wrap gap-1.5 justify-start sm:justify-end items-center sm:pl-4 shrink-0 w-full sm:w-auto sm:min-w-[15%]">
                      {line.chords.map((chord, cIdx) => (
                           <button 
                             key={cIdx}
                             onClick={(e) => { e.stopPropagation(); setSelectedChord(chord); }}
                             className={`px-3 py-1 rounded-lg font-mono font-bold transition-all shadow-sm border
                               ${isActive 
                                 ? 'bg-amber-500/20 text-amber-300 border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.15)] hover:bg-amber-500/30 scale-105'
                                 : 'bg-white/[0.04] text-amber-500/60 border-white/[0.06] hover:bg-white/[0.08] hover:text-amber-400'}
                             `}
                             style={{ fontSize: `${Math.max(14, fontSize * 0.7)}px` }}
                           >
                               {chord}
                           </button>
                      ))}
                  </div>
              </div>
          );
      });
  };

  const handlePlayPause = () => {
    let startedFromVideo = false;
    if (!isPlaying && karaokeEnabled && playerReady && playerRef.current?.getCurrentTime) {
      const videoTime = playerRef.current.getCurrentTime() + syncOffset;
      const clampedTime = Math.min(actualDuration, Math.max(0, videoTime));
      videoAnchorRef.current = {
        videoTime: clampedTime,
        lyricTime: currentTimeRef.current || clampedTime
      };
      currentTimeRef.current = currentTimeRef.current || clampedTime;
      setCurrentTime(currentTimeRef.current);
      const timings = getLineTimings();
      const syncedLine = getActiveLineForTime(currentTimeRef.current, timings);
      if (syncedLine >= 0) {
        activeLineIndexRef.current = syncedLine;
        setActiveLineIndex(syncedLine);
        startedFromVideo = true;
      }
    }

    if (!isPlaying && activeLineIndex < 0 && !startedFromVideo) {
      const timings = getLineTimings();
      const firstLine = timings.findIndex(t => t >= 0);
      const startTime = firstLine >= 0 ? timings[firstLine] : 0;
      currentTimeRef.current = startTime;
      setCurrentTime(startTime);
      videoAnchorRef.current = { videoTime: startTime, lyricTime: startTime };
      activeLineIndexRef.current = firstLine >= 0 ? firstLine : 0;
      setActiveLineIndex(firstLine >= 0 ? firstLine : 0);
      if (firstLine >= 0) scrollToLine(firstLine);
    }

    if (karaokeEnabled && playerReady) {
      try {
        if (isPlaying) playerRef.current?.pauseVideo?.();
        else playerRef.current?.playVideo?.();
      } catch (e) {
        if (import.meta.env.DEV) console.warn('Could not toggle YouTube playback', e);
      }
    }

    setIsPlaying(!isPlaying);
  };

  const isAiGenerated = (song as any).source === 'ai';

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col h-[100dvh] w-screen overflow-hidden font-sans group bg-[#020617]"
      style={{
        backgroundImage: isAiGenerated
          ? `radial-gradient(circle at 20% 18%, rgba(125, 30, 70, 0.28), transparent 34%),
             radial-gradient(circle at 80% 32%, rgba(88, 28, 135, 0.18), transparent 40%),
             linear-gradient(135deg, #09030a 0%, #170412 48%, #030105 100%)`
          : `radial-gradient(circle at 20% 20%, rgba(40, 90, 180, 0.35), transparent 35%),
             radial-gradient(circle at 80% 30%, rgba(80, 120, 255, 0.22), transparent 40%),
             radial-gradient(circle at 50% 90%, rgba(10, 30, 80, 0.4), transparent 45%),
             linear-gradient(135deg, #020617 0%, #07142f 45%, #020617 100%)`
      }}
    >
      {/* Subtle Ambient Glows based on source */}
      <div className="absolute inset-0 pointer-events-none z-0 opacity-60">
        <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] blur-[150px] rounded-full ${isAiGenerated ? 'bg-rose-900/10' : 'bg-sky-500/10'}`}></div>
        <div className={`absolute bottom-0 left-1/4 w-[600px] h-[300px] blur-[120px] rounded-full ${isAiGenerated ? 'bg-fuchsia-900/10' : 'bg-indigo-500/10'}`}></div>
        <div className="absolute inset-0 bg-black/25"></div>
      </div>
      {/* Header - Now an overlay that appears on hover */}
      <div className={`absolute top-0 left-0 right-0 h-20 md:h-24 flex items-center justify-between px-3 md:px-8 z-50 shrink-0 border-b shadow-[0_4px_30px_rgba(0,0,0,0.3)] w-full opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 ${
        isAiGenerated ? 'bg-[#1a050f]/90 border-rose-900/20' : 'bg-[#0f172a]/90 border-white/[0.05]'
      }`}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
             <button onClick={onClose} className="p-2.5 bg-white/[0.04] hover:bg-white/[0.08] text-white rounded-xl transition-all backdrop-blur-lg shrink-0 active:scale-95 border border-white/[0.06]">
                <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex flex-col overflow-hidden">
                <h2 className="text-xl md:text-2xl font-black text-white tracking-tight drop-shadow-md truncate leading-tight">{song.title}</h2>
                <div className="flex items-center gap-1.5 md:gap-2 mt-0.5 min-w-0 overflow-hidden">
                    <span className="text-[10px] md:text-xs text-gray-400 font-medium truncate">{song.artist}</span>
                    {song.capo !== undefined && song.capo > 0 && (
                        <span className="text-[9px] px-2 py-0.5 bg-amber-500/15 border border-amber-500/20 rounded-full text-amber-300 font-bold uppercase tracking-wider">
                            Capo {song.capo}
                        </span>
                    )}
                    {song.strummingPattern && (
                        <span className="hidden md:inline text-[9px] px-2 py-0.5 bg-indigo-500/15 border border-indigo-500/20 rounded-full text-indigo-300 font-mono font-bold">
                            {song.strummingPattern}
                        </span>
                    )}
                </div>
            </div>
        </div>
        
        <div className="flex items-center gap-2 shrink-0">
             <button 
                onClick={() => setKaraokeEnabled(!karaokeEnabled)}
                className={`px-3 py-2 md:px-4 md:py-2.5 rounded-xl text-[10px] md:text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all border backdrop-blur-lg ${
                  karaokeEnabled
                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30 shadow-[0_0_20px_rgba(99,102,241,0.15)]'
                    : 'text-gray-400 bg-white/[0.04] border-white/[0.06] hover:bg-white/[0.08]'
                }`}
             >
                <Layout className="w-4 h-4" /> <span className="hidden md:inline">{karaokeEnabled ? 'Exit Split' : 'Karaoke'}</span>
             </button>
             <button onClick={onClose} className="p-2.5 bg-white/[0.04] hover:bg-white/[0.08] text-white rounded-xl transition-all border border-white/[0.06]">
                <X className="w-5 h-5" />
            </button>
        </div>
      </div>

      <div
        ref={splitContainerRef}
        onPointerMove={karaokeEnabled ? handleSplitPointerMove : undefined}
        onPointerUp={karaokeEnabled ? handleSplitPointerUp : undefined}
        className={`flex-1 min-h-0 overflow-hidden relative flex ${karaokeEnabled ? 'flex-col md:flex-row' : ''}`}
        style={karaokeEnabled ? { userSelect: isDraggingSplitRef.current ? 'none' : undefined } as React.CSSProperties : undefined}
      >
         <div
           className={`min-h-0 relative ${karaokeEnabled ? 'teleprompter-lyrics-pane border-b md:border-b-0 md:border-r border-white/[0.05] order-2 md:order-1' : 'w-full h-full'}`}
           style={karaokeEnabled ? { '--lyrics-pane-width': `${splitRatio * 100}%` } as React.CSSProperties : undefined}
         >
             <div
               ref={scrollContainerRef}
               onWheel={syncClockToManualScroll}
               onScroll={holdAutoScrollForManualInput}
               onTouchStart={holdAutoScrollForManualInput}
               onTouchMove={syncClockToManualScroll}
               onPointerDown={(event) => {
                 if (!isDraggingSplitRef.current && event.pointerType !== 'mouse') holdAutoScrollForManualInput();
               }}
               onPointerMove={(event) => {
                 if (event.buttons === 1 && !isDraggingSplitRef.current) syncClockToManualScroll();
               }}
               className="h-full overflow-y-auto overscroll-contain relative custom-scrollbar pb-32 touch-pan-y"
             >
                 <div className="min-h-full pt-24 pb-28 md:pt-40 md:pb-24 px-3 sm:px-5 md:px-12 lg:px-20 mx-auto relative z-10 max-w-4xl">
                     {/* Spacer so first line can center */}
                     <div className="h-[34dvh] md:h-[40vh]"></div>
                     {renderStructuredContent()}
                     <div className="h-[48dvh] md:h-[60vh]"></div>
                 </div>
             </div>
             {/* Gradient fade overlays */}
             <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-[#0a0f1a] to-transparent pointer-events-none z-10"></div>
             <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-black to-transparent pointer-events-none z-10"></div>
         </div>

         {/* Draggable divider — desktop only */}
         {karaokeEnabled && (
           <div
             onPointerDown={handleSplitPointerDown}
             className="hidden md:flex items-center justify-center w-2 cursor-col-resize order-2 shrink-0 group/divider z-20 hover:bg-white/[0.06] active:bg-indigo-500/20 transition-colors"
             style={{ touchAction: 'none' }}
           >
             <div className="w-0.5 h-12 rounded-full bg-white/20 group-hover/divider:bg-indigo-400/60 group-active/divider:bg-indigo-400 transition-colors"></div>
           </div>
         )}

         {karaokeEnabled && (
             <div
               className="bg-black/50 backdrop-blur-xl flex flex-col h-[40vh] md:h-full border-b md:border-b-0 md:border-l border-white/[0.05] shadow-2xl animate-in slide-in-from-right duration-300 order-1 md:order-3 shrink-0"
               style={{ flex: '1 1 0%', minWidth: 0 }}
             >
                 <div className="p-3 md:p-4 bg-white/[0.03] border-b border-white/[0.05] flex items-center justify-between backdrop-blur-lg">
                     <div className="flex items-center gap-2 text-indigo-400 font-bold uppercase tracking-widest text-xs">
                         <Youtube className="w-4 h-4" /> 
                         {sourceLabel}
                     </div>
                     <div className="flex gap-1.5">
                         <button onClick={() => { setFallbackLevel(5); setActiveSource(null); setDynamicVideoId(null); setIframeKey(k => k+1); }} className={`p-1.5 rounded-lg transition-all ${fallbackLevel === 5 ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/30' : 'bg-white/[0.04] text-gray-500'}`} title="Karaoke source"><Mic2 className="w-3 h-3"/></button>
                         <button onClick={() => { setFallbackLevel(1); setActiveSource(null); setDynamicVideoId(null); setIframeKey(k => k+1); }} className={`p-1.5 rounded-lg transition-all ${fallbackLevel > 0 && fallbackLevel < 5 ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/30' : 'bg-white/[0.04] text-gray-500'}`} title="Original source"><Youtube className="w-3 h-3"/></button>
                     </div>
                 </div>

                 <div className="aspect-video bg-black w-full border-b border-white/[0.05] relative group shrink-0">
                     <div id="player-wrapper" className={`w-full h-full absolute inset-0 ${videoError ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                        <div ref={youtubeHostRef} className="w-full h-full"></div>
                     </div>
                     {(!playerReady && !videoError) || isFetchingId ? (
                         <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-10 flex-col pointer-events-none">
                            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mb-4" />
                            <p className="text-xs text-indigo-400/60 font-bold uppercase tracking-widest animate-pulse">
                               {isFetchingId ? "Searching YouTube..." : "Loading Player..."}
                            </p>
                         </div>
                     ) : null}
                     {videoError && (
                         <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 p-6 text-center z-20">
                             <AlertCircle className="w-10 h-10 text-amber-500 mb-2" />
                             <h4 className="text-white font-bold mb-1">Could not embed this video</h4>
                             <p className="text-[10px] text-gray-500 mb-4">{videoErrorMessage || 'Try another version or open on YouTube.'}</p>
                             <button onClick={() => handleVideoError()} className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all mb-2">
                                 <RefreshCw className="w-3 h-3" /> Try Next Source
                             </button>
                             <button
                               onClick={() => window.open(activeVideoId ? toYouTubeWatchUrl(activeVideoId) : getYouTubeSearchUrl(searchQuery || `${song.title} ${song.artist}`), '_blank')}
                               className="px-5 py-3 bg-white/[0.04] hover:bg-white/[0.08] text-gray-300 rounded-xl text-xs font-bold flex items-center gap-2 transition-all border border-white/[0.06]"
                             >
                                 <ExternalLink className="w-3 h-3" /> Open on YouTube
                             </button>
                         </div>
                     )}
                 </div>

                 <div className="p-4 md:p-5 flex-1 bg-black/30 flex flex-col gap-4 overflow-y-auto backdrop-blur-lg">
                      <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.06]">
                          <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                  <div className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Source Type</div>
                                  <div className="text-sm text-white font-bold truncate">{sourceLabel}</div>
                                  <div className="text-[10px] text-indigo-300/70 truncate">{sourceChannelName}</div>
                              </div>
                              <button onClick={handleVideoError} className="px-3 py-2 bg-white/[0.04] hover:bg-white/[0.08] text-indigo-300 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-white/[0.06] shrink-0">
                                  Change
                              </button>
                          </div>
                      </div>

                      {/* Sync Controls */}
                      <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.06]">
                          <div className="flex justify-between items-center mb-2">
                              <label className="text-[10px] text-indigo-400/80 uppercase font-bold tracking-widest flex items-center gap-2"><Timer className="w-3 h-3" /> Sync</label>
                              <span className="text-xs font-mono text-indigo-300/60">{syncOffset > 0 ? `+${syncOffset}s` : `${syncOffset}s`}</span>
                          </div>
                          <div className="flex gap-2 items-center">
                              <button onClick={() => setSyncOffset(s => s - 1)} className="p-2 bg-white/[0.04] hover:bg-indigo-500/20 rounded-lg text-white transition-all"><Minus className="w-3 h-3"/></button>
                              <input type="range" min="-30" max="30" step="1" value={syncOffset} onChange={e => setSyncOffset(parseFloat(e.target.value))} className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                              <button onClick={() => setSyncOffset(s => s + 1)} className="p-2 bg-white/[0.04] hover:bg-indigo-500/20 rounded-lg text-white transition-all"><Plus className="w-3 h-3"/></button>
                          </div>
                      </div>

                      <div>
                          <label className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-2 block">Finder</label>
                          <div className="flex gap-2">
                             <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleInternalSearch()} className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-gray-300 outline-none focus:border-indigo-500/50 transition-colors backdrop-blur-lg" placeholder="Search official source..." />
                             <button onClick={handleInternalSearch} className="px-4 py-2 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 rounded-xl text-xs font-bold transition-all border border-indigo-500/30 flex items-center gap-2"><Search className="w-3 h-3" /> Play</button>
                          </div>
                      </div>

                      <div className="border-t border-white/[0.05] pt-4">
                          <label className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-2 block">Direct URL</label>
                          <div className="flex gap-2">
                             <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2 text-xs text-gray-300 outline-none focus:border-indigo-500/50 transition-colors font-mono backdrop-blur-lg" placeholder="Paste YouTube Link..." />
                             <button onClick={handleUpdateVideo} className="p-2 bg-white/[0.04] hover:bg-white/[0.08] text-indigo-400 rounded-xl transition-all border border-white/[0.06]"><ArrowRight className="w-4 h-4" /></button>
                          </div>
                      </div>
                 </div>
             </div>
         )}
      </div>

      {/* Playback Footer - Now an overlay that appears on hover */}
      <div className={`absolute bottom-0 left-0 right-0 h-20 md:h-24 pb-safe border-t flex items-center justify-start md:justify-center gap-2 md:gap-8 z-50 shrink-0 shadow-[0_-5px_30px_rgba(0,0,0,0.3)] opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-300 overflow-x-auto px-2 md:px-0 ${
        isAiGenerated ? 'bg-[#1a050f]/90 border-rose-900/20' : 'bg-[#0f172a]/90 border-white/[0.05]'
      }`}>
             <div className="flex items-center gap-1 md:gap-2 px-1.5 md:px-4 border-r border-white/[0.06] pr-2 md:pr-6">
                 <button onClick={() => setFontSize(f => Math.max(16, f-2))} className="p-2 md:p-3 bg-white/[0.04] hover:bg-white/[0.08] rounded-xl text-gray-400 hover:text-white transition-all active:scale-95"><Minus className="w-4 h-4"/></button>
                 <div className="flex flex-col items-center w-12 md:w-16">
                    <span className="text-lg md:text-2xl font-bold text-white">{fontSize}</span>
                    <span className="text-[8px] text-gray-400 uppercase tracking-widest font-bold">Size</span>
                 </div>
                 <button onClick={() => setFontSize(f => Math.min(72, f+2))} className="p-2 md:p-3 bg-white/[0.04] hover:bg-white/[0.08] rounded-xl text-gray-400 hover:text-white transition-all active:scale-95"><Plus className="w-4 h-4"/></button>
             </div>
             
             {/* Playback Speed Control */}
             <div className="flex items-center gap-1 md:gap-2 px-1.5 md:px-4 border-r border-white/[0.06] pr-2 md:pr-6">
                 <button onClick={() => updatePlaybackSpeed(-0.05)} className="p-2 md:p-3 bg-white/[0.04] hover:bg-white/[0.08] rounded-xl text-gray-400 hover:text-white transition-all active:scale-95"><Minus className="w-4 h-4"/></button>
                 <div className="flex flex-col items-center w-12 md:w-16">
                    <span className="text-lg md:text-2xl font-bold text-blue-400">{playbackSpeed.toFixed(2).replace(/0$/, '')}x</span>
                    <span className="text-[8px] text-gray-400 uppercase tracking-widest font-bold">Speed</span>
                 </div>
                 <button onClick={() => updatePlaybackSpeed(0.05)} className="p-2 md:p-3 bg-white/[0.04] hover:bg-white/[0.08] rounded-xl text-gray-400 hover:text-white transition-all active:scale-95"><Plus className="w-4 h-4"/></button>
             </div>
             
             <button onClick={handlePlayPause} className={`w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center shadow-2xl transition-all transform active:scale-90 border-2 ${
               isPlaying
                 ? 'bg-white text-black border-white shadow-[0_0_30px_rgba(255,255,255,0.2)]'
                 : 'bg-white/[0.06] border-white/20 text-white hover:bg-white/[0.12] hover:border-white/40'
             }`}>
                {isPlaying ? <Pause className="w-6 h-6 md:w-7 md:h-7 fill-current" /> : <Play className="w-6 h-6 md:w-7 md:h-7 fill-current ml-0.5" />}
             </button>

             {hasTimedLyrics && (
               <div className="pl-2 md:pl-6 border-l border-white/[0.06] shrink-0">
                 <span className="text-[9px] text-emerald-400/60 font-bold uppercase tracking-widest flex items-center gap-1.5">
                   <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
                   Synced
                 </span>
               </div>
             )}
      </div>

      {selectedChord && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl p-4 animate-in fade-in" onClick={() => setSelectedChord(null)}>
            <div className="bg-[#111]/90 backdrop-blur-2xl border border-white/[0.08] rounded-3xl w-full max-w-2xl h-[60vh] shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                 <div className="p-6 border-b border-white/[0.06] flex justify-between items-center bg-white/[0.02]">
                     <div>
                         <h3 className="text-4xl font-bold text-white mb-1 font-mono">{selectedChord}</h3>
                         <button onClick={() => setHandedness(h => h === 'Right' ? 'Left' : 'Right')} className="text-indigo-400 text-xs font-bold uppercase tracking-widest hover:text-white transition-colors">Switch to {handedness === 'Right' ? 'Left' : 'Right'} Hand</button>
                     </div>
                     <button onClick={() => setSelectedChord(null)} className="p-2.5 bg-white/[0.04] hover:bg-white/[0.08] rounded-full text-white transition-all border border-white/[0.06]"><X className="w-6 h-6"/></button>
                 </div>
                 <div className="flex-1 p-6 bg-black/30">
                     <GuitarFretboard activeNotes={getChordFingering(selectedChord)?.frets.map((f, i) => ({ string: i, fret: f }))} handedness={handedness} interactive={true} autoPlay={true} />
                 </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default Teleprompter;
