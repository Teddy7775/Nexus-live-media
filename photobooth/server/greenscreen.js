import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/**
 * Green screen: replace a green backdrop with a picture of the guest's choice.
 *
 * How a pixel is judged: "how much greener than its red/blue is it?"  d = G - max(R, B).
 *   d <= low   -> part of the person: kept        (skin, hair, most clothes have d <= 0)
 *   d >= high  -> backdrop: removed
 *   between    -> a soft edge: partly kept        (this is what makes hair and edges look natural)
 * Then "despill" pulls the leftover green glow off the kept pixels (the backdrop's light bouncing onto hair and shoulders),
 * and a tiny blur on the mask anti-aliases the edge.
 *
 * It works on whatever size it is given, so the same code serves live frames, photo previews and the final layout
 * (always at the size actually shown or printed - never on the full 24-megapixel original).
 */

export const DEFAULT_KEY = Object.freeze({
  sensitivity: 50, // 1-100: higher removes more (use it when the backdrop is unevenly lit or has shadows)
  softness: 30, // 5-100: width of the soft edge, in "greenness" units
  despill: 1, // 0-1: how much green glow to pull off the kept pixels
  edgeBlur: 0.8, // 0-4: edge smoothing in pixels
});

export const KEY_LIMITS = Object.freeze({ sensitivity: [1, 100], softness: [5, 100], despill: [0, 1], edgeBlur: [0, 4] });

export function keyBounds({ sensitivity, softness }) {
  const low = 45 - 0.4 * sensitivity;
  return { low, high: low + softness };
}

/** Problems with a complete key settings object (empty list = fine). */
export function validateKey(key) {
  const problems = [];
  for (const [name, [min, max]] of Object.entries(KEY_LIMITS)) {
    const v = key?.[name];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) problems.push(`${name} must be a number from ${min} to ${max}`);
  }
  return problems;
}

/** Applies a partial change to complete key settings, returning the problems instead of a result when it is not valid. */
export function mergeKey(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return { problems: ['key must be an object'] };
  const unknown = Object.keys(patch).filter((k) => !(k in KEY_LIMITS));
  if (unknown.length) return { problems: [`unknown key setting: ${unknown.join(', ')}`] };
  const key = { ...base, ...patch };
  const problems = validateKey(key);
  return problems.length ? { problems } : { key };
}

// ---------------------------------------------------------------------------- the keyer

/** Greenness -> opacity of the person (0-255 per pixel), softened at the edges. */
export async function computeMatte({ fg, width, height, key = DEFAULT_KEY }) {
  const n = width * height;
  if (fg.length !== n * 3) throw new Error('image data does not match its size');
  const { low, high } = keyBounds(key);
  const range = high - low;
  const alpha = Buffer.allocUnsafe(n);
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const r = fg[p];
    const b = fg[p + 2];
    const d = fg[p + 1] - (r > b ? r : b);
    alpha[i] = d <= low ? 255 : d >= high ? 0 : ((high - d) / range) * 255 + 0.5;
  }
  if (key.edgeBlur < 0.3) return alpha;
  // toColourspace('b-w') keeps it ONE channel: without it sharp hands back three, and every pixel after the first row is misread.
  const smooth = await sharp(alpha, { raw: { width, height, channels: 1 } }).blur(key.edgeBlur).toColourspace('b-w').raw().toBuffer();
  if (smooth.length !== n) throw new Error(`matte has ${smooth.length} bytes, expected ${n}`);
  return smooth;
}

/**
 * Puts the person from `fg` onto `bg`. Both are raw RGB (3 bytes per pixel) of the SAME width x height; so is the result.
 * `mask` (from computeMatte) can be passed when it was already worked out.
 */
