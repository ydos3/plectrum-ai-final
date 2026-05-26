
import { AppLanguage, SkillLevel } from "../types";
import { searchLRCLIB, searchSongDatabase, normalizeSongSearchText } from "./songDatabaseService";
import {
  debugSongLookup,
  isDatabaseSongStructurallyComplete,
  mapDatabaseSongToExistingGeminiFormat,
  searchSongDatabase as searchLocalSongDatabase,
} from "./songDatabaseLookup";
import { normalizeLyricsForRequestedLanguage } from "./indicTransliterationService";
import { quickValidateAcousticDatabaseSong, SongQualityValidation, validateAcousticDatabaseSong, validateFrontendSongResult } from "./songQualityValidator";

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
const REPAIRED_CACHE_KEY = 'plectrum_repaired_song_cache_v1';
const NORMALIZED_SONG_CACHE_KEY = 'plectrum_normalized_song_cache_v1';
const REPAIRED_CACHE_VERSION = 3;
const generationMemoryCache = new Map<string, any>();
const pendingGenerationRequests = new Map<string, Promise<any>>();

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

const getClientUserId = () => {
  try {
    if (typeof localStorage === 'undefined') return '';
    const raw = localStorage.getItem('plexdrum_user_v2');
    if (!raw) return '';
    const user = JSON.parse(raw);
    return typeof user?.id === 'string' ? user.id : '';
  } catch {
    return '';
  }
};

const callGeminiApi = async (model: string, contents: any[], config: any = {}) => {
  const { requestTimeoutMs, rateLimitScope, ...generationConfigInput } = config || {};
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
        ...(rateLimitScope ? { rateLimitScope, clientUserId: getClientUserId() } : {}),
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

const normalizeContentScript = (content: string, language: AppLanguage) => (
  content
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('###')) return line;
      return normalizeLyricsForRequestedLanguage(line, language);
    })
    .join('\n')
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
    source: 'database' | 'database_repaired_with_gemini' | 'gemini_fallback' | 'ai' | 'cache' | 'database-fallback';
    minimumLines?: number;
    validation?: SongQualityValidation;
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
  if (typeof data.content === 'string') {
    data.content = normalizeContentScript(data.content, defaults.language);
  }
  if (defaults.validation) {
    data.qualityScore = defaults.validation.qualityScore;
    data.validationIssues = defaults.validation.issues;
    data.metadata = {
      ...(data.metadata || {}),
      qualityScore: defaults.validation.qualityScore,
      validationIssues: defaults.validation.issues,
      recommendedAction: defaults.validation.recommendedAction,
    };
  }

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
      const lyricText = normalizeLyricsForRequestedLanguage(line.replace(/\[[^\]]*\]/g, ''), language);
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
    .replace(/\b(?:please|pls|give|show|find|fetch|get|make|create|generate)\s+(?:me\s+)?(?:the\s+)?/gi, ' ')
    .replace(/\b(?:lyrics?|lyrical|chords?|tabs?|guitar|karaoke|official|audio|video|version)\b/gi, ' ')
    .replace(/\b(?:use|with)\s+(?:open|barre)\s+chords?\b/gi, ' ')
    .replace(/\b(?:beginner|easy|easier|capo suggestions?)\b/gi, ' ')
    .trim()
);

const verifiedLyricsUnavailableMessage = (query: string, identity?: SongIdentityResolution | null) => {
  const identityText = identity?.title && identity.artist
    ? `"${identity.title}" by ${identity.artist}`
    : `"${stripGenerationDirectives(query) || query}"`;
  return `I could not find verified lyrics for ${identityText}. I will not generate or merge fake lyrics. Add the artist name, paste the lyrics you want chorded, or try another exact title.`;
};

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

const cacheKeyForRepair = (query: string, language: AppLanguage, skillLevel: SkillLevel) => (
  `${REPAIRED_CACHE_VERSION}:${language}:${skillLevel}:${normalizeSongSearchText(query)}`
);

const cacheKeyForGeneration = (query: string, language: AppLanguage, skillLevel: SkillLevel) => (
  `${REPAIRED_CACHE_VERSION}:${language}:${skillLevel}:${normalizeSongSearchText(stripGenerationDirectives(query))}`
);

const devTimingStart = (label: string) => {
  if (!isDevelopment()) return 0;
  return performance.now();
};

