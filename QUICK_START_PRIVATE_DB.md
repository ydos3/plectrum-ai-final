# 🎸 Private DB Integration - Quick Start Guide

## ✅ What Was Done

Your **25-song acoustic_setlist_db.json** is now the **first search layer** in Plectrum AI.

### Flow
```
Query → [NEW] Private DB ✅ → [OLD] LRCLIB → [OLD] Gemini
```

### Key Files Created
- `/data/acoustic_setlist_db.json` (25 songs)
- `/services/songDbTypes.ts` (types)
- `/services/privateSongDb.ts` (normalization + fuzzy matching)
- `/services/privateSongRepository.ts` (DB loader + search)
- `/services/mapAcousticDbToResponse.ts` (adapter to Gemini format)
- `/api/test-song-lookup.ts` (test endpoint)
- `PRIVATE_DB_INTEGRATION.md` (full documentation)

### Key Files Modified
- `/services/geminiService.ts` (added DB lookup at start)
- `/.env.local` (added DB config)
- `/.env.example` (documented)
- `/package.json` (added test command)

---

## 🚀 Local Testing (5 minutes)

### Start the app
```bash
npm run dev
```

### Test in browser
1. Open http://localhost:5173
2. Go to **Teleprompter** or **Song Editor**
3. Search: **"Majboor"**
   - ✅ Should return instantly from private DB
   - ✅ Lyrics + chords visible
4. Search: **"bairan"** (case-insensitive)
   - ✅ Should match "Bairan"
5. Search: **"Some Random XYZ"**
   - ⏳ Should eventually call Gemini (slower)

### Test via API
```bash
# Should return private DB result
curl -X POST http://localhost:5173/api/test-song-lookup \
  -H "Content-Type: application/json" \
  -d '{"query":"Majboor"}'

# Check for "source": "private_db" in response
```

---

## 📊 25 Songs in Database

```
S001  Majboor (Sheheryar Rehan, Zoha Waseem)
S002  Bairan (Banjaare)
S003  Jaiye Sajana (Jasmine Sandlas, Satinder Sartaaj, Sheheryar Rehan)
S004  Gehra Hua (Arijit Singh, Armaan Khan)
S005  Apna Bana Le (Arijit Singh)
S006  Agar Tum Saath Ho (Arijit Singh)
... (19 more)
```

→ See full list in `/PRIVATE_DB_INTEGRATION.md`

---

## ⚙️ Configuration

In `.env.local`:
```bash
PRIVATE_SONG_DB_ENABLED=true           # Enable/disable DB
PRIVATE_SONG_DB_MIN_CONFIDENCE=0.78    # Match threshold (0–1)
PRIVATE_SONG_DB_MODE=json              # Always 'json'
```

To **disable** DB (use Gemini only):
```bash
PRIVATE_SONG_DB_ENABLED=false
```

---

## 📝 How DB Lookup Works

1. **Normalize query** → lowercase, remove punctuation
2. **Search by:**
   - Title (exact, normalized, partial, fuzzy)
   - Singer(s)
   - Album/Film
   - Genre, Language, Easy Shape
3. **Score confidence:**
   - Exact match: 1.00
   - Normalized: 0.98
   - Title+Singer: 0.95
   - Partial: 0.82–0.93
   - Fuzzy (Levenshtein): 0.75+
4. **If confidence ≥ 0.78:**
   - Map DB song → Gemini response format
   - Return instantly
5. **Else:**
   - Fall back to LRCLIB/Gemini as before

---

## 🎯 Response Format

Private DB returns **exact same format** as Gemini:

```json
{
  "title": "Majboor",
  "artist": "Sheheryar Rehan, Zoha Waseem",
  "content": "### [Verse 1]\n[Em] Sachi tu ya main jhoota [Bm]\n...",
  "key": "G",
  "capo": 0,
  "strummingPattern": "D - D - U U D - D U",
  "difficulty": "Beginner",
  "practiceTips": [...],
  "chordSimplifications": [...],
  "duration": 145,
  "language": "Hindi",
  "source": "private_db",
  "_debug": { "confidence": 1.0, ... }  // dev mode
}
```

---

## 🧪 Verification Checklist

Before going to production:

- [ ] `npm run dev` starts without errors
- [ ] Search "Majboor" → Private DB hit ✅
- [ ] Search "majboor" (lowercase) → Match ✅
- [ ] Search "Arijit" → Title+Singer match ✅
- [ ] Search "Random XYZ" → Falls back to Gemini ✅
- [ ] Karaoke mode works (see lyrics+chords)
- [ ] Paste mode works (copy formatted lyrics)
- [ ] No TypeScript errors: `npx tsc --noEmit` ✅
- [ ] `_debug` field shows confidence score
- [ ] `.env.local` has all DB settings

---

## 🚨 Troubleshooting

| Problem | Solution |
|---------|----------|
| Can't find DB songs | Check `PRIVATE_SONG_DB_ENABLED=true` in `.env.local` |
| Getting Gemini results instead | Check query confidence (might be <0.78) |
| No lyrics in results | Check song has complete `lyrics` object in JSON |
| TypeScript errors | Run `npm install` to ensure all deps loaded |
| Private DB disabled? | Set `PRIVATE_SONG_DB_ENABLED=true` |

---

## 📦 Deployment

When ready:
```bash
npm run build      # Creates dist/
npm run deploy:vercel
```

**Private DB will work on Vercel because:**
- JSON bundled in dist/
- No backend database needed
- Gemini fallback ensures it always works

---

## 💾 Adding More Songs

1. Open `/data/acoustic_setlist_db.json`
2. Add new song object to `songs[]` array
3. Keep schema consistent
4. Restart `npm run dev`

**Schema required:**
```json
{
  "id": "S026",
  "title": "Song Title",
  "singers": ["Artist Name"],
  "verified_key": "G",
  "capo": 0,
  "lyrics": {
    "verse1": ["[G] Lyric line with chords [D]"],
    "chorus": ["[G] Chorus line [C]"]
  },
  ...
}
```

---

## 📞 Need Help?

See `PRIVATE_DB_INTEGRATION.md` for:
- Detailed architecture
- All files changed
- Full confidence scoring rules
- Karaoke timing (future)
- Performance notes
- Backend integration (future)

---

**Status:** ✅ **Ready for Local Testing**  
**Date:** 2026-05-15
