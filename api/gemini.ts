const ALLOWED_MODELS = new Set([
  'gemini-2.5-pro',
  'gemini-2.5-flash'
]);

const SONG_GENERATION_DAILY_LIMIT = 15;
const SONG_RATE_LIMIT_SCOPE = 'song-generation';
const SONG_RATE_LIMIT_COOKIE = 'plectrum_song_generation_daily';

type RateLimitBucket = {
  count: number;
  day: string;
};

const getRateLimitStore = (): Map<string, RateLimitBucket> => {
  const globalStore = globalThis as typeof globalThis & {
    __plectrumSongRateLimits?: Map<string, RateLimitBucket>;
  };
  if (!globalStore.__plectrumSongRateLimits) {
    globalStore.__plectrumSongRateLimits = new Map();
  }
  return globalStore.__plectrumSongRateLimits;
};

const getClientIp = (req: any) => {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'unknown');
};

const getTodayKey = () => new Date().toISOString().slice(0, 10);

const parseCookies = (cookieHeader: string = '') => (
  Object.fromEntries(
    cookieHeader
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf('=');
        if (index < 0) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  )
);

const readCookieLimit = (req: any) => {
  const cookies = parseCookies(String(req.headers?.cookie || ''));
  const [day, countText] = String(cookies[SONG_RATE_LIMIT_COOKIE] || '').split(':');
  const count = Number(countText);
  if (day !== getTodayKey() || !Number.isFinite(count) || count < 0) return 0;
  return count;
};

const setCookieLimit = (req: any, res: any, day: string, count: number) => {
  const isHttps = String(req.headers?.['x-forwarded-proto'] || '').includes('https');
  res.setHeader(
    'Set-Cookie',
    `${SONG_RATE_LIMIT_COOKIE}=${encodeURIComponent(`${day}:${count}`)}; Path=/; Max-Age=90000; SameSite=Lax${isHttps ? '; Secure' : ''}`
  );
};

const checkSongGenerationLimit = (req: any, clientUserId?: string) => {
  const today = getTodayKey();
  const userPart = String(clientUserId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'anonymous';
  const key = `${today}:${getClientIp(req)}:${userPart}`;
  const store = getRateLimitStore();
  const bucket = store.get(key);
  const cookieCount = readCookieLimit(req);
  const currentCount = Math.max(bucket?.day === today ? bucket.count : 0, cookieCount);

  if (currentCount >= SONG_GENERATION_DAILY_LIMIT) {
    return {
      allowed: false,
      count: currentCount,
      remaining: 0,
      limit: SONG_GENERATION_DAILY_LIMIT,
      reset: `${today}T23:59:59.999Z`,
    };
  }

  const nextCount = currentCount + 1;
  store.set(key, { day: today, count: nextCount });
  return {
    allowed: true,
    count: nextCount,
    remaining: Math.max(0, SONG_GENERATION_DAILY_LIMIT - nextCount),
    limit: SONG_GENERATION_DAILY_LIMIT,
    reset: `${today}T23:59:59.999Z`,
  };
};

const getServerApiKey = () => {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY || '';
};

const getGeminiUrl = (model: string, apiKey: string) => {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    
    const apiKey = getServerApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: 'Gemini API key is not configured on the server.' });
    }

    if (!payload || !ALLOWED_MODELS.has(payload.model)) {
      return res.status(400).json({ error: 'Unsupported Gemini model.' });
    }

    if (!Array.isArray(payload.contents) || payload.contents.length === 0) {
      return res.status(400).json({ error: 'Gemini request is missing contents.' });
    }

    if (payload.rateLimitScope === SONG_RATE_LIMIT_SCOPE) {
      const rateLimit = checkSongGenerationLimit(req, payload.clientUserId);
      setCookieLimit(req, res, getTodayKey(), rateLimit.count);
      res.setHeader('X-RateLimit-Limit', String(rateLimit.limit));
      res.setHeader('X-RateLimit-Remaining', String(rateLimit.remaining));
      res.setHeader('X-RateLimit-Reset', rateLimit.reset);
      if (!rateLimit.allowed) {
        return res.status(429).json({
          error: 'Daily AI song generation limit reached. Database songs remain available; please try AI generation again tomorrow.',
        });
      }
    }

    const { systemInstruction, ...generationConfig } = payload.generationConfig || {};

    const response = await fetch(getGeminiUrl(payload.model, apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: payload.contents,
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ],
        generationConfig: {
          candidateCount: 1,
          ...generationConfig
        },
        ...(systemInstruction ? { systemInstruction } : {})
      })
    });

    const text = await response.text();

    if (!response.ok) {
      let message = `Gemini API Error: ${response.status} ${response.statusText}`;
      try {
        const parsed = JSON.parse(text);
        message = parsed?.error?.message || message;
      } catch {
        // Keep the sanitized status message.
      }
      return res.status(response.status).json({ error: message });
    }

    try {
      return res.status(200).json(JSON.parse(text));
    } catch {
      return res.status(502).json({ error: 'Gemini returned an invalid response.' });
    }

  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Invalid Gemini request.' });
  }
}
