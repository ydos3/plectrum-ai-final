
import { AppLanguage, SkillLevel } from "../types";
import { searchLRCLIB, searchSongDatabase, normalizeSongSearchText } from "./songDatabaseService";
import {
  debugSongLookup,
  isDatabaseSongStructurallyComplete,
  mapDatabaseSongToExistingGeminiFormat,
  searchSongDatabase as searchLocalSongDatabase,
} from "./songDatabaseLookup";
import { transliterateLyricsForLanguage } from "./indicTransliterationService";

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
  PRO: "gemini-2.5-pro",
  PRO_FALLBACK: "gemini-2.5-pro",
  FLASH: "gemini-2.5-flash",        // Fast identity/search work.
  FLASH_FALLBACK: "gemini-2.5-flash",
} as const;

const ENABLE_SONG_DATABASE_LOOKUPS = true;

const isDevelopment = () => {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
};

const logSongGenDebug = (message: string, details?: Record<string, unknown>) => {
  if (!isDevelopment()) return;
  console.log(`[SongGen] ${message}`, details || '');
};

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
  const { requestTimeoutMs, ...generationConfigInput } = config || {};
  const controller = new AbortController();
  const timeoutMs = requestTimeoutMs || (model === MODELS.PRO ? 30000 : 90000);
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;

  try {
    // When running server-side (no `window`), use an absolute URL to the API proxy so
    // server-side callers (API routes) can reach the proxy. In browser, keep the
    // relative path so the request goes through the same origin.
    const isServer = typeof window === 'undefined';
    const hostBase = isServer
      ? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${process.env.PORT || 3000}`)
      : '';

    response = await fetch(`${hostBase}/api/gemini`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        contents,
        generationConfig: {
          candidateCount: 1,
          temperature: 0.2,
          ...(model.includes('flash') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          ...generationConfigInput
        }
      })
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }

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
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
  }
  const candidate = data.candidates?.[0];
  if (!candidate) return "";
  if (candidate.finishReason && candidate.finishReason !== 'STOP' && !candidate.content?.parts?.length) {
    throw new Error(`Gemini stopped before returning content: ${candidate.finishReason}`);
  }
  const part = candidate.content?.parts?.[0];
  return part?.text || "";
};

const shouldFallbackModel = (error: unknown) => {
  const message = error instanceof Error
    ? `${error.name} ${error.message}`.toLowerCase()
    : String(error).toLowerCase();
  return message.includes('not found') ||
    message.includes('unsupported') ||
    message.includes('not supported') ||
    message.includes('permission') ||
    message.includes('abort') ||
    message.includes('timeout') ||
    message.includes('model');
};

const callGeminiApiWithFallback = async (model: string, contents: any[], config: any = {}) => {
  const modelChain = model === MODELS.PRO
    ? [MODELS.PRO, MODELS.PRO_FALLBACK]
    : model === MODELS.FLASH
      ? [MODELS.FLASH, MODELS.FLASH_FALLBACK]
      : [model];
  const uniqueModelChain = Array.from(new Set(modelChain));
  let lastError: unknown;

  for (const candidateModel of uniqueModelChain) {
    try {
      logSongGenDebug('Calling AI model', { model: candidateModel });
      return await callGeminiApi(candidateModel, contents, config);
    } catch (error) {
      lastError = error;
      if (!shouldFallbackModel(error)) throw error;
      console.warn(`[Gemini] ${candidateModel} unavailable, trying fallback`, error);
    }
  }

  throw lastError;
};

// ─── Chat (Gemini Flash) ───────────────────────────────────────────────

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
      return await callGeminiApiWithFallback(MODELS.FLASH, contents, {
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

// ─── Image Analysis (Gemini Pro) ───────────────────────────────────────

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
      return await callGeminiApiWithFallback(MODELS.PRO, contents, { maxOutputTokens: 1800 });
    });
    return responseText || "No analysis could be generated.";
  } catch (error) {
    console.error("Gemini Vision Error:", error);
    return `Failed to analyze image. Error: ${error instanceof Error ? error.message : String(error)}`;
  }
};

// ─── Song Recommendations (Gemini Flash - fast) ────────────────────────

export const getSongRecommendations = async (historyTitles: string[], language: string): Promise<string[]> => {
  try {
    const historyContext = historyTitles.length > 0
      ? `The user has these songs in their library: ${historyTitles.join(', ')}.`
      : "The user is new.";

    const prompt = `${historyContext} Suggest 5 new song titles that fit their taste or are popular guitar songs, strictly in the ${language} language/region if the history suggests it, otherwise mix. Return ONLY a JSON array of strings.`;

    const responseText = await retryWithBackoff(async () => {
      return await callGeminiApiWithFallback(MODELS.FLASH, [{ role: 'user', parts: [{ text: prompt }] }], {
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

// ─── Search Suggestions (DB-first, Gemini Flash fallback) ──────────────

export const getSearchSuggestions = async (query: string): Promise<string[]> => {
  if (!query || query.length < 2) return [];
  try {
    const dbMatches = await searchLRCLIB(query);
    const verifiedDbSuggestions = Array.from(new Set(
      dbMatches
        .filter(track => !track.instrumental && (track.plainLyrics || track.syncedLyrics))
        .slice(0, 5)
        .map(track => `${track.trackName} by ${track.artistName}`)
    ));
    if (verifiedDbSuggestions.length > 0) return verifiedDbSuggestions;

    const prompt = `User Input: "${query}".
            Task: Identify exact real songs based on the title OR lyric fragment in the input.
            Rules:
            1. Return only songs that are strong matches for the exact text the user typed.
            2. If the input is a noisy lyric fragment, return the song only if you are confident the lyric belongs to it.
            3. Return only REAL, commercially available songs, formatted as "Song Title by Artist".
            4. If confidence is low, return [].
            5. Be consistent. Do not change answers randomly.
            Format: JSON Array of strings.`;

    const responseText = await retryWithBackoff(async () => {
      return await callGeminiApiWithFallback(MODELS.FLASH, [{ role: 'user', parts: [{ text: prompt }] }], {
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
      return await callGeminiApiWithFallback(MODELS.FLASH, [{ role: 'user', parts: [{ text: prompt }] }], {
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

// ─── Song Generation (Verified DB-first, Gemini Pro fallback) ──────────

const normalizePracticeSkill = (skillLevel?: SkillLevel) => (
  skillLevel === 'Beginner' || skillLevel === 'Intermediate' ? skillLevel : 'Advanced'
);

type SongIdentityResolution = {
  status?: 'FOUND' | 'AMBIGUOUS' | 'NOT_FOUND';
  found?: boolean;
  title?: string;
  artist?: string;
  confidence?: number;
  searchQuery?: string;
  reason?: string;
};

const cleanJsonText = (value: string) => value.replace(/```json/g, '').replace(/```/g, '').trim();

const parseGeminiJson = (value: string) => {
  const cleanText = cleanJsonText(value);
  try {
    return JSON.parse(cleanText);
  } catch {
    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleanText.slice(start, end + 1));
    }
    const arrayStart = cleanText.indexOf('[');
    const arrayEnd = cleanText.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return JSON.parse(cleanText.slice(arrayStart, arrayEnd + 1));
    }
    throw new Error('Gemini returned text that was not valid JSON.');
  }
};

const tryParseGeminiJson = (value: string) => {
  try {
    return parseGeminiJson(value);
  } catch {
    return null;
  }
};

const stripQuoted = (value: string) => value.replace(/^["'`]+|["'`]+$/g, '').trim();

const parseLooseIdentityText = (query: string, value: string): SongIdentityResolution => {
  const cleanText = cleanJsonText(value).replace(/\*\*/g, '').trim();
  const titleMatch = cleanText.match(/(?:title|song)\s*[:\-]\s*([^\n,]+)/i);
  const artistMatch = cleanText.match(/(?:artist|singer|by)\s*[:\-]\s*([^\n,]+)/i) ||
    cleanText.match(/\bby\s+([^\n.]+)/i);
  const foundText = /\b(found|identified|likely|probably|song is)\b/i.test(cleanText);

  return {
    status: titleMatch || artistMatch || foundText ? 'FOUND' : 'AMBIGUOUS',
    title: stripQuoted(titleMatch?.[1] || query),
    artist: stripQuoted(artistMatch?.[1] || 'Unknown'),
    confidence: titleMatch || artistMatch ? 0.73 : 0.5,
    searchQuery: titleMatch || artistMatch
      ? `${stripQuoted(titleMatch?.[1] || query)} ${stripQuoted(artistMatch?.[1] || '')}`.trim()
      : query,
    reason: 'Could not confidently identify the exact song.'
  };
};

const normalizeContentField = (data: any) => {
  if (!data?.content && data?.lyrics) data.content = data.lyrics;
  if (!data?.content && data?.body) data.content = data.body;
  if (!data?.content && data?.text) data.content = data.text;
  if (Array.isArray(data?.content)) data.content = data.content.join('\n');
  return data;
};

const hasChordedContent = (value: unknown) => (
  typeof value === 'string' &&
  value.trim().length > 0 &&
  /\[[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?\]/.test(value)
);

const countContentLyricLines = (value: unknown) => (
  typeof value === 'string'
    ? value
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('###')).length
    : 0
);

const isValidGeneratedResult = (result: any, minimumLines = 1) => (
  !!result &&
  typeof result === 'object' &&
  typeof result.title === 'string' &&
  result.title.trim().length > 0 &&
  typeof result.content === 'string' &&
  result.content.trim().length > 0 &&
  hasChordedContent(result.content) &&
  countContentLyricLines(result.content) >= minimumLines
);

const normalizeGeneratedResult = (
  result: any,
  defaults: {
    title?: string;
    artist?: string;
    language: AppLanguage;
    skillLevel: SkillLevel;
    source: 'database' | 'ai' | 'cache' | 'database-fallback';
    minimumLines?: number;
  }
) => {
  const data = normalizeContentField({ ...(result || {}) });
  data.title = data.title || defaults.title || 'Untitled Song';
  data.artist = data.artist || defaults.artist || 'Unknown';
  data.language = defaults.language;
  data.difficulty = data.difficulty || defaults.skillLevel;
  data.skillLevel = data.skillLevel || data.difficulty || defaults.skillLevel;
  data.practiceTips = Array.isArray(data.practiceTips) ? data.practiceTips : [];
  data.chordSimplifications = Array.isArray(data.chordSimplifications) ? data.chordSimplifications : [];
  data.recommendedKey = data.recommendedKey || data.easierKey || data.key || '';
  data.languageFallbackReason = data.languageFallbackReason || '';
  data.source = data.source || defaults.source;

  if (!isValidGeneratedResult(data, defaults.minimumLines || 1)) {
    throw new Error('Generated result was empty or missing playable chorded content.');
  }

  logSongGenDebug('Normalized generation result', {
    source: data.source,
    title: data.title,
    contentLength: data.content.length,
    lyricLines: countContentLyricLines(data.content),
  });

  return data;
};

const sectionTitleForLine = (line: string) => {
  const normalized = line.toLowerCase();
  if (/\bchorus\b/.test(normalized)) return '### [Chorus]';
  if (/\bbridge\b/.test(normalized)) return '### [Bridge]';
  return '';
};

const buildPlayableSongDraft = (
  dbResult: NonNullable<Awaited<ReturnType<typeof searchSongDatabase>>>,
  language: AppLanguage,
  practiceSkill: SkillLevel
) => {
  const progression = practiceSkill === 'Beginner'
    ? ['G', 'D', 'Em', 'C']
    : ['G', 'D', 'Em7', 'Cadd9', 'Am', 'D'];
  let lyricLineIndex = 0;

  const contentLines = (dbResult.plainLyrics || '')
    .split(/\r?\n/)
    .map((rawLine) => {
      const line = rawLine.trim();
      if (!line) return '';
      const section = sectionTitleForLine(line);
      if (section) return section;
      const chord = progression[lyricLineIndex % progression.length];
      lyricLineIndex += 1;
      const lyricText = transliterateLyricsForLanguage(line.replace(/\[[^\]]*\]/g, ''), language);
      return `[${chord}]${lyricText}`;
    })
    .filter((line, index, lines) => line || lines[index - 1]);

  if (!contentLines.some(line => line.startsWith('###'))) {
    contentLines.unshift('### [Verse 1]');
  }

  return {
    title: dbResult.title,
    artist: dbResult.artist,
    key: 'G Major',
    recommendedKey: 'G Major',
    capo: 0,
    strummingPattern: practiceSkill === 'Beginner' ? 'D-DU-UDU' : 'D-D-U-U-D-U',
    difficulty: practiceSkill,
    skillLevel: practiceSkill,
    practiceTips: [
      'Use the generated progression as a playable draft, then adjust chord changes by ear.',
      'Loop one section at a time before increasing tempo.'
    ],
    chordSimplifications: practiceSkill === 'Beginner'
      ? [{ from: 'F', to: 'Fmaj7', reason: 'avoids a full barre shape when adapting the draft' }]
      : [],
    karaokeUrl: '',
    language,
    languageFallbackReason: '',
    content: contentLines.join('\n'),
    duration: dbResult.duration,
    timedLyrics: dbResult.syncedLyrics,
    source: 'database-fallback',
  };
};

