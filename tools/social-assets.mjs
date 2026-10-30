// =============================================================
// Social media assets from the brand kit: avatar, covers, launch
// carousel, square posts, story, YouTube thumbnail.
//   cd tools && npm install && node social-assets.mjs <raw-folder>
// <raw-folder> holds the source photos used by images.json.
// Output: ../social/assets/
// =============================================================
import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const repo = join(toolsDir, '..');
const raw = process.argv[2];
if (!raw) { console.error('usage: node social-assets.mjs <raw-folder>'); process.exit(1); }
const out = join(repo, 'social', 'assets');
mkdirSync(out, { recursive: true });
const img = join(repo, 'assets', 'img');
const tile = join(img, 'favicon-192.png');

const NAVY = '#050B1E', BLUE = '#1D4ED8', LIGHT = '#4DA3FF', GOLD = '#D4B072';
const FONT = 'Arial, Helvetica, sans-serif';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
const grad = (id, stops) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
const photo = (name, w, h) => sharp(join(raw, name)).resize(w, h, { fit: 'cover', position: 'attention' }).toBuffer();
const mark = (size) => sharp(tile).resize(size, size).png().toBuffer();
const save = (p, name) => p.jpeg({ quality: 86, mozjpeg: true }).toFile(join(out, name)).then(() => console.log('ok', name));

// ---------- Avatar 1024 (white, mark centred: survives circular crops) ----------
{
  const m = await sharp(join(img, 'brand', 'logo-mark.png')).resize(640, 640).png().toBuffer();
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#ffffff' } })
    .composite([{ input: m, left: 192, top: 192 }]).png().toFile(join(out, 'avatar-1024.png'));
  console.log('ok avatar-1024.png');
}

// ---------- Generic cover composer ----------
async function cover(name, w, h, src, { safe = null, scale = 1 } = {}) {
  const bg = await photo(src, w, h);
  const s = scale;
  const cx = safe ? safe.x : 0, cy = safe ? safe.y : 0, cw = safe ? safe.w : w, ch = safe ? safe.h : h;
  const markSize = Math.round(ch * 0.62);
  const left = cx + Math.round(ch * 0.19);
  const top = cy + Math.round((ch - markSize) / 2);
  const tx = left + markSize + Math.round(ch * 0.16);
  const base = cy + ch / 2;
  // Fit the text block into the width left of the mark (Arial bold caps ≈ 0.68 em/char, regular ≈ 0.5 em/char)
  const maxW = cx + cw - tx - Math.round(ch * 0.12);
  let f1 = ch * 0.26 * s, f2 = ch * 0.14 * s, f3 = ch * 0.10 * s;
  const k = Math.min(1, maxW / (16 * f1 * 0.68), maxW / (82 * f3 * 0.5));
  f1 = Math.round(f1 * k); f2 = Math.round(f2 * k); f3 = Math.round(f3 * k);
  const overlay = svg(w, h, `
    <defs>${grad('g', [[0, NAVY, 0.55], [1, NAVY, 0.85]])}</defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <text x="${tx}" y="${base - f1 * 0.25}" font-family="${FONT}" font-size="${f1}" font-weight="bold" fill="#ffffff">NEXUS LIVE MEDIA</text>
    <text x="${tx}" y="${base + f2 * 0.95}" font-family="Georgia, serif" font-style="italic" font-size="${f2}" fill="${GOLD}">Your Event. Elevated.</text>
    <text x="${tx}" y="${base + f2 * 0.95 + f3 * 1.7}" font-family="${FONT}" font-size="${f3}" fill="#DCE3FF">LED Walls  •  Live Streaming  •  Photo Booth  •  AV Production  •  Washington DC · MD · VA</text>
    <text x="${w - Math.round(ch * 0.12)}" y="${cy + ch - Math.round(ch * 0.12)}" text-anchor="end" font-family="${FONT}" font-size="${f3}" font-weight="bold" fill="${LIGHT}">nexuslivemedia.com  •  (202) 243-8880</text>`);
  await save(sharp(bg).composite([{ input: overlay }, { input: await mark(markSize), left, top }]), name);
}
await cover('cover-facebook-1640x624.jpg', 1640, 624, 'hero-a.png');
await cover('cover-linkedin-2256x382.jpg', 2256, 382, 'brand-gala.jpg', { scale: 0.9 });
await cover('cover-x-1500x500.jpg', 1500, 500, 'brand-keynote.jpg');
// YouTube: 2560x1440 with the safe area (1546x423) centred — everything important lives there
await cover('cover-youtube-2560x1440.jpg', 2560, 1440, 'hero-a.png', { safe: { x: 507, y: 508, w: 1546, h: 423 } });