export async function keyComposite({ fg, bg, width, height, key = DEFAULT_KEY, mask = null }) {
  const n = width * height;
  if (bg.length !== n * 3) throw new Error('foreground and background must be the same size');
  const matte = mask ?? (await computeMatte({ fg, width, height, key }));
  const despill = key.despill;
  const out = Buffer.allocUnsafe(n * 3);
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const a = matte[i];
    if (a === 0) {
      out[p] = bg[p];
      out[p + 1] = bg[p + 1];
      out[p + 2] = bg[p + 2];
      continue;
    }
    const r = fg[p];
    const g = fg[p + 1];
    const b = fg[p + 2];
    const d = g - (r > b ? r : b);
    const gClean = d > 0 && despill > 0 ? g - despill * d : g;
    if (a === 255) {
      out[p] = r;
      out[p + 1] = gClean;
      out[p + 2] = b;
    } else {
      const k = a / 255;
      const j = 1 - k;
      out[p] = r * k + bg[p] * j;
      out[p + 1] = gClean * k + bg[p + 1] * j;
      out[p + 2] = b * k + bg[p + 2] * j;
    }
  }
  return out;
}

/** The matte as a grey picture (white = kept, black = replaced) - what the operator looks at while tuning. */
export function matteToRgb(mask) {
  const out = Buffer.allocUnsafe(mask.length * 3);
  for (let i = 0, p = 0; i < mask.length; i++, p += 3) out[p] = out[p + 1] = out[p + 2] = mask[i];
  return out;
}

/** Decodes an image (bytes or a file path) to raw RGB at exactly width x height: upright, cover-cropped, flattened onto white. */
export async function rawRgb(source, width, height, { mirror = false } = {}) {
  let img = sharp(source, { failOn: 'none' }).rotate();
  if (mirror) img = img.flop();
  return img.resize(width, height, { fit: 'cover', position: 'centre' }).flatten({ background: '#ffffff' }).toColourspace('srgb').removeAlpha().raw().toBuffer();
}

/**
 * Keys a photo (JPEG bytes or a file path) at `width` px wide and returns a JPEG.
 * `background(width, height)` must resolve to raw RGB of that size (see Backgrounds.raw).
 * view: 'composite' (the result) | 'matte' (what is kept) | 'raw' (the camera picture as it is).
 * mirror flips only the camera picture, so a background with writing on it is never mirrored.
 */
export async function keyToJpeg({ source, background, width, key = DEFAULT_KEY, mirror = false, view = 'composite', quality = 85 }) {
  let img = sharp(source, { failOn: 'none' }).rotate();
  if (mirror) img = img.flop();
  const { data, info } = await img.resize({ width, withoutEnlargement: true }).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let out;
  if (view === 'raw') out = data;
  else if (view === 'matte') out = matteToRgb(await computeMatte({ fg: data, width: w, height: h, key }));
  else out = await keyComposite({ fg: data, bg: await background(w, h), width: w, height: h, key });
  return sharp(out, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality }).toBuffer();
}

// ------------------------------------------------------------------- calibration

/**
 * Looks at a picture of the EMPTY backdrop and suggests settings that remove all of it while keeping as much of a person
 * as possible. Returns { ok, sensitivity, softness, p5, median, advice }.
 */
