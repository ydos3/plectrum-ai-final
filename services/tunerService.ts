
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
            return {
                note: tuning.notes[preferredIndex],
                frequency: tuning.frequencies[preferredIndex],
                index: preferredIndex,
                cents,
            };
        }
    }

    return tuning.frequencies.reduce((nearest, targetFrequency, index) => {
        const cents = centsOffFromPitch(frequency, targetFrequency);
        return Math.abs(cents) < Math.abs(nearest.cents)
            ? { note: tuning.notes[index], frequency: targetFrequency, index, cents }
            : nearest;
    }, {
        note: tuning.notes[0],
        frequency: tuning.frequencies[0],
        index: 0,
        cents: centsOffFromPitch(frequency, tuning.frequencies[0]),
    });
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
    };
};
