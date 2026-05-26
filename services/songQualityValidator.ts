import { AppLanguage } from '../types';
import { AcousticDbSong } from './songDbTypes';

export type SongQualityAction = 'use_database' | 'repair_with_gemini' | 'fallback_to_gemini';

export interface SongQualityValidation {
  isUsable: boolean;
  qualityScore: number;
  issues: string[];
  recommendedAction: SongQualityAction;
}

const CHORD_RE = /\[[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?\]/;
const SECTION_RE = /^###\s*\[[^\]]+\]/;

const normalizeLine = (line: string) => (
  line
    .replace(/\[[^\]]+\]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
);

const lyricLinesFromContent = (content: string) => (
  content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !SECTION_RE.test(line))
);

const sectionNamesFromContent = (content: string) => (
  content
    .split(/\r?\n/)
    .map(line => line.trim().match(/^###\s*\[([^\]]+)\]/)?.[1]?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value))
);

const repetitionStats = (lines: string[]) => {
  const normalized = lines.map(normalizeLine).filter(line => line.length >= 4);
  const counts = new Map<string, number>();
  normalized.forEach(line => counts.set(line, (counts.get(line) || 0) + 1));

  const repeatedLineCount = normalized.filter(line => (counts.get(line) || 0) > 1).length;
  const maxRepeat = Math.max(0, ...Array.from(counts.values()));
  const uniqueRatio = normalized.length ? counts.size / normalized.length : 0;

  let repeatedRuns = 0;
  for (let i = 2; i < normalized.length; i += 1) {
    if (normalized[i] && normalized[i] === normalized[i - 1] && normalized[i] === normalized[i - 2]) {
      repeatedRuns += 1;
    }
  }

  return { uniqueRatio, repeatedLineCount, maxRepeat, repeatedRuns };
};

const hasLikelyPlaceholderText = (content: string) => (
  /\b(?:placeholder|sample lyrics|lorem ipsum|todo|unknown lyrics|lyrics unavailable|not available|na\/a|insert lyrics|generated lyrics)\b/i.test(content)
);

const hasMalformedChordPlacement = (lines: string[]) => {
  const bracketLines = lines.filter(line => /\[[^\]]+\]/.test(line));
  if (bracketLines.length === 0) return false;
  const nonChordBracketLines = bracketLines.filter(line => {
    const brackets = line.match(/\[[^\]]+\]/g) || [];
    return brackets.some(token => !CHORD_RE.test(token));
  });
  return nonChordBracketLines.length / bracketLines.length > 0.35;
};

const hasScriptMismatch = (content: string, language: AppLanguage) => {
  const lyricText = lyricLinesFromContent(content).join(' ');
  if (!lyricText.trim()) return false;
  const latinChars = (lyricText.match(/[A-Za-z]/g) || []).length;
  const devanagariChars = (lyricText.match(/[\u0900-\u097F]/g) || []).length;
  if (language === 'English') {
    return devanagariChars > 10 && latinChars < devanagariChars * 2;
  }
  if (['Hindi', 'Marathi', 'Maithili'].includes(language)) {
    return latinChars > 80 && devanagariChars < 10;
  }
  return false;
};

const finalizeValidation = (score: number, issues: string[]): SongQualityValidation => {
  const qualityScore = Math.max(0, Math.min(100, Math.round(score)));
  const severe = issues.some(issue => /missing title|missing artist|missing lyrics|too short|placeholder|unrelated|malformed schema/i.test(issue));
  const recommendedAction: SongQualityAction =
    qualityScore >= 78 && !severe ? 'use_database' :
    qualityScore >= 45 && !issues.some(issue => /missing lyrics|placeholder|malformed schema/i.test(issue)) ? 'repair_with_gemini' :
    'fallback_to_gemini';

  return {
    isUsable: recommendedAction === 'use_database',
    qualityScore,
    issues,
    recommendedAction,
  };
};

export const validateFrontendSongResult = (
  result: any,
  options: { language: AppLanguage; expectChords?: boolean; minimumLines?: number } = { language: 'English' }
): SongQualityValidation => {
  const issues: string[] = [];
  let score = 100;

  if (!result || typeof result !== 'object') {
    return finalizeValidation(0, ['malformed schema: result is not an object']);
  }

  const title = String(result.title || '').trim();
  const artist = String(result.artist || '').trim();
  const content = typeof result.content === 'string' ? result.content.trim() : '';
  const lines = content ? lyricLinesFromContent(content) : [];
  const sections = content ? sectionNamesFromContent(content) : [];
  const minimumLines = options.minimumLines ?? 8;

  if (!title) { issues.push('missing title'); score -= 20; }
  if (!artist || /^unknown$/i.test(artist)) { issues.push('missing artist'); score -= 12; }
  if (!content) { issues.push('missing lyrics/content'); score -= 50; }
  if (content && lines.length < minimumLines) { issues.push(`lyrics too short (${lines.length} lines)`); score -= 24; }
  if (content && content.length < 220) { issues.push('content too short'); score -= 14; }
  if (hasLikelyPlaceholderText(content)) { issues.push('placeholder or useless lyric text detected'); score -= 35; }
  if (options.expectChords !== false && !CHORD_RE.test(content)) { issues.push('missing playable chord markers'); score -= 25; }
  if (sections.length === 0) { issues.push('missing section headers'); score -= 10; }
  if (sections.length > 0 && !sections.some(section => /verse|chorus|bridge|intro|outro|pre/.test(section))) {
    issues.push('broken section format');
    score -= 12;
  }

  const sectionCounts = new Map<string, number>();
  sections.forEach(section => sectionCounts.set(section, (sectionCounts.get(section) || 0) + 1));
  if (Array.from(sectionCounts.values()).some(count => count > 3)) {
    issues.push('duplicate sections repeated too often');
    score -= 12;
  }

  if (lines.length) {
    const stats = repetitionStats(lines);
    if (stats.uniqueRatio < 0.58 && lines.length >= 10) {
      issues.push('lyrics are highly repetitive or padded');
      score -= 26;
    }
    if (stats.maxRepeat >= 5) {
      issues.push('same lyric line repeated excessively');
      score -= 20;
    }
    if (stats.repeatedRuns > 0) {
      issues.push('consecutive repeated lyric lines detected');
      score -= 14;
    }
    if (hasMalformedChordPlacement(lines)) {
      issues.push('malformed bracket/chord placement');
      score -= 16;
    }
  }

  if (hasScriptMismatch(content, options.language)) {
    issues.push(`content script does not match requested ${options.language}`);
    score -= 18;
  }

  return finalizeValidation(score, issues);
};

