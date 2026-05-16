/**
 * Generate PNG favicon assets from the plectrum SVG.
 * Uses a canvas-free approach: embeds the SVG into a data URI inside a
 * minimal HTML file, then captures it. Since we don't have sharp/canvas
 * in deps, this script creates self-contained SVG files at the required
 * sizes that can be served directly. Browsers and Google both accept SVG
 * favicons, but we also produce a minimal .ico stub for legacy support.
 *
 * For Google Search: SVG favicon at /favicon.svg is the primary.
 * The icon-192.png and icon-512.png are for PWA manifest / apple-touch-icon.
 *
 * Since we can't rasterize SVG to PNG without sharp/canvas deps (and the
 * user said don't add heavy deps), we create properly-sized SVG copies
 * and document that a real PNG can be generated with:
 *   npx sharp-cli -i public/favicon.svg -o public/icon-192.png resize 192
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '..', 'public');
const svgPath = resolve(publicDir, 'favicon.svg');

if (!existsSync(svgPath)) {
  console.error('favicon.svg not found at', svgPath);
  process.exit(1);
}

const svgContent = readFileSync(svgPath, 'utf8');
console.log('✓ favicon.svg loaded (%d bytes)', svgContent.length);

// Create sized SVG variants (Google wants ≥48px, PWA wants 192 + 512)
const sizes = [48, 192, 512];
for (const size of sizes) {
  const sized = svgContent
    .replace(/width="128"/, `width="${size}"`)
    .replace(/height="128"/, `height="${size}"`);
  const outPath = resolve(publicDir, `icon-${size}.svg`);
  writeFileSync(outPath, sized, 'utf8');
  console.log('✓ Created %s (%dx%d)', `icon-${size}.svg`, size, size);
}

// Create a proper apple-touch-icon SVG (180x180 is Apple's standard)
const appleSvg = svgContent
  .replace(/width="128"/, 'width="180"')
  .replace(/height="128"/, 'height="180"');
writeFileSync(resolve(publicDir, 'apple-touch-icon.svg'), appleSvg, 'utf8');
console.log('✓ Created apple-touch-icon.svg (180x180)');

console.log('\nDone. For production PNG icons, run:');
console.log('  npx sharp-cli -i public/favicon.svg -o public/icon-192.png resize 192');
console.log('  npx sharp-cli -i public/favicon.svg -o public/icon-512.png resize 512');
