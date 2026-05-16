const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

type YouTubeSearchPayload = {
  q?: string;
  videoId?: string;
};

type Candidate = {
  id: string;
  title?: string;
  channelName?: string;
  sourceType?: string;
};

const isValidVideoId = (id?: string | null) => !!id && YOUTUBE_ID_PATTERN.test(id);

const unique = <T,>(items: T[]) => Array.from(new Set(items));

const withTimeout = async <T,>(fn: (signal: AbortSignal) => Promise<T>, ms = 7000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchText = async (url: string) => {
  const response = await withTimeout((signal) => fetch(url, {
    signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  }));
  if (!response.ok) return '';
  return response.text();
};

const canResolveOEmbed = async (videoId: string) => {
  try {
    const response = await withTimeout((signal) => fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`, {
      signal,
      headers: { 'User-Agent': 'PlectrumAI/1.0' }
    }), 5000);
    return response.ok;
  } catch {
    return false;
  }
};

const fetchOEmbed = async (videoId: string): Promise<Candidate | null> => {
  try {
    const response = await withTimeout((signal) => fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`, {
      signal,
      headers: { 'User-Agent': 'PlectrumAI/1.0' }
    }), 5000);
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

const classifySource = (query: string, candidate: Candidate) => {
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
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
    const html = await fetchText(searchUrl);
    const candidates = extractVideoIds(html);

    for (const id of candidates) {
      const metadata = await fetchOEmbed(id);
      if (metadata) return { ...metadata, sourceType: classifySource(query, metadata) };
    }

    return candidates[0] ? { id: candidates[0], sourceType: 'Fallback' } : null;
  } catch {
    return null;
  }
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

  const result = await searchYouTube(query);
  return { status: 200, body: result || { id: null } };
};
