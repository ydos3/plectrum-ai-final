
export interface TunerResult {
    note: string;
    octave: number;
    frequency: number;
    cents: number;
    isInTune: boolean;
    targetNote: string;
    targetFrequency: number;
    stringIndex: number;
    status: 'flat' | 'in-tune' | 'sharp';
    /** Auto-match landed between two strings — UI must not assert a target. */
    ambiguous: boolean;
    /** Following this reading needs a large tighten — likely the wrong string. */
    risky: boolean;
}

export const TUNINGS = {
    'Standard': { name: 'Standard', frequencies: [82.41, 110.00, 146.83, 196.00, 246.94, 329.63], notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
    'Drop D': { name: 'Drop D', frequencies: [73.42, 110.00, 146.83, 196.00, 246.94, 329.63], notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
    'Open G': { name: 'Open G', frequencies: [73.42, 98.00, 146.83, 196.00, 246.94, 293.66], notes: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'] },
    'DADGAD': { name: 'DADGAD', frequencies: [73.42, 110.00, 146.83, 196.00, 220.00, 293.66], notes: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] },
    'Bass Standard': { name: 'Bass Standard', frequencies: [41.20, 55.00, 73.42, 98.00], notes: ['E1', 'A1', 'D2', 'G2'] }
};

const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const IN_TUNE_THRESHOLD_CENTS = 5;

// ── Safety ───────────────────────────────────────────────────────────────────
// Guitar strings sit a 4th apart (500 cents; G–B is 400), so a pitch more than
// ~200 cents from every string is genuinely ambiguous — it could belong to either
// neighbour. Auto-matching it anyway is how a tuner tells someone tuning a SHARP
// low E (say 100 Hz) that they are a flat A2 and should tighten to 110 Hz. That is
// a 4th too high on that string: tension rises with the SQUARE of frequency
// (~+78%), which is how strings get snapped. We surface ambiguity instead.
// 150 cents ≈ a tone and a half. A string you are actually tuning is rarely that
// far off, whereas 100 Hz (a sharp low E) lands 165 cents under A2 — so this
// threshold catches the misidentified-string case while leaving normal
// corrections (a few tens of cents) untouched.
export const AMBIGUOUS_MATCH_CENTS = 150;
/** Raising pitch this far (~+18% tension) is beyond a normal correction. */
export const RISKY_RAISE_CENTS = 150;

/** String tension rises with the square of frequency. */
export const tensionRatio = (fromFrequency: number, toFrequency: number): number =>
    (toFrequency / fromFrequency) ** 2;

export interface TuningSafety {
    /** Cents the player must move to reach the target (+ = must tighten). */
    centsToTarget: number;
    /** Approximate tension multiplier if they tune to the target. */
    tension: number;
    /** True when the required change is a big upward jump — likely wrong string. */
    risky: boolean;
    /** True when the pitch is too far from any string to attribute confidently. */
    ambiguous: boolean;
}

/**
 * Judge whether following this tuner reading is safe. Pure, so it is unit-tested.
 * `risky` means "you are probably on a different string than the tuner thinks" —
 * the UI must warn rather than silently instruct a big tighten.
 */
export const assessTuningSafety = (detectedFrequency: number, targetFrequency: number): TuningSafety => {
    const centsToTarget = centsOffFromPitch(targetFrequency, detectedFrequency);
    return {
        centsToTarget,
        tension: tensionRatio(detectedFrequency, targetFrequency),
        risky: centsToTarget > RISKY_RAISE_CENTS,
        ambiguous: Math.abs(centsToTarget) > AMBIGUOUS_MATCH_CENTS,
    };
};

export const centsOffFromPitch = (frequency: number, targetFrequency: number) => (
    1200 * Math.log2(frequency / targetFrequency)
);

export const findNearestGuitarString = (
    frequency: number,
    tuning = TUNINGS.Standard,
    preferredNote?: string | null
) => {
    if (preferredNote) {
        const preferredIndex = tuning.notes.indexOf(preferredNote);
        if (preferredIndex >= 0) {
            const cents = centsOffFromPitch(frequency, tuning.frequencies[preferredIndex]);
            // Manual lock: the player chose the string, so it is never "ambiguous" —
            // this is the safe mode and the one we steer users toward.
            return {
                note: tuning.notes[preferredIndex],
                frequency: tuning.frequencies[preferredIndex],
                index: preferredIndex,
                cents,
                ambiguous: false,
            };
        }
    }

    const nearest = tuning.frequencies.reduce((best, targetFrequency, index) => {
        const cents = centsOffFromPitch(frequency, targetFrequency);
        return Math.abs(cents) < Math.abs(best.cents)
            ? { note: tuning.notes[index], frequency: targetFrequency, index, cents }
            : best;
    }, {
        note: tuning.notes[0],
        frequency: tuning.frequencies[0],
        index: 0,
        cents: centsOffFromPitch(frequency, tuning.frequencies[0]),
    });

    // Flag readings that sit between two strings. The UI must not present these
    // as a confident "tune to X" instruction (see AMBIGUOUS_MATCH_CENTS).
    return { ...nearest, ambiguous: Math.abs(nearest.cents) > AMBIGUOUS_MATCH_CENTS };
};

/**
 * Enhanced Autocorrelation Algorithm (McLeod Pitch Method simplified)
 * Good balance of CPU usage and accuracy for guitar.
 */
export const detectPitchYIN = (audioData: Float32Array, sampleRate: number): number | null => {
    const bufferSize = audioData.length;
    let rms = 0;
    for (let i = 0; i < bufferSize; i++) rms += audioData[i] * audioData[i];
    rms = Math.sqrt(rms / bufferSize);
    if (rms < 0.008) return null;

    const minFrequency = 65;
    const maxFrequency = 1200;
    const minTau = Math.max(2, Math.floor(sampleRate / maxFrequency));
    const maxTau = Math.min(Math.floor(sampleRate / minFrequency), Math.floor(bufferSize / 2));
    const yinBuffer = new Float32Array(maxTau + 1);

    for (let tau = minTau; tau <= maxTau; tau++) {
        let sum = 0;
        for (let i = 0; i < maxTau; i++) {
            const delta = audioData[i] - audioData[i + tau];
            sum += delta * delta;
        }
        yinBuffer[tau] = sum;
    }

    let runningSum = 0;
    yinBuffer[0] = 1;
    for (let tau = minTau; tau <= maxTau; tau++) {
        runningSum += yinBuffer[tau];
        yinBuffer[tau] = runningSum === 0 ? 1 : yinBuffer[tau] * tau / runningSum;
    }

    const threshold = 0.12;
    let tauEstimate = -1;
    for (let tau = minTau; tau <= maxTau; tau++) {
        if (yinBuffer[tau] < threshold) {
            while (tau + 1 <= maxTau && yinBuffer[tau + 1] < yinBuffer[tau]) tau++;
            tauEstimate = tau;
            break;
        }
    }

    if (tauEstimate === -1) return null;

    const betterTau = parabolicInterpolate(yinBuffer, tauEstimate);
    const frequency = sampleRate / betterTau;
    return Number.isFinite(frequency) && frequency >= minFrequency && frequency <= maxFrequency ? frequency : null;
};

const parabolicInterpolate = (buffer: Float32Array, tau: number) => {
    const x0 = tau < 1 ? tau : tau - 1;
    const x2 = tau + 1 < buffer.length ? tau + 1 : tau;
    if (x0 === tau || x2 === tau) return tau;

    const s0 = buffer[x0];
    const s1 = buffer[tau];
    const s2 = buffer[x2];
    const denominator = 2 * (2 * s1 - s2 - s0);
    if (denominator === 0) return tau;
    return tau + (s2 - s0) / denominator;
};

export const detectPitch = detectPitchYIN;

export const getNoteFromFrequency = (
    frequency: number,
    tuning = TUNINGS.Standard,
    preferredNote?: string | null
): TunerResult => {
    // A4 = 440Hz is the reference
    const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
    const roundedNoteNum = Math.round(noteNum) + 69; // MIDI note number

    const noteIndex = roundedNoteNum % 12;
    const note = NOTE_STRINGS[noteIndex];
    const octave = Math.floor(roundedNoteNum / 12) - 1;

    // Cents calculation
    const perfectFreq = 440 * Math.pow(2, (roundedNoteNum - 69) / 12);
    const nearestString = findNearestGuitarString(frequency, tuning, preferredNote);
    const cents = Math.round(nearestString.cents);
    const isInTune = Math.abs(cents) <= IN_TUNE_THRESHOLD_CENTS;
    const safety = assessTuningSafety(frequency, nearestString.frequency);

    return {
        note,
        octave,
        frequency,
        cents,
        isInTune,
        targetNote: nearestString.note,
        targetFrequency: nearestString.frequency,
        stringIndex: nearestString.index,
        status: isInTune ? 'in-tune' : cents < 0 ? 'flat' : 'sharp',
        ambiguous: nearestString.ambiguous,
        // A manual lock is the player's own choice, so never nag in that mode.
        risky: !preferredNote && safety.risky,
    };
};