export function suggestKey(rgb, width, height) {
  const n = width * height;
  if (rgb.length !== n * 3) throw new Error('image data does not match its size');
  const hist = new Uint32Array(511); // greenness d from -255 to +255
  let count = 0;
  for (let i = 0, p = 0; i < n; i += 3, p += 9) {
    // every third pixel is plenty
    const r = rgb[p];
    const b = rgb[p + 2];
    hist[rgb[p + 1] - (r > b ? r : b) + 255] += 1;
    count += 1;
  }
  const percentile = (q) => {
    const target = count * q;
    let seen = 0;
    for (let v = 0; v < hist.length; v++) {
      seen += hist[v];
      if (seen >= target) return v - 255;
    }
    return 255;
  };
  const p5 = percentile(0.05);
  const median = percentile(0.5);

  if (median < 25) {
    return { ok: false, p5, median, sensitivity: DEFAULT_KEY.sensitivity, softness: DEFAULT_KEY.softness, advice: 'The picture is not green enough. Check that the camera is pointing at the backdrop and that it is lit, then try again.' };
  }
  if (p5 < 10) {
    return { ok: false, p5, median, sensitivity: DEFAULT_KEY.sensitivity, softness: DEFAULT_KEY.softness, advice: 'Part of the picture is not green. Is someone standing in front of the backdrop? Step aside and try again (an empty, evenly lit backdrop gives the best settings).' };
  }
  // Fully remove all but the darkest 5% of the backdrop (shadows, folds), with a margin for camera noise.
  const high = Math.min(100, Math.max(15, p5 - 6));
  let low = Math.max(5, high - DEFAULT_KEY.softness);
  const sensitivity = Math.min(100, Math.max(1, Math.round((45 - low) / 0.4)));
  low = 45 - 0.4 * sensitivity;
  const softness = Math.min(100, Math.max(5, Math.round(high - low)));
  const weak = p5 < 45;
  const advice = weak
    ? 'The backdrop is unevenly or weakly lit (dark corners or shadows), so edges may look rough. More light on the backdrop - not on the guest - helps more than any setting.'
    : 'Looks good. These settings remove the whole backdrop.';
  return { ok: true, p5, median, sensitivity, softness, advice, warn: weak };
}

export async function suggestKeyFromJpeg(source) {
  const { data, info } = await sharp(source, { failOn: 'none' }).rotate().resize({ width: 640, withoutEnlargement: true }).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return suggestKey(data, info.width, info.height);
}

// ---------------------------------------------------------------- backgrounds

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png']);
const MAX_BYTES = 25 * 1024 * 1024;
const RAW_BUDGET = 96 * 1024 * 1024; // resized backgrounds kept in memory
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'background';
const titleCase = (s) => s.replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Simple built-in backdrops so the feature can be tried before you have your own pictures. */
const BUILTIN = {
  'builtin-sunset': {
    name: 'Sunset',
    svg: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1055"/><stop offset="0.45" stop-color="#d1495b"/><stop offset="0.75" stop-color="#f9a03f"/><stop offset="1" stop-color="#ffd166"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.5}" cy="${h * 0.7}" r="${h * 0.16}" fill="#fff3c4" opacity="0.92"/><path d="M0 ${h * 0.82} Q ${w * 0.25} ${h * 0.74} ${w * 0.5} ${h * 0.82} T ${w} ${h * 0.8} V ${h} H0Z" fill="#1d1033"/></svg>`,
  },
  'builtin-night': {
    name: 'Night sky',
    svg: (w, h) => {
      let stars = '';
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 160; i++) stars += `<circle cx="${rnd() * w}" cy="${rnd() * h * 0.85}" r="${(0.8 + rnd() * 2.4) * (w / 1800)}" fill="#fff" opacity="${0.4 + rnd() * 0.6}"/>`;
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050a24"/><stop offset="1" stop-color="#27346b"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${stars}<circle cx="${w * 0.78}" cy="${h * 0.22}" r="${h * 0.08}" fill="#f4f1d0"/></svg>`;
    },
  },
  'builtin-studio': {
    name: 'Studio grey',
    svg: (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><radialGradient id="g" cx="0.5" cy="0.45" r="0.75"><stop offset="0" stop-color="#d9dde3"/><stop offset="1" stop-color="#6b7280"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  },
};

/** The pictures guests can choose from: every .jpg/.png in the backgrounds folder, plus the built-in ones. */
export class Backgrounds {
  #items = new Map(); // id -> { id, name, file?, builtin }
  #buffers = new Map();
  #thumbs = new Map();
  #raw = new Map(); // "id:WxH" -> raw RGB, oldest first
  #rawBytes = 0;

  constructor({ dir, builtin = true, logger, rawBudgetBytes = RAW_BUDGET }) {
    this.dir = dir;
    this.builtin = builtin;
    this.log = logger;
    this.rawBudgetBytes = rawBudgetBytes;
  }

