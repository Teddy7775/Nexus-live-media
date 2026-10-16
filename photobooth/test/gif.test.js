import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { GifError, encodeGif, grabFrames } from '../server/gif.js';

const jpeg = (color, { width = 320, height = 240 } = {}) => sharp({ create: { width, height, channels: 3, background: color } }).jpeg({ quality: 95 }).toBuffer();
const near = (actual, expected, tolerance = 14) => actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);

/** The colour at the centre of one frame of a GIF, read back with sharp (an independent decoder). */
async function frameColour(gif, page) {
  const meta = await sharp(gif, { page }).metadata();
  const { data } = await sharp(gif, { page }).extract({ left: Math.floor(meta.width / 2), top: Math.floor(meta.height / 2), width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return [...data];
}

const RED = [255, 0, 0];
const GREEN = [0, 200, 0];
const BLUE = [0, 0, 255];
const YELLOW = [255, 220, 0];

test('a GIF has the right frames, size, timing and looping (decoded back with an independent reader)', async () => {
  const frames = await Promise.all(['#ff0000', '#00c800', '#0000ff'].map((c) => jpeg(c)));
  const gif = await encodeGif({ frames, width: 640, delayMs: 200, boomerang: false, loop: true });
  assert.equal(gif.subarray(0, 6).toString(), 'GIF89a');
  const meta = await sharp(gif, { animated: true }).metadata();
  assert.equal(meta.pages, 3);
  assert.equal(meta.width, 320, 'never enlarged beyond the source size');
  assert.equal(meta.pageHeight, 240);
  assert.deepEqual(meta.delay, [200, 200, 200]);
  assert.equal(meta.loop, 0, 'loops forever');
  assert.ok(near(await frameColour(gif, 0), RED));
  assert.ok(near(await frameColour(gif, 1), GREEN));
  assert.ok(near(await frameColour(gif, 2), BLUE));
});

test('boomerang plays forwards then backwards without repeating the end frames', async () => {
  const frames = await Promise.all(['#ff0000', '#00c800', '#0000ff', '#ffdc00'].map((c) => jpeg(c)));
  const gif = await encodeGif({ frames, boomerang: true });
  const meta = await sharp(gif, { animated: true }).metadata();
  assert.equal(meta.pages, 6, '4 frames forwards + the 2 middle frames backwards');
  const colours = [];
  for (let p = 0; p < meta.pages; p++) colours.push(await frameColour(gif, p));
  const expected = [RED, GREEN, BLUE, YELLOW, BLUE, GREEN];
  expected.forEach((e, i) => assert.ok(near(colours[i], e), `frame ${i}: ${colours[i]} vs ${e}`));
});

test('a boomerang of two frames is just those two frames (nothing to reverse)', async () => {
  const gif = await encodeGif({ frames: [await jpeg('#ff0000'), await jpeg('#0000ff')], boomerang: true });
  assert.equal((await sharp(gif, { animated: true }).metadata()).pages, 2);
});

test('large live-view frames are scaled down to the configured width, keeping the aspect ratio', async () => {
  const frames = [await jpeg('#336699', { width: 1280, height: 720 }), await jpeg('#996633', { width: 1280, height: 720 }), await jpeg('#339966', { width: 1280, height: 720 })];
  const gif = await encodeGif({ frames, width: 640, boomerang: false });
  const meta = await sharp(gif, { animated: true }).metadata();
  assert.deepEqual([meta.width, meta.pageHeight], [640, 360]);
});

test('colours stay faithful across a smooth gradient (one shared palette, no banding disaster)', async () => {
  const gradient = (shift) => {
    const w = 200;
    const h = 100;
    const data = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; data[i] = (x * 255) / w; data[i + 1] = ((y * 255) / h + shift) % 255; data[i + 2] = 128; }
    return sharp(data, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  };
  const frames = await Promise.all([0, 40, 80].map(gradient));
  const gif = await encodeGif({ frames, boomerang: false, width: 200 });
  for (const [page, src] of frames.entries()) {
    const a = await sharp(gif, { page }).removeAlpha().raw().toBuffer();
    const b = await sharp(src).removeAlpha().raw().toBuffer();
    let total = 0;
    for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
    assert.ok(total / a.length < 14, `frame ${page} average colour error ${(total / a.length).toFixed(1)}`);
  }
});

test('"play once" GIFs do not loop; no frames is a clear error', async () => {
  const frames = [await jpeg('#ff0000'), await jpeg('#00c800'), await jpeg('#0000ff')];
  const once = await encodeGif({ frames, boomerang: false, loop: false });
  assert.notEqual((await sharp(once, { animated: true }).metadata()).loop, 0);
  await assert.rejects(encodeGif({ frames: [] }), (e) => e instanceof GifError && e.code === 'no_frames');
});

// ---------------------------------------------------------------- grabFrames

const A = Buffer.from('frame-A');
const B = Buffer.from('frame-B');
const C = Buffer.from('frame-C');
const D = Buffer.from('frame-D');
const scripted = (list) => {
  let i = 0;
  return async () => (i < list.length ? list[i++] : list.at(-1));
};

test('grabFrames skips missing frames and repeats of a stalled live view, and spaces the frames out', async () => {
  const started = Date.now();
  const frames = await grabFrames({ getFrame: scripted([null, A, A, A, B, null, B, C, C, D]), count: 4, intervalMs: 60 });
  assert.deepEqual(frames.map(String), ['frame-A', 'frame-B', 'frame-C', 'frame-D']);
  assert.ok(Date.now() - started >= 150, 'frames were spaced about intervalMs apart (3 gaps of ~60 ms)');
});

test('grabFrames on a live view that stalls part-way still returns what it has when that is enough for an animation', async () => {
  const frames = await grabFrames({ getFrame: scripted([A, B, C, C]), count: 6, intervalMs: 20, timeoutMs: 250 });
  assert.deepEqual(frames.map(String), ['frame-A', 'frame-B', 'frame-C']);
});

test('grabFrames gives a clear error when there are too few frames, or none at all', async () => {
  await assert.rejects(grabFrames({ getFrame: scripted([A, B, B]), count: 6, intervalMs: 20, timeoutMs: 200 }), (e) => e instanceof GifError && e.code === 'no_live_view' && /Only 2/.test(e.message));
  await assert.rejects(grabFrames({ getFrame: async () => null, count: 4, intervalMs: 20, timeoutMs: 150 }), (e) => e.code === 'no_live_view' && /No live view frames/.test(e.message));
});