const devTimingEnd = (label: string, start: number, details?: Record<string, unknown>) => {
  if (!isDevelopment() || !start) return;
  console.log(`[SongGenTiming] ${label}: ${Math.round(performance.now() - start)}ms`, details || '');
};

const readNormalizedSongCache = (cacheKey: string, language: AppLanguage, skillLevel: SkillLevel) => {
  if (generationMemoryCache.has(cacheKey)) {
    logSongGenDebug('CACHE_HIT', { cache: 'memory', cacheKey });
    const cached = { ...generationMemoryCache.get(cacheKey), source: 'cache' };
    return normalizeGeneratedResult(cached, {
      language,
      skillLevel,
      source: 'cache',
      minimumLines: 1,
    });
  }
  try {
    if (typeof localStorage === 'undefined') return null;
    const cache = JSON.parse(localStorage.getItem(NORMALIZED_SONG_CACHE_KEY) || '{}');
    const cached = cache[cacheKey];
    if (!cached) return null;
    generationMemoryCache.set(cacheKey, cached);
    logSongGenDebug('CACHE_HIT', { cache: 'localStorage', cacheKey });
    return normalizeGeneratedResult({ ...cached, source: 'cache' }, {
      language,
      skillLevel,
      source: 'cache',
      minimumLines: 1,
    });
  } catch {
    return null;
  }
};

