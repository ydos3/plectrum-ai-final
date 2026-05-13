import { AppLanguage, SkillLevel } from '../types';
import { normalizeSongSearchText } from './songDatabaseService';

const CACHE_KEY = 'plectrum_song_arrangement_cache_v1';
const MAX_CACHE_ITEMS = 75;

type CacheEnvelope = {
  savedAt: number;
  data: any;
};

const normalizeSkill = (skillLevel?: SkillLevel) => (
  skillLevel === 'Beginner' || skillLevel === 'Intermediate' ? skillLevel : 'Advanced'
);

export const getArrangementCacheKey = (
  query: string,
  language: AppLanguage,
  skillLevel: SkillLevel,
  title?: string,
  artist?: string
) => {
  const identity = title && artist ? `${title} ${artist}` : query;
  return [
    normalizeSongSearchText(identity),
    language,
    normalizeSkill(skillLevel)
  ].join('|');
};

const readLocalCache = (): Record<string, CacheEnvelope> => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
};

export const getCachedArrangement = async (key: string) => {
  const local = readLocalCache()[key]?.data;
  if (local) return { ...local, source: local.source || 'cache' };

  try {
    const response = await fetch(`/api/song-cache?key=${encodeURIComponent(key)}`);
    if (!response.ok) return null;
    const remote = await response.json();
    if (remote?.data) {
      saveArrangementToLocalCache(key, remote.data);
      return { ...remote.data, source: remote.data.source || 'shared-cache' };
    }
  } catch {
    // Remote cache is optional. Local-first still works without it.
  }

  return null;
};

export const searchCachedArrangement = async (
  query: string,
  language: AppLanguage,
  skillLevel: SkillLevel
) => {
  try {
    const params = new URLSearchParams({
      q: query,
      language,
      skillLevel: normalizeSkill(skillLevel)
    });
    const response = await fetch(`/api/song-cache?${params.toString()}`);
    if (!response.ok) return null;
    const remote = await response.json();
    if (remote?.data) {
      saveArrangementToLocalCache(getArrangementCacheKey(query, language, skillLevel, remote.data.title, remote.data.artist), remote.data);
      return { ...remote.data, source: remote.data.source || 'shared-library' };
    }
  } catch {
    // Local dev may not have the backend running yet.
  }

  return null;
};

export const saveArrangementToLocalCache = (key: string, data: any) => {
  const cache = readLocalCache();
  cache[key] = { savedAt: Date.now(), data };

  const sorted = Object.entries(cache)
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .slice(0, MAX_CACHE_ITEMS);

  localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(sorted)));
};

export const saveArrangementToCache = async (key: string, data: any) => {
  saveArrangementToLocalCache(key, data);

  try {
    await fetch('/api/song-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, data })
    });
  } catch {
    // Optional shared cache may be disabled in deployments without KV env vars.
  }
};
