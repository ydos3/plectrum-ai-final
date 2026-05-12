# Plectrum.ai 9/10 Implementation Plan

## 1. Current Repo Understanding

Plectrum.ai is a client-side Vite + React + TypeScript application using npm. There is no backend/API route layer in this repository. The app runs from `index.tsx` into `App.tsx`, with view state switching between auth/onboarding, library, composer, teleprompter, chat, analyzer, chord trainer, fretboard lab, practice room, and tuner.

Persistence is local-first:
- Songs are stored in `localStorage` via `services/storageService.ts`.
- User/auth state is stored in `localStorage` via `services/authService.ts`.
- Practice recordings are saved in IndexedDB via `services/recordingDb.ts`.

AI is handled in `services/geminiService.ts`. Vite injects `GEMINI_API_KEY` from environment variables in `vite.config.ts`. Gemini is used for chat, image analysis, song recommendations, search suggestions, YouTube video ID lookup, and song/chord sheet generation. Song search first tries LRCLIB in `services/songDatabaseService.ts`, then falls back to Gemini.

The current main product surfaces are:
- `App.tsx`: landing/auth/onboarding and view orchestration.
- `components/SongEditor.tsx`: composer/search flow, Gemini generation, manual editing, saving songs.
- `components/SongList.tsx`: saved song library, print/PDF, quick actions.
- `components/Teleprompter.tsx`: full-screen lyric/chord teleprompter with karaoke/YouTube support.
- `components/PracticeRoom.tsx`: recording and creator/practice mode using camera, canvas filters, teleprompter panel, and IndexedDB takes.
- `components/GuitarTuner.tsx` and `services/tunerService.ts`: browser mic tuner using Web Audio and pitch detection.
- `components/FretboardLab.tsx`, `components/GuitarFretboard.tsx`, `components/ChordTrainer.tsx`, `services/chordService.ts`, `services/audioService.ts`: guitar visualization, chord learning, and playback helpers.
- `components/AIChat.tsx`: Bes, the AI guide.

The app has a strong brown/wood/acoustic visual identity with amber accents, dark panels, cursive logo treatment, and music-studio language. It is already mobile-aware, but the core workflow is not yet presented as one coherent journey.

## 2. Product Positioning

Positioning: “AI-powered guitar practice and cover-creation studio.”

One-line pitch: Turn any song idea into a playable guitar practice session, then rehearse, tune, record, and save your cover workflow.

Homepage headline: Learn, practice, and record any song on guitar with AI.

Homepage subheadline: Search a song, get playable chords, simplify them for your level, follow live lyrics, tune your guitar, and create better covers.

Primary CTA: Start with a song.

Secondary CTA: Open guitar tuner.

Best target user: Beginner-to-intermediate guitarists and social cover creators who want fast, playable arrangements instead of scattered tabs, lyric pages, tuner apps, and recording tools.

## 3. Current Strengths

- Warm, memorable acoustic brand identity.
- Existing end-to-end pieces: song generation, library, teleprompter, karaoke, tuner, fretboard tools, practice recording, AI chat.
- Local-first persistence lowers infrastructure complexity.
- Gemini integration is centralized and already returns JSON for song generation.
- Teleprompter and practice room are differentiated and creator-oriented.
- Guitar-specific features are deeper than a generic AI song app.
- Multilingual transliteration support has already started.
- YouTube parser/fallback and tuner lifecycle have already been strengthened.

## 4. Current Weaknesses

- The main product story is hidden behind separate tools rather than one clear workflow.
- Song generation does not consistently expose skill level, difficulty, simplification, recommended key, or practice tips in the UI.
- Library is useful but not retention-focused yet: no favorites, last practiced, notes, or arrangement preference.
- AI assistant is helpful but not context-aware to the current song or practice workflow.
- No analytics layer exists to understand activation and retention.
- No backend cache or account sync exists, so saved songs/recordings are device-local.
- Public launch legal posture around copyrighted lyrics should be tightened.
- Monetization gates and upgrade paths are not implemented.
- Testing coverage is minimal; verification is mostly build/manual.

## 5. The Ideal Core User Flow

