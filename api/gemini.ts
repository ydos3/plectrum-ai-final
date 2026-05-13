const ALLOWED_MODELS = new Set([
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'glm-4-flash'
]);

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || 'ddd4a35a6ffe43c0ae534a1bcf3b6683.87gtrpBTIyFkmEQ0';

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

    if (payload.model.startsWith('glm-')) {
      const messages: any[] = [];
      if (systemInstruction?.parts?.[0]?.text) {
        messages.push({ role: 'system', content: systemInstruction.parts[0].text });
      }
      for (const c of payload.contents) {
        const role = c.role === 'model' ? 'assistant' : 'user';
        const content = c.parts.map((p: any) => p.text || '').join('\\n');
        messages.push({ role, content });
      }

      const zhipuResponse = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ZHIPU_API_KEY}`
        },
        body: JSON.stringify({
          model: payload.model,
          messages,
          temperature: generationConfig.temperature || 0.2,
        })
      });

      const text = await zhipuResponse.text();
      if (!zhipuResponse.ok) {
        let message = `GLM API Error: ${zhipuResponse.status} ${zhipuResponse.statusText}`;
        try {
          const parsed = JSON.parse(text);
          message = parsed?.error?.message || message;
        } catch { }
        return res.status(zhipuResponse.status).json({ error: message });
      }

      try {
        const data = JSON.parse(text);
        // Translate back to Gemini format for the client
        const geminiFormat = {
          candidates: [
            {
              content: {
                parts: [{ text: data.choices[0].message.content }],
                role: 'model'
              },
              finishReason: data.choices[0].finish_reason === 'stop' ? 'STOP' : (data.choices[0].finish_reason || 'STOP')
            }
          ]
        };
        return res.status(200).json(geminiFormat);
      } catch {
        return res.status(502).json({ error: 'GLM returned an invalid response.' });
      }
    }

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
