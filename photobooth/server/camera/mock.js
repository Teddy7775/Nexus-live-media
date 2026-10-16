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

/** No hardware needed: lets you rehearse the whole booth flow, including the error screens. */
export class MockCamera {
  constructor({ captureDelayMs = 400, failEveryNth = 0 } = {}, { logger } = {}) {
    this.name = 'mock';
    this.captureDelayMs = captureDelayMs;
    this.failEveryNth = failEveryNth;
    this.log = logger;
    this.liveViewOn = false;
    this.captureCount = 0;
  }

  async init() {}

  async close() {}

  async status() {
    return { driver: 'mock', connected: true, cameras: ['MOCK-0001'], detail: 'Mock camera (synthetic test photos)' };
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
    const svg = photoSvg({ width: 3000, height: 2000, hue: (this.captureCount * 67) % 360, label: `MOCK PHOTO ${this.captureCount}`, sub: baseName });
    await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(file);
    return { file };
  }
}
