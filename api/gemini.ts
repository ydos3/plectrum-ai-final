import { handleGeminiProxyRequest } from '../server/geminiProxy';

type ApiRequest = AsyncIterable<Buffer | string> & {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void };
};

const readJsonBody = async (req: ApiRequest) => {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  return rawBody ? JSON.parse(rawBody) : {};
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const payload = await readJsonBody(req);
    const result = await handleGeminiProxyRequest(payload);
    return res.status(result.status).json(result.body);
  } catch {
    return res.status(400).json({ error: 'Invalid Gemini request.' });
  }
}
