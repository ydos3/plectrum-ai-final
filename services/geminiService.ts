
import { AppLanguage, SkillLevel } from "../types";
import { searchSongDatabase, parseSyncedLyrics } from "./songDatabaseService";

// ─── Model Configuration ──────────────────────────────────────────────
// Pro handles high-value generation and vision. Flash handles lightweight UX paths.
// SECURITY: the browser never receives the Gemini key. Calls go through /api/gemini.

const isMissingApiKeyError = (error: unknown) => (
  error instanceof Error && (
    error.message.toLowerCase().includes('gemini api key is not configured') ||
    error.message.toLowerCase().includes('api key is not configured')
  )
);

const MODELS = {
  PRO: "gemini-2.5-pro",         // Heavy: generation, analysis, chat (stable, paid-tier)
  FLASH: "gemini-2.5-flash",     // Light: suggestions, search, recommendations (stable, fast)
} as const;

const LANGUAGE_SCRIPT_HINTS: Record<AppLanguage, string> = {
  English: 'English/Roman script',
  Hindi: 'Hindi in Devanagari script',
  Bengali: 'Bengali script',
  Telugu: 'Telugu script',
  Marathi: 'Marathi in Devanagari script',
  Tamil: 'Tamil script',
  Urdu: 'Urdu script',
  Gujarati: 'Gujarati script',
  Kannada: 'Kannada script',
  Malayalam: 'Malayalam script',
  Odia: 'Odia script',
  Punjabi: 'Punjabi in Gurmukhi script',
  Assamese: 'Assamese script',
  Maithili: 'Maithili in Devanagari script',
};

const getLyricLanguageInstruction = (language: AppLanguage) => {
  if (language === 'English') {
    return `Output lyric text in English/Roman script. If the original lyrics are in a non-Latin script, provide a singable Romanized phonetic transcription. Do not translate the meaning.`;
  }

  return `MANDATORY: output lyric text in ${LANGUAGE_SCRIPT_HINTS[language] || language}, not English/Roman. Convert only the lyric text into a phonetic transcription/transliteration in the selected language/script. Do not translate the meaning. Preserve the song's sung words, chord positions, line breaks, verse/chorus labels, and structure. Keep chord names in standard notation like C, G, Am, F#m. If exact transliteration is uncertain, choose the most singable phonetic approximation. If ${language} cannot be handled, use English/Roman output and set "languageFallbackReason" in the JSON response.`;
};

