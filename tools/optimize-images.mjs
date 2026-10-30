// =============================================================
// Image pipeline for nexuslivemedia.com
//   cd tools && npm install
//   node optimize-images.mjs <folder-with-source-images>
// Reads images.json, writes responsive JPG + WebP variants into
// ../assets/img, plus og.jpg, logo.png, favicon.ico and
// apple-touch-icon.png generated from favicon.svg.
// =============================================================
import sharp from 'sharp';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
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
    const opts = { width: w };
    if (it.aspect) {                       // e.g. "16:9": crop around the most interesting region
      const [aw, ah] = it.aspect.split(':').map(Number);
      Object.assign(opts, { height: Math.round(w * ah / aw), fit: 'cover', position: 'attention' });
    }
    const base = sharp(src).resize(opts);
    const j = await base.clone().jpeg({ quality: cfg.quality.jpg, mozjpeg: true, progressive: true }).toFile(`${outBase}-${w}.jpg`);
    const p = await base.clone().webp({ quality: cfg.quality.webp, effort: 5 }).toFile(`${outBase}-${w}.webp`);
    console.log(`${it.out}-${w}: jpg ${kb(j.size)} / webp ${kb(p.size)}`);
  }
}

// Icons (favicon.ico, apple-touch-icon.png, logo.png, brand/*) come from the official logo;
// they are generated once and committed, not rebuilt here.

// ---- Open Graph image 1200x630 ----
const ogSrc = join(rawDir, cfg.og.src);
const markPath = join(imgDir, 'favicon-192.png');
if (existsSync(ogSrc) && existsSync(markPath)) {
  const mark = await sharp(markPath).resize(120, 120).png().toBuffer();
  const overlay = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050B1E" stop-opacity="0.15"/><stop offset="0.55" stop-color="#050B1E" stop-opacity="0.60"/><stop offset="1" stop-color="#050B1E" stop-opacity="0.95"/></linearGradient>
      <linearGradient id="a" x1="0" x2="1"><stop offset="0" stop-color="#1D4ED8"/><stop offset="1" stop-color="#60A5FA"/></linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#g)"/>
    <text x="212" y="396" font-family="Arial, Helvetica, sans-serif" font-size="60" font-weight="bold" fill="#ffffff">Nexus Live Media</text>
    <text x="212" y="446" font-family="Georgia, 'Times New Roman', serif" font-size="34" font-style="italic" fill="#D4B072">Your Event. Elevated.</text>
    <rect x="212" y="466" width="150" height="6" rx="3" fill="url(#a)"/>
    <text x="212" y="508" font-family="Arial, Helvetica, sans-serif" font-size="25" fill="#DCE3FF">LED Walls  •  Live Streaming  •  Photo Booth  •  AV Production</text>
    <text x="212" y="546" font-family="Arial, Helvetica, sans-serif" font-size="23" fill="#AEB9DE">Washington DC  •  Maryland  •  Virginia      nexuslivemedia.com</text>
  </svg>`);
  await sharp(ogSrc).resize(1200, 630, { fit: 'cover', position: 'attention' })
    .composite([{ input: overlay }, { input: mark, left: 72, top: 356 }])
    .jpeg({ quality: 82, mozjpeg: true }).toFile(join(imgDir, 'og.jpg'));
  console.log('og.jpg written');
}
console.log('done');
