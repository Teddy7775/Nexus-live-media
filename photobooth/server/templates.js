import fs from 'node:fs';
import path from 'node:path';

/**
 * A template is plain data:
 *   id, name, shots (how many photos to take), canvas {width,height,dpi,background},
 *   slots [{shot,x,y,width,height}], overlay (optional PNG, same size as canvas),
 *   text [{text,x,y,size,weight,color,anchor,maxWidth}]  - {event}, {date}, {time} are replaced.
 *   qr   [{x,y,size}]  - where to print the guest's gallery QR code (only drawn when sharing is on).
 * Built-in templates use exactly the same format as user templates in ./templates/*.json.
 */

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** 4x6 inch portrait sheet holding two identical 2x6 strips side by side (printer cuts them apart). */
function stripTemplate({ qr = false } = {}) {
  const W = 1200;
  const H = 1800;
  const stripW = W / 2;
  const margin = 30;
  const slotW = stripW - margin * 2;
  const slotH = Math.round((slotW * 3) / 4);
  const gap = 24;
  const top = 40;
  const slots = [];
  for (const strip of [0, 1]) {
    for (let shot = 0; shot < 3; shot++) {
      slots.push({ shot, x: strip * stripW + margin, y: top + shot * (slotH + gap), width: slotW, height: slotH });
    }
  }
  const footerTop = top + 3 * slotH + 2 * (gap);
  const text = [];
  const qrs = [];
  for (const strip of [0, 1]) {
    const cx = strip * stripW + stripW / 2;
    if (qr) {
      // Name, date, then a 190 px (0.63 in) QR - big enough to scan from a 2x6 strip.
      text.push({ text: '{event}', x: cx, y: footerTop + 85, size: 54, weight: 700, color: '#111111', anchor: 'middle', maxWidth: slotW });
      text.push({ text: '{date}', x: cx, y: footerTop + 140, size: 32, weight: 400, color: '#555555', anchor: 'middle', maxWidth: slotW });
      qrs.push({ x: cx - 95, y: footerTop + 175, size: 190 });
    } else {
      // Footer area is footerTop..H; these offsets centre the two-line block in it.
      text.push({ text: '{event}', x: cx, y: footerTop + 235, size: 58, weight: 700, color: '#111111', anchor: 'middle', maxWidth: slotW });
      text.push({ text: '{date}', x: cx, y: footerTop + 315, size: 34, weight: 400, color: '#555555', anchor: 'middle', maxWidth: slotW });
    }
  }
  return {
    id: 'strip-2x6-x2',
    name: 'Photo strip x2 (2x6 cut)',
    description: '3 photos. Prints two identical 2x6 strips on one 4x6 sheet - use the printer\'s "2 inch cut" paper size.',
    shots: 3,
    canvas: { width: W, height: H, dpi: 300, background: '#ffffff' },
    slots,
    text,
    ...(qrs.length ? { qr: qrs } : {}),
  };
}

/** One full-bleed 6x4 landscape photo with a thin caption bar. */
function singleTemplate({ qr = false } = {}) {
  const W = 1800;
  const H = 1200;
  return {
    id: 'single-4x6',
    name: 'Single photo (4x6)',
    description: '1 photo, full-bleed on a 4x6 print.',
    shots: 1,
    canvas: { width: W, height: H, dpi: 300, background: '#000000' },
    slots: [{ shot: 0, x: 0, y: 0, width: W, height: H }],
    text: [
      qr
        ? { text: '{event}  -  {date}', x: 50, y: H - 36, size: 44, weight: 600, color: '#ffffff', anchor: 'start', maxWidth: W - 360, shadow: true }
        : { text: '{event}  -  {date}', x: W / 2, y: H - 36, size: 44, weight: 600, color: '#ffffff', anchor: 'middle', maxWidth: W - 120, shadow: true },
    ],
    ...(qr ? { qr: [{ x: W - 240, y: H - 240, size: 200 }] } : {}),
  };
}

/** Two stacked 3:2 photos on a 4x6 portrait sheet with a footer. */
function duoTemplate({ qr = false } = {}) {
  const W = 1200;
  const H = 1800;
  const margin = 50;
  const slotW = W - margin * 2;
  const slotH = Math.round((slotW * 2) / 3);
  const gap = 30;
  const slots = [0, 1].map((shot) => ({ shot, x: margin, y: margin + shot * (slotH + gap), width: slotW, height: slotH }));
  const footerTop = margin + 2 * slotH + gap;
  return {
    id: 'duo-4x6',
    name: 'Two photos (4x6 portrait)',
    description: '2 photos stacked on one 4x6 portrait print.',
    shots: 2,
    canvas: { width: W, height: H, dpi: 300, background: '#ffffff' },
    slots,
    text: qr
      ? [
          { text: '{event}', x: margin, y: footerTop + 105, size: 60, weight: 700, color: '#111111', anchor: 'start', maxWidth: slotW - 230 },
          { text: '{date}', x: margin, y: footerTop + 170, size: 36, weight: 400, color: '#555555', anchor: 'start', maxWidth: slotW - 230 },
        ]
      : [
          { text: '{event}', x: W / 2, y: footerTop + 105, size: 64, weight: 700, color: '#111111', anchor: 'middle', maxWidth: slotW },
          { text: '{date}', x: W / 2, y: footerTop + 170, size: 36, weight: 400, color: '#555555', anchor: 'middle', maxWidth: slotW },
        ],
    ...(qr ? { qr: [{ x: W - margin - 200, y: footerTop + 27, size: 200 }] } : {}),
  };
}

