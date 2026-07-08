
import { AppLanguage, Song } from '../types';

const STORAGE_KEY = 'plectrum_songs_db';

// Original fingerstyle demo arrangement (Plectrum tab notation). NO copyrighted
// lyrics. Played with Capo 5 at ~1.4x for the ballad feel. Moves through the
// Am–Em–F–C–G–E progression with arpeggios, a hammer-on, a slide and a slap.
const CHANNA_FINGERSTYLE_TAB = [
    // Intro — Am, Em
    'A0-e0-B1-G2-B1-e0-E0-e0-B0-G0-B0-e0',
    // Verse — F(maj7), C
    'D3-e0-B1-G2-B1-e0-A3-e0-B1-G0-B1-e0',
    // Verse — G, Am
    'E3-e3-B0-G0-B0-e3-A0-e0-B1-G2-B1-e0',
    // Lift — hammer-on + slide flourish
    'e0-h-e2-B1-s-B3-B3-p-B1-G0',
    // Chorus — E to Am with chord stabs
    'E0/G1/B0/e0-e0-B0-G1-A0/G2/B1/e0-e0-B1-G2',
    // Chorus — F to C
    'D3/G2/B1/e0-e0-B1-G2-A3/G0/B1/e0-e0-B1-G0',
    // Tag
    'slap-A0-e0',
].join('-');

const CHANNA_DEMO_CONTENT = `### [Fingerstyle Demo — Tabs Only]
An original fingerstyle arrangement for practice.
Open in Fretboard Lab to play the full tab.

### [How to play]
Capo 5 · play at ~1.4x speed for the ballad feel.

### [Progression]
Am   Em   F   C   G   E

### [Note]
Demo arrangement only. Plectrum does not publish copyrighted lyrics.`;

// Bundled demo songs. These are merged into every user library (by id) so
// they stay available and fresh across updates without clobbering user edits.
const BUILTIN_DEMO_SONGS: Song[] = [
    {
        id: 'builtin_channa_mereya_demo',
        title: 'Channa Mereya',
        artist: 'Arijit Singh / Fingerstyle Demo',
        movie: 'Bollywood Fingerstyle Demos',
        collection: 'Bollywood Fingerstyle Demos',
        status: 'tabs-only',
        isBuiltIn: true,
        key: 'Am',
        capo: 5,
        language: 'Hindi',
        fingerstyleTab: CHANNA_FINGERSTYLE_TAB,
        createdAt: 0,
        content: CHANNA_DEMO_CONTENT,
    },
];

const DEFAULT_SONGS: Song[] = [
    {
        id: 'default_1000_years',
        title: 'A Thousand Years',
        artist: 'Christina Perri',
        movie: 'Twilight',
        releaseDate: '2011',
        key: 'Bb',
        capo: 3,
        status: 'complete',
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

const countLyricLines = (content: string) => (
  content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('###')).length
);

const getSectionLabel = (header: string) => {
  const match = header.match(/^###\s*\[([^\]]+)\]/);
  return (match?.[1] || header.replace(/^#+\s*/, '')).trim();
};

const relabelSection = (block: string, label: string) => (
  block.replace(/^###\s*\[[^\]]+\]/, `### [${label}]`)
);

const completePerformanceArrangement = (content: string, minimumLines = 24) => {
  if (!content || countLyricLines(content) >= minimumLines) return content;

  const blocks = content
    .split(/\n(?=###\s*\[[^\]]+\])/)
    .map(block => block.trim())
    .filter(Boolean);

  if (blocks.length < 2) return content;

  const findBlock = (pattern: RegExp) => blocks.find(block => pattern.test(getSectionLabel(block)));
  const intro = findBlock(/intro/i);
  const verse1 = findBlock(/verse\s*1/i) || findBlock(/verse/i);
  const verse2 = findBlock(/verse\s*2/i);
  const preChorus = findBlock(/pre/i);
  const chorus = findBlock(/chorus/i);
  const bridge = findBlock(/bridge/i);
  const outro = findBlock(/outro/i);

  if (!verse1 || !chorus) return content;

  const arranged = [
    intro && relabelSection(intro, 'Intro'),
    relabelSection(verse1, 'Verse 1'),
    preChorus && relabelSection(preChorus, 'Pre-Chorus 1'),
    relabelSection(chorus, 'Chorus 1'),
    relabelSection(verse2 || verse1, 'Verse 2'),
    preChorus && relabelSection(preChorus, 'Pre-Chorus 2'),
    relabelSection(chorus, 'Chorus 2'),
    bridge && relabelSection(bridge, 'Bridge'),
    relabelSection(chorus, 'Final Chorus'),
    outro && relabelSection(outro, 'Outro'),
  ].filter(Boolean) as string[];

  const arrangedContent = arranged.join('\n\n');
  return countLyricLines(arrangedContent) > countLyricLines(content)
    ? arrangedContent
    : content;
};

const normalizeStoredSong = (song: Song): Song => ({
  ...song,
  // Tab-only demos have no lyric arrangement to expand; leave them untouched.
  content: song.fingerstyleTab
    ? (song.content || '')
    : completePerformanceArrangement(song.content || ''),
});

// Ensure bundled demo songs are present (keyed by id) without clobbering user
// edits. Built-in demos that the user has not modified are refreshed to the
// latest bundled version so demo content never goes stale.
const withBuiltInDemos = (songs: Song[]): Song[] => {
  const merged = [...songs];
  BUILTIN_DEMO_SONGS.forEach(demo => {
    const idx = merged.findIndex(s => s.id === demo.id);
    if (idx === -1) {
      merged.push(demo);
    } else if (merged[idx].isBuiltIn) {
      // Refresh unmodified built-ins to the latest bundled content.
      merged[idx] = { ...demo, createdAt: merged[idx].createdAt || demo.createdAt };
    }
  });
  return merged;
};

export const getSongs = (): Song[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) {
        // Initialize with default + built-in demo songs if library is empty
        const normalizedDefaults = withBuiltInDemos(DEFAULT_SONGS).map(normalizeStoredSong);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedDefaults));
        return normalizedDefaults;
    }
    const songs = withBuiltInDemos((JSON.parse(data) as Song[])).map(normalizeStoredSong);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
    return songs;
  } catch (e) {
    console.error("Failed to load songs", e);
    return [];
  }
};

export const saveSong = (song: Song): void => {
  const data = localStorage.getItem(STORAGE_KEY);
  const allSongs: Song[] = data ? JSON.parse(data) : [];
  const normalizedSong = normalizeStoredSong(song);

  const existingIndex = allSongs.findIndex(s => s.id === normalizedSong.id);
  
  if (existingIndex >= 0) {
    allSongs[existingIndex] = normalizedSong;
  } else {
    allSongs.push(normalizedSong);
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
