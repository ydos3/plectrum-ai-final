// Pure, dependency-free strum detector for the Air Strum / Gesture Guitar
// section. It consumes lightweight motion samples (horizontal motion centroid +
// magnitude) and emits down/up strum events with velocity gating and debounce.
//
// Keeping the detection logic pure (no DOM / camera) means it is fully unit
// testable with mocked samples and could later be fed by a hand-landmark model
// (e.g. MediaPipe) instead of the on-device frame-differencing we ship today.

export type StrumDirection = 'down' | 'up';

export interface MotionSample {
  /** Horizontal centroid of motion, normalized 0 (left) .. 1 (right). */
  centroidX: number;
  /** Overall motion magnitude, normalized 0 .. 1. */
  magnitude: number;
  /** Timestamp in milliseconds (monotonic). */
  time: number;
}

export interface StrumEvent {
  direction: StrumDirection;
  /** Absolute horizontal velocity in normalized units per second. */
  velocity: number;
  time: number;
}

export interface StrumDetectorOptions {
  /** Below this motion magnitude we treat the frame as "no hand". */
  motionThreshold: number;
  /** Minimum |velocity| (fraction/sec) to count as a deliberate strum. */
  velocityThreshold: number;
  /** Minimum gap between strums, milliseconds. */
  debounceMs: number;
}

export const DEFAULT_STRUM_OPTIONS: StrumDetectorOptions = {
  motionThreshold: 0.02,
  velocityThreshold: 1.1,
  debounceMs: 160,
};

export class StrumDetector {
  private opts: StrumDetectorOptions;
  private lastX: number | null = null;
  private lastTime = 0;
  private lastStrumTime = Number.NEGATIVE_INFINITY;

  constructor(options: Partial<StrumDetectorOptions> = {}) {
    this.opts = { ...DEFAULT_STRUM_OPTIONS, ...options };
  }

  setOptions(options: Partial<StrumDetectorOptions>) {
    this.opts = { ...this.opts, ...options };
  }

  /** Clears motion history (e.g. when the hand leaves the frame). */
  reset() {
    this.lastX = null;
    this.lastTime = 0;
  }

  /**
   * Feed one motion sample. Returns a StrumEvent when a strum is recognized,
   * otherwise null.
   */
  push(sample: MotionSample): StrumEvent | null {
    const { magnitude, centroidX, time } = sample;

    // No meaningful motion → treat as hand absent and forget history so we
    // never compute a bogus velocity across a gap.
    if (magnitude < this.opts.motionThreshold) {
      this.lastX = null;
      this.lastTime = time;
      return null;
    }

    if (this.lastX !== null) {
      const dt = (time - this.lastTime) / 1000;
      if (dt > 0) {
        const vx = (centroidX - this.lastX) / dt; // fraction / second
        const withinDebounce = time - this.lastStrumTime < this.opts.debounceMs;
        if (Math.abs(vx) >= this.opts.velocityThreshold && !withinDebounce) {
          this.lastStrumTime = time;
          this.lastX = centroidX;
          this.lastTime = time;
          return {
            direction: vx > 0 ? 'down' : 'up',
            velocity: Math.abs(vx),
            time,
          };
        }
      }
    }

    this.lastX = centroidX;
    this.lastTime = time;
    return null;
  }
}
