// =============================================================
// Image pipeline for nexuslivemedia.com
//   cd tools && npm install
//   node optimize-images.mjs <folder-with-source-images>
// Reads images.json, writes responsive JPG + WebP variants into
// ../assets/img, plus og.jpg, logo.png, favicon.ico and
// apple-touch-icon.png generated from favicon.svg.
// =============================================================
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(toolsDir, '..');
const rawDir = process.argv[2];
if (!rawDir) { console.error('usage: node optimize-images.mjs <raw-folder>'); process.exit(1); }

const cfg = JSON.parse(readFileSync(join(toolsDir, 'images.json'), 'utf8'));
const imgDir = join(repoRoot, 'assets', 'img');
const kb = (n) => Math.round(n / 1024) + ' KB';

// ---- Responsive variants ----
for (const it of cfg.images) {
  const src = join(rawDir, it.src);
  if (!existsSync(src)) { console.warn('MISSING', src); continue; }
  const outBase = join(imgDir, it.out);
  mkdirSync(dirname(outBase), { recursive: true });
  const meta = await sharp(src).metadata();
  for (const w of it.widths) {
    if (w > meta.width * 1.12) { console.warn(`skip ${it.out}-${w} (source is ${meta.width}px wide)`); continue; }
    const base = sharp(src).resize({ width: w });
    const j = await base.clone().jpeg({ quality: cfg.quality.jpg, mozjpeg: true, progressive: true }).toFile(`${outBase}-${w}.jpg`);
    const p = await base.clone().webp({ quality: cfg.quality.webp, effort: 5 }).toFile(`${outBase}-${w}.webp`);
    console.log(`${it.out}-${w}: jpg ${kb(j.size)} / webp ${kb(p.size)}`);
  }
}

// ---- Icons from favicon.svg ----
const svg = readFileSync(join(imgDir, 'favicon.svg'));
const iconPng = (size) => sharp(svg, { density: 600 }).resize(size, size).png().toBuffer();
writeFileSync(join(imgDir, 'logo.png'), await iconPng(512));
writeFileSync(join(repoRoot, 'apple-touch-icon.png'), await iconPng(180));
writeFileSync(join(repoRoot, 'favicon.ico'), await pngToIco([await iconPng(16), await iconPng(32), await iconPng(48)]));
console.log('icons: logo.png, apple-touch-icon.png, favicon.ico');

// ---- Open Graph image 1200x630 ----
const ogSrc = join(rawDir, cfg.og.src);
if (existsSync(ogSrc)) {
  const mark = await iconPng(104);
  const overlay = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070A16" stop-opacity="0.10"/><stop offset="0.55" stop-color="#070A16" stop-opacity="0.55"/><stop offset="1" stop-color="#070A16" stop-opacity="0.94"/></linearGradient>
      <linearGradient id="a" x1="0" x2="1"><stop offset="0" stop-color="#7C3AED"/><stop offset="1" stop-color="#22D3EE"/></linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#g)"/>
    <text x="196" y="402" font-family="Arial, Helvetica, sans-serif" font-size="62" font-weight="bold" fill="#ffffff">Nexus Live Media</text>
    <rect x="196" y="420" width="140" height="6" rx="3" fill="url(#a)"/>
    <text x="196" y="470" font-family="Arial, Helvetica, sans-serif" font-size="27" fill="#DCE3FF">Live Video Production  •  Hybrid Events  •  LED Walls  •  Photo Booths</text>
    <text x="196" y="512" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#AEB9DE">Washington DC  •  Maryland  •  Virginia      nexuslivemedia.com</text>
  </svg>`);
  await sharp(ogSrc).resize(1200, 630, { fit: 'cover', position: 'attention' })
    .composite([{ input: overlay }, { input: mark, left: 72, top: 348 }])
    .jpeg({ quality: 82, mozjpeg: true }).toFile(join(imgDir, 'og.jpg'));
  console.log('og.jpg written');
}
console.log('done');
