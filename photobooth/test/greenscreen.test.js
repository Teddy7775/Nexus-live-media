import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { Backgrounds, DEFAULT_KEY, computeMatte, keyBounds, keyComposite, keyToJpeg, matteToRgb, mergeKey, rawRgb, suggestKey, suggestKeyFromJpeg, validateKey } from '../server/greenscreen.js';
import { flat, greenScene, judge, stripes } from './greenFootage.js';

const key = (patch = {}) => ({ ...DEFAULT_KEY, ...patch });
const run = (scene, bg, k = DEFAULT_KEY) => keyComposite({ fg: scene.rgb, bg, width: scene.width, height: scene.height, key: k });

test('a noisy, unevenly lit backdrop is replaced and the person is left untouched', async () => {
  const scene = greenScene({ vignette: 0.35, noise: 5 });
  const bg = stripes(scene.width, scene.height);
  const out = await run(scene, bg);
  const j = judge({ out, scene, bg });
  assert.ok(j.backdropShare >= 0.995, `backdrop replaced: ${j.backdropShare}`);
  assert.equal(j.subjectShare, 1, 'every interior pixel of the person comes out exactly as it went in');
  assert.ok(j.backdropN > 100000 && j.subjectN > 30000, 'the check looked at a meaningful number of pixels');
});

test('a harshly lit backdrop needs higher sensitivity - that is what the knob is for', async () => {
  const scene = greenScene({ vignette: 0.55, noise: 5 });
  const bg = stripes(scene.width, scene.height);
  const at = async (sensitivity) => judge({ out: await run(scene, bg, key({ sensitivity })), scene, bg });
  const low = await at(40);
  const high = await at(90);
  assert.ok(low.backdropShare < 0.9, `at low sensitivity part of the dark backdrop shows through (${low.backdropShare})`);
  assert.ok(high.backdropShare >= 0.995, `at high sensitivity it is gone (${high.backdropShare})`);
  assert.equal(high.subjectShare, 1, 'and the person is still untouched');
});

test('sensitivity is monotonic: a higher setting never makes any pixel MORE opaque', async () => {
  const n = 4000;
  const fg = Buffer.alloc(n * 3);
  let s = 12345;
  for (let i = 0; i < fg.length; i++) fg[i] = (s = (s * 1103515245 + 12345) & 0x7fffffff) % 256;
  let previous = null;
  for (const sensitivity of [1, 20, 40, 60, 80, 100]) {
    const m = await computeMatte({ fg, width: 100, height: 40, key: key({ sensitivity, edgeBlur: 0 }) });
    if (previous) for (let i = 0; i < n; i++) assert.ok(m[i] <= previous[i], `pixel ${i} got more opaque at sensitivity ${sensitivity}`);
    previous = m;
  }
});

test('softness widens the soft edge: more in-between values, never a harder edge', async () => {
  const fg = Buffer.alloc(256 * 3);
  for (let x = 0; x < 256; x++) {
    fg[x * 3] = 20;
    fg[x * 3 + 1] = Math.min(255, x); // greenness ramps from 0 to 235
    fg[x * 3 + 2] = 20;
  }
  const partial = async (softness) => {
    const m = await computeMatte({ fg, width: 256, height: 1, key: key({ softness, edgeBlur: 0 }) });
    return [...m].filter((v) => v > 0 && v < 255).length;
  };
  const narrow = await partial(8);
  const wide = await partial(60);
  assert.ok(wide > narrow * 3, `${wide} in-between values with wide softness vs ${narrow} with narrow`);
});

test('what counts as backdrop: green goes, but skin, black, white, yellow, cyan, blue and red stay', async () => {
  const cases = [
    ['pure green', [0, 255, 0], true],
    ['studio green', [30, 180, 60], true],
    ['dark green', [10, 100, 30], true],
    ['skin', [226, 172, 142], false],
    ['dark skin', [110, 70, 50], false],
    ['black', [0, 0, 0], false],
    ['white', [255, 255, 255], false],
    ['grey', [128, 128, 128], false],
    ['yellow', [255, 255, 0], false],
    ['cyan', [0, 255, 255], false],
    ['blue', [20, 50, 200], false],
    ['red', [220, 20, 20], false],
  ];
  const fg = Buffer.from(cases.flatMap(([, c]) => c));
  const m = await computeMatte({ fg, width: cases.length, height: 1, key: key({ edgeBlur: 0 }) });
  cases.forEach(([name, , removed], i) => assert.equal(m[i], removed ? 0 : 255, `${name}`));
});

