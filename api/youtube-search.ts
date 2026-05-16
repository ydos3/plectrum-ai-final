const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

const isValidVideoId = (id?: string | null) => !!id && YOUTUBE_ID_PATTERN.test(id);

const unique = (items: string[]) => Array.from(new Set(items));

const withTimeout = async (url: string, ms: number) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const canResolveOEmbed = async (videoId: string) => {
  try {
    const response = await withTimeout(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`,
      5000
    );
    return response.ok;
  } catch {
    return false;
  }
};

const fetchOEmbed = async (videoId: string) => {
  try {
    const response = await withTimeout(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`,
      5000
    );
    if (!response.ok) return null;
    const data = await response.json();
    return {
      id: videoId,
      title: typeof data?.title === 'string' ? data.title : undefined,
      channelName: typeof data?.author_name === 'string' ? data.author_name : undefined
    };
  } catch {
    return null;
  }
};

const classifySource = (query: string, candidate: { title?: string; channelName?: string }) => {
  const text = `${query} ${candidate.title || ''} ${candidate.channelName || ''}`.toLowerCase();
  if (/\bkaraoke\b/.test(text)) return 'Karaoke';
  if (/\binstrumental\b|\bbacking track\b/.test(text)) return 'Instrumental';
  if (/\bcover\b/.test(text)) return 'Cover';
  if (/\blyric video\b|\blyrics\b/.test(text)) return 'Lyric Video';
  if (/\bofficial audio\b|\btopic\b/.test(text)) return 'Official Audio';
  if (/\bofficial\b|\bvevo\b|\brecords\b|\bmusic\b/.test(text)) return 'Original';
  return 'Fallback';
};

const extractVideoIds = (html: string) => {
  const ids = [
    ...Array.from(html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)).map(match => match[1]),
    ...Array.from(html.matchAll(/\/watch\?v=([a-zA-Z0-9_-]{11})/g)).map(match => match[1])
  ];
  return unique(ids).slice(0, 20);
};

const searchYouTube = async (query: string) => {
  try {
    const response = await withTimeout(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`,
      7000
    );
    if (!response.ok) return null;

    const candidates = extractVideoIds(await response.text());
    for (const id of candidates) {
      const metadata = await fetchOEmbed(id);
      if (metadata) return { ...metadata, sourceType: classifySource(query, metadata) };
    }
    return candidates[0] ? { id: candidates[0], sourceType: 'Fallback' } : null;
  } catch {
    return null;
  }
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const videoId = String(req.query?.videoId || '');
  if (videoId) {
    if (!isValidVideoId(videoId)) {
      return res.status(400).json({ error: 'Invalid YouTube video ID.' });
    }
    return res.status(200).json({ ok: await canResolveOEmbed(videoId) });
  }

  const query = String(req.query?.q || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Missing search query.' });
  }

  return res.status(200).json((await searchYouTube(query)) || { id: null });
}
