// One-off: rasterise the SVG logo into PNG PWA icons (Chrome installability needs
// PNG 192 + 512). Run: node scripts/gen-icons.mjs
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('public/icon-512.svg');
const BG = { r: 15, g: 10, b: 6, alpha: 1 }; // #0f0a06 (matches theme_color)

const out = async (size, file) => {
  const png = await sharp(svg, { density: 384 }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  writeFileSync(file, png);
  console.log('wrote', file, png.length, 'bytes');
};

// Maskable: solid background + logo inset to the safe zone (~78%) so masks don't clip it.
const maskable = async (size, file) => {
  const inner = Math.round(size * 0.78);
  const logo = await sharp(svg, { density: 384 }).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const png = await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: 'center' }])
    .png().toBuffer();
  writeFileSync(file, png);
  console.log('wrote', file, png.length, 'bytes');
};

await out(192, 'public/icon-192.png');
await out(512, 'public/icon-512.png');
await maskable(512, 'public/icon-512-maskable.png');
await maskable(192, 'public/icon-192-maskable.png');
console.log('done');