Search -> Skill Level -> Practice Sheet -> Simplify/Transpose/Capo -> Teleprompter/Karaoke -> Tune -> Record -> Save/Share.

The product should make the first session feel obvious:
1. User searches a song or provides lyrics.
2. User selects Beginner, Intermediate, or Advanced.
3. AI creates a practice-ready song sheet with sections, chords, capo, strumming, difficulty, tips, and safe lyric/transliteration handling.
4. User can simplify chords, transpose key, adjust capo, or ask Bes for coaching.
5. User opens teleprompter/karaoke to rehearse.
6. User tunes the guitar.
7. User records a take in Practice Room.
8. User saves, revisits, exports, or shares.

## 6. Must-Fix Before Public Launch

| Feature/Issue | Why it matters | User impact | Engineering effort | Files likely involved | Priority |
|---|---|---|---|---|---|
| Core workflow clarity | Users need to understand the product in 5 seconds | Higher activation | Low | `App.tsx`, `SongList.tsx`, `SongEditor.tsx` | P0 |
| Skill-level song generation | Beginners leave when chords are too hard | Better first success | Low-medium | `SongEditor.tsx`, `geminiService.ts`, `types.ts` | P0 |
| Copyright-safe lyric posture | Public launch risk | Safer product positioning | Medium | `geminiService.ts`, UI copy | P0 |
| Structured practice-sheet schema | Enables simplification, transpose, tips | Better AI reliability | Medium | `geminiService.ts`, `types.ts`, parser/UI | P0 |
| Make this song easier | Core beginner value prop | Better retention | Medium | `SongEditor.tsx`, `geminiService.ts` | P0 |
| Better loading/error states | AI and media can fail | More trust | Low | `SongEditor.tsx`, `Teleprompter.tsx`, `GuitarTuner.tsx` | P1 |
| Library retention metadata | Users need reasons to return | More repeat usage | Medium | `storageService.ts`, `SongList.tsx`, `types.ts` | P1 |
| Recording workflow polish | Creator positioning depends on it | Differentiation | Medium | `PracticeRoom.tsx`, `recordingDb.ts` | P1 |
| Analytics events | Need product feedback loop | Better launch decisions | Low-medium | new `analyticsService.ts`, main components | P1 |
| Account/backend sync | Device-local storage limits growth | Cross-device retention | High | new backend/database | P2 |

## 7. 9/10 Feature Roadmap

Immediate quick wins:
- Sharpen homepage headline/subheadline/CTA.
- Add flow hints: Search -> Practice -> Perform -> Save.
- Add visible skill level selector to song generation.
- Include difficulty, recommended key, simplification, and practice tips in Gemini output.
- Surface song metadata in library cards.
- Improve empty states and generation errors.

v1 launch must-haves:
- Reliable practice-sheet schema.
- “Make this song easier for me.”
- Transpose/capo controls.
- Teleprompter section jumps and countdown.
- Better library search/filter.
- Recently practiced tracking.
- Safer lyric policy and user-provided lyric workflow.
- Basic analytics events.

Retention features:
- Favorites.
- Recently practiced.
- Practice notes.
- Preferred key/capo per song.
- Daily streak/reminder.
- Saved arrangements.
- Continue where you left off.

Creator features:
- Countdown recording.
- Save takes.
- Export cover title/caption/hashtags.
- Shareable practice/cover card.
- Teleprompter + camera templates.
- Reels-friendly portrait mode.

Monetization features:
- Free save limits.
- Pro simplification/transposition/multilingual limits.
- Creator recording/export features.
- Upgrade prompts tied to clear moments of value.

Long-term moat:
- Personal practice memory.
- Voice-range-aware key recommendations.
- AI cover coach.
- Arrangement library.
- Community-safe public share pages.
- Cross-device synced practice studio.

## 8. AI Prompt and Schema Upgrade

Current prompt issues:
- Prompts are guitar-specific but still ask for “exact official lyrics,” which is risky for public launch.
- Output schema is partly structured but underpowered for a practice engine.
- Skill level is not consistently part of generation.
- Practice tips, simplifications, difficulty, confidence, and warnings are not first-class fields.
- Chord simplification is only indirectly requested through prompt suffixes.