export const quickValidateAcousticDatabaseSong = (
  song: AcousticDbSong | undefined
): SongQualityValidation => {
  if (!song) return finalizeValidation(0, ['malformed schema: missing database song']);

  const issues: string[] = [];
  let score = 100;
  const title = String(song.title || '').trim();
  const artist = Array.isArray(song.singers) ? song.singers.filter(Boolean).join(', ') : '';
  const sections = song.lyrics && typeof song.lyrics === 'object' ? Object.values(song.lyrics) : [];
  const lines = sections
    .filter(Array.isArray)
    .flat()
    .map(line => String(line || '').trim())
    .filter(Boolean);
  const content = lines.join('\n');

  if (!title) { issues.push('missing title'); score -= 35; }
  if (!artist) { issues.push('missing artist'); score -= 10; }
  if (!lines.length) { issues.push('missing lyrics/content'); score -= 55; }
  if (lines.length > 0 && lines.length < 6) { issues.push(`lyrics too short (${lines.length} lines)`); score -= 28; }
  if (content.length > 0 && content.length < 160) { issues.push('content too short'); score -= 18; }
  if (hasLikelyPlaceholderText(content)) { issues.push('placeholder or useless lyric text detected'); score -= 45; }
  if (!CHORD_RE.test(content)) { issues.push('missing playable chord markers'); score -= 18; }

  if (lines.length >= 8) {
    const stats = repetitionStats(lines);
    if (stats.uniqueRatio < 0.42) {
      issues.push('massive duplicate repetition detected');
      score -= 42;
    } else if (stats.uniqueRatio < 0.52 && stats.maxRepeat >= 5) {
      issues.push('lyrics appear padded with repeated lines');
      score -= 26;
    }
    if (stats.repeatedRuns >= 2) {
      issues.push('consecutive repeated lyric lines detected');
      score -= 24;
    }
  }

  const qualityScore = Math.max(0, Math.min(100, Math.round(score)));
  const recommendedAction: SongQualityAction =
    qualityScore >= 68 && !issues.some(issue => /missing lyrics|placeholder|massive duplicate|missing title/i.test(issue))
      ? 'use_database'
      : qualityScore >= 42
        ? 'repair_with_gemini'
        : 'fallback_to_gemini';

  return {
    isUsable: recommendedAction === 'use_database',
    qualityScore,
    issues,
    recommendedAction,
  };
};

export const validateAcousticDatabaseSong = (
  song: AcousticDbSong | undefined,
  options: { language: AppLanguage }
): SongQualityValidation => {
  if (!song) return finalizeValidation(0, ['malformed schema: missing database song']);
  const content = Object.entries(song.lyrics || {})
    .map(([section, lines]) => `### [${section}]\n${Array.isArray(lines) ? lines.join('\n') : ''}`)
    .join('\n\n');

  const mappedLike = {
    title: song.title,
    artist: Array.isArray(song.singers) ? song.singers.join(', ') : '',
    content,
  };
  const validation = validateFrontendSongResult(mappedLike, {
    language: options.language,
    expectChords: true,
    minimumLines: 10,
  });

  const issues = [...validation.issues];
  let score = validation.qualityScore;
  const flag = String(song.verification_flag || '').toUpperCase();
  const notes = String(song.verification_notes || '');

  if (flag !== 'VERIFIED') {
    issues.push(`database verification flag is ${flag || 'missing'}`);
    score -= flag === 'PARTIAL' ? 16 : 24;
  }
  if (/partial|incomplete|placeholder|sample|needs|uncertain|unverified/i.test(notes)) {
    issues.push('database notes indicate partial or uncertain data');
    score -= 18;
  }
  if (!song.verified_key) { issues.push('missing key metadata'); score -= 6; }
  if (!song.strumming_pattern) { issues.push('missing strumming pattern'); score -= 5; }

  return finalizeValidation(score, Array.from(new Set(issues)));
};

export const summarizeValidation = (validation: SongQualityValidation) => (
  `${validation.recommendedAction} (${validation.qualityScore}/100): ${validation.issues.join('; ') || 'no issues'}`
);