// ---------- Portrait / square card composer ----------
async function card(name, w, h, src, { kicker, title, lines = [], footer = true, big = false }) {
  const bg = await photo(src, w, h);
  const pad = Math.round(w * 0.075);
  const fT = Math.round(w * (big ? 0.105 : 0.082)), fK = Math.round(w * 0.034), fL = Math.round(w * 0.042), fF = Math.round(w * 0.036);
  const titleLines = title.split('\n');
  let y = h - pad - (lines.length ? lines.length * fL * 1.5 + fL * 0.6 : 0) - (footer ? fF * 2.6 : 0);
  const titleBlock = titleLines.map((t, i) => `<text x="${pad}" y="${y - (titleLines.length - 1 - i) * fT * 1.12}" font-family="${FONT}" font-size="${fT}" font-weight="bold" fill="#ffffff">${esc(t)}</text>`).join('');
  const kickerY = y - titleLines.length * fT * 1.12 - fK * 0.4;
  const bullets = lines.map((l, i) => `<text x="${pad}" y="${y + fL * 1.3 + i * fL * 1.5}" font-family="${FONT}" font-size="${fL}" fill="#DCE3FF">•  ${esc(l)}</text>`).join('');
  const foot = footer ? `<text x="${pad}" y="${h - pad}" font-family="${FONT}" font-size="${fF}" font-weight="bold" fill="${LIGHT}">nexuslivemedia.com</text><text x="${w - pad}" y="${h - pad}" text-anchor="end" font-family="${FONT}" font-size="${fF}" fill="#AEB9DE">(202) 243-8880</text>` : '';
  const overlay = svg(w, h, `
    <defs>${grad('g', [[0, NAVY, 0.05], [0.45, NAVY, 0.35], [1, NAVY, 0.95]])}</defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <rect x="${pad}" y="${kickerY - fK * 1.15}" width="${Math.round(w * 0.08)}" height="${Math.max(4, Math.round(w * 0.005))}" fill="${GOLD}"/>
    <text x="${pad}" y="${kickerY}" font-family="${FONT}" font-size="${fK}" font-weight="bold" letter-spacing="3" fill="${GOLD}">${esc(kicker.toUpperCase())}</text>
    ${titleBlock}${bullets}${foot}`);
  const m = await mark(Math.round(w * 0.11));
  await save(sharp(bg).composite([{ input: overlay }, { input: m, left: pad, top: pad }]), name);
}

