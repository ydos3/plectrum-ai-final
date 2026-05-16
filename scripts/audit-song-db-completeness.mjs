import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const dbPath = path.join(projectRoot, 'data', 'acoustic_setlist_db.min.json');

const getSections = song => (
  song?.lyrics && typeof song.lyrics === 'object'
    ? Object.entries(song.lyrics).filter(([, lines]) => Array.isArray(lines))
    : []
);

const analyzeSong = song => {
  const sections = getSections(song);
  const sectionKeys = sections.map(([key]) => key);
  const lineCount = sections.reduce((count, [, lines]) => count + lines.length, 0);
  const charCount = sections.reduce((count, [, lines]) => count + lines.join('\n').length, 0);
  const hasChorus = sectionKeys.some(key => /chorus/i.test(key));
  const hasVerse2 = sectionKeys.some(key => /verse2|verse_2/i.test(key));
  const flag = String(song.verification_flag || 'UNKNOWN');
  const notes = String(song.verification_notes || '');

  const issues = [];
  if (flag !== 'VERIFIED') issues.push(`verification_flag=${flag}`);
  if (/partial|incomplete|placeholder|sample|needs/i.test(notes)) issues.push('notes suggest incomplete/partial');
  if (sections.length < 3) issues.push('fewer than 3 lyric sections');
  if (lineCount < 12) issues.push('fewer than 12 lyric lines');
  if (charCount < 450) issues.push('short lyric text');
  if (!hasChorus) issues.push('missing chorus section');
  if (!hasVerse2) issues.push('missing verse2 section');

  return {
    id: song.id || '',
    title: song.title || '',
    artist: Array.isArray(song.singers) ? song.singers.join(', ') : '',
    verificationFlag: flag,
    sections: sections.length,
    lines: lineCount,
    characters: charCount,
    hasChorus,
    hasVerse2,
    status: issues.length ? 'needs_review' : 'looks_structurally_complete',
    issues,
  };
};

try {
  const parsed = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const songs = Array.isArray(parsed) ? parsed : parsed.songs;
  if (!Array.isArray(songs)) throw new Error('Expected an array or an object with songs[].');

  const report = songs.map(analyzeSong);
  const needsReview = report.filter(song => song.status === 'needs_review');
  const outputPath = path.join(projectRoot, 'data', 'song-db-completeness-report.json');

  fs.writeFileSync(outputPath, `${JSON.stringify({
    database: 'data/acoustic_setlist_db.min.json',
    generatedAt: new Date().toISOString(),
    totalSongs: report.length,
    looksStructurallyComplete: report.length - needsReview.length,
    needsReview: needsReview.length,
    songs: report,
  }, null, 2)}\n`);

  console.log(`Audited ${report.length} songs.`);
  console.log(`Looks structurally complete: ${report.length - needsReview.length}`);
  console.log(`Needs review: ${needsReview.length}`);
  console.log(`Report: ${path.relative(projectRoot, outputPath)}`);
  console.log('');
  console.table(needsReview.slice(0, 30).map(song => ({
    id: song.id,
    title: song.title,
    flag: song.verificationFlag,
    sections: song.sections,
    lines: song.lines,
    issues: song.issues.slice(0, 2).join('; '),
  })));
  if (needsReview.length > 30) {
    console.log(`...and ${needsReview.length - 30} more in the JSON report.`);
  }
} catch (error) {
  console.error(`Song DB audit failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
