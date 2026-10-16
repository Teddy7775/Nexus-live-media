import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { CameraError } from './errors.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Synthetic "portrait": coloured gradient, a head-and-shoulders silhouette and a label. */
function photoSvg({ width, height, hue, label, sub }) {
  const cx = width / 2;
  const headR = height * 0.17;
  const headY = height * 0.42;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,30%)"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <ellipse cx="${cx}" cy="${height * 0.98}" rx="${width * 0.26}" ry="${height * 0.34}" fill="#101418" fill-opacity="0.85"/>
    <circle cx="${cx}" cy="${headY}" r="${headR}" fill="#101418" fill-opacity="0.85"/>
    <text x="${cx}" y="${height * 0.1}" font-family="Arial, Helvetica, 'DejaVu Sans', sans-serif" font-size="${height * 0.07}" font-weight="700" text-anchor="middle" fill="#ffffff">${label}</text>
    <text x="${cx}" y="${height * 0.165}" font-family="Arial, Helvetica, 'DejaVu Sans', sans-serif" font-size="${height * 0.04}" text-anchor="middle" fill="#ffffff" fill-opacity="0.85">${sub}</text>
  </svg>`;
}

const SHIRTS = ['#2f5fb3', '#b33a3a', '#7a3fb3', '#d9822b', '#2b8f9e', '#c24d8f']; // none of them green

/** The unevenly lit green backdrop (bright centre, dark corners, a soft shadow behind the person). Cached: it never changes. */
const backdropCache = new Map();
async function greenBackdrop(width, height) {
  const k = `${width}x${height}`;
  if (!backdropCache.has(k)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <radialGradient id="bg" cx="0.5" cy="0.42" r="0.78"><stop offset="0" stop-color="#3fd35c"/><stop offset="0.6" stop-color="#25a847"/><stop offset="1" stop-color="#15782f"/></radialGradient>
        <radialGradient id="sh" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#0b4a1c" stop-opacity="0.5"/><stop offset="1" stop-color="#0b4a1c" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <ellipse cx="${width * 0.56}" cy="${height * 0.9}" rx="${width * 0.36}" ry="${height * 0.42}" fill="url(#sh)"/>
    </svg>`;
    backdropCache.set(k, await sharp(Buffer.from(svg)).png().toBuffer());
  }
  return backdropCache.get(k);
}

