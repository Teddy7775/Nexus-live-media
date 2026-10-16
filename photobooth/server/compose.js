import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const FONT_STACK = "Arial, Helvetica, 'DejaVu Sans', sans-serif";

export class ComposeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ComposeError';
  }
}

const escapeXml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

export function resolveTokens(text, { event, now }) {
  const date = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return text.replaceAll('{event}', event).replaceAll('{date}', date).replaceAll('{time}', time);
}

/** Shrink (then truncate) text so it stays inside maxWidth. Glyph width is estimated, not measured. */
export function fitText({ text, size, maxWidth }) {
  const GLYPH = 0.56;
  if (!maxWidth) return { text, size };
  let fontSize = size;
  if (text.length * fontSize * GLYPH > maxWidth) fontSize = Math.max(18, Math.floor(maxWidth / (text.length * GLYPH)));
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * GLYPH)));
  const fitted = text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text;
  return { text: fitted, size: fontSize };
}

export function buildTextSvg(template, { event, now }) {
  const items = template.text ?? [];
  if (items.length === 0) return null;
  const { width, height } = template.canvas;
  const nodes = items.map((item) => {
    const resolved = resolveTokens(item.text, { event, now });
    const { text, size } = fitText({ text: resolved, size: item.size, maxWidth: item.maxWidth });
    const attrs = `x="${item.x}" y="${item.y}" font-family="${FONT_STACK}" font-size="${size}" font-weight="${item.weight ?? 400}" text-anchor="${item.anchor ?? 'start'}"`;
    const shadow = item.shadow ? `<text ${attrs.replace(`x="${item.x}" y="${item.y}"`, `x="${item.x + 2}" y="${item.y + 2}"`)} fill="#000000" fill-opacity="0.65">${escapeXml(text)}</text>` : '';
    return `${shadow}<text ${attrs} fill="${item.color ?? '#000000'}">${escapeXml(text)}</text>`;
  });
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${nodes.join('')}</svg>`);
}

async function assertReadable(file, label) {
  try {
    await fs.access(file);
  } catch {
    throw new ComposeError(`${label} is missing (${path.basename(file)})`);
  }
}

/**
 * Builds the final print image and a screen-size preview.
 * `shotFiles[n]` is the photo for shot n (JPEG from the camera).
 */
export async function composeTemplate({ template, shotFiles, event, outFile, previewFile, previewWidth = 1200, templatesDir, now = new Date(), jpegQuality = 95 }) {
  const { width, height, dpi = 300, background = '#ffffff' } = template.canvas;

  for (let n = 0; n < template.shots; n++) {
    if (!shotFiles[n]) throw new ComposeError(`Photo ${n + 1} of ${template.shots} has not been taken yet`);
    await assertReadable(shotFiles[n], `Photo ${n + 1}`);
  }

  const layers = [];
  const slotCache = new Map();
  for (const slot of template.slots) {
    const key = `${slot.shot}:${slot.width}x${slot.height}`;
    if (!slotCache.has(key)) {
      const { data, info } = await sharp(shotFiles[slot.shot], { failOn: 'none' })
        .rotate() // honour the camera's EXIF orientation
        .resize(slot.width, slot.height, { fit: 'cover', position: 'centre' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      slotCache.set(key, { data, info });
    }
    const { data, info } = slotCache.get(key);
    layers.push({ input: data, raw: { width: info.width, height: info.height, channels: info.channels }, left: slot.x, top: slot.y });
  }

  if (template.overlay) {
    if (!templatesDir) throw new ComposeError('Template has an overlay but no templates folder was provided');
    const overlayFile = path.join(templatesDir, template.overlay);
    await assertReadable(overlayFile, `Overlay ${template.overlay}`);
    const meta = await sharp(overlayFile).metadata();
    if (meta.width !== width || meta.height !== height) {
      throw new ComposeError(`Overlay ${template.overlay} is ${meta.width}x${meta.height} but the template canvas is ${width}x${height}`);
    }
    layers.push({ input: overlayFile, left: 0, top: 0 });
  }

  const textSvg = buildTextSvg(template, { event, now });
  if (textSvg) layers.push({ input: textSvg, left: 0, top: 0 });

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background } })
    .composite(layers)
    .jpeg({ quality: jpegQuality, chromaSubsampling: '4:4:4' })
    .withMetadata({ density: dpi })
    .toFile(outFile);

  if (previewFile) await makePreview(outFile, previewFile, previewWidth);
  return { width, height, finalFile: outFile, previewFile: previewFile ?? null };
}

/** Screen-sized JPEG for the kiosk UI (keeps the full-size original untouched). */
export async function makePreview(srcFile, destFile, width = 1600) {
  await fs.mkdir(path.dirname(destFile), { recursive: true });
  await sharp(srcFile, { failOn: 'none' }).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(destFile);
  return destFile;
}

/** Alignment/colour test page: grid, border, corner marks and a label. Same size as the template canvas. */
export async function renderTestPattern({ width, height, dpi = 300, label = 'PRINT TEST' }, outFile) {
  const step = Math.round(dpi / 2); // a line every half inch
  let lines = '';
  for (let x = 0; x <= width; x += step) lines += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#bbbbbb" stroke-width="2"/>`;
  for (let y = 0; y <= height; y += step) lines += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#bbbbbb" stroke-width="2"/>`;
  const swatches = ['#ff0000', '#00aa00', '#0000ff', '#00cccc', '#cc00cc', '#ffcc00', '#000000', '#808080']
    .map((c, i) => `<rect x="${40 + i * Math.floor((width - 80) / 8)}" y="${height - 220}" width="${Math.floor((width - 80) / 8) - 8}" height="160" fill="${c}"/>`)
    .join('');
  const size = Math.round(Math.min(width, height) / 9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#ffffff"/>${lines}
    <rect x="6" y="6" width="${width - 12}" height="${height - 12}" fill="none" stroke="#ff0000" stroke-width="12"/>
    <text x="${width / 2}" y="${height / 2}" font-family="${FONT_STACK}" font-size="${size}" font-weight="700" text-anchor="middle" fill="#111111">${escapeXml(label)}</text>
    <text x="${width / 2}" y="${height / 2 + size * 0.8}" font-family="${FONT_STACK}" font-size="${Math.round(size / 2.4)}" text-anchor="middle" fill="#444444">${width} x ${height} px @ ${dpi} dpi</text>
    ${swatches}</svg>`;
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await sharp(Buffer.from(svg)).jpeg({ quality: 95 }).withMetadata({ density: dpi }).toFile(outFile);
  return outFile;
}
