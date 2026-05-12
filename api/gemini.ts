const ALLOWED_MODELS = new Set([
  'gemini-2.5-pro',
  'gemini-2.5-flash'
]);

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