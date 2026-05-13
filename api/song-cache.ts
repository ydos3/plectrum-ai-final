import { handleSongCacheRequest } from '../server/songCacheStore';

export default async function handler(req: any, res: any) {
  try {
    const payload = req.method === 'GET'
      ? req.query || {}
      : (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});

    const result = await handleSongCacheRequest(payload, req.method || 'GET');
    if (result.status === 405) res.setHeader('Allow', 'GET, POST');
    return res.status(result.status).json(result.body);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Song cache failed.' });
  }
}
