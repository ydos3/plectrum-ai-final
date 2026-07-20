// Precise on-device hand tracking for Air Strum using MediaPipe Hand Landmarker.
//
// This is what makes gesture instruments (like the reference reel) feel smooth
// and only respond to the hand: it tracks the 21 hand landmarks and gives us
// the index-fingertip position per hand, instead of coarse whole-frame motion.
//
// Loaded lazily from a CDN only when the camera starts. It is fully defensive —
// if the module or model can't load (offline, blocked, unsupported), the caller
// falls back to the built-in motion detector. Frames NEVER leave the device;
// MediaPipe runs entirely in the browser (only the model file is fetched).

export interface HandPoint {
  x: number; // on-screen normalized 0..1 (already mirrored to match the flipped video)
  y: number; // normalized 0..1, top→bottom
}

export interface HandTracker {
  detect(video: HTMLVideoElement, timestampMs: number): HandPoint[];
  close(): void;
}

const TASKS_VISION_URL = 'https://esm.sh/@mediapipe/tasks-vision@0.10.14';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const INDEX_FINGERTIP = 8;

// A process-wide singleton so the (heavy) model + WASM download happens at most
// once per session and can be started BEFORE Air Strum opens (see warmUpHandTracker).
let sharedTrackerPromise: Promise<HandTracker | null> | null = null;

/**
 * Kick off (or reuse) loading the hand tracker. Call this on intent — e.g. when
 * the user hovers/taps the Air Strum nav — so the model is already downloading by
 * the time the screen mounts, making it feel near-instant. Cheap to call repeatedly.
 */
export const warmUpHandTracker = (): Promise<HandTracker | null> => {
  if (!sharedTrackerPromise) sharedTrackerPromise = createHandTracker();
  return sharedTrackerPromise;
};

export const createHandTracker = async (): Promise<HandTracker | null> => {
  try {
    // Variable specifier keeps the bundler/TS from statically resolving it.
    const specifier = TASKS_VISION_URL;
    const vision: any = await import(/* @vite-ignore */ specifier);
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);

    const makeOptions = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      numHands: 2,
      runningMode: 'VIDEO' as const,
      minHandDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    let landmarker: any;
    try {
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, makeOptions('GPU'));
    } catch {
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, makeOptions('CPU'));
    }

    return {
      detect(video: HTMLVideoElement, timestampMs: number): HandPoint[] {
        try {
          const res = landmarker.detectForVideo(video, timestampMs);
          const hands: any[] = res?.landmarks || [];
          // The video is displayed mirrored (-scale-x-100), so mirror x too.
          return hands
            .filter(lm => lm && lm[INDEX_FINGERTIP])
            .map(lm => ({ x: 1 - lm[INDEX_FINGERTIP].x, y: lm[INDEX_FINGERTIP].y }));
        } catch {
          return [];
        }
      },
      close() {
        try { landmarker.close(); } catch { /* ignore */ }
      },
    };
  } catch {
    // MediaPipe unavailable → caller uses the motion-detection fallback.
    return null;
  }
};