// ─── Retry Helper ─────────────────────────────────────────────────────

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelayMs: number = 1000
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const status = error?.status || error?.code || error?.message || '';
      if (
        String(status).includes('429') ||
        String(status).includes('503') ||
        String(error?.message || '').toLowerCase().includes('resource exhausted') ||
        String(error?.message || '').toLowerCase().includes('rate limit')
      ) {
        const waitTime = initialDelayMs * Math.pow(2, attempt);
        console.log(`Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}...`);
        await delay(waitTime);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// ─── Core API Call ────────────────────────────────────────────────────

const callGeminiApi = async (model: string, contents: any[], config: any = {}) => {
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      contents,
      generationConfig: {
        candidateCount: 1,
        temperature: 0.2,
        ...config
      }
    })
  });

  if (!response.ok) {
    let errorMessage = `Gemini API Error: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData?.error || errorMessage;
    } catch {
      // Keep the sanitized status message.
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  if (!candidate) return "";
  const part = candidate.content?.parts?.[0];
  return part?.text || "";
};

// ─── Chat (Gemini 3.1 Pro) ─────────────────────────────────────────────

export const sendChatMessage = async (
  message: string,
  history: { role: 'user' | 'model', text: string }[]
): Promise<string> => {
  try {
    const recentHistory = history.slice(-6);
    const contents = recentHistory.map(msg => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.text.slice(0, 900) }]
    }));
    contents.push({ role: 'user', parts: [{ text: message.slice(0, 1200) }] });

    const responseText = await retryWithBackoff(async () => {
      return await callGeminiApi(MODELS.FLASH, contents, {
        maxOutputTokens: 360,
        systemInstruction: {
          parts: [{ text: `You are Bes, an AI Luthier and wise Guitar Guide. You speak with a calm, knowledgeable tone. Help the user with guitar chords, scales, songwriting, practice tips, and music theory. Be concise but helpful.` }]
        }
      });
    });

    return responseText || "I am tuning my strings... please try again.";
  } catch (error) {
    console.error("Gemini Chat Error:", error);
    if (isMissingApiKeyError(error)) {
      return "Bes is not connected to Gemini yet. Add `GEMINI_API_KEY` to the server environment, then restart.";
    }
    return `I could not reach Gemini right now. ${error instanceof Error ? error.message : String(error)}`;
  }
};

// ─── Image Analysis (Gemini 3.1 Pro) ───────────────────────────────────

export const analyzeImage = async (base64Image: string, prompt: string): Promise<string> => {
  try {
    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');
    const contents = [{
      parts: [
        { inlineData: { mimeType: 'image/png', data: cleanBase64 } },
        { text: prompt }
      ]
    }];

    const responseText = await retryWithBackoff(async () => {
      return await callGeminiApi(MODELS.PRO, contents, { maxOutputTokens: 1800 });
    });
    return responseText || "No analysis could be generated.";
  } catch (error) {
    console.error("Gemini Vision Error:", error);
    return `Failed to analyze image. Error: ${error instanceof Error ? error.message : String(error)}`;
  }
};

// ─── Song Recommendations (Gemini 3 Flash - fast) ──────────────────────

export const getSongRecommendations = async (historyTitles: string[], language: string): Promise<string[]> => {
  try {
    const historyContext = historyTitles.length > 0
      ? `The user has these songs in their library: ${historyTitles.join(', ')}.`
      : "The user is new.";

    const prompt = `${historyContext} Suggest 5 new song titles that fit their taste or are popular guitar songs, strictly in the ${language} language/region if the history suggests it, otherwise mix. Return ONLY a JSON array of strings.`;

    const responseText = await retryWithBackoff(async () => {
      return await callGeminiApi(MODELS.FLASH, [{ role: 'user', parts: [{ text: prompt }] }], {
        responseMimeType: "application/json",
        maxOutputTokens: 160
      });
    });

    return responseText ? JSON.parse(responseText) : ["Wonderwall", "Hotel California", "Perfect", "Hallelujah"];
  } catch (e) {
    console.error("Song Recommendations Error:", e);
    return ["Wonderwall", "Hotel California", "Perfect", "Hallelujah"];
  }
};

// ─── Search Suggestions (Gemini 3 Flash - fast) ───────────────────────

export const getSearchSuggestions = async (query: string): Promise<string[]> => {
  if (!query || query.length < 2) return [];
  try {
    const prompt = `User Input: "${query}".
            Task: Identify the song based on the Title OR the Lyrics provided in the input.
            Rules:
            1. If the input matches a song title (e.g., "Tum"), return songs starting with "Tum".
            2. If the input matches a famous lyric (e.g., "palm of my hand"), return the song containing that lyric (e.g., "A Thousand Years").
            3. Return only REAL, commercially available songs.
            4. Be consistent. Do not change answers randomly.
            Format: JSON Array of strings (Song Titles only).`;

    const responseText = await retryWithBackoff(async () => {
      return await callGeminiApi(MODELS.FLASH, [{ role: 'user', parts: [{ text: prompt }] }], {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 140
      });
    });

    return responseText ? JSON.parse(responseText) : [];
  } catch (e) {
    console.error("Search Suggestions Error:", e);
    return [];
  }
};

// ─── YouTube ID Finder (Gemini 2.5 Flash - fast) ───────────────────────

export const getYouTubeVideoId = async (query: string): Promise<string | null> => {
  try {
    const prompt = `Find the best embeddable 11-character YouTube Video ID for: "${query}".
    Prefer, in order: official audio, official lyric video, official music video, high-quality acoustic cover, karaoke/instrumental version when the query asks for karaoke.
    Avoid unavailable, private, region-blocked, Shorts-only, age-restricted, or obviously non-embeddable videos when possible.
    Return ONLY the 11-character ID string. Do not return a full URL. Do not return markdown. If you cannot find a reliable candidate, return exactly "NOT_FOUND".`;

    const responseText = await retryWithBackoff(async () => {
      return await callGeminiApi(MODELS.FLASH, [{ role: 'user', parts: [{ text: prompt }] }], {
        temperature: 0.1,
        maxOutputTokens: 16
      });
    });

    const id = responseText.trim();
    if (id === "NOT_FOUND" || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;
    return id;
  } catch (e) {
    console.error("YouTube ID Finder Error:", e);
    return null;
  }
};

// ─── Song Generation (DB-First → Gemini 3.1 Pro fallback) ──────────────

const normalizePracticeSkill = (skillLevel?: SkillLevel) => (
  skillLevel === 'Beginner' || skillLevel === 'Intermediate' ? skillLevel : 'Advanced'
);

export const generateSongFromTitle = async (query: string, language: AppLanguage = 'English', skillLevel: SkillLevel = 'Intermediate'): Promise<any> => {
  const practiceSkill = normalizePracticeSkill(skillLevel);
  // STEP 1: Try database first (LRCLIB) — instant, no AI cost
  const dbResult = await searchSongDatabase(query);

  if (dbResult && dbResult.plainLyrics) {
    console.log('[SongGen] Database hit! Using LRCLIB lyrics for:', dbResult.title);

    // We have lyrics from DB. Now use Gemini 3.1 Pro to add accurate chords
    try {
      const lyricLanguageRule = getLyricLanguageInstruction(language);

      const chordPrompt = `You are a professional music transcriber with decades of experience.

TASK: Add accurate guitar chords and a practice-ready arrangement to the following lyrics for "${dbResult.title}" by "${dbResult.artist}".
OUTPUT LANGUAGE/SCRIPT: ${language}
TARGET SKILL LEVEL: ${practiceSkill}

STRICT RULES — FOLLOW EXACTLY:
1. CHORD ACCURACY:
   - Use the REAL, published chords for this song as they appear in official songbooks, Ultimate Guitar, or professional sheet music.
   - Do NOT invent or approximate chords. If you are uncertain about a specific chord, use the most commonly accepted version from reputable guitar tab sources.
   - Include chord variations where the original uses them (e.g., Cadd9 instead of C, Fmaj7 instead of F).

2. CHORD PLACEMENT:
   - Place each chord in [square brackets] DIRECTLY BEFORE the syllable/word where the chord change occurs.
   - Example: "[G]Here comes the [C]sun, [D]doo doo doo [G]doo"

3. SONG STRUCTURE:
   - Use "### [Section]" headers: ### [Intro], ### [Verse 1], ### [Pre-Chorus], ### [Chorus], ### [Verse 2], ### [Bridge], ### [Outro], etc.
   - Preserve the exact sung words. ${lyricLanguageRule}
   - Keep each lyric line on its own line. Do NOT merge lines into paragraphs.
   - Transliterate/transcribe phonetically; do not translate meaning.

4. METADATA:
   - Detect the correct musical key of the original recording.
   - Suggest a recommendedKey if a different key is easier or more singable for ${practiceSkill}; otherwise repeat the original key.
   - If a capo is commonly used for this song, specify the fret position. Otherwise set capo to 0.
   - Provide the most common strumming pattern (e.g., "D-DU-UDU", "D-D-U-U-D-U").
   - Provide difficulty, practiceTips, and chordSimplifications for ${practiceSkill}.
   - For Beginner, prefer open chords, capo suggestions, slower strumming, and substitutions for barre or complex chords.
   - "karaokeUrl": A valid "https://www.youtube.com/watch?v=..." link to the official music video or a popular karaoke/lyrics video. Do NOT use shortened youtu.be or music.youtube.com links.

OUTPUT FORMAT (strict JSON, no markdown fences):
{
  "key": "e.g. G Major",
  "recommendedKey": "e.g. G Major",
  "capo": 0,
  "strummingPattern": "D-DU-UDU",
  "difficulty": "${practiceSkill}",
  "skillLevel": "${practiceSkill}",
  "practiceTips": ["short, practical tip for learning this song"],
  "chordSimplifications": [{"from": "F", "to": "Fmaj7", "reason": "avoids full barre"}],
  "karaokeUrl": "https://www.youtube.com/watch?v=...",
  "language": "${language}",
  "languageFallbackReason": "",
  "content": "full lyrics with [chords] inline, using ### [Section] headers, line-by-line"
}

LYRICS TO ANNOTATE:
${dbResult.plainLyrics}`;

      const chordResponse = await retryWithBackoff(async () => {
        return await callGeminiApi(MODELS.PRO, [{ role: 'user', parts: [{ text: chordPrompt }] }], {
          responseMimeType: "application/json",
          temperature: 0.1,
          maxOutputTokens: 8192
        });
      });

      const cleanText = chordResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      const chordData = JSON.parse(cleanText);

      return {
        title: dbResult.title,
        artist: dbResult.artist,
        key: chordData.key || '',
        recommendedKey: chordData.recommendedKey || chordData.key || '',
        capo: chordData.capo || 0,
        strummingPattern: chordData.strummingPattern || '',
        difficulty: chordData.difficulty || practiceSkill,
        practiceTips: Array.isArray(chordData.practiceTips) ? chordData.practiceTips : [],
        chordSimplifications: Array.isArray(chordData.chordSimplifications) ? chordData.chordSimplifications : [],
        karaokeUrl: chordData.karaokeUrl || '',
        language: language,
        languageFallbackReason: chordData.languageFallbackReason || '',
        content: chordData.content || dbResult.plainLyrics,
        duration: dbResult.duration,
        timedLyrics: dbResult.syncedLyrics,
        source: 'database', // Flag for UI
      };
    } catch (e) {
      console.warn('[SongGen] Chord addition failed', e);
      if (isMissingApiKeyError(e)) {
        throw e;
      }
      throw new Error(`I found lyrics for "${dbResult.title}", but Gemini could not add chords/transliteration. Please retry, or paste your lyrics manually and generate again.`);
    }
  }

  // STEP 2: Full AI generation with Gemini 3.1 Pro
  console.log('[SongGen] No DB hit, using Gemini 3.1 Pro for:', query);

  try {
    const langInstruction = language === 'English' ? "English/Roman" : `${language} (${LANGUAGE_SCRIPT_HINTS[language] || 'selected script'})`;
    const lyricLanguageRule = getLyricLanguageInstruction(language);
    const prompt = `You are a professional music transcriber and guitar teacher with access to the world's largest library of published guitar tabs and sheet music.

USER REQUEST: "${query}"
TARGET LANGUAGE/SCRIPT: ${langInstruction}
TARGET SKILL LEVEL: ${practiceSkill}

TASK: Create a practice-ready guitar arrangement for this song.

STRICT RULES — FOLLOW EXACTLY:

1. LYRICS:
   - Return the COMPLETE, UNABRIDGED lyrics of the song — every verse, chorus, bridge, pre-chorus, and outro.
   - Use the EXACT original words as published. Do NOT paraphrase, truncate, or summarize.
   - ${lyricLanguageRule}
   - Transliterate/transcribe phonetically; do not translate meaning.

2. CHORD ACCURACY:
   - Use the REAL, published chords as they appear in official songbooks, Ultimate Guitar (highest-rated tabs), or professional transcriptions.
   - Do NOT invent chords. Use the most widely accepted chord progression for this song.
   - Include variations (sus4, add9, 7ths, etc.) where the original recording uses them.
   - Place chords in [square brackets] directly before the word/syllable where the chord change occurs.

3. SONG STRUCTURE:
   - Use "### [Section]" headers: ### [Intro], ### [Verse 1], ### [Pre-Chorus], ### [Chorus], ### [Verse 2], ### [Bridge], ### [Outro], etc.
   - If the song has an instrumental intro or interlude, notate the chords for that section too with a "### [Intro]" or "### [Interlude]" header.
   - Each lyric line must be on its own line. Do NOT merge lines into paragraphs.

4. METADATA:
   - "key": The correct musical key of the original studio recording.
   - "recommendedKey": A friendlier or more singable key for ${practiceSkill}, or the original key if no change is needed.
   - "capo": The most common capo position used to play this song with open chords. 0 if no capo is standard.
   - "strummingPattern": The most widely taught strumming pattern for this song (e.g., "D-DU-UDU").
   - "difficulty": Beginner, Intermediate, or Advanced.
   - "practiceTips": 2-4 short, practical coaching tips.
   - "chordSimplifications": substitutions that make the song easier while preserving singability.
   - For Beginner, prefer open chords, capo suggestions, and fewer chord shapes.
   - "karaokeUrl": A valid "https://www.youtube.com/watch?v=..." link to the official music video or a popular karaoke/lyrics video. Do NOT use shortened youtu.be or music.youtube.com links.
   - "duration": Approximate duration in seconds (integer).

OUTPUT FORMAT (strict JSON, no markdown fences):
{
  "title": "Exact Song Title",
  "artist": "Exact Artist Name",
  "key": "e.g. C Major",
  "recommendedKey": "e.g. G Major",
  "capo": 0,
  "strummingPattern": "D-DU-UDU",
  "difficulty": "${practiceSkill}",
  "skillLevel": "${practiceSkill}",
  "practiceTips": ["short, practical tip for learning this song"],
  "chordSimplifications": [{"from": "F", "to": "Fmaj7", "reason": "avoids full barre"}],
  "karaokeUrl": "https://www.youtube.com/watch?v=...",
  "language": "${language}",
  "languageFallbackReason": "",
  "duration": 240,
  "content": "Full lyrics with [chords] inline, ### [Section] headers, line-by-line"
}`;

    const responseText = await retryWithBackoff(async () => {
      return await callGeminiApi(MODELS.PRO, [{ role: 'user', parts: [{ text: prompt }] }], {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 8192
      });
    }, 4, 2000);

    const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    let parsed = JSON.parse(cleanText);
    if (Array.isArray(parsed)) parsed = parsed[0];
    if (!parsed.content && parsed.lyrics) parsed.content = parsed.lyrics;
    if (!parsed.content && parsed.body) parsed.content = parsed.body;
    if (!parsed.content && parsed.text) parsed.content = parsed.text;
    if (Array.isArray(parsed.content)) parsed.content = parsed.content.join('\n');

    parsed.source = 'ai';
    parsed.language = language;
    parsed.difficulty = parsed.difficulty || practiceSkill;
    parsed.practiceTips = Array.isArray(parsed.practiceTips) ? parsed.practiceTips : [];
    parsed.chordSimplifications = Array.isArray(parsed.chordSimplifications) ? parsed.chordSimplifications : [];
    parsed.recommendedKey = parsed.recommendedKey || parsed.key || '';
    parsed.languageFallbackReason = parsed.languageFallbackReason || '';
    return parsed;
  } catch (error) {
    console.error("Song Generation Error:", error);
    throw error;
  }
};

// ─── Complete Song from Lyrics (Gemini 3.1 Pro) ───────────────────────

export const completeSongFromLyrics = async (partialLyrics: string, language: AppLanguage = 'English'): Promise<any> => {
  try {
    const lyricLanguageRule = getLyricLanguageInstruction(language);
    const prompt = `You are a professional musician and songwriter.

A user has provided partial lyrics or a song fragment. Your task is to identify the song (if it's a real song) or complete it creatively (if it's original).

INPUT: "${partialLyrics}"
TARGET LANGUAGE/SCRIPT: ${language}
LYRIC SCRIPT RULE: ${lyricLanguageRule}

RULES:
1. If this matches a REAL, published song:
   - Return the COMPLETE lyrics with ACCURATE chords from official sources.
   - Use [chord] brackets inline before the word where the chord changes.
   - Use "### [Section]" headers for structure.
   - Transliterate/transcribe phonetically; do not translate meaning.

2. If this is an ORIGINAL composition:
   - Complete the song in a musically coherent way, matching the style, meter, and mood.
   - Add appropriate guitar chords that fit the melody implied by the lyrics.
   - Ensure line-by-line formatting (no paragraphs).

3. Detect the musical key and suggest a capo position if applicable.
4. Provide a strumming pattern.

OUTPUT FORMAT (strict JSON):
{
  "title": "Song Title",
  "artist": "Artist Name or 'Original'",
  "key": "Musical Key",
  "capo": 0,
  "strummingPattern": "D-DU-UDU",
  "language": "${language}",
  "languageFallbackReason": "",
  "content": "Full lyrics with [chords] inline, ### [Section] headers, line-by-line"
}`;

    const responseText = await retryWithBackoff(async () => {
      return await callGeminiApi(MODELS.PRO, [{ role: 'user', parts: [{ text: prompt }] }], {
        responseMimeType: "application/json",
        maxOutputTokens: 8192
      });
    });
    return responseText ? JSON.parse(responseText) : null;
  } catch (error) {
    console.error("Complete Song Error:", error);
    throw error;
  }
};