/** With { qr: true } the built-in layouts reserve room for the guest's gallery QR code. */
export function builtinTemplates({ qr = false } = {}) {
  return [stripTemplate({ qr }), singleTemplate({ qr }), duoTemplate({ qr })];
}

const isInt = (v) => Number.isInteger(v);

/** Returns a list of problems (empty when valid). */
export function validateTemplate(t, { templatesDir } = {}) {
  const problems = [];
  const need = (cond, msg) => {
    if (!cond) problems.push(msg);
  };
  if (t === null || typeof t !== 'object') return ['template must be a JSON object'];

  need(typeof t.id === 'string' && ID.test(t.id), 'id must be lowercase letters, digits and dashes (e.g. "wedding-strip")');
  need(typeof t.name === 'string' && t.name.trim().length > 0, 'name is required');
  need(isInt(t.shots) && t.shots >= 1 && t.shots <= 8, 'shots must be an integer from 1 to 8');

  const c = t.canvas ?? {};
  need(isInt(c.width) && c.width >= 300 && c.width <= 8000, 'canvas.width must be an integer from 300 to 8000');
  need(isInt(c.height) && c.height >= 300 && c.height <= 8000, 'canvas.height must be an integer from 300 to 8000');
  need(c.dpi === undefined || (isInt(c.dpi) && c.dpi >= 72 && c.dpi <= 1200), 'canvas.dpi must be an integer from 72 to 1200');
  need(c.background === undefined || /^#[0-9a-fA-F]{6}$/.test(c.background), 'canvas.background must look like #rrggbb');

  const slots = Array.isArray(t.slots) ? t.slots : [];
  need(slots.length > 0, 'slots must be a non-empty list');
  const used = new Set();
  slots.forEach((s, i) => {
    const where = `slots[${i}]`;
    const ok = [s?.x, s?.y, s?.width, s?.height].every(isInt) && s.width > 0 && s.height > 0 && s.x >= 0 && s.y >= 0;
    need(ok, `${where}: x, y, width and height must be integers (width/height > 0)`);
    if (ok && isInt(c.width) && isInt(c.height)) {
      need(s.x + s.width <= c.width && s.y + s.height <= c.height, `${where} extends outside the ${c.width}x${c.height} canvas`);
    }
    need(isInt(s?.shot) && s.shot >= 0 && s.shot < (t.shots ?? 0), `${where}: shot must be an integer from 0 to ${(t.shots ?? 1) - 1}`);
    if (isInt(s?.shot)) used.add(s.shot);
  });
  for (let n = 0; n < (isInt(t.shots) ? t.shots : 0); n++) need(used.has(n), `shot ${n} is never used by any slot`);

  if (t.overlay !== undefined) {
    need(typeof t.overlay === 'string' && /\.png$/i.test(t.overlay) && !/[\\/]/.test(t.overlay), 'overlay must be a PNG file name inside the templates folder (no sub-folders)');
    if (templatesDir && typeof t.overlay === 'string' && !/[\\/]/.test(t.overlay)) {
      need(fs.existsSync(path.join(templatesDir, t.overlay)), `overlay file "${t.overlay}" not found in ${templatesDir}`);
    }
  }

  (t.qr ?? []).forEach((q, i) => {
    const where = `qr[${i}]`;
    const ok = [q?.x, q?.y, q?.size].every(isInt) && q.size >= 80 && q.size <= 1200 && q.x >= 0 && q.y >= 0;
    need(ok, `${where}: x, y and size must be whole numbers (size 80-1200)`);
    if (ok && isInt(c.width) && isInt(c.height)) need(q.x + q.size <= c.width && q.y + q.size <= c.height, `${where} extends outside the ${c.width}x${c.height} canvas`);
  });

  (t.text ?? []).forEach((item, i) => {
    const where = `text[${i}]`;
    need(typeof item?.text === 'string', `${where}.text must be a string`);
    need(Number.isFinite(item?.x) && Number.isFinite(item?.y), `${where}: x and y must be numbers`);
    need(Number.isFinite(item?.size) && item.size > 0, `${where}.size must be a positive number`);
    need(item?.anchor === undefined || ['start', 'middle', 'end'].includes(item.anchor), `${where}.anchor must be start, middle or end`);
  });

  return problems;
}

/** Built-ins first, then every valid *.json in the templates folder (same id = user template wins). */
export function loadTemplates({ templatesDir, qr = false } = {}) {
  const templates = new Map();
  const problems = [];
  for (const t of builtinTemplates({ qr })) {
    const issues = validateTemplate(t);
    if (issues.length) throw new Error(`Built-in template ${t.id} is invalid: ${issues.join('; ')}`);
    templates.set(t.id, t);
  }
  if (templatesDir && fs.existsSync(templatesDir)) {
    for (const file of fs.readdirSync(templatesDir).filter((f) => f.toLowerCase().endsWith('.json')).sort()) {
      try {
        const t = JSON.parse(fs.readFileSync(path.join(templatesDir, file), 'utf8'));
        const issues = validateTemplate(t, { templatesDir });
        if (issues.length) {
          problems.push({ file, issues });
          continue;
        }
        templates.set(t.id, t);
      } catch (err) {
        problems.push({ file, issues: [`cannot read template: ${err.message}`] });
      }
    }
  }
  return { templates, problems };
}

/** Landscape canvases are rotated to portrait so they fill a portrait-fed 4x6 sheet. */
export function printGeometry(template) {
  const { width, height } = template.canvas;
  const dpi = template.canvas.dpi ?? 300;
  const rotate = width > height;
  const [pw, ph] = rotate ? [height, width] : [width, height];
  return { rotate, pageWidthPt: (pw / dpi) * 72, pageHeightPt: (ph / dpi) * 72, dpi };
}