const isMashupRequest = (query: string) => {
  const normalized = normalizeSongSearchText(query);
  return normalized.includes('mashup') || /\bvs\b/.test(normalized) || query.includes(',');
};

const stripGenerationDirectives = (query: string) => (
  query
    .replace(/\([^)]*(?:open chords?|barre chords?|capo|beginner|easy|easier)[^)]*\)/gi, ' ')
    .replace(/\s+-\s+make\s+this\s+song.*$/i, ' ')
    .replace(/\b(?:use|with)\s+(?:open|barre)\s+chords?\b/gi, ' ')
    .replace(/\b(?:beginner|easy|easier|capo suggestions?)\b/gi, ' ')
    .trim()
);

const hasHighConfidenceIdentity = (identity?: SongIdentityResolution | null) => (
  !!identity &&
  (identity.status === 'FOUND' || identity.found === true) &&
  !!identity.title &&
  !!identity.artist &&
  typeof identity.confidence === 'number' &&
  identity.confidence >= 0.72
);

const identityLabel = (identity: SongIdentityResolution) => (
  `${identity.title || ''} ${identity.artist || ''}`.trim()
);

const sameIdentity = (actual: any, expected?: SongIdentityResolution | null) => {
  if (!expected?.title || !expected.artist) return true;
  const actualTitle = normalizeSongSearchText(actual?.title || '');
  const actualArtist = normalizeSongSearchText(actual?.artist || '');
  const expectedTitle = normalizeSongSearchText(expected.title);
  const expectedArtist = normalizeSongSearchText(expected.artist);

  const titleMatches = actualTitle === expectedTitle ||
    (actualTitle.includes(expectedTitle) && expectedTitle.length > 2) ||
    (expectedTitle.includes(actualTitle) && actualTitle.length > 2);
  const artistMatches = actualArtist === expectedArtist ||
    actualArtist.includes(expectedArtist) ||
    expectedArtist.includes(actualArtist);

  return titleMatches && artistMatches;
};

