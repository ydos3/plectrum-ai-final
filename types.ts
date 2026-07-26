
export type InstrumentType = 'Guitar';
export type Handedness = 'Right' | 'Left';
export type AppLanguage = 'English' | 'Hindi' | 'Bengali' | 'Telugu' | 'Marathi' | 'Tamil' | 'Urdu' | 'Gujarati' | 'Kannada' | 'Malayalam' | 'Odia' | 'Punjabi' | 'Assamese' | 'Maithili';
export type SkillLevel = 'Beginner' | 'Intermediate' | 'Advanced' | 'Professional';

export interface User {
  id: string;
  name: string;
  /** Email used as the account identity; namespaces the saved song library. */
  email?: string;
  skillLevel: SkillLevel;
  subscriptionStatus: 'trial' | 'active' | 'expired';
  trialEndDate: number;
  isAdmin?: boolean;
}

// Honest completeness labelling so incomplete/demo content is never presented
// as a polished, complete song.
export type SongStatus =
  | 'complete'
  | 'demo'
  | 'incomplete'
  | 'tabs-only'
  | 'lyrics-only'
  | 'needs-sync';

export interface Song {
  id: string;
  title: string;
  artist: string;
  movie?: string;
  releaseDate?: string;
  content: string; // Text format with [Chords]
  key?: string;
  recommendedKey?: string;
  capo?: number;
  strummingPattern?: string;
  /** Playable fingerstyle tab in Plectrum tab notation (see services/tabParser.ts). */
  fingerstyleTab?: string;
  /** Album/collection this song belongs to, e.g. "Bollywood Fingerstyle Demos". */
  collection?: string;
  /** Honest completeness status; drives library labelling. */
  status?: SongStatus;
  /** True for bundled demo content so we can keep it fresh across app updates. */
  isBuiltIn?: boolean;
  difficulty?: 'Beginner' | 'Intermediate' | 'Advanced' | string;
  practiceTips?: string[];
  chordSimplifications?: { from: string; to: string; reason?: string }[];
  duration?: number;
  karaokeUrl?: string; // YouTube URL for backing track
  language?: AppLanguage; // Lyric script/transliteration target
  timedLyrics?: {      // For karaoke sync
    time: number;
    text: string;
    chords?: string[];
  }[];
  createdAt: number;
  /** Last-modified timestamp (ms). Used for last-write-wins cloud sync; set on every save. */
  updatedAt?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export type ViewState = 'AUTH' | 'SUBSCRIPTION' | 'ONBOARDING' | 'LIBRARY' | 'EDITOR' | 'TELEPROMPTER' | 'CHAT' | 'ANALYZER' | 'CHORD_TRAINER' | 'FRETBOARD_LAB' | 'PRACTICE_ROOM' | 'AIR_STRUM' | 'TUNER' | 'CONNECTIONS';

export interface ViewProps {
  changeView: (view: ViewState, data?: any) => void;
}

export interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: any) => void;
}

export interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

export interface SpeechRecognitionResult {
  isFinal: boolean;
  [0]: SpeechRecognitionAlternative;
}

export interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
