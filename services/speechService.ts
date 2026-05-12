/**
 * Web Speech API Service
 * Centralized wrapper for browser-native speech recognition & synthesis.
 * No external dependencies - pure Web Speech API.
 */

let recognitionInstance: any = null;

// ─── Speech Recognition (STT) ─────────────────────────────────────────

export const startListening = (
  lang: string = 'en-US',
  onResult: (transcript: string) => void,
  onError?: (error: string) => void,
  onStart?: () => void,
  onEnd?: () => void
): boolean => {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    onError?.('Speech recognition not supported. Use Chrome, Edge, or Safari.');
    return false;
  }

  try {
    stopListening(); // Clean up any previous instance

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onstart = () => onStart?.();
    recognition.onend = () => onEnd?.();
    recognition.onerror = (event: any) => {
      console.error('[Speech] Error:', event.error);
      onError?.(event.error);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        onResult(transcript);
      }
    };

    recognition.start();
    recognitionInstance = recognition;
    return true;
  } catch (e) {
    console.error('[Speech] Init failed:', e);
    onError?.('Failed to start speech recognition. Check microphone permissions.');
    return false;
  }
};

export const stopListening = (): void => {
  try {
    recognitionInstance?.stop();
  } catch (e) {
    // Ignore - may already be stopped
  }
  recognitionInstance = null;
};

export const isListening = (): boolean => {
  return recognitionInstance !== null;
};

// ─── Speech Synthesis (TTS) ───────────────────────────────────────────

export const speak = (text: string, rate: number = 1.0): void => {
  if (!window.speechSynthesis) return;

  window.speechSynthesis.cancel(); // Stop any current speech

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = rate;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  // Try to use a good English voice
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v =>
    v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural'))
  ) || voices.find(v => v.lang.startsWith('en'));

  if (preferred) utterance.voice = preferred;

  window.speechSynthesis.speak(utterance);
};

export const stopSpeaking = (): void => {
  window.speechSynthesis?.cancel();
};