test('known limitation, stated plainly: a light-green garment is treated as backdrop', async () => {
  const m = await computeMatte({ fg: Buffer.from([120, 230, 60]), width: 1, height: 1, key: key({ edgeBlur: 0 }) });
  assert.equal(m[0], 0);
});

test('despill removes the green glow from the person; without it the cast stays', async () => {
  const scene = greenScene({ vignette: 0.3, noise: 4, spill: 25 });
  const bg = stripes(scene.width, scene.height);
  const without = judge({ out: await run(scene, bg, key({ despill: 0 })), scene, bg, tolerance: 60 });
  const withIt = judge({ out: await run(scene, bg, key({ despill: 1 })), scene, bg, tolerance: 60 });
  assert.ok(without.greenest >= 8, `without despill a green cast of ${without.greenest} remains on the hair`);
  assert.equal(withIt.greenest, 0, 'with despill no pixel of the person is greener than its red/blue');
});

test('despill leaves true colours alone: a pixel that is not green-tinted is unchanged', async () => {
  const fg = Buffer.from([100, 110, 80]); // greenness 10 -> kept, slightly green -> neutralised to 100
  const bg = Buffer.from([0, 0, 0]);
  const out = await keyComposite({ fg, bg, width: 1, height: 1, key: key({ edgeBlur: 0 }) });
  assert.deepEqual([...out], [100, 100, 80]);
  const skin = await keyComposite({ fg: Buffer.from([226, 172, 142]), bg, width: 1, height: 1, key: key({ edgeBlur: 0 }) });
  assert.deepEqual([...skin], [226, 172, 142]);
});

test('soft edges blend the person and the new background instead of cutting hard', async () => {
  const { low, high } = keyBounds(DEFAULT_KEY);
  const mid = Math.round((low + high) / 2);
  const fg = Buffer.from([100, 100 + mid, 100]); // greenness mid-way between "person" and "backdrop"
  const bg = Buffer.from([0, 0, 0]);
  const out = await keyComposite({ fg, bg, width: 1, height: 1, key: key({ edgeBlur: 0 }) });
  assert.ok(out[0] > 30 && out[0] < 70, `about half of the person's red remains (${out[0]})`);
});

test('the edge is smoothed: a blurred matte has no abrupt 0 -> 255 steps along the outline', async () => {
  const scene = greenScene({ noise: 0, vignette: 0.2 });
  const sharpMatte = await computeMatte({ fg: scene.rgb, width: scene.width, height: scene.height, key: key({ edgeBlur: 0 }) });
  const blurred = await computeMatte({ fg: scene.rgb, width: scene.width, height: scene.height, key: key({ edgeBlur: 1.5 }) });
  const steps = (m) => {
    let n = 0;
    for (let y = 0; y < scene.height; y++) for (let x = 1; x < scene.width; x++) if (Math.abs(m[y * scene.width + x] - m[y * scene.width + x - 1]) > 200) n += 1;
    return n;
  };
  assert.ok(steps(sharpMatte) > 100, 'the unblurred matte has hard steps');
  assert.equal(steps(blurred), 0, 'the blurred one has none');
});

test('the matte is one value per pixel (regression: sharp returned 3 channels and shifted every row)', async () => {
  const scene = greenScene({ width: 120, height: 80, noise: 0 });
  const m = await computeMatte({ fg: scene.rgb, width: 120, height: 80, key: DEFAULT_KEY });
  assert.equal(m.length, 120 * 80);
  const top = m.subarray(0, 120);
  assert.ok(top.every((v) => v === 0), 'the top row is plain backdrop, so fully replaced');
  const centre = m[Math.floor(80 * 0.4) * 120 + 60];
  assert.equal(centre, 255, 'the centre of the head is the person');
});

test('mismatched sizes are refused rather than producing garbage', async () => {
  await assert.rejects(() => keyComposite({ fg: Buffer.alloc(12), bg: Buffer.alloc(9), width: 2, height: 2 }), /same size/);
  await assert.rejects(() => computeMatte({ fg: Buffer.alloc(11), width: 2, height: 2 }), /does not match/);
});

