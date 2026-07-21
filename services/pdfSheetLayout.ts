// Pure, dependency-free helpers for the PDF practice sheet (filename + content
// parsing). Kept separate from pdfSheet.ts (which imports the browser-only jsPDF)
// so these can be unit-tested headlessly in Node.

// Reserved filename characters only: backslash / : * ? " < > | (no ranges, so
// letters, spaces and dashes are preserved). Built via RegExp to avoid literal
// escaping pitfalls.
const ILLEGAL_FILENAME = new RegExp('[\\\\/:*?"<>|]', 'g');

/** Song title -> safe download filename, always ending in .pdf. Keeps spaces and
 *  dashes so "Death Bed - Fingerstyle.pdf" stays intact. */
export const sanitizeFilename = (title?: string): string => {
  const base = String(title ?? '')
    .replace(ILLEGAL_FILENAME, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '') // no trailing dots (Windows)
    .slice(0, 120);
  return `${base || 'Plectrum Practice Sheet'}.pdf`;
};

export type SheetLineKind = 'section' | 'lyric' | 'spacer';
export interface SheetLine { kind: SheetLineKind; text: string; chords: string[]; }

/** Parse stored song content into structured lines for PDF layout. */
export const parseSheetContent = (content: string): SheetLine[] =>
  String(content ?? '').split(/\r?\n/).map((raw): SheetLine => {
    const t = raw.trim();
    if (!t) return { kind: 'spacer', text: '', chords: [] };
    if (t.startsWith('###') || t.endsWith(':')) {
      return { kind: 'section', text: t.replace(/###/g, '').replace(/[[\]:]/g, '').trim(), chords: [] };
    }
    const chords = Array.from(t.matchAll(/\[(.*?)\]/g)).map(m => m[1].trim()).filter(Boolean);
    const lyric = t.replace(/\[[^\]]+\]/g, '').replace(/\s{2,}/g, ' ').trim();
    return { kind: 'lyric', text: lyric, chords };
  });