const identifySongFromQuery = async (query: string, language: AppLanguage): Promise<SongIdentityResolution | null> => {
  const prompt = `Identify the exact real song requested by this user input.

USER INPUT: "${query}"
LANGUAGE/REGION HINT: ${language}

Rules:
- The input may be a title, "title by artist", or a noisy lyric fragment with spelling mistakes.
- For Hindi/Urdu/Punjabi/Indian indie songs, handle Romanized phonetics and common misspellings.
- Return FOUND only when you can identify one specific released song. Do not choose a similar song.
- If there are multiple plausible songs or confidence is below 0.72, return AMBIGUOUS or NOT_FOUND.
- Do not invent artists, alternate titles, lyrics, URLs, or metadata.

Return strict JSON only:
{
  "status": "FOUND | AMBIGUOUS | NOT_FOUND",
  "title": "Exact song title or empty",
  "artist": "Primary artist or empty",
  "confidence": 0.0,
  "searchQuery": "best title artist search query or empty",
  "reason": "short reason"
}`;

  const responseText = await retryWithBackoff(async () => {
    return await callGeminiApiWithFallback(MODELS.FLASH, [{ role: 'user', parts: [{ text: prompt }] }], {
      responseMimeType: "application/json",
      temperature: 0,
      maxOutputTokens: 220
    });
  }, 2, 800);

  if (!responseText) return null;
  const parsed = tryParseGeminiJson(responseText) || parseLooseIdentityText(query, responseText);
  return Array.isArray(parsed) ? parsed[0] : parsed;
};