const writeNormalizedSongCache = (cacheKey: string, result: any) => {
  if (!result?.content || !result?.title) return;
  if (!['database', 'database_repaired_with_gemini', 'gemini_fallback', 'database-fallback'].includes(String(result.source))) return;
  const cacheable = {
    ...result,
    metadata: {
      ...(result.metadata || {}),
      cacheVersion: REPAIRED_CACHE_VERSION,
      cachedAt: Date.now(),
    },
  };
  generationMemoryCache.set(cacheKey, cacheable);
  try {
    if (typeof localStorage === 'undefined') return;
    const cache = JSON.parse(localStorage.getItem(NORMALIZED_SONG_CACHE_KEY) || '{}');
    cache[cacheKey] = cacheable;
    const entries = Object.entries(cache).slice(-80);
    localStorage.setItem(NORMALIZED_SONG_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Cache is optional.
  }
};

const readRepairedSongCache = (query: string, language: AppLanguage, skillLevel: SkillLevel) => {
  try {
    if (typeof localStorage === 'undefined') return null;
    const cache = JSON.parse(localStorage.getItem(REPAIRED_CACHE_KEY) || '{}');
    return cache[cacheKeyForRepair(query, language, skillLevel)] || null;
  } catch {
    return null;
  }
};

const writeRepairedSongCache = (query: string, language: AppLanguage, skillLevel: SkillLevel, result: any) => {
  try {
    if (typeof localStorage === 'undefined') return;
    const cache = JSON.parse(localStorage.getItem(REPAIRED_CACHE_KEY) || '{}');
    cache[cacheKeyForRepair(query, language, skillLevel)] = {
      ...result,
      metadata: {
        ...(result.metadata || {}),
        cacheVersion: REPAIRED_CACHE_VERSION,
        cachedAt: Date.now(),
      },
    };
    const entries = Object.entries(cache).slice(-40);
    localStorage.setItem(REPAIRED_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Cache is a performance hint only.
  }
};

const getRequestedLyricTransform = (query: string, language: AppLanguage) => {
  const normalized = normalizeSongSearchText(query);
  const wantsMeaningTranslation = /\btranslate|meaning|meaning in|hindi meaning|into hindi|in hindi\b/i.test(query) &&
    !/\btransliterate|transcription|roman|hinglish|script\b/i.test(query);
  const wantsTransliteration = /\btransliterate|transcription|transcribe|romanize|romanise|hinglish|english script|roman script|hindi script\b/i.test(query);

  if (wantsMeaningTranslation) {
    return `The user is asking for meaning translation. If the full lyrics are not user-provided, do not invent or reproduce complete copyrighted lyrics. Prefer a concise Hindi/Hinglish meaning summary, and if lyrics are provided by the user, translate only that provided text. Still return a nonblank practice object with clean sections and chords where possible.`;
  }
  if (wantsTransliteration || language !== 'English') {
    return `The user is asking for transliteration/transcription. Preserve sung words phonetically, convert script as requested, and do not translate meaning unless explicitly requested.`;
  }
  if (normalized.includes('format') || normalized.includes('karaoke') || normalized.includes('teleprompter')) {
    return `The user likely wants formatting for karaoke/teleprompter. Preserve provided text, clean line breaks, add sections, and add playable chords where possible.`;
  }
  return '';
};

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

const lyricLinesOnly = (value: string) => (
  value
    .split(/\r?\n/)
    .map(line => line.replace(/\[[^\]]+\]/g, '').replace(/^#+\s*\[[^\]]+\]\s*/g, '').trim())
    .filter(line => line && !/^#+/.test(line))
);

const lyricTokensForComparison = (value: string) => (
  normalizeSongSearchText(lyricLinesOnly(value).join(' '))
    .split(' ')
    .filter(token => token.length > 2)
);

const assertVerifiedLyricsPreserved = (
  sourceLyrics: string,
  candidateContent: string,
  language: AppLanguage
) => {
  const sourceLines = lyricLinesOnly(sourceLyrics);
  const candidateLines = lyricLinesOnly(candidateContent);
  if (sourceLines.length >= 8 && candidateLines.length < Math.floor(sourceLines.length * 0.55)) {
    throw new Error('Chord pass dropped too many verified lyric lines.');
  }

  if (language !== 'English') return;
  if (/[\u0900-\u097F]/.test(sourceLyrics)) return;

  const sourceTokens = Array.from(new Set(lyricTokensForComparison(sourceLyrics)));
  const candidateTokens = new Set(lyricTokensForComparison(candidateContent));
  if (sourceTokens.length < 12) return;

  const overlap = sourceTokens.filter(token => candidateTokens.has(token)).length / sourceTokens.length;
  if (overlap < 0.65) {
    throw new Error('Chord pass rewrote or merged the verified lyrics.');
  }
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
        rateLimitScope: 'song-generation',
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
      content: normalizeContentScript(data.content, language),
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

const repairDatabaseResultWithGemini = async (
  query: string,
  databaseResult: any,
  validation: SongQualityValidation,
  language: AppLanguage,
  practiceSkill: SkillLevel,
  sourceLabel: 'bundled_database' | 'lrclib'
) => {
  const cached = readRepairedSongCache(`${sourceLabel}:${query}:${databaseResult?.title || ''}:${databaseResult?.artist || ''}`, language, practiceSkill);
  if (cached) {
    const cachedValidation = validateFrontendSongResult(cached, { language, expectChords: true, minimumLines: 8 });
    if (cachedValidation.recommendedAction === 'use_database') {
      return normalizeGeneratedResult(cached, {
        language,
        skillLevel: practiceSkill,
        source: 'cache',
        minimumLines: 8,
        validation: cachedValidation,
      });
    }
  }

  const transformInstruction = getRequestedLyricTransform(query, language);
  const prompt = `You are repairing a database-backed guitar/karaoke song result for PlectrumAI.

USER REQUEST:
${query}

DATABASE SOURCE:
${sourceLabel}

VALIDATION ISSUES:
${validation.issues.length ? validation.issues.map(issue => `- ${issue}`).join('\n') : '- none'}

QUALITY SCORE:
${validation.qualityScore}/100

TARGET LANGUAGE/SCRIPT:
${language}

TARGET SKILL LEVEL:
${practiceSkill}

${transformInstruction}

DATABASE RESULT TO REPAIR:
${JSON.stringify(databaseResult, null, 2)}

REPAIR RULES:
- Preserve correct title, artist, metadata, known lyrics, chord names, and timing data when they are usable.
- Remove obvious scraping/generation repetition, duplicate sections, empty karaoke lines, and malformed section labels.
- Add or improve [chord] markers only when musically confident; otherwise use a simple playable educational progression.
- Use "### [Section]" headers and one lyric line per line.
- Do not randomly rewrite the song if the database result is mostly good.
- Do not hallucinate fake full copyrighted lyrics if the database did not provide them. If lyrics are unavailable, return a graceful short practice shell and explain in practiceTips.
- Make the result teleprompter/karaoke compatible and nonblank.
- Return strict JSON only in this schema:
{
  "found": true,
  "title": "Exact Song Title",
  "artist": "Exact Artist Name",
  "key": "e.g. G Major",
  "recommendedKey": "e.g. G Major",
  "capo": 0,
  "strummingPattern": "D-DU-UDU",
  "difficulty": "${practiceSkill}",
  "skillLevel": "${practiceSkill}",
  "practiceTips": ["short, practical tip"],
  "chordSimplifications": [{"from":"F","to":"Fmaj7","reason":"easier shape"}],
  "karaokeUrl": "",
  "language": "${language}",
  "languageFallbackReason": "",
  "duration": 240,
  "content": "### [Verse 1]\\n[G]line..."
}`;

  const responseText = await retryWithBackoff(async () => (
    await callGeminiApiWithFallback(MODELS.PRO, [{ role: 'user', parts: [{ text: prompt }] }], {
      rateLimitScope: 'song-generation',
      responseMimeType: 'application/json',
      temperature: 0.12,
      maxOutputTokens: 8192,
    })
  ), 2, 1200);

  const parsed = normalizeContentField(parseGeminiJson(responseText));
  parsed.source = 'database_repaired_with_gemini';
  parsed.metadata = {
    ...(parsed.metadata || {}),
    repairedFrom: sourceLabel,
    originalQualityScore: validation.qualityScore,
    originalValidationIssues: validation.issues,
  };

  const repairedValidation = validateFrontendSongResult(parsed, { language, expectChords: true, minimumLines: 8 });
  if (repairedValidation.recommendedAction !== 'use_database') {
    throw new Error(`Gemini repair remained low quality: ${repairedValidation.issues.join('; ') || repairedValidation.qualityScore}`);
  }

  const normalized = normalizeGeneratedResult(parsed, {
    language,
    skillLevel: practiceSkill,
    source: 'database_repaired_with_gemini',
    minimumLines: 8,
    validation: repairedValidation,
  });
  writeRepairedSongCache(`${sourceLabel}:${query}:${databaseResult?.title || ''}:${databaseResult?.artist || ''}`, language, practiceSkill, normalized);
  return normalized;
};

const generateSongFromTitleInternal = async (query: string, language: AppLanguage = 'English', skillLevel: SkillLevel = 'Intermediate'): Promise<any> => {
  const practiceSkill = normalizePracticeSkill(skillLevel);
  const requestStart = devTimingStart('full_request');
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
      const lookupQuery = stripGenerationDirectives(query);
      const dbSearchStart = devTimingStart('database_search');
      const databaseMatch = searchLocalSongDatabase(lookupQuery);
      devTimingEnd('database_search', dbSearchStart, {
        matched: databaseMatch.found,
        confidence: databaseMatch.confidence,
        reason: databaseMatch.reason,
      });
      const quickValidationStart = devTimingStart('quick_validation');
      const quickValidation = quickValidateAcousticDatabaseSong(databaseMatch.match);
      devTimingEnd('quick_validation', quickValidationStart, {
        qualityScore: quickValidation.qualityScore,
        recommendedAction: quickValidation.recommendedAction,
      });

      if (databaseMatch.found && databaseMatch.match && quickValidation.recommendedAction === 'use_database') {
        const normalizeStart = devTimingStart('database_normalization');
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
          minimumLines: 6,
          validation: quickValidation,
        });
        devTimingEnd('database_normalization', normalizeStart, {
          title: normalized.title,
          source: normalized.source,
        });
        logSongGenDebug('DATABASE_HIT_FAST_PATH', {
          title: databaseMatch.match.title,
          confidence: databaseMatch.confidence,
          qualityScore: quickValidation.qualityScore,
        });
        debugSongLookup({
          query,
          matched: true,
          title: databaseMatch.match.title,
          confidence: databaseMatch.confidence,
          source: 'database',
        });
        devTimingEnd('full_request', requestStart, { source: 'database' });
        return normalized;
      }

      const structuralComplete = !!databaseMatch.match && isDatabaseSongStructurallyComplete(databaseMatch.match);
      const rawValidation = validateAcousticDatabaseSong(databaseMatch.match, { language });
      logSongGenDebug('Bundled database lookup finished', {
        matched: databaseMatch.found,
        complete: structuralComplete,
        confidence: databaseMatch.confidence,
        reason: databaseMatch.reason,
        qualityScore: rawValidation.qualityScore,
        recommendedAction: rawValidation.recommendedAction,
      });

      if (databaseMatch.found && databaseMatch.match) {
        const mapped = mapDatabaseSongToExistingGeminiFormat(
          databaseMatch.match,
          databaseMatch.confidence,
          language,
          practiceSkill
        );
        const mappedValidation = validateFrontendSongResult(mapped, { language, expectChords: true, minimumLines: 10 });

        if (structuralComplete && mappedValidation.recommendedAction === 'use_database' && rawValidation.qualityScore >= 72) {
          const normalized = normalizeGeneratedResult(mapped, {
            language,
            skillLevel: practiceSkill,
            source: 'database',
            minimumLines: 8,
            validation: mappedValidation,
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

        const combinedValidation: SongQualityValidation = {
          isUsable: false,
          qualityScore: Math.min(rawValidation.qualityScore, mappedValidation.qualityScore),
          issues: Array.from(new Set([...rawValidation.issues, ...mappedValidation.issues])),
          recommendedAction: Math.min(rawValidation.qualityScore, mappedValidation.qualityScore) >= 45
            ? 'repair_with_gemini'
            : 'fallback_to_gemini',
        };

        if (combinedValidation.recommendedAction === 'repair_with_gemini') {
          logSongGenDebug('DATABASE_HIT_NEEDS_REPAIR', {
            title: databaseMatch.match.title,
            qualityScore: combinedValidation.qualityScore,
            issues: combinedValidation.issues,
          });
          try {
            const repaired = await repairDatabaseResultWithGemini(
              query,
              mapped,
              combinedValidation,
              language,
              practiceSkill,
              'bundled_database'
            );
            debugSongLookup({
              query,
              matched: true,
              title: databaseMatch.match.title,
              confidence: databaseMatch.confidence,
              source: 'database',
            });
            logSongGenDebug('GEMINI_REPAIR_USED', { title: repaired.title, source: repaired.source });
            devTimingEnd('full_request', requestStart, { source: repaired.source });
            return repaired;
          } catch (repairError) {
            logSongGenDebug('Bundled database repair failed; continuing to fallback flow', {
              error: repairError instanceof Error ? repairError.message : String(repairError),
            });
          }
        }

        logSongGenDebug('Bundled database result rejected by quality validator', {
          title: databaseMatch.match.title,
          validation: combinedValidation,
        });
      }

      debugSongLookup({
        query,
        matched: false,
        confidence: databaseMatch.confidence,
        source: 'gemini',
      });
      logSongGenDebug('DATABASE_MISS_GEMINI_FALLBACK', {
        confidence: databaseMatch.confidence,
        reason: databaseMatch.reason,
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
      const transformInstruction = getRequestedLyricTransform(query, language);
      const rawLyricValidation = validateFrontendSongResult({
        title: dbResult.title,
        artist: dbResult.artist,
        content: dbResult.plainLyrics,
      }, { language, expectChords: false, minimumLines: 8 });

      const chordPrompt = `You are a professional music transcriber with decades of experience.

TASK: Add accurate guitar chords and a practice-ready arrangement to the following lyrics for "${dbResult.title}" by "${dbResult.artist}".
OUTPUT LANGUAGE/SCRIPT: ${language}
TARGET SKILL LEVEL: ${practiceSkill}
${verifiedIdentity ? `CONFIRMED SONG IDENTITY: "${verifiedIdentity.title}" by "${verifiedIdentity.artist}". Use this exact song only.` : ''}
${transformInstruction ? `USER INTENT: ${transformInstruction}` : ''}
DATABASE LYRIC QUALITY: ${rawLyricValidation.qualityScore}/100 (${rawLyricValidation.issues.join('; ') || 'no issues'})

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
          rateLimitScope: 'song-generation',
          responseMimeType: "application/json",
          temperature: 0.1,
          maxOutputTokens: 8192
        });
      });

      const chordData = normalizeContentField(parseGeminiJson(chordResponse));
      if (!hasChordedContent(chordData.content)) {
        throw new Error('Gemini response did not include playable chorded content.');
      }
      assertVerifiedLyricsPreserved(dbResult.plainLyrics, chordData.content, language);

      const candidate = {
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
        source: 'database_repaired_with_gemini',
      };
      const validation = validateFrontendSongResult(candidate, { language, expectChords: true, minimumLines: 8 });
      if (validation.recommendedAction === 'use_database') {
        const normalizedCandidate = normalizeGeneratedResult(candidate, {
          language,
          skillLevel: practiceSkill,
          source: 'database_repaired_with_gemini',
          minimumLines: 8,
          validation,
        });
        devTimingEnd('full_request', requestStart, { source: normalizedCandidate.source });
        return normalizedCandidate;
      }
      return await repairDatabaseResultWithGemini(query, candidate, validation, language, practiceSkill, 'lrclib');
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
        assertVerifiedLyricsPreserved(dbResult.plainLyrics, fallbackData.content, language);

        const compactCandidate = {
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
          source: 'database_repaired_with_gemini',
        };
        const compactValidation = validateFrontendSongResult(compactCandidate, { language, expectChords: true, minimumLines: 8 });
        if (compactValidation.recommendedAction !== 'fallback_to_gemini') {
          const normalizedCompact = normalizeGeneratedResult(compactCandidate, {
            language,
            skillLevel: practiceSkill,
            source: 'database_repaired_with_gemini',
            minimumLines: 8,
            validation: compactValidation,
          });
          devTimingEnd('full_request', requestStart, { source: normalizedCompact.source });
          return normalizedCompact;
        }
        throw new Error(`Compact Gemini fallback remained low quality: ${compactValidation.issues.join('; ')}`);
      } catch (fallbackError) {
        console.warn('[SongGen] Compact Gemini fallback failed, using deterministic playable draft', fallbackError);
        const draft = buildPlayableSongDraft(
          dbResult,
          language,
          practiceSkill
        );
        devTimingEnd('full_request', requestStart, { source: draft.source });
        return draft;
      }
    }
  }

  if (!mashupMode && verifiedIdentity) {
    logSongGenDebug('Verified lyric lookup missed; continuing with AI fallback using resolved identity', {
      title: verifiedIdentity.title,
      artist: verifiedIdentity.artist,
      status: verifiedIdentity.status,
      confidence: verifiedIdentity.confidence,
    });
  }

  // STEP 2: If verified lyrics are unavailable, keep the app useful by asking
  // Gemini for a practice-ready transcription instead of surfacing a hard error.
  console.log('[SongGen] AI transcription fallback for:', query);

  try {
    const langInstruction = language === 'English' ? "English/Roman" : `${language} (${LANGUAGE_SCRIPT_HINTS[language] || 'selected script'})`;
    const lyricLanguageRule = getLyricLanguageInstruction(language);
    const transformInstruction = getRequestedLyricTransform(query, language);
    const prompt = `You are a professional music transcriber and guitar teacher with access to the world's largest library of published guitar tabs and sheet music.

USER REQUEST: "${query}"
TARGET LANGUAGE/SCRIPT: ${langInstruction}
TARGET SKILL LEVEL: ${practiceSkill}
${verifiedIdentity ? `CONFIRMED SONG IDENTITY: "${verifiedIdentity.title}" by "${verifiedIdentity.artist}". Use this exact song only.` : ''}
${transformInstruction ? `USER INTENT: ${transformInstruction}` : ''}

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
        rateLimitScope: 'song-generation',
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
      source: 'gemini_fallback',
      minimumLines: 8,
    });
    devTimingEnd('full_request', requestStart, { source: parsed.source });
    return parsed;
  } catch (error) {
    console.error("Song Generation Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message || 'AI generation failed before returning usable content.');
  }
};

// ─── Complete Song from Lyrics (Gemini Pro) ────────────────────────────

export const generateSongFromTitle = async (
  query: string,
  language: AppLanguage = 'English',
  skillLevel: SkillLevel = 'Intermediate'
): Promise<any> => {
  const practiceSkill = normalizePracticeSkill(skillLevel);
  const cacheKey = cacheKeyForGeneration(query, language, practiceSkill);
  const cached = readNormalizedSongCache(cacheKey, language, practiceSkill);
  if (cached) return cached;

  const pending = pendingGenerationRequests.get(cacheKey);
  if (pending) {
    logSongGenDebug('CACHE_HIT', { cache: 'pending-promise', cacheKey });
    return pending;
  }

  const request = generateSongFromTitleInternal(query, language, practiceSkill)
    .then(result => {
      writeNormalizedSongCache(cacheKey, result);
      return result;
    })
    .finally(() => {
      pendingGenerationRequests.delete(cacheKey);
    });

  pendingGenerationRequests.set(cacheKey, request);
  return request;
};

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
        rateLimitScope: 'song-generation',
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