  stats() {
    return { rawEntries: this.#raw.size, rawBytes: this.#rawBytes };
  }

  async load() {
    this.#items.clear();
    this.#buffers.clear();
    this.#thumbs.clear();
    this.#raw.clear();
    this.#rawBytes = 0;
    let names = [];
    try {
      names = (await fs.readdir(this.dir)).sort();
    } catch {
      /* no folder yet: built-ins only */
    }
    for (const name of names) {
      const ext = path.extname(name).toLowerCase();
      if (!IMAGE_EXT.has(ext) || name.startsWith('.')) continue;
      const file = path.join(this.dir, name);
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile()) throw new Error('not a file');
        if (stat.size > MAX_BYTES) throw new Error('file is larger than 25 MB');
        const meta = await sharp(file).metadata();
        if (!meta.width || meta.width < 400) throw new Error('image is too small (under 400 px wide)');
        const base = slug(path.basename(name, ext));
        let id = base;
        for (let k = 2; this.#items.has(id) || Object.hasOwn(BUILTIN, id); k++) id = `${base}-${k}`; // never shadow a built-in id
        this.#items.set(id, { id, name: titleCase(path.basename(name, ext)), file, builtin: false });
      } catch (err) {
        this.log?.warn?.(`background ${name} ignored: ${err.message}`);
      }
    }
    if (this.builtin) for (const [id, def] of Object.entries(BUILTIN)) this.#items.set(id, { id, name: def.name, builtin: true });
    return this;
  }

  list() {
    return [...this.#items.values()].map(({ id, name, builtin }) => ({ id, name, builtin }));
  }

  get(id) {
    const item = this.#items.get(id);
    return item ? { id: item.id, name: item.name, builtin: item.builtin } : null;
  }

  has(id) {
    return this.#items.has(id);
  }

  firstId() {
    return this.#items.keys().next().value ?? null;
  }

  /** Full-size background bytes (built-ins are drawn on first use, then kept). */
  async buffer(id) {
    const item = this.#items.get(id);
    if (!item) return null;
    if (this.#buffers.has(id)) return this.#buffers.get(id);
    const buffer = item.builtin ? await sharp(Buffer.from(BUILTIN[id].svg(3000, 2000))).jpeg({ quality: 90 }).toBuffer() : await fs.readFile(item.file);
    this.#buffers.set(id, buffer);
    return buffer;
  }

  /** Raw RGB of the background at exactly width x height (cover-cropped). Recently used sizes are kept in memory. */
  async raw(id, width, height) {
    const k = `${id}:${width}x${height}`;
    const hit = this.#raw.get(k);
    if (hit) {
      this.#raw.delete(k); // mark as recently used
      this.#raw.set(k, hit);
      return hit;
    }
    const source = await this.buffer(id);
    if (!source) throw new Error(`Unknown background "${id}"`);
    const data = await rawRgb(source, width, height);
    this.#raw.set(k, data);
    this.#rawBytes += data.length;
    for (const [oldKey, oldData] of this.#raw) {
      if (this.#rawBytes <= this.rawBudgetBytes || this.#raw.size <= 1) break;
      this.#raw.delete(oldKey);
      this.#rawBytes -= oldData.length;
    }
    return data;
  }

  async thumb(id, width = 800) {
    if (this.#thumbs.has(id)) return this.#thumbs.get(id);
    const source = await this.buffer(id);
    if (!source) return null;
    const jpeg = await sharp(source, { failOn: 'none' }).rotate().resize({ width, height: Math.round((width * 2) / 3), fit: 'cover' }).flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer();
    this.#thumbs.set(id, jpeg);
    return jpeg;
  }

  /** Draws the built-ins and the thumbnails now, so the first guest does not wait for it. */
  async warm() {
    for (const { id } of this.list()) await this.thumb(id);
  }
}