const findVerifiedLyrics = async (query: string, language: AppLanguage) => {
  const lookupQuery = stripGenerationDirectives(query);
  const directDbResult = await searchSongDatabase(lookupQuery);
  if (directDbResult?.plainLyrics) {
    return { dbResult: directDbResult, identity: null as SongIdentityResolution | null };
  }

  let identity: SongIdentityResolution | null = null;
  try {
    identity = await identifySongFromQuery(lookupQuery, language);
  } catch (error) {
    console.warn('[SongGen] Identity resolution failed safely', error);
    identity = {
      status: 'AMBIGUOUS',
      confidence: 0,
      reason: 'Identity lookup returned an unusable response.'
    };
  }
  if (!hasHighConfidenceIdentity(identity)) {
    return { dbResult: null, identity };
  }

  const identitySearches = [
    identity!.searchQuery,
    identityLabel(identity!),
    `${identity!.title} ${identity!.artist}`
  ].filter((value, index, arr): value is string => !!value && arr.indexOf(value) === index);

  for (const searchQuery of identitySearches) {
    const resolvedDbResult = await searchSongDatabase(searchQuery);
    if (resolvedDbResult?.plainLyrics) {
      return { dbResult: resolvedDbResult, identity };
    }
  }

  return { dbResult: null, identity };
};