Suggested schema:
```json
{
  "title": "Song Title",
  "artist": "Artist",
  "key": "Original key",
  "recommendedKey": "Easier/singable key",
  "capo": 0,
  "strummingPattern": "D-DU-UDU",
  "difficulty": "Beginner | Intermediate | Advanced",
  "skillLevel": "Beginner | Intermediate | Advanced",
  "practiceTips": ["Tip 1", "Tip 2"],
  "chordSimplifications": [
    { "from": "F", "to": "Fmaj7", "reason": "Avoids full barre" }
  ],
  "warnings": ["Use user-provided lyrics for full copyrighted text when needed"],
  "confidence": "high | medium | low",
  "language": "English",
  "languageFallbackReason": "",
  "karaokeUrl": "https://www.youtube.com/watch?v=...",
  "duration": 240,
  "content": "### [Verse 1]\n[G]Line..."
}
```

Suggested prompt improvements:
- Position Gemini as a practice assistant, arrangement assistant, chord simplifier, transliteration assistant, and cover coach.
- Preserve existing `content` format with inline `[Chord]` markers.
- Always include `capo`, `strummingPattern`, `difficulty`, `practiceTips`, and `chordSimplifications`.
- For Beginner, prefer open chords, capo use, fewer chord shapes, and simple strumming.
- For Advanced, preserve richer voicings and performance detail.
- Keep transliteration instructions explicit: phonetic transcription, not meaning translation.

Copyright-safe lyric strategy:
- Prefer user-provided lyrics for full lyric sheets.
- For searched songs, provide practice arrangement, sections, chord progression, short excerpts if needed, and guidance to paste lyrics when full text cannot be safely provided.
- Do not add scraping. Do not present the app as a copyrighted lyric database.

Caching strategy:
- Include search query, language, skill level, arrangement mode, capo preference, and simplification mode in cache keys.
- Store generated arrangements separately from raw songs.
- Do not reuse English/Roman output for Hindi/Gujarati transliteration.

Error handling strategy:
- Missing API key: show setup message, not raw stack.
- Gemini failure: show retry, manual editor, and paste lyrics options.
- JSON parse failure: attempt safe fallback, then keep user input intact.
- YouTube blocked: show Open on YouTube and Try another version.

## 9. UI/UX Upgrade Plan

Homepage:
- Lead with “Learn, practice, and record any song on guitar with AI.”
- Show one primary CTA: Start with a song.
- Show secondary utility CTA: Open guitar tuner.
- Add workflow chips: Search, Practice, Perform, Save.

Song search/result:
- Make search the dominant Composer action.
- Add skill selector.
- Show difficulty, capo, key, strumming, simplifications, and practice tips after generation.
- Add “Make easier,” “Transpose,” and “Open Teleprompter” actions.

Teleprompter:
- Keep full-screen mobile-first mode.
- Add countdown, section jumps, and creator mode later.
- Preserve high-contrast lyric text over dark stage/nebula/wood-inspired backgrounds.

Karaoke:
- Keep robust parser/fallback.
- Add clearer source picker and manual paste.
- Add mobile-friendly blocked-video fallback.

Tuner:
- Maintain start/stop, mic states, cents meter, target strings, smoothing.
- Add calibration later if needed.

AI assistant:
- Make Bes context-aware with current song, skill, key, capo, and recent actions.
- Add quick prompts for “make easier,” “teach me in 10 minutes,” and “cover caption.”

Composer:
- Add structured result summary.
- Add simplify/transpose hooks.
- Keep manual editing prominent.

Guitar simulator:
- Add BPM, loop, strumming pattern selector, and AI continuation later.

Library:
- Improve empty state.
- Add saved arrangement metadata.
- Add favorites, recent, notes, and filters.

Mobile layout:
- Prioritize one primary CTA per screen.
- Keep controls thumb-friendly.
- Avoid clutter in song cards.

## 10. Engineering Refactor Plan

What to modularize:
- Song arrangement types and parsing utilities.
- AI prompt builders.
- YouTube utilities.
- Chord transformation/simplification utilities.
- Analytics events.

