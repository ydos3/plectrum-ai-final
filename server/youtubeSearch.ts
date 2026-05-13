const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

type YouTubeSearchPayload = {
  q?: string;
  videoId?: string;
};

const isValidVideoId = (id?: string | null) => !!id && YOUTUBE_ID_PATTERN.test(id);

const unique = <T,>(items: T[]) => Array.from(new Set(items));

const fetchText = async (url: string) => {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  if (!response.ok) throw new Error(`YouTube request failed: ${response.status}`);
  return response.text();
};

const canResolveOEmbed = async (videoId: string) => {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`, {
      headers: { 'User-Agent': 'PlectrumAI/1.0' }
    });
    return response.ok;
  } catch {
    return false;
  }
};

const extractVideoIds = (html: string) => {
  const ids = [
    ...Array.from(html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)).map(match => match[1]),
    ...Array.from(html.matchAll(/\/watch\?v=([a-zA-Z0-9_-]{11})/g)).map(match => match[1])
  ];
  return unique(ids).slice(0, 20);
};

const searchYouTube = async (query: string) => {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
  const html = await fetchText(searchUrl);
  const candidates = extractVideoIds(html);

  for (const id of candidates) {
    if (await canResolveOEmbed(id)) return id;
  }

  return candidates[0] || null;
};

export const handleYouTubeSearchRequest = async (payload: YouTubeSearchPayload, method: string) => {
  if (method !== 'GET') {
    return { status: 405, body: { error: 'Method not allowed.' } };
  }

  if (payload.videoId) {
    const videoId = String(payload.videoId);
    if (!isValidVideoId(videoId)) {
      return { status: 400, body: { error: 'Invalid YouTube video ID.' } };
    }
    return { status: 200, body: { ok: await canResolveOEmbed(videoId) } };
  }

  const query = String(payload.q || '').trim();
  if (!query) {
    return { status: 400, body: { error: 'Missing search query.' } };
  }

  return { status: 200, body: { id: await searchYouTube(query) } };
};