const isLikelyUserProvidedLyrics = (query: string) => {
  const lines = query.split(/\r?\n/).filter(line => line.trim().length > 0);
  const wordCount = query.trim().split(/\s+/).filter(Boolean).length;
  return lines.length >= 3 || wordCount >= 28;
};

const buildUserProvidedLyricsArrangement = async (
  lyrics: string,
  language: AppLanguage,
  practiceSkill: SkillLevel
) => {
  const dbLikeResult = {
    source: 'ai' as const,
    title: 'Untitled Lyrics',
    artist: 'User Provided',
    plainLyrics: lyrics,
    duration: Math.max(90, Math.min(420, lyrics.split(/\s+/).length * 2.1))
  };

  try {
    const lyricLanguageRule = getLyricLanguageInstruction(language);
    const prompt = `You are a professional guitar teacher and music transcriber.

TASK: Add playable, musically sensible guitar chords to the user-provided lyrics below.
OUTPUT LANGUAGE/SCRIPT: ${language}
TARGET SKILL LEVEL: ${practiceSkill}

Rules:
- Preserve the user's lyric words and line breaks.
- Put chords inline in [G] format directly before the word or syllable where the chord changes.
- Add "### [Section]" headers when the section is obvious from the lyric structure.
- If the title or artist is obvious from the text, set them. Otherwise use "Untitled Lyrics" and "User Provided".
- ${lyricLanguageRule}
- Return strict JSON only.

{
  "title": "Song Title",
  "artist": "Artist Name",
  "key": "e.g. G Major",
  "recommendedKey": "e.g. G Major",
  "capo": 0,
  "strummingPattern": "D-DU-UDU",
  "difficulty": "${practiceSkill}",
  "skillLevel": "${practiceSkill}",
  "practiceTips": ["short, practical tip"],
  "chordSimplifications": [],
  "karaokeUrl": "",
  "language": "${language}",
  "languageFallbackReason": "",
  "content": "lyrics with [chords] inline"
}

USER-PROVIDED LYRICS:
${lyrics}`;

    const responseText = await retryWithBackoff(async () => {
      return await callGeminiApiWithFallback(MODELS.PRO, [{ role: 'user', parts: [{ text: prompt }] }], {
        responseMimeType: "application/json",
        temperature: 0.15,
        maxOutputTokens: 8192
      });
    }, 2, 1200);

    const data = normalizeContentField(parseGeminiJson(responseText));
    if (!hasChordedContent(data.content)) {
      throw new Error('Gemini response did not include playable chorded content.');
    }

    return {
      title: data.title || 'Untitled Lyrics',
      artist: data.artist || 'User Provided',
      key: data.key || 'G Major',
      recommendedKey: data.recommendedKey || data.key || 'G Major',
      capo: typeof data.capo === 'number' ? data.capo : 0,
      strummingPattern: data.strummingPattern || (practiceSkill === 'Beginner' ? 'D-DU-UDU' : 'D-D-U-U-D-U'),
      difficulty: data.difficulty || practiceSkill,
      skillLevel: data.skillLevel || practiceSkill,
      practiceTips: Array.isArray(data.practiceTips) ? data.practiceTips : [],
      chordSimplifications: Array.isArray(data.chordSimplifications) ? data.chordSimplifications : [],
      karaokeUrl: data.karaokeUrl || '',
      language,
      languageFallbackReason: data.languageFallbackReason || '',
      content: data.content,
      duration: dbLikeResult.duration,
      source: 'ai',
    };
  } catch (error) {
    console.warn('[SongGen] Gemini chord pass for user lyrics failed, using local draft', error);
    return buildPlayableSongDraft(
      dbLikeResult,
      language,
      practiceSkill
    );
  }
};

