/**
 * Type definitions for the private acoustic setlist database schema.
 * Maps to the bundled acoustic setlist database schema.
 */

export interface AcousticDbSong {
  id: string;
  title: string;
  album?: string;
  film_show?: string | null;
  singers: string[];
  composer?: string;
  lyricist?: string;
  arranger?: string;
  producer?: string;
  label?: string;
  release_year?: number;
  release_date?: string;
  language: string[];
  genre: string[];
  bpm?: number;
  duration_sec?: number | null;
  verified_key: string;
  capo: number;
  chords_no_capo: string[];
  capo_alt?: number;
  chords_with_capo_alt?: string[];
  easy_shape: string;
  strumming_pattern: string;
  time_signature?: string;
  cover_difficulty: string;
  collab_type?: string;
  reel_potential?: string;
  lyrics: {
    [sectionKey: string]: string[];
  };
  verification_flag: 'VERIFIED' | 'UNVERIFIED' | 'PARTIAL';
  verification_notes?: string;
}

export interface AcousticDbMeta {
  schema_version: string;
  created: string;
  description: string;
  total_songs: number;
  verified_sources?: string[];
  notes?: {
    [key: string]: string;
  };
}

export interface AcousticSetlistDatabase {
  _meta: AcousticDbMeta;
  songs: AcousticDbSong[];
}

export interface SongSearchMatch {
  song: AcousticDbSong;
  confidence: number;
  matchType:
    | 'exact-title'
    | 'normalized-title'
    | 'title-singer'
    | 'partial-title'
    | 'album-film-title'
    | 'fuzzy';
}

export interface SongSearchOptions {
  minConfidence?: number;
  includePartial?: boolean;
  languages?: string[];
}

export const DEFAULT_MIN_CONFIDENCE = 0.78;
