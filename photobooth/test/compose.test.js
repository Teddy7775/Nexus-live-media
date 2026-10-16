import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ComposeError, composeTemplate, fitText, renderTestPattern, resolveTokens } from '../server/compose.js';
import { builtinTemplates } from '../server/templates.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'compose-test-'));
const strip = () => builtinTemplates().find((t) => t.id === 'strip-2x6-x2');

async function solidPhoto(dir, name, color, { width = 1500, height = 1000 } = {}) {
  const file = path.join(dir, name);
  await sharp({ create: { width, height, channels: 3, background: color } }).jpeg({ quality: 95 }).toFile(file);
  return file;
}

async function pixel(file, left, top) {
  const { data } = await sharp(file).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return [...data];
}

const near = (actual, expected, tolerance = 14) => actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);

test('strip: each photo lands in the right slot of BOTH strips, margins stay white', async () => {
  const dir = tmpDir();
  try {
    const colours = [
      ['#ff0000', [255, 0, 0]],
      ['#00ff00', [0, 255, 0]],
      ['#0000ff', [0, 0, 255]],
    ];
    const shots = [];
    for (const [i, [hex]] of colours.entries()) shots.push(await solidPhoto(dir, `s${i}.jpg`, hex));

    const template = strip();
    const out = path.join(dir, 'final.jpg');
    const result = await composeTemplate({ template, shotFiles: shots, event: 'Test', outFile: out, previewFile: path.join(dir, 'p.jpg') });
    assert.equal(result.width, 1200);
    assert.equal(result.height, 1800);
    const meta = await sharp(out).metadata();
    assert.equal(meta.width, 1200);
    assert.equal(meta.height, 1800);
    assert.equal(meta.density, 300, 'print resolution is recorded in the file');

    for (const slot of template.slots) {
      const centre = await pixel(out, slot.x + Math.floor(slot.width / 2), slot.y + Math.floor(slot.height / 2));
      assert.ok(near(centre, colours[slot.shot][1]), `slot for shot ${slot.shot} at x=${slot.x}: got ${centre}`);
    }
    // Outer margin and the gutter between the two strips are untouched background.
    assert.deepEqual(await pixel(out, 5, 5), [255, 255, 255]);
    assert.deepEqual(await pixel(out, 600, 200), [255, 255, 255]);

    const preview = await sharp(path.join(dir, 'p.jpg')).metadata();
    assert.equal(preview.width, 1200);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('strip: the footer text is actually drawn (footer is not blank)', async () => {
  const dir = tmpDir();
  try {
    const shots = [];
    for (let i = 0; i < 3; i++) shots.push(await solidPhoto(dir, `s${i}.jpg`, '#808080'));
    const template = strip();
    const out = path.join(dir, 'final.jpg');
    await composeTemplate({ template, shotFiles: shots, event: 'Sarah & James', outFile: out });
    const footerTop = template.slots[2].y + template.slots[2].height + 20;
    const { data } = await sharp(out).extract({ left: 0, top: footerTop, width: 600, height: 1800 - footerTop }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const dark = [...data].filter((v) => v < 128).length;
    assert.ok(dark > 500, `expected text pixels in the footer, found ${dark}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a portrait-orientation photo (EXIF-rotated) is stood upright before cropping', async () => {
  const dir = tmpDir();
  try {
    // 1000x1500 stored sideways with EXIF orientation 6 (rotate 90 CW) => displays as 1500x1000 landscape.
    const sideways = path.join(dir, 'sideways.jpg');
    await sharp({ create: { width: 1000, height: 1500, channels: 3, background: '#ffffff' } })
      .composite([{ input: { create: { width: 1000, height: 500, channels: 3, background: '#ff0000' } }, top: 0, left: 0 }])
      .jpeg({ quality: 95 })
      .withMetadata({ orientation: 6 })
      .toFile(sideways);
    const template = {
      id: 't', name: 't', shots: 1,
      canvas: { width: 1500, height: 1000, dpi: 300, background: '#000000' },
      slots: [{ shot: 0, x: 0, y: 0, width: 1500, height: 1000 }],
    };
    const out = path.join(dir, 'out.jpg');
    await composeTemplate({ template, shotFiles: [sideways], event: 'x', outFile: out });
    // After applying orientation 6 the red band (top of the stored image) ends up on the RIGHT edge.
    assert.ok(near(await pixel(out, 1450, 500), [255, 0, 0], 30), 'red band should be on the right after auto-orient');
    assert.ok(near(await pixel(out, 50, 500), [255, 255, 255], 30), 'left side should be white');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing photo is a clear ComposeError naming which photo', async () => {
  const dir = tmpDir();
  try {
    const shots = [await solidPhoto(dir, 's0.jpg', '#ff0000'), await solidPhoto(dir, 's1.jpg', '#00ff00')];
    await assert.rejects(
      composeTemplate({ template: strip(), shotFiles: shots, event: 'x', outFile: path.join(dir, 'o.jpg') }),
      (err) => err instanceof ComposeError && /Photo 3 of 3/.test(err.message),
    );
    await assert.rejects(
      composeTemplate({ template: strip(), shotFiles: [shots[0], shots[1], path.join(dir, 'gone.jpg')], event: 'x', outFile: path.join(dir, 'o.jpg') }),
      (err) => err instanceof ComposeError && /Photo 3 is missing/.test(err.message),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an overlay PNG is composited on top, and an overlay of the wrong size is rejected', async () => {
  const dir = tmpDir();
  try {
    const photo = await solidPhoto(dir, 's0.jpg', '#00ff00');
    await sharp({ create: { width: 1800, height: 1200, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } }).png().toFile(path.join(dir, 'opaque.png'));
    await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toFile(path.join(dir, 'wrong.png'));
    const base = { id: 't', name: 't', shots: 1, canvas: { width: 1800, height: 1200, dpi: 300 }, slots: [{ shot: 0, x: 0, y: 0, width: 1800, height: 1200 }] };

    const out = path.join(dir, 'o.jpg');
    await composeTemplate({ template: { ...base, overlay: 'opaque.png' }, shotFiles: [photo], event: 'x', outFile: out, templatesDir: dir });
    assert.ok(near(await pixel(out, 900, 600), [255, 0, 255]), 'overlay covers the photo');

    await assert.rejects(
      composeTemplate({ template: { ...base, overlay: 'wrong.png' }, shotFiles: [photo], event: 'x', outFile: out, templatesDir: dir }),
      (err) => err instanceof ComposeError && /100x100 but the template canvas is 1800x1200/.test(err.message),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fitText shrinks long text, then truncates with an ellipsis, and leaves short text alone', () => {
  assert.deepEqual(fitText({ text: 'Hi', size: 58, maxWidth: 540 }), { text: 'Hi', size: 58 });
  const shrunk = fitText({ text: 'Sarah & James Wedding', size: 58, maxWidth: 540 });
  assert.ok(shrunk.size < 58 && shrunk.size >= 18);
  assert.equal(shrunk.text, 'Sarah & James Wedding');
  const truncated = fitText({ text: 'A very very very very very long event name that cannot possibly fit on a strip', size: 58, maxWidth: 540 });
  assert.equal(truncated.size, 18);
  assert.ok(truncated.text.endsWith('…') && truncated.text.length < 80);
});

test('resolveTokens fills {event}, {date} and {time}', () => {
  const now = new Date('2026-10-16T14:30:00');
  const text = resolveTokens('{event} | {date} | {time}', { event: 'Gala', now });
  assert.match(text, /^Gala \| Oct 16, 2026 \| 0?2:30 PM$/);
});

test('special characters in the event name cannot break the text rendering', async () => {
  const dir = tmpDir();
  try {
    const shots = [];
    for (let i = 0; i < 3; i++) shots.push(await solidPhoto(dir, `s${i}.jpg`, '#808080'));
    const out = path.join(dir, 'o.jpg');
    await composeTemplate({ template: strip(), shotFiles: shots, event: `<b>"Tom & Jerry's"</b> ]]>`, outFile: out });
    assert.equal((await sharp(out).metadata()).width, 1200);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test pattern renders at the requested size', async () => {
  const dir = tmpDir();
  try {
    const out = path.join(dir, 'pattern.jpg');
    await renderTestPattern({ width: 1200, height: 1800, dpi: 300 }, out);
    const meta = await sharp(out).metadata();
    assert.deepEqual([meta.width, meta.height, meta.density], [1200, 1800, 300]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the example layout in the README is valid and really composes (docs cannot rot silently)', async () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const block = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => b.includes('"wedding-strip"'));
  assert.ok(block, 'README should contain the wedding-strip example');
  const template = JSON.parse(block);
  assert.equal(template.overlay, 'wedding-strip.png', 'the example documents an overlay file the user must supply');
  delete template.overlay; // the PNG is the user's own artwork; everything else must work as written

  const { validateTemplate } = await import('../server/templates.js');
  assert.deepEqual(validateTemplate(template), []);

  const dir = tmpDir();
  try {
    const shots = [];
    for (let i = 0; i < template.shots; i++) shots.push(await solidPhoto(dir, `s${i}.jpg`, ['#ff0000', '#00ff00', '#0000ff'][i]));
    const out = path.join(dir, 'o.jpg');
    await composeTemplate({ template, shotFiles: shots, event: 'Example', outFile: out });
    const meta = await sharp(out).metadata();
    assert.deepEqual([meta.width, meta.height], [1200, 1800]);
    for (const slot of template.slots) {
      const centre = await pixel(out, Math.floor(slot.x + slot.width / 2), Math.floor(slot.y + slot.height / 2));
      assert.ok(near(centre, [[255, 0, 0], [0, 255, 0], [0, 0, 255]][slot.shot]), `slot ${slot.shot}: ${centre}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
