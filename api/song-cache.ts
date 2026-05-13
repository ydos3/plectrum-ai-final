const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const CACHE_PREFIX = 'plectrum:song:';

const isCacheConfigured = () => Boolean(KV_URL && KV_TOKEN);

const kvRequest = async (path: string, init?: RequestInit) => {
  const response = await fetch(`${KV_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      ...(init?.headers || {})
    }
  });
  if (!response.ok) throw new Error(`KV request failed: ${response.status}`);
  return response.json();
};

const cacheKey = (value: string) => `${CACHE_PREFIX}${value}`.replace(/[\r\n]/g, '');

export default async function handler(req: any, res: any) {
  if (!isCacheConfigured()) {
    return res.status(204).end();
  }

  try {
    if (req.method === 'GET') {
      const key = String(req.query?.key || '');
      if (!key) return res.status(400).json({ error: 'Missing cache key.' });

      const result = await kvRequest(`/get/${encodeURIComponent(cacheKey(key))}`);
      const raw = result?.result;
      return res.status(200).json({ data: raw ? JSON.parse(raw) : null });
    }

    if (req.method === 'POST') {
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const key = String(payload?.key || '');
      if (!key || !payload?.data) return res.status(400).json({ error: 'Missing cache payload.' });

      await kvRequest(`/set/${encodeURIComponent(cacheKey(key))}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(JSON.stringify(payload.data))
      });

      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Song cache failed.' });
  }
}
