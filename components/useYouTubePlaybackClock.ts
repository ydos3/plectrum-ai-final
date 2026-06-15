import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { estimatePlaybackClockTimeMs, PlaybackClockSample } from '../services/lyricsSync';

type YouTubePlaybackClockOptions = {
  enabled: boolean;
  playerRef: MutableRefObject<any>;
  durationMs: number;
  pollIntervalMs?: number;
};

const PLAYING_STATE = 1;

const nowMs = () => (
  typeof performance !== 'undefined' ? performance.now() : Date.now()
);

const readPlaybackRate = (player: any) => {
  const rate = player?.getPlaybackRate?.();
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : 1;
};

const readMediaTimeMs = (player: any, durationMs: number) => {
  const time = player?.getCurrentTime?.();
  if (typeof time !== 'number' || !Number.isFinite(time)) return 0;
  return Math.min(Math.max(0, time * 1000), Math.max(0, durationMs));
};

const readIsActive = (player: any) => (
  player?.getPlayerState?.() === PLAYING_STATE
);

export const useYouTubePlaybackClock = ({
  enabled,
  playerRef,
  durationMs,
  pollIntervalMs = 250,
}: YouTubePlaybackClockOptions) => {
  const clockRef = useRef<PlaybackClockSample>({
    mediaTimeMs: 0,
    sampleTimeMs: nowMs(),
    playbackRate: 1,
    isActive: false,
  });
  const [snapshot, setSnapshot] = useState(clockRef.current);

  const syncNow = useCallback((isActiveOverride?: boolean) => {
    const player = playerRef.current;
    if (!enabled || !player) return clockRef.current;

    const nextSample: PlaybackClockSample = {
      mediaTimeMs: readMediaTimeMs(player, durationMs),
      sampleTimeMs: nowMs(),
      playbackRate: readPlaybackRate(player),
      isActive: typeof isActiveOverride === 'boolean' ? isActiveOverride : readIsActive(player),
    };

    clockRef.current = nextSample;
    setSnapshot(nextSample);
    return nextSample;
  }, [durationMs, enabled, playerRef]);

  const getEstimatedTimeMs = useCallback(() => (
    estimatePlaybackClockTimeMs(clockRef.current, nowMs(), durationMs)
  ), [durationMs]);

  useEffect(() => {
    if (!enabled) {
      const stopped = {
        ...clockRef.current,
        sampleTimeMs: nowMs(),
        isActive: false,
      };
      clockRef.current = stopped;
      setSnapshot(stopped);
      return;
    }

    syncNow();
    const intervalId = window.setInterval(() => {
      const actual = syncNow();
      const estimated = estimatePlaybackClockTimeMs(clockRef.current, nowMs(), durationMs);
      if (Math.abs(estimated - actual.mediaTimeMs) > 300) {
        clockRef.current = actual;
      }
    }, pollIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [durationMs, enabled, pollIntervalMs, syncNow]);

  return {
    snapshot,
    syncNow,
    getEstimatedTimeMs,
  };
};