test('settings validation and merging', () => {
  assert.deepEqual(validateKey(DEFAULT_KEY), []);
  assert.equal(validateKey({ ...DEFAULT_KEY, sensitivity: 0 }).length, 1);
  assert.equal(validateKey({ ...DEFAULT_KEY, softness: 101 }).length, 1);
  assert.equal(validateKey({ ...DEFAULT_KEY, despill: 2 }).length, 1);
  assert.equal(validateKey({ ...DEFAULT_KEY, edgeBlur: 'a lot' }).length, 1);
  assert.equal(validateKey({ ...DEFAULT_KEY, sensitivity: NaN }).length, 1);
  assert.equal(validateKey({}).length, 4);

  const merged = mergeKey(DEFAULT_KEY, { sensitivity: 70 });
  assert.equal(merged.key.sensitivity, 70);
  assert.equal(merged.key.softness, DEFAULT_KEY.softness, 'untouched settings keep their value');
  assert.match(mergeKey(DEFAULT_KEY, { sensitivity: 500 }).problems[0], /sensitivity/);
  assert.match(mergeKey(DEFAULT_KEY, { bogus: 1 }).problems[0], /unknown key setting: bogus/);
  assert.match(mergeKey(DEFAULT_KEY, 'x').problems[0], /object/);
  assert.match(mergeKey(DEFAULT_KEY, [1]).problems[0], /object/);
});

test('speed: a live-preview frame and a full print slot are keyed fast enough', async () => {
  const live = greenScene({ width: 640, height: 427, noise: 4 });
  const slot = greenScene({ width: 1800, height: 1200, noise: 2 });
  const time = async (scene) => {
    const bg = flat(scene.width, scene.height, [10, 20, 200]);
    await run(scene, bg); // warm up
    const t0 = performance.now();
    for (let i = 0; i < 3; i++) await run(scene, bg);
    return (performance.now() - t0) / 3;
  };
  const liveMs = await time(live);
  const slotMs = await time(slot);
  // Typical here: ~7 ms and ~50 ms. The limits leave plenty of room for a slow or busy PC while still catching a real regression.
  assert.ok(liveMs < 150, `a 640 px live frame took ${liveMs.toFixed(0)} ms`);
  assert.ok(slotMs < 1500, `a 1800x1200 slot took ${slotMs.toFixed(0)} ms`);
});

// ----------------------------------------------------------------- JPEG in, JPEG out

const jpegOf = (scene, extra) => sharp(scene.rgb, { raw: { width: scene.width, height: scene.height, channels: 3 } }).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).withMetadata(extra ?? {}).toBuffer();
const decode = async (jpeg) => {
  const { data, info } = await sharp(jpeg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, ...info };
};
const rawBg = (buffer) => (w, h) => rawRgb(buffer, w, h);
const solidJpeg = (w, h, colour) => sharp({ create: { width: w, height: h, channels: 3, background: colour } }).jpeg().toBuffer();

test('keyToJpeg: a JPEG goes in, a JPEG of the requested width comes out with the background in place', async () => {
  const scene = greenScene({ width: 900, height: 600, noise: 4, vignette: 0.3 });
  const source = await jpegOf(scene);
  const bgJpeg = await solidJpeg(1000, 700, '#1428c8');
  const out = await keyToJpeg({ source, background: rawBg(bgJpeg), width: 450 });
  const px = await decode(out);
  assert.equal(px.width, 450);
  assert.equal(px.height, 300);
  const at = (x, y) => [...px.data.subarray((y * px.width + x) * 3, (y * px.width + x) * 3 + 3)];
  const corner = at(10, 10);
  assert.ok(Math.abs(corner[0] - 20) < 12 && Math.abs(corner[1] - 40) < 12 && Math.abs(corner[2] - 200) < 12, `backdrop became the blue background: ${corner}`);
  const face = at(225, 130);
  assert.ok(face[0] > 190 && face[1] > 140 && face[2] > 110 && face[0] > face[2], `the face is still skin-coloured: ${face}`);
});

