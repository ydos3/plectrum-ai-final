import assert from 'node:assert/strict';
import { sanitizeFilename, parseSheetContent } from '../services/pdfSheetLayout.ts';

// ── filename sanitisation ──
{
  assert.equal(sanitizeFilename('Khairiyat'), 'Khairiyat.pdf', 'plain title');
  assert.equal(sanitizeFilename('Death Bed - Fingerstyle'), 'Death Bed - Fingerstyle.pdf', 'dashes + spaces kept');
  assert.equal(sanitizeFilename('A/B:C*?"<>|D'), 'A B C D.pdf', 'only forbidden chars stripped');
  assert.equal(sanitizeFilename('Khairiyat'), 'Khairiyat.pdf', 'plain title');
  assert.equal(sanitizeFilename(''), 'Plectrum Practice Sheet.pdf', 'empty → fallback');
  assert.equal(sanitizeFilename('   '), 'Plectrum Practice Sheet.pdf', 'whitespace → fallback');
  assert.equal(sanitizeFilename('Trailing dots...'), 'Trailing dots.pdf', 'no trailing dots');
  assert.ok(sanitizeFilename('x'.repeat(500)).length <= 124, 'very long title clamped');
  assert.ok(sanitizeFilename('Song "Quote" & <tag>').endsWith('.pdf'), 'always .pdf');
}

// ── content parsing ──
{
  const lines = parseSheetContent('### [Verse 1]\nHeart beats fast [G]\nColors [Em7] and [C] promises\n\n### [Chorus]');
  assert.equal(lines.filter(l => l.kind === 'section').length, 2, 'two sections');
  assert.equal(lines.filter(l => l.kind === 'spacer').length, 1, 'one blank → spacer');
  const chordLine = lines.find(l => l.text.startsWith('Colors'))!;
  assert.deepEqual(chordLine.chords, ['Em7', 'C'], 'chords extracted in order');
  assert.equal(chordLine.text, 'Colors and promises', 'chord brackets stripped from lyric');
  const first = lines.find(l => l.kind === 'section')!;
  assert.equal(first.text, 'Verse 1', 'section markers/brackets stripped');
}

// ── empty / edge content ──
{
  assert.deepEqual(parseSheetContent(''), [{ kind: 'spacer', text: '', chords: [] }], 'empty content → single spacer');
  const longTab = parseSheetContent('E3/B0-Slap-E3-B3-Slap-E3/B0-Slap-E3/B3-Hammer-B5-Pulloff-B0-Slap-E3');
  assert.equal(longTab[0].kind, 'lyric', 'a tab line is treated as a lyric line');
  assert.ok(longTab[0].text.length > 20, 'long unbroken notation preserved as text');
}

// ── real PDF generation (jsPDF) — multi-page, valid bytes ──
{
  const { renderSheetDoc } = await import('../services/pdfSheet.ts');
  const verse = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a very long song [G] with chords [Em7]`).join('\n');
  const longSong: any = { id: 'x', title: 'Khairiyat', artist: 'Arijit Singh', content: `### [Verse]\n${verse}\n\n### [Chorus]\n${verse}`, createdAt: 1 };
  const doc = renderSheetDoc(longSong, null); // null bg → tint fallback (no image needed in Node)
  const pages = doc.getNumberOfPages();
  assert.ok(pages >= 2, `long song paginates across multiple A4 pages (got ${pages})`);
  const bytes = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
  const header = String.fromCharCode(...bytes.slice(0, 5));
  assert.equal(header, '%PDF-', 'output is a valid PDF (starts with %PDF-)');
  assert.ok(bytes.length > 1000, 'PDF has real content');

  // Short song → exactly one page, still valid.
  const shortDoc = renderSheetDoc({ id: 'y', title: 'Tiny', artist: 'A', content: '### [V]\nHi [C]', createdAt: 1 } as any, null);
  assert.equal(shortDoc.getNumberOfPages(), 1, 'short song is a single page');
}

console.log('pdf-sheet tests passed');
