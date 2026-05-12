
import { AppLanguage, Song } from '../types';

const STORAGE_KEY = 'plectrum_songs_db';

const DEFAULT_SONGS: Song[] = [
    {
        id: 'default_1000_years',
        title: 'A Thousand Years',
        artist: 'Christina Perri',
        movie: 'Twilight',
        releaseDate: '2011',
        key: 'Bb',
        capo: 3,
        strummingPattern: 'D-D-U-U-D-U',
        duration: 285,
        karaokeUrl: 'https://www.youtube.com/watch?v=rtOvBOTyX00',
        language: 'English',
        createdAt: Date.now(),
        content: `### [Verse 1]
Heart beats fast [G]
Colors and pro[Em7]mises
How to be brave [Cadd9]
How can I love when I'm [G] afraid to [D] fall
But watching you stand [G] alone
All of my doubt [Em7] suddenly goes away somehow [Cadd9]
One step [D] closer

### [Chorus]
[G] I have died every day [D/F#] waiting for you
[Em7] Darling don't be afraid I have [D] loved you
For a [Cadd9] thousand years
I'll love you for a [D] thousand more

### [Verse 2]
Time stands still [G]
Beauty in all [Em7] she is
I will be brave [Cadd9]
I will not let anything [G] take away [D] what's standing in front of me
[G] Every breath
Every hour has [Em7] come to this
[Cadd9] One step [D] closer

### [Chorus]
[G] I have died every day [D/F#] waiting for you
[Em7] Darling don't be afraid I have [D] loved you
For a [Cadd9] thousand years
I'll love you for a [D] thousand more

[G] And all along I believed [D/F#] I would find you
[Em7] Time has brought your heart to me
I have [D] loved you for a [Cadd9] thousand years
I'll love you for a [D] thousand more`
    }
];

export const getSongs = (): Song[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) {
        // Initialize with default song if library is empty
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SONGS));
        return DEFAULT_SONGS;
    }
    return JSON.parse(data);
  } catch (e) {
    console.error("Failed to load songs", e);
    return [];
  }
};

export const saveSong = (song: Song): void => {
  const data = localStorage.getItem(STORAGE_KEY);
  const allSongs: Song[] = data ? JSON.parse(data) : [];

  const existingIndex = allSongs.findIndex(s => s.id === song.id);
  
  if (existingIndex >= 0) {
    allSongs[existingIndex] = song;
  } else {
    allSongs.push(song);
  }
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(allSongs));
};

export const deleteSong = (id: string): void => {
  const data = localStorage.getItem(STORAGE_KEY);
  const allSongs: Song[] = data ? JSON.parse(data) : [];
  const updatedSongs = allSongs.filter(s => String(s.id) !== String(id));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSongs));
};

export const findSongByTitle = (query: string, language?: AppLanguage): Song | undefined => {
    const songs = getSongs();
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const q = normalize(query);
    
    // Exact match or very close containment
    return songs.find(s => {
        const songLanguage = s.language || 'English';
        const titleMatches = normalize(s.title) === q || normalize(s.title).includes(q) && q.length > 4;
        return titleMatches && (!language || songLanguage === language);
    });
};
