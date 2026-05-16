# Acoustic Setlist Database

Project-local database file:

`data/acoustic_setlist_db.min.json`

Imported from:

`C:\Users\Yuval\.gemini\antigravity\scratch\acoustic_setlist_db.min.json`

## Lookup Flow

Plectrum AI searches this bundled local database first in `services/songDatabaseLookup.ts`.

1. The user query is normalized by `normalizeSongQuery`.
2. `searchSongDatabase` scores local records by title, singer/artist, album/film, keywords, partial matches, and fuzzy similarity.
3. A confident match is mapped by `mapDatabaseSongToExistingGeminiFormat` into the same response shape used by the existing Gemini song generation flow.
4. If the local match is missing, ambiguous, too low confidence, or cannot be mapped safely, the existing LRCLIB/Gemini fallback in `services/geminiService.ts` continues as before.

Runtime code uses the project-local file only. It does not read from the original scratch path.

## Adding Songs

Add records to `data/acoustic_setlist_db.min.json` using the existing schema:

- `title`
- `singers`
- `album` or `film_show` when available
- `verified_key`
- `capo`
- `easy_shape`
- `strumming_pattern`
- `lyrics` as section arrays with inline `[Chord]` markers
- `verification_flag`

Do not add secrets or API keys to this file.

## Validation

Run:

```bash
npm run validate:song-db
```

Sample queries checked by the script:

- `apna bana le chords`
- `apna banale arijit`
- `kesariya guitar tabs`
- `majboor acoustic`
- `perfect ed sheeran chords`
- `finding her guitar`
- `unknown random song not in db`