What to cache:
- AI song arrangements by query/language/skill/simplification.
- YouTube lookup results.
- Recent practice sessions.

What utilities to add:
- `songMetadataService` for difficulty/tips/simplification metadata.
- `transposeService` for chord shifts.
- `analyticsService` for event logging.
- `practiceSessionService` for last opened/practiced timestamps.

What errors to handle:
- Gemini missing key, rate limits, parse failures.
- LRCLIB network failure.
- YouTube unavailable/blocked.
- Mic/camera permission denied.
- IndexedDB unavailable/quota exceeded.

What tests to add:
- YouTube ID parser.
- Chord parser.
- Transpose utility.
- Tuner math utilities.
- Gemini response normalization.
- Storage migration/default handling.

What not to touch yet:
- No heavy backend migration in the same pass.
- No aggressive lyric scraping.
- No broad visual redesign that loses the wood/acoustic identity.
- No large dependency additions until product surface stabilizes.

## 11. Analytics Plan

Recommended events:
- `song_search_started`
- `song_result_generated`
- `skill_level_changed`
- `simplify_chords_clicked`
- `transpose_used`
- `capo_suggestion_used`
- `teleprompter_started`
- `karaoke_opened`
- `tuner_started`
- `recording_started`
- `song_saved`
- `share_card_exported`
- `library_song_opened`

Also track error events:
- `gemini_generation_failed`
- `youtube_embed_failed`
- `mic_permission_denied`
- `camera_permission_denied`
- `song_save_failed`

## 12. Monetization Plan

Free:
- Basic song search.
- Basic tuner.
- Basic teleprompter.
- Limited saves.

Pro:
- Unlimited AI practice sheets.
- Simplify chords.
- Transpose/capo tools.
- Saved library.
- Multilingual transliteration.
- Practice plans.

Creator:
- Recording mode.
- Cover planner.
- Share/export cards.
- Caption/hashtag generator.
- Advanced library.

Suggested pricing:
- India Pro: Rs 149-Rs 299/month.
- India Creator: Rs 399-Rs 699/month.
- Global Pro: $4.99-$7.99/month.
- Global Creator: $9.99-$14.99/month.

## 13. 30-Day Build Plan

Week 1:
- Finalize positioning, homepage, song search, skill selector, prompt schema, safe lyric policy, and library metadata.
- Add analytics stubs.

Week 2:
- Build “Make easier,” transpose, capo controls, and practice-sheet result summary.
- Add recent/favorite/notes library features.

Week 3:
- Upgrade teleprompter with countdown, section jumps, and creator mode.
- Polish Practice Room recording flow and saved takes.

Week 4:
- Add share/export cards, Pro/Creator upgrade gates, onboarding polish, and launch QA.
- Add tests for parsers, storage, and utility logic.

## 14. What I Implemented In This Run

Implemented safely in this run:
- Added the plan file itself.
- Sharpened landing/onboarding CTA direction toward “Start with a song” and “Open guitar tuner.”
- Added visible workflow hints: Search -> Practice -> Perform -> Save.
- Changed onboarding skill labels toward Beginner, Intermediate, Advanced.
- Passed user skill level into Composer.
- Added Composer practice-level controls: Beginner, Intermediate, Advanced.
- Added a lightweight “Make easier” hook that reruns generation with beginner/open-chord/capo intent.
- Expanded the Gemini song-generation prompts without breaking the existing `content` parser.
- Added optional song metadata fields for recommended key, difficulty, practice tips, and chord simplifications.
- Saved and displayed practice-sheet metadata in Composer and Library where available.
- Improved the Library empty state and primary action card to reinforce the core practice-session workflow.

## 15. What Needs A Separate Prompt

- Full transpose engine with chord rewriting and UI.
- Complete “Make easier” engine with chord substitution preview and diff.
- Backend/user accounts/sync.
- Analytics provider integration.
- Monetization/paywall implementation.
- Shareable public pages.
- Creator export card/image/PDF pipeline.
- Context-aware Bes connected to current song/session.
- Full legal-safe lyric workflow redesign.
