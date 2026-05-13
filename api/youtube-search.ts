import { handleYouTubeSearchRequest } from '../server/youtubeSearch';

export default async function handler(req: any, res: any) {
  try {
    const result = await handleYouTubeSearchRequest(req.query || {}, req.method || 'GET');
    if (result.status === 405) res.setHeader('Allow', 'GET');
    return res.status(result.status).json(result.body);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'YouTube search failed.' });
  }
}
