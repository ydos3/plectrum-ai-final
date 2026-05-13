const ALLOWED_MODELS = new Set([
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash'
]);

const getServerApiKey = () => (
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.API_KEY ||
  ''
);

const getGeminiUrl = (model: string, apiKey: string) => (
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
);

export interface GeminiProxyPayload {
  model: string;
  contents: unknown[];
  generationConfig?: Record<string, unknown>;
}

export const handleGeminiProxyRequest = async (payload: GeminiProxyPayload) => {
  const apiKey = getServerApiKey();
  if (!apiKey) {
    return {
      status: 500,
      body: { error: 'Gemini API key is not configured on the server.' }
    };
  }

  if (!payload || !ALLOWED_MODELS.has(payload.model)) {
    return {
      status: 400,
      body: { error: 'Unsupported Gemini model.' }
    };
  }

  if (!Array.isArray(payload.contents) || payload.contents.length === 0) {
    return {
      status: 400,
      body: { error: 'Gemini request is missing contents.' }
    };
  }

  const { systemInstruction, ...generationConfig } = payload.generationConfig || {};

  const response = await fetch(getGeminiUrl(payload.model, apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: payload.contents,
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

    return {
      status: response.status,
      body: { error: message }
    };
  }

  try {
    return {
      status: 200,
      body: JSON.parse(text)
    };
  } catch {
    return {
      status: 502,
      body: { error: 'Gemini returned an invalid response.' }
    };
  }
};