/** The person alone (transparent around them): skin, dark hair with a few loose strands, a coloured top. */
function personSvg({ width, height, dx = 0, shirt }) {
  const cx = width / 2 + dx;
  const R = height * 0.16; // head size
  const headY = height * 0.4;
  const strands = [-0.55, -0.3, -0.05, 0.2, 0.45]
    .map((k, i) => `<path d="M ${cx + k * R} ${headY - R * 1.05} q ${(i % 2 ? 1 : -1) * R * 0.25} ${-R * 0.35} ${(i % 2 ? 1 : -1) * R * 0.5} ${-R * 0.18}" stroke="#3a2616" stroke-width="${Math.max(1.5, height * 0.0025)}" fill="none" stroke-linecap="round"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="${cx - R * 0.35}" y="${headY + R * 0.7}" width="${R * 0.7}" height="${R * 1.5}" fill="#c98f6c"/>
    <ellipse cx="${cx}" cy="${height * 1.0}" rx="${width * 0.27}" ry="${height * 0.3}" fill="${shirt}"/>
    <ellipse cx="${cx}" cy="${headY - R * 0.1}" rx="${R * 0.92}" ry="${R * 1.12}" fill="#3a2616"/>
    <ellipse cx="${cx}" cy="${headY + R * 0.08}" rx="${R * 0.78}" ry="${R * 0.95}" fill="#e3ad8b"/>
    <path d="M ${cx - R * 0.8} ${headY - R * 0.1} Q ${cx} ${headY - R * 1.3} ${cx + R * 0.8} ${headY - R * 0.1} Q ${cx} ${headY - R * 0.55} ${cx - R * 0.8} ${headY - R * 0.1} Z" fill="#3a2616"/>
    <circle cx="${cx - R * 0.3}" cy="${headY + R * 0.05}" r="${R * 0.07}" fill="#2a1a12"/>
    <circle cx="${cx + R * 0.3}" cy="${headY + R * 0.05}" r="${R * 0.07}" fill="#2a1a12"/>
    <path d="M ${cx - R * 0.32} ${headY + R * 0.42} Q ${cx} ${headY + R * 0.72} ${cx + R * 0.32} ${headY + R * 0.42}" stroke="#8a3b2e" stroke-width="${R * 0.06}" fill="none" stroke-linecap="round"/>
    ${strands}
  </svg>`;
}

/** Camera noise, so the keyer is rehearsed on something realistic (small, a few levels). */
function addNoise(raw, amount, seed = 1) {
  let s = seed >>> 0 || 1;
  for (let i = 0; i < raw.length; i++) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    const v = raw[i] + ((s & 0xff) / 255 - 0.5) * 2 * amount;
    raw[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return raw;
}

async function greenScreenJpeg({ width, height, dx, shirt, noise, quality, seed }) {
  // A slightly soft edge, like a real lens: blur the person layer a touch before laying it on the backdrop.
  const person = await sharp(Buffer.from(personSvg({ width, height, dx, shirt }))).blur(Math.max(0.6, height * 0.0011)).png().toBuffer();
  const { data, info } = await sharp(await greenBackdrop(width, height)).composite([{ input: person }]).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  addNoise(data, noise, seed);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).jpeg({ quality }).toBuffer();
}

/** No hardware needed: lets you rehearse the whole booth flow, including the error screens. */
export class MockCamera {
  constructor({ captureDelayMs = 400, failEveryNth = 0, scene = 'portrait' } = {}, { logger } = {}) {
    this.name = 'mock';
    this.scene = scene;
    this.captureDelayMs = captureDelayMs;
    this.failEveryNth = failEveryNth;
    this.log = logger;
    this.liveViewOn = false;
    this.captureCount = 0;
  }

  async init() {}

  async close() {}

  async status() {
    return { driver: 'mock', connected: true, cameras: ['MOCK-0001'], detail: `Mock camera (synthetic test photos${this.scene === 'greenscreen' ? ', green backdrop' : ''})` };
  }

  async startLiveView() {
    this.liveViewOn = true;
  }

  async stopLiveView() {
    this.liveViewOn = false;
  }

  /** A moving dot so you can see the preview is "live". */
  async liveFrame() {
    if (!this.liveViewOn) return null;
    const t = Date.now() / 1000;
    const width = 960;
    const height = 640;
    if (this.scene === 'greenscreen') {
      // The person sways a little so you can see the live keyed preview following them.
      return greenScreenJpeg({ width, height, dx: Math.sin(t * 1.6) * width * 0.06, shirt: SHIRTS[Math.floor(t / 4) % SHIRTS.length], noise: 5, quality: 80, seed: Math.floor(t * 30) + 1 });
    }
    const x = width / 2 + Math.sin(t * 2) * width * 0.3;
    const svg = photoSvg({ width, height, hue: (t * 20) % 360, label: 'LIVE PREVIEW', sub: new Date().toLocaleTimeString() }).replace('</svg>', `<circle cx="${x}" cy="${height * 0.78}" r="22" fill="#ffffff"/></svg>`);
    return sharp(Buffer.from(svg)).jpeg({ quality: 70 }).toBuffer();
  }

  async capture({ dir, baseName }) {
    this.captureCount += 1;
    await sleep(this.captureDelayMs);
    if (this.failEveryNth > 0 && this.captureCount % this.failEveryNth === 0) {
      throw new CameraError('capture_failed', 'Mock camera: simulated capture failure');
    }
    const file = path.join(dir, `${baseName}.jpg`);
    await fs.mkdir(dir, { recursive: true });
    if (this.scene === 'greenscreen') {
      // A different shirt colour and pose each time, so you can tell the photos apart.
      const jpeg = await greenScreenJpeg({ width: 3000, height: 2000, dx: ((this.captureCount % 5) - 2) * 90, shirt: SHIRTS[(this.captureCount - 1) % SHIRTS.length], noise: 3, quality: 92, seed: this.captureCount + 100 });
      await fs.writeFile(file, jpeg);
      return { file };
    }
    const svg = photoSvg({ width: 3000, height: 2000, hue: (this.captureCount * 67) % 360, label: `MOCK PHOTO ${this.captureCount}`, sub: baseName });
    await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(file);
    return { file };
  }
}