test('keyToJpeg honours the photo\'s rotation (a DSLR stores portraits sideways)', async () => {
  const scene = greenScene({ width: 600, height: 400, noise: 3 });
  const source = await jpegOf(scene, { orientation: 6 }); // "rotate 90 degrees to view"
  const bgJpeg = await solidJpeg(800, 800, '#c81428');
  const out = await keyToJpeg({ source, background: rawBg(bgJpeg), width: 300 });
  const px = await decode(out);
  assert.equal(px.width, 300);
  assert.equal(px.height, 450, 'the sideways 600x400 photo came out upright: 300 wide, 450 tall');
});

test('mirror flips the person but never the background', async () => {
  const scene = greenScene({ width: 600, height: 400, noise: 3, dx: 140, vignette: 0.2 }); // person right of centre
  const source = await jpegOf(scene);
  const bgW = 600;
  const bgPixels = stripes(bgW, 400, [255, 0, 0], [0, 0, 255]);
  const bgJpeg = await sharp(bgPixels, { raw: { width: bgW, height: 400, channels: 3 } }).png().toBuffer();
  const plain = await decode(await keyToJpeg({ source, background: rawBg(bgJpeg), width: 600, quality: 100 }));
  const mirrored = await decode(await keyToJpeg({ source, background: rawBg(bgJpeg), width: 600, mirror: true, quality: 100 }));
  const at = (img, x, y) => [...img.data.subarray((y * img.width + x) * 3, (y * img.width + x) * 3 + 3)];
  const skin = (c) => c[0] > 190 && c[1] > 140 && c[2] > 110 && c[0] > c[2] + 40;
  const faceY = 190;
  assert.ok(skin(at(plain, 300 + 140, faceY)), 'unmirrored: the face is right of centre');
  assert.ok(!skin(at(plain, 300 - 140, faceY)));
  assert.ok(skin(at(mirrored, 300 - 140, faceY)), 'mirrored: the face moved to the left of centre');
  assert.ok(!skin(at(mirrored, 300 + 140, faceY)));
  // Background pixels far from the person are identical either way (the stripes were NOT flipped).
  let same = 0;
  let total = 0;
  for (let y = 5; y < 60; y++) {
    for (let x = 5; x < 60; x++) {
      total += 1;
      const a = at(plain, x, y);
      const b = at(mirrored, x, y);
      if (Math.abs(a[0] - b[0]) < 30 && Math.abs(a[2] - b[2]) < 30) same += 1;
    }
  }
  assert.ok(same / total > 0.98, `top-left background identical with and without mirror (${same}/${total})`);
});

test('view "matte" shows white where the person is and black where the backdrop was; "raw" shows the camera picture', async () => {
  const scene = greenScene({ width: 400, height: 300, noise: 3 });
  const source = await jpegOf(scene);
  const matte = await decode(await keyToJpeg({ source, background: null, width: 400, view: 'matte' }));
  const at = (img, x, y) => img.data[(y * img.width + x) * 3];
  assert.ok(at(matte, 200, 100) > 240, 'face is white');
  assert.ok(at(matte, 10, 10) < 15, 'backdrop is black');
  const raw = await decode(await keyToJpeg({ source, background: null, width: 400, view: 'raw' }));
  assert.ok(raw.data[(10 * raw.width + 10) * 3 + 1] > 60, 'raw still shows the green backdrop');
});

test('matteToRgb makes grey pixels', () => {
  assert.deepEqual([...matteToRgb(Buffer.from([0, 128, 255]))], [0, 0, 0, 128, 128, 128, 255, 255, 255]);
});

// --------------------------------------------------------------------- calibration

test('calibration on an empty, unevenly lit backdrop finds settings that remove all of it', async () => {
  const empty = greenScene({ subject: false, shadow: false, vignette: 0.5, noise: 5 });
  const s = suggestKey(empty.rgb, empty.width, empty.height);
  assert.equal(s.ok, true);
  assert.ok(s.p5 > 40 && s.median > s.p5);
  const k = key({ sensitivity: s.sensitivity, softness: s.softness });
  const withPerson = greenScene({ vignette: 0.5, noise: 5, shadow: false });
  const bg = stripes(withPerson.width, withPerson.height);
  const j = judge({ out: await run(withPerson, bg, k), scene: withPerson, bg });
  assert.ok(j.backdropShare >= 0.995, `after calibrating on the empty backdrop, ${(j.backdropShare * 100).toFixed(1)}% of it is replaced`);
  assert.equal(j.subjectShare, 1);
});