export const generateSongFromTitle = async (query: string, language: AppLanguage = 'English', skillLevel: SkillLevel = 'Intermediate'): Promise<any> => {
  const practiceSkill = normalizePracticeSkill(skillLevel);
  logSongGenDebug('Generation started', {
    queryLength: query.length,
    language,
    skillLevel: practiceSkill,
  });
  
  if (isLikelyUserProvidedLyrics(query)) {
    const arrangement = await buildUserProvidedLyricsArrangement(query, language, practiceSkill);
    return arrangement;
  }
  const mashupMode = isMashupRequest(query);
  if (ENABLE_SONG_DATABASE_LOOKUPS && !mashupMode) {
    try {
      const databaseMatch = searchLocalSongDatabase(stripGenerationDirectives(query));
      const completeDbRecord = !!databaseMatch.match && isDatabaseSongStructurallyComplete(databaseMatch.match);
      logSongGenDebug('Bundled database lookup finished', {
        matched: databaseMatch.found,
        complete: completeDbRecord,
        confidence: databaseMatch.confidence,
        reason: databaseMatch.reason,
      });

      if (databaseMatch.found && databaseMatch.match && completeDbRecord) {
        const mapped = mapDatabaseSongToExistingGeminiFormat(
          databaseMatch.match,
          databaseMatch.confidence,
          language,
          practiceSkill
        );
        const normalized = normalizeGeneratedResult(mapped, {
          language,
          skillLevel: practiceSkill,
          source: 'database',
          minimumLines: 8,
        });
        debugSongLookup({
          query,
          matched: true,
          title: databaseMatch.match.title,
          confidence: databaseMatch.confidence,
          source: 'database',
        });
        return normalized;
      }

      debugSongLookup({
        query,
        matched: false,
        confidence: databaseMatch.confidence,
        source: 'gemini',
      });
    } catch (error) {
      logSongGenDebug('Bundled database lookup failed safely; falling back to AI', {
        error: error instanceof Error ? error.message : String(error),
      });
      debugSongLookup({ query, matched: false, source: 'gemini' });
    }
  }
  // STEP 1: Try database first (LRCLIB) - instant, no AI cost
  const verifiedLookup = mashupMode
    ? { dbResult: null, identity: null as SongIdentityResolution | null }
    : await findVerifiedLyrics(query, language);
  const dbResult = verifiedLookup.dbResult;
  const verifiedIdentity = verifiedLookup.identity;

  if (dbResult && dbResult.plainLyrics) {
    console.log('[SongGen] Database hit! Using LRCLIB lyrics for:', dbResult.title);

    // We have lyrics from DB. Now use Gemini Pro to add accurate chords.
    try {
      const lyricLanguageRule = getLyricLanguageInstruction(language);

      const chordPrompt = `You are a professional music transcriber with decades of experience.

TASK: Add accurate guitar chords and a practice-ready arrangement to the following lyrics for "${dbResult.title}" by "${dbResult.artist}".
OUTPUT LANGUAGE/SCRIPT: ${language}
TARGET SKILL LEVEL: ${practiceSkill}
${verifiedIdentity ? `CONFIRMED SONG IDENTITY: "${verifiedIdentity.title}" by "${verifiedIdentity.artist}". Use this exact song only.` : ''}

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
        return await callGeminiApiWithFallback(MODELS.PRO, [{ role: 'user', parts: [{ text: chordPrompt }] }], {
          responseMimeType: "application/json",
          temperature: 0.1,
          maxOutputTokens: 8192
        });
      });

      const chordData = normalizeContentField(parseGeminiJson(chordResponse));
      if (!hasChordedContent(chordData.content)) {
        throw new Error('Gemini response did not include playable chorded content.');
      }

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
        content: chordData.content,
        duration: dbResult.duration,
        timedLyrics: dbResult.syncedLyrics,
        source: 'database', // Flag for UI
      };
    } catch (e) {
      if (isMissingApiKeyError(e)) {
        throw e;
      }
      console.warn('[SongGen] Primary chord addition failed, trying compact fallback', e);

      try {
        const compactPrompt = `Return strict JSON only. Add simple playable guitar chords to these verified lyrics for "${dbResult.title}" by "${dbResult.artist}".
Use ${practiceSkill} friendly chords, preserve line breaks, and put chords inline in [G] format.
Return:
{"key":"G Major","recommendedKey":"G Major","capo":0,"strummingPattern":"D-DU-UDU","difficulty":"${practiceSkill}","practiceTips":["short tip"],"chordSimplifications":[],"karaokeUrl":"","language":"${language}","languageFallbackReason":"","content":"### [Verse 1]\\n[G]line..."}

Lyrics:
${dbResult.plainLyrics}`;

        const fallbackResponse = await retryWithBackoff(async () => {
          return await callGeminiApiWithFallback(MODELS.FLASH, [{ role: 'user', parts: [{ text: compactPrompt }] }], {
            responseMimeType: "application/json",
            temperature: 0.2,
            maxOutputTokens: 8192
          });
        }, 2, 800);

        const fallbackData = normalizeContentField(parseGeminiJson(fallbackResponse));
        if (!hasChordedContent(fallbackData.content)) {
          throw new Error('Gemini fallback response did not include playable chorded content.');
        }

        return {
          title: dbResult.title,
          artist: dbResult.artist,
          key: fallbackData.key || 'G Major',
          recommendedKey: fallbackData.recommendedKey || fallbackData.key || 'G Major',
          capo: typeof fallbackData.capo === 'number' ? fallbackData.capo : 0,
          strummingPattern: fallbackData.strummingPattern || 'D-DU-UDU',
          difficulty: fallbackData.difficulty || practiceSkill,
          practiceTips: Array.isArray(fallbackData.practiceTips) ? fallbackData.practiceTips : [],
          chordSimplifications: Array.isArray(fallbackData.chordSimplifications) ? fallbackData.chordSimplifications : [],
          karaokeUrl: fallbackData.karaokeUrl || '',
          language,
          languageFallbackReason: fallbackData.languageFallbackReason || '',
          content: fallbackData.content,
          duration: dbResult.duration,
          timedLyrics: dbResult.syncedLyrics,
          source: 'database-fallback',
        };
      } catch (fallbackError) {
        console.warn('[SongGen] Compact Gemini fallback failed, using deterministic playable draft', fallbackError);
        return buildPlayableSongDraft(
          dbResult,
          language,
          practiceSkill
        );
      }
    }
  }

  if (!mashupMode && !hasHighConfidenceIdentity(verifiedIdentity)) {
    console.warn(`[SongGen] Low confidence identity for "${query}", trying Gemini generation anyway...`);
  }

  if (!mashupMode && verifiedIdentity?.title && verifiedIdentity.artist) {
    console.log(`[SongGen] Verified identity "${verifiedIdentity.title}" for "${query}", but no DB lyrics. Asking Gemini to generate...`);
  }

  // STEP 2: Full AI generation with Gemini Pro, guarded by exact identity checks.
  console.log('[SongGen] No DB hit, using Gemini Pro for:', query);

  try {
    const langInstruction = language === 'English' ? "English/Roman" : `${language} (${LANGUAGE_SCRIPT_HINTS[language] || 'selected script'})`;
    const lyricLanguageRule = getLyricLanguageInstruction(language);
    const prompt = `You are a professional music transcriber and guitar teacher with access to the world's largest library of published guitar tabs and sheet music.

USER REQUEST: "${query}"
TARGET LANGUAGE/SCRIPT: ${langInstruction}
TARGET SKILL LEVEL: ${practiceSkill}
${verifiedIdentity ? `CONFIRMED SONG IDENTITY: "${verifiedIdentity.title}" by "${verifiedIdentity.artist}". Use this exact song only.` : ''}

TASK: Create a practice-ready guitar arrangement for this song.

STRICT RULES — FOLLOW EXACTLY:

0. SONG IDENTITY:
   - Identify the exact requested song. If you are entirely guessing the song and it doesn't exist, return {"found": false, "reason": "Song not found."}
   - Do NOT substitute a drastically different song.
   - If CONFIRMED SONG IDENTITY is present, try to match it.

1. LYRICS:
   - Provide the lyrics of the song — every verse, chorus, bridge, pre-chorus, and outro.
   - You MUST provide the full textual content for the chord chart. This is essential for the educational chord placement.
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
  "found": true,
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
      return await callGeminiApiWithFallback(MODELS.PRO, [{ role: 'user', parts: [{ text: prompt }] }], {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 8192
      });
    }, 4, 2000);

    let parsed = parseGeminiJson(responseText);
    if (Array.isArray(parsed)) parsed = parsed[0];
    if (parsed?.found === false) {
      throw new Error(parsed.reason || 'I could not confidently identify that song.');
    }
    
    parsed = normalizeGeneratedResult(parsed, {
      language,
      skillLevel: practiceSkill,
      source: 'ai',
      minimumLines: 8,
    });
    return parsed;
  } catch (error) {
    console.error("Song Generation Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message || 'AI generation failed before returning usable content.');
  }
};

// ─── Complete Song from Lyrics (Gemini Pro) ────────────────────────────

export const completeSongFromLyrics = async (partialLyrics: string, language: AppLanguage = 'English'): Promise<any> => {
  if (partialLyrics.trim()) {
    return await buildUserProvidedLyricsArrangement(partialLyrics, language, 'Intermediate');
  }

  try {
    const lyricLanguageRule = getLyricLanguageInstruction(language);
    const prompt = `You are a professional musician and songwriter.

A user has provided partial lyrics or a song fragment. Your task is to identify the song (if it's a real song) or complete it creatively (if it's original).

INPUT: "${partialLyrics}"
TARGET LANGUAGE/SCRIPT: ${language}
LYRIC SCRIPT RULE: ${lyricLanguageRule}

RULES:
1. If this matches a REAL, published song:
   - Provide the lyrics with ACCURATE chords from official sources. This is for an educational chord chart.
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
      return await callGeminiApiWithFallback(MODELS.PRO, [{ role: 'user', parts: [{ text: prompt }] }], {
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
