import assert from 'node:assert/strict';
import {
  applyManualScrollOverride,
  calculateTwoPointCalibration,
  estimatePlaybackClockTimeMs,
  findActiveCueIndex,
  lyricTimeToVideoTimeMs,
  moveLyricsEarlier,
  moveLyricsLater,
  parseLrcToCues,
  resetSongSyncState,
  restoreAutoFollow,
  timedLyricsToCues,
  videoTimeToLyricTimeMs,
} from '../services/lyricsSync.ts';

const cues = parseLrcToCues(`
[00:12.40]I found a love for me
[00:17.80]Darling, just dive right in
[00:22.10]And follow my lead
`);

assert.equal(cues.length, 3, 'LRC parsing returns timestamped lines');
assert.equal(cues[0].startMs, 12400, 'LRC timestamps parse to milliseconds');
assert.equal(cues[0].endMs, 17800, 'end-time generation uses the next cue start');
assert.equal(cues[2].endMs, 26100, 'final cue uses fallback duration');

assert.equal(findActiveCueIndex(cues, 17850), 1, 'active cue selection uses cue timestamp ranges');
assert.equal(findActiveCueIndex(cues, 1000), -1, 'before-first-line state has no active cue');
assert.equal(findActiveCueIndex(cues, 28000), 2, 'after-last-line state keeps the most recent cue');

const offsetCorrection = { offsetMs: 500, scale: 1 };
assert.equal(videoTimeToLyricTimeMs(10000, offsetCorrection), 10500, 'offset is applied in video-to-lyric mapping');
assert.equal(lyricTimeToVideoTimeMs(10500, offsetCorrection), 10000, 'click-to-seek maps lyric time back to video time');

const earlier = moveLyricsEarlier({ offsetMs: 0, scale: 1 }, 100);
assert.equal(earlier.offsetMs, 100, 'Lyrics earlier increases lyric time for the same video time');
assert.equal(findActiveCueIndex([{ id: 'a', startMs: 10000, endMs: 15000, text: 'line' }], videoTimeToLyricTimeMs(9900, earlier)), 0, 'Lyrics earlier makes the next lyric active sooner');

const later = moveLyricsLater({ offsetMs: 0, scale: 1 }, 100);
assert.equal(later.offsetMs, -100, 'Lyrics later decreases lyric time for the same video time');
assert.equal(findActiveCueIndex([{ id: 'a', startMs: 10000, endMs: 15000, text: 'line' }], videoTimeToLyricTimeMs(10000, later)), -1, 'Lyrics later delays the next lyric');

const calibrated = calculateTwoPointCalibration(
  { videoTimeMs: 10000, lyricTimeMs: 12000 },
  { videoTimeMs: 70000, lyricTimeMs: 73500 }
);
assert.ok(calibrated, 'two-point calibration accepts valid distant points');
assert.ok(calibrated!.scale > 1 && calibrated!.scale < 1.1, 'two-point calibration calculates gradual drift scale');

assert.equal(calculateTwoPointCalibration(
  { videoTimeMs: 10000, lyricTimeMs: 12000 },
  { videoTimeMs: 10200, lyricTimeMs: 12200 }
), null, 'invalid calibration rejects points that are too close');

assert.equal(calculateTwoPointCalibration(
  { videoTimeMs: 10000, lyricTimeMs: 10000 },
  { videoTimeMs: 70000, lyricTimeMs: 90000 }
), null, 'invalid calibration rejects absurd scale values');

assert.equal(videoTimeToLyricTimeMs(20000, { offsetMs: 1000, scale: 1.05 }), 22000, 'video-time-to-lyric-time mapping supports scale and offset');
assert.equal(lyricTimeToVideoTimeMs(22000, { offsetMs: 1000, scale: 1.05 }), 20000, 'lyric-time-to-video-time mapping supports scale and offset');

assert.equal(estimatePlaybackClockTimeMs({
  mediaTimeMs: 10000,
  sampleTimeMs: 1000,
  playbackRate: 1.5,
  isActive: true,
}, 3000), 13000, 'playback-rate changes affect clock estimation only');

const gapCues = timedLyricsToCues([
  { time: 0, text: 'Before the solo' },
  { time: 30, text: 'After the solo' },
]);
assert.equal(findActiveCueIndex(gapCues, 20000), 0, 'long instrumental gaps keep the most recent line active');

const duplicateCues = timedLyricsToCues([
  { time: 10, text: 'One' },
  { time: 10, text: 'Two' },
  { time: 12, text: 'Three' },
]);
assert.equal(duplicateCues[0].startMs, duplicateCues[1].startMs, 'duplicate timestamps are preserved');
assert.notEqual(findActiveCueIndex(duplicateCues, 10000), -1, 'duplicate timestamps still produce an active cue');

const reset = resetSongSyncState();
assert.deepEqual(reset, { offsetMs: 0, scale: 1 }, 'song change reset clears sync correction');

const manual = applyManualScrollOverride();
assert.deepEqual(manual, { paused: true, showReturn: true }, 'manual-scroll override pauses auto-follow and shows return');
assert.deepEqual(restoreAutoFollow(), { paused: false, showReturn: false }, 'return-to-current-line restores auto-follow');

console.log('lyrics sync tests passed');