test('calibration adapts to the lighting: a dimmer backdrop gets a MORE sensitive setting', async () => {
  const bright = greenScene({ subject: false, shadow: false, vignette: 0.4 });
  const dim = greenScene({ subject: false, shadow: false, vignette: 0.4, backdrop: [30, 120, 60] });
  const a = suggestKey(bright.rgb, bright.width, bright.height);
  const b = suggestKey(dim.rgb, dim.width, dim.height);
  assert.ok(b.sensitivity > a.sensitivity, `${b.sensitivity} > ${a.sensitivity}`);
  assert.equal(a.warn, false);
  assert.equal(b.warn, true, 'a weakly lit backdrop is flagged');
  assert.match(b.advice, /lit/);
});

test('calibration refuses to guess when a person is in front, or the picture is not green', () => {
  const person = greenScene({ subject: true });
  const p = suggestKey(person.rgb, person.width, person.height);
  assert.equal(p.ok, false);
  assert.match(p.advice, /standing in front|not green/);
  const grey = flat(200, 100, [120, 120, 120]);
  const g = suggestKey(grey, 200, 100);
  assert.equal(g.ok, false);
  assert.match(g.advice, /not green enough/);
  assert.throws(() => suggestKey(Buffer.alloc(5), 10, 10), /does not match/);
});

test('suggestKeyFromJpeg decodes a camera frame first', async () => {
  const empty = greenScene({ subject: false, shadow: false, vignette: 0.4, noise: 3 });
  const s = await suggestKeyFromJpeg(await jpegOf(empty));
  assert.equal(s.ok, true);
});

// --------------------------------------------------------------------- backgrounds

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bg-test-'));
const png = (w, h, colour) => sharp({ create: { width: w, height: h, channels: 3, background: colour } }).png().toBuffer();

test('backgrounds: loads usable pictures, ignores the rest (with a reason), names and ids are tidy', async () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'Beach Day.jpg'), await solidJpeg(1200, 800, '#ffcc66'));
    fs.writeFileSync(path.join(dir, 'beach_day.png'), await png(1200, 800, '#66ccff')); // same id as the first
    fs.writeFileSync(path.join(dir, 'tiny.jpg'), await solidJpeg(200, 150, '#ffffff'));
    fs.writeFileSync(path.join(dir, 'broken.jpg'), 'this is not an image');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
    fs.writeFileSync(path.join(dir, '.hidden.jpg'), await solidJpeg(1200, 800, '#000000'));
    fs.writeFileSync(path.join(dir, 'builtin-night.jpg'), await solidJpeg(1200, 800, '#000000')); // must not shadow a built-in
    const warnings = [];
    const bgs = await new Backgrounds({ dir, logger: { warn: (m) => warnings.push(m) } }).load();
    const list = bgs.list();
    const own = list.filter((b) => !b.builtin).map((b) => b.id).sort();
    const builtins = list.filter((b) => b.builtin).map((b) => b.id).sort();
    assert.deepEqual(own, ['beach-day', 'beach-day-2', 'builtin-night-2'], 'duplicates get -2; a file called builtin-night is renamed, not allowed to shadow the built-in');
    assert.deepEqual(builtins, ['builtin-night', 'builtin-studio', 'builtin-sunset']);
    assert.equal(list.find((b) => b.id === 'beach-day').name, 'Beach Day');
    assert.equal(bgs.get('builtin-night').builtin, true, 'the built-in kept its id');
    assert.equal(bgs.has('tiny'), false);
    assert.equal(bgs.has('broken'), false);
    assert.equal(bgs.has('.hidden'), false);
    assert.ok(warnings.some((w) => /tiny\.jpg ignored.*too small/.test(w)), warnings.join('|'));
    assert.ok(warnings.some((w) => /broken\.jpg ignored/.test(w)));
    assert.equal(warnings.length, 2, 'only the two real problems are reported (text files and dot-files are silently skipped)');
    assert.equal(bgs.firstId(), 'beach-day', 'your own pictures come before the built-in ones');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backgrounds: built-ins alone work, a missing folder is fine, and builtin:false with no pictures is empty', async () => {
  const none = await new Backgrounds({ dir: path.join(os.tmpdir(), 'does-not-exist-bg') }).load();
  assert.deepEqual(none.list().map((b) => b.id), ['builtin-sunset', 'builtin-night', 'builtin-studio']);
  const empty = await new Backgrounds({ dir: path.join(os.tmpdir(), 'does-not-exist-bg'), builtin: false }).load();
  assert.deepEqual(empty.list(), []);
  assert.equal(empty.firstId(), null);
  assert.equal(await empty.buffer('x'), null);
  assert.equal(await empty.thumb('x'), null);
  await assert.rejects(() => empty.raw('x', 10, 10), /Unknown background/);
});

