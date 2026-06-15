export type LyricCue = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
};

export type TimedLyricInput = {
  time: number;
  text: string;
};

export type LyricSyncCorrection = {
  offsetMs: number;
  scale: number;
};

export type CalibrationPoint = {
  videoTimeMs: number;
  lyricTimeMs: number;
};

export type PlaybackClockSample = {
  mediaTimeMs: number;
  sampleTimeMs: number;
  playbackRate: number;
  isActive: boolean;
};

export type AutoFollowState = {
  paused: boolean;
  showReturn: boolean;
};

const DEFAULT_FINAL_CUE_DURATION_MS = 4000;
const MIN_CALIBRATION_DISTANCE_MS = 5000;
const MIN_SCALE = 0.9;
const MAX_SCALE = 1.1;

export const DEFAULT_LYRIC_SYNC_CORRECTION: LyricSyncCorrection = {
  offsetMs: 0,
  scale: 1,
};

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

const parseLrcTimestampMs = (minutes: string, seconds: string, fraction = '0') => {
  const minuteValue = Number(minutes);
  const secondValue = Number(seconds);
  const fractionMs = fraction.length === 3
    ? Number(fraction)
    : Number(fraction.padEnd(3, '0'));

  if (
    !Number.isFinite(minuteValue) ||
    !Number.isFinite(secondValue) ||
    !Number.isFinite(fractionMs) ||
    secondValue < 0 ||
    secondValue >= 60
  ) {
    return null;
  }

  return Math.round((minuteValue * 60 * 1000) + (secondValue * 1000) + fractionMs);
};

export const parseLrcToTimedLyrics = (lrc: string): TimedLyricInput[] => {
  if (!lrc) return [];

  const cues: TimedLyricInput[] = [];
  const timestampPattern = /\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g;

  lrc.split(/\r?\n/).forEach((rawLine) => {
    timestampPattern.lastIndex = 0;
    const matches = [...rawLine.matchAll(timestampPattern)];
    if (!matches.length) return;

    const text = rawLine.slice(matches[matches.length - 1].index! + matches[matches.length - 1][0].length).trim();
    if (!text) return;

    matches.forEach((match) => {
      const startMs = parseLrcTimestampMs(match[1], match[2], match[3]);
      if (startMs === null) return;
      cues.push({ time: startMs / 1000, text });
    });
  });

  return cues.sort((a, b) => (a.time - b.time));
};

export const timedLyricsToCues = (
  timedLyrics: TimedLyricInput[] = [],
  fallbackDurationMs = DEFAULT_FINAL_CUE_DURATION_MS
): LyricCue[] => {
  const normalized = timedLyrics
    .map((line, index) => ({
      index,
      startMs: Math.round(line.time * 1000),
      text: String(line.text || '').trim(),
    }))
    .filter(line => isFiniteNumber(line.startMs) && line.startMs >= 0 && line.text)
    .sort((a, b) => (a.startMs - b.startMs) || (a.index - b.index));

  return normalized.map((line, index) => {
    const nextDistinct = normalized
      .slice(index + 1)
      .find(next => next.startMs > line.startMs);
    const fallbackEnd = line.startMs + Math.max(500, fallbackDurationMs);
    const endMs = nextDistinct ? nextDistinct.startMs : fallbackEnd;

    return {
      id: `line-${index}-${line.startMs}`,
      startMs: line.startMs,
      endMs: Math.max(line.startMs + 250, endMs),
      text: line.text,
    };
  });
};

export const parseLrcToCues = (lrc: string): LyricCue[] => (
  timedLyricsToCues(parseLrcToTimedLyrics(lrc))
);

export const findActiveCueIndex = (
  cues: LyricCue[],
  lyricTimeMs: number,
  keepPreviousDuringGap = true
) => {
  if (!cues.length || !Number.isFinite(lyricTimeMs) || lyricTimeMs < cues[0].startMs) {
    return -1;
  }

  let low = 0;
  let high = cues.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (cues[mid].startMs <= lyricTimeMs) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (candidate < 0) return -1;
  if (lyricTimeMs < cues[candidate].endMs) return candidate;
  return keepPreviousDuringGap ? candidate : -1;
};

export const videoTimeToLyricTimeMs = (
  videoTimeMs: number,
  correction: LyricSyncCorrection = DEFAULT_LYRIC_SYNC_CORRECTION
) => (correction.scale * videoTimeMs) + correction.offsetMs;

export const lyricTimeToVideoTimeMs = (
  lyricTimeMs: number,
  correction: LyricSyncCorrection = DEFAULT_LYRIC_SYNC_CORRECTION
) => {
  if (!Number.isFinite(correction.scale) || Math.abs(correction.scale) < 0.0001) return lyricTimeMs;
  return (lyricTimeMs - correction.offsetMs) / correction.scale;
};

export const moveLyricsEarlier = (
  correction: LyricSyncCorrection,
  deltaMs: number
): LyricSyncCorrection => ({
  ...correction,
  offsetMs: correction.offsetMs + Math.abs(deltaMs),
});

export const moveLyricsLater = (
  correction: LyricSyncCorrection,
  deltaMs: number
): LyricSyncCorrection => ({
  ...correction,
  offsetMs: correction.offsetMs - Math.abs(deltaMs),
});

export const calculateTwoPointCalibration = (
  first: CalibrationPoint,
  second: CalibrationPoint
): LyricSyncCorrection | null => {
  const videoDelta = second.videoTimeMs - first.videoTimeMs;
  const lyricDelta = second.lyricTimeMs - first.lyricTimeMs;

  if (
    !Number.isFinite(videoDelta) ||
    !Number.isFinite(lyricDelta) ||
    Math.abs(videoDelta) < MIN_CALIBRATION_DISTANCE_MS ||
    Math.abs(lyricDelta) < MIN_CALIBRATION_DISTANCE_MS
  ) {
    return null;
  }

  const scale = lyricDelta / videoDelta;
  if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) return null;

  return {
    scale,
    offsetMs: first.lyricTimeMs - (scale * first.videoTimeMs),
  };
};

export const estimatePlaybackClockTimeMs = (
  sample: PlaybackClockSample,
  nowMs: number,
  durationMs = Number.POSITIVE_INFINITY
) => {
  const elapsed = sample.isActive
    ? Math.max(0, nowMs - sample.sampleTimeMs) * sample.playbackRate
    : 0;
  return Math.min(Math.max(0, sample.mediaTimeMs + elapsed), durationMs);
};

export const resetSongSyncState = (): LyricSyncCorrection => ({
  ...DEFAULT_LYRIC_SYNC_CORRECTION,
});

export const applyManualScrollOverride = (): AutoFollowState => ({
  paused: true,
  showReturn: true,
});

export const restoreAutoFollow = (): AutoFollowState => ({
  paused: false,
  showReturn: false,
});
