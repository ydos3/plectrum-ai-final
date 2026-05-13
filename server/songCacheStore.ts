import fs from 'fs/promises';
import path from 'path';
import { normalizeSongSearchText } from '../services/songDatabaseService';

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const CACHE_PREFIX = 'plectrum:song:v2:'; // Bumped version to flush old bad caches
const LOCAL_STORE_PATH = path.resolve(process.cwd(), 'data', 'song-library-v2.json');

type SongCacheRecord = {
  key: string;
  savedAt: number;
  normalizedTitle: string;
  normalizedArtist: string;
  normalizedSearchText: string;
  language: string;
  skillLevel: string;
  data: any;
};

type SongCachePayload = {
  key?: string;
  q?: string;
  language?: string;
  skillLevel?: string;
  data?: any;
};

const isKvConfigured = () => Boolean(KV_URL && KV_TOKEN);

const normalizeSkill = (skillLevel?: string) => (
  skillLevel === 'Beginner' || skillLevel === 'Intermediate' ? skillLevel : 'Advanced'
);

const makeRecord = (key: string, data: any): SongCacheRecord => {
  const title = String(data?.title || '');
  const artist = String(data?.artist || '');
  const language = String(data?.language || 'English');
  const skillLevel = normalizeSkill(String(data?.skillLevel || data?.difficulty || 'Advanced'));
  return {
    key,
    savedAt: Date.now(),
    normalizedTitle: normalizeSongSearchText(title),
    normalizedArtist: normalizeSongSearchText(artist),
    normalizedSearchText: normalizeSongSearchText(`${title} ${artist} ${data?.movie || ''}`),
    language,
    skillLevel,
    data
  };
};

const readLocalStore = async (): Promise<Record<string, SongCacheRecord>> => {
  try {
    const raw = await fs.readFile(LOCAL_STORE_PATH, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
};

const writeLocalStore = async (records: Record<string, SongCacheRecord>) => {
  await fs.mkdir(path.dirname(LOCAL_STORE_PATH), { recursive: true });
  await fs.writeFile(LOCAL_STORE_PATH, JSON.stringify(records, null, 2), 'utf8');
};

const kvRequest = async (pathSuffix: string, init?: RequestInit) => {
  const response = await fetch(`${KV_URL}${pathSuffix}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      ...(init?.headers || {})
    }
  });
  if (!response.ok) throw new Error(`KV request failed: ${response.status}`);
  return response.json();
};

const kvKey = (value: string) => `${CACHE_PREFIX}${value}`.replace(/[\r\n]/g, '');

const getByKey = async (key: string) => {
  if (isKvConfigured()) {
    const result = await kvRequest(`/get/${encodeURIComponent(kvKey(key))}`);
    const raw = result?.result;
    return raw ? JSON.parse(raw).data || JSON.parse(raw) : null;
  }

  const records = await readLocalStore();
  return records[key]?.data || null;
};

const saveByKey = async (key: string, data: any) => {
  const record = makeRecord(key, data);

  if (isKvConfigured()) {
    await kvRequest(`/set/${encodeURIComponent(kvKey(key))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(record))
    });
    return;
  }

  const records = await readLocalStore();
  records[key] = record;
  await writeLocalStore(records);
};

const searchLocal = async (payload: SongCachePayload) => {
  const records = Object.values(await readLocalStore());
  const query = normalizeSongSearchText(String(payload.q || ''));
  if (!query) return null;

  const language = payload.language ? String(payload.language) : '';
  const skillLevel = payload.skillLevel ? normalizeSkill(String(payload.skillLevel)) : '';

  const scored = records
    .filter(record => !language || record.language === language)
    .filter(record => !skillLevel || record.skillLevel === skillLevel)
    .map(record => {
      let score = 0;
      if (record.normalizedTitle === query) score += 1;
      if (record.normalizedSearchText === query) score += 1;
      if (record.normalizedSearchText.includes(query) && query.length > 2) score += 0.6;
      if (query.includes(record.normalizedTitle) && record.normalizedTitle.length > 2) score += 0.5;
      return { record, score };
    })
    .filter(item => item.score >= 0.6)
    .sort((a, b) => b.score - a.score || b.record.savedAt - a.record.savedAt);

  if (scored.length === 0) return null;

  const best = scored[0];
  const second = scored[1];
  if (
    best.record.normalizedTitle === query &&
    second?.record.normalizedTitle === query &&
    best.record.normalizedArtist !== second.record.normalizedArtist &&
    best.score === second.score
  ) {
    return null;
  }

  return best.record.data;
};

export const handleSongCacheRequest = async (payload: SongCachePayload, method: string) => {
  if (method === 'GET') {
    if (payload.key) {
      return { status: 200, body: { data: await getByKey(String(payload.key)) } };
    }
    if (payload.q) {
      return { status: 200, body: { data: await searchLocal(payload) } };
    }
    return { status: 400, body: { error: 'Missing cache key or search query.' } };
  }

  if (method === 'POST') {
    if (!payload.key || !payload.data) {
      return { status: 400, body: { error: 'Missing cache payload.' } };
    }
    await saveByKey(String(payload.key), payload.data);
    return { status: 200, body: { ok: true } };
  }

  return { status: 405, body: { error: 'Method not allowed.' } };
};