test('backgrounds: thumbnails and sized pixels are the right shape, and large built-ins are high resolution', async () => {
  const bgs = await new Backgrounds({ dir: path.join(os.tmpdir(), 'nope-bg') }).load();
  const thumb = await sharp(await bgs.thumb('builtin-sunset')).metadata();
  assert.deepEqual([thumb.format, thumb.width, thumb.height], ['jpeg', 800, 533]);
  const full = await sharp(await bgs.buffer('builtin-sunset')).metadata();
  assert.deepEqual([full.width, full.height], [3000, 2000], 'big enough for a full 4x6 at 300 dpi without stretching');
  const raw = await bgs.raw('builtin-sunset', 300, 200);
  assert.equal(raw.length, 300 * 200 * 3);
  assert.equal(await bgs.raw('builtin-sunset', 300, 200), raw, 'the second request reuses the same pixels');
  const portrait = await bgs.raw('builtin-night', 200, 300);
  assert.equal(portrait.length, 200 * 300 * 3, 'a portrait slot is cut out of the landscape picture');
});

test('backgrounds: a phone photo\'s rotation and a transparent PNG are handled', async () => {
  const dir = tmp();
  try {
    // 800x600 landscape: left half red, right half blue, flagged "rotate 90 degrees clockwise" -> upright it is red on TOP.
    const halves = Buffer.alloc(800 * 600 * 3);
    for (let y = 0; y < 600; y++) for (let x = 0; x < 800; x++) halves.set(x < 400 ? [255, 0, 0] : [0, 0, 255], (y * 800 + x) * 3);
    fs.writeFileSync(path.join(dir, 'rotated.jpg'), await sharp(halves, { raw: { width: 800, height: 600, channels: 3 } }).jpeg({ quality: 100 }).withMetadata({ orientation: 6 }).toBuffer());
    // A fully transparent PNG must come out WHITE, not black.
    fs.writeFileSync(path.join(dir, 'clear.png'), await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
    const bgs = await new Backgrounds({ dir, builtin: false }).load();
    const rot = await bgs.raw('rotated', 300, 400);
    const at = (img, w, x, y) => [...img.subarray((y * w + x) * 3, (y * w + x) * 3 + 3)];
    assert.ok(at(rot, 300, 150, 20)[0] > 200, `top is red: ${at(rot, 300, 150, 20)}`);
    assert.ok(at(rot, 300, 150, 380)[2] > 200, `bottom is blue: ${at(rot, 300, 150, 380)}`);
    const clear = await bgs.raw('clear', 100, 100);
    assert.deepEqual(at(clear, 100, 50, 50), [255, 255, 255]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backgrounds: the in-memory cache stays within its budget and keeps the most recent', async () => {
  const bgs = await new Backgrounds({ dir: path.join(os.tmpdir(), 'nope-bg'), rawBudgetBytes: 3_000_000 }).load();
  const sizes = [[640, 427], [641, 427], [642, 427], [643, 427], [644, 427], [645, 427], [646, 427], [647, 427]];
  for (const [w, h] of sizes) await bgs.raw('builtin-studio', w, h);
  const { rawEntries, rawBytes } = bgs.stats();
  assert.ok(rawBytes <= 3_000_000 + 700_000, `${rawBytes} bytes held`);
  assert.ok(rawEntries >= 2 && rawEntries < sizes.length, `${rawEntries} entries kept of ${sizes.length}`);
  const latest = await bgs.raw('builtin-studio', 647, 427);
  assert.equal(await bgs.raw('builtin-studio', 647, 427), latest, 'the newest size is still cached');
});