// Instagram carousel 1080x1350
await card('ig-carousel-01-1080x1350.jpg', 1080, 1350, 'hero-a.png', { kicker: 'Washington DC · Maryland · Virginia', title: 'Your Event.\nElevated.', lines: ['Live video & streaming', 'LED walls & pro audio', 'Open-air photo booths'], big: true });
await card('ig-carousel-02-1080x1350.jpg', 1080, 1350, 'brand-switcher.jpg', { kicker: 'Live video & streaming', title: 'Reach every\nscreen.', lines: ['3–4 cameras, live switched', 'YouTube, Zoom, Facebook, private link', 'Bonded cellular, never venue Wi-Fi'] });
await card('ig-carousel-03-1080x1350.jpg', 1080, 1350, 'led-wall.png', { kicker: 'LED walls', title: 'A stage people\nremember.', lines: ['10×6 and 13×8 ft modular walls', 'Install + video tech included', 'From $3,000'] });
await card('ig-carousel-04-1080x1350.jpg', 1080, 1350, 'brand-booth.jpg', { kicker: 'Photo booth', title: 'Prints in\nseconds.', lines: ['Canon DSLR, instant dye-sub prints', 'GIFs, boomerangs, custom overlay', 'From $550'] });
await card('ig-carousel-05-1080x1350.jpg', 1080, 1350, 'brand-gala.jpg', { kicker: 'One crew. One contract.', title: 'Let’s plan\nyour event.', lines: ['$2M liability, free COIs', 'Quote within 1 business day', 'DM us or call (202) 243-8880'] });

// Square launch post, service squares, landscape link post, story
await card('post-square-1080.jpg', 1080, 1080, 'hero-a.png', { kicker: 'Now booking · DC · MD · VA', title: 'Your Event.\nElevated.', lines: ['Live video, LED walls, audio, photo booth'], big: true });
await card('service-led-1080.jpg', 1080, 1080, 'led-wall.png', { kicker: 'LED wall rental', title: 'Big screen.\nBig moment.', lines: ['From $3,000 · install included'] });
await card('service-booth-1080.jpg', 1080, 1080, 'brand-booth-print.png', { kicker: 'Photo booth', title: 'Guests leave\nwith a print.', lines: ['From $550 · 2 active hours'] });
await card('service-live-1080.jpg', 1080, 1080, 'brand-switcher.jpg', { kicker: 'Live streaming', title: 'Family abroad\nwatches live.', lines: ['From $1,850 · private link + replay'] });
await card('service-print-1080.jpg', 1080, 1080, 'brand-heatpress.jpg', { kicker: 'Printing & branding', title: 'Merch printed\non site.', lines: ['Shirts, caps, stoles, banners'] });
await card('post-landscape-1200x628.jpg', 1200, 628, 'brand-keynote.jpg', { kicker: 'Event production · Washington DC', title: 'Your Event. Elevated.', lines: ['Live video · LED walls · audio · photo booth · printing'] });
await card('story-1080x1920.jpg', 1080, 1920, 'brand-gala.jpg', { kicker: 'Now booking 2026–2027', title: 'Your Event.\nElevated.', lines: ['Live video & streaming', 'LED walls & pro audio', 'Open-air photo booths', 'Washington DC · MD · VA'], big: true });

// YouTube thumbnail 1280x720
await card('thumbnail-youtube-1280x720.jpg', 1280, 720, 'hero-a.png', { kicker: 'Nexus Live Media', title: 'Live Event Production\nin Washington DC', lines: [], big: true });

// End card for the YouTube video 1920x1080
{
  const m = await mark(300);
  const overlay = svg(1920, 1080, `
    <rect width="1920" height="1080" fill="${NAVY}"/>
    <text x="960" y="720" text-anchor="middle" font-family="${FONT}" font-size="86" font-weight="bold" fill="#ffffff">NEXUS LIVE MEDIA</text>
    <text x="960" y="800" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="48" fill="${GOLD}">Your Event. Elevated.</text>
    <text x="960" y="890" text-anchor="middle" font-family="${FONT}" font-size="40" fill="${LIGHT}">nexuslivemedia.com  •  (202) 243-8880  •  Washington DC · MD · VA</text>`);
  await sharp({ create: { width: 1920, height: 1080, channels: 3, background: NAVY } })
    .composite([{ input: overlay }, { input: m, left: 810, top: 320 }]).png().toFile(join(out, 'endcard-1920x1080.png'));
  console.log('ok endcard-1920x1080.png');
}
console.log('done');
