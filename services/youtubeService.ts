const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export const isValidYouTubeVideoId = (id?: string | null) => (
  !!id && YOUTUBE_ID_PATTERN.test(id)
);

export const extractYouTubeVideoId = (input: string): string | null => {
  if (!input) return null;
  const value = input.trim();
  if (isValidYouTubeVideoId(value)) return value;

  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(withProtocol);
    const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '').replace(/^music\./, '');

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return isValidYouTubeVideoId(id) ? id : null;
    }

    if (host.endsWith('youtube.com')) {
      const fromQuery = url.searchParams.get('v');
      if (isValidYouTubeVideoId(fromQuery)) return fromQuery;

      const parts = url.pathname.split('/').filter(Boolean);
      const markerIndex = parts.findIndex(part => ['embed', 'shorts', 'v', 'live'].includes(part));
      const id = markerIndex >= 0 ? parts[markerIndex + 1] : null;
      return isValidYouTubeVideoId(id) ? id : null;
    }
  } catch {
    const match = value.match(/(?:v=|\/embed\/|\/shorts\/|youtu\.be\/|\/v\/|\/live\/)([a-zA-Z0-9_-]{11})/);
    return isValidYouTubeVideoId(match?.[1]) ? match![1] : null;
  }

  return null;
};

export const toYouTubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export const getYouTubeSearchUrl = (query: string) => (
  `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
);
