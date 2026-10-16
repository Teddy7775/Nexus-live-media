import gifenc from 'gifenc';
import sharp from 'sharp';

// gifenc is CommonJS: from an ES module its functions come from the default export.
const { GIFEncoder, quantize, applyPalette } = gifenc;

export class GifError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GifError';
    this.code = code;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MIN_FRAMES = 3;

/**
 * Collects `count` DISTINCT live-view JPEGs, roughly `intervalMs` apart. A live view that stalls (serving the same frame
 * again and again) would otherwise produce a frozen "animation", so repeats are skipped. If time runs out we still return
 * what we have, as long as that is enough for a short animation.
 */
export async function grabFrames({ getFrame, count, intervalMs, timeoutMs = count * intervalMs * 4 + 2000, now = Date.now, wait = sleep }) {
  const frames = [];
  const started = now();
  let previous = null;
  let nextAt = started;
  while (frames.length < count) {
    if (now() - started > timeoutMs) {
      if (frames.length >= MIN_FRAMES) break;
      throw new GifError('no_live_view', frames.length === 0 ? 'No live view frames arrived - is live view running?' : `Only ${frames.length} live view frame(s) arrived in time`);
    }
    const pause = nextAt - now();
    if (pause > 0) await wait(pause);
    const frame = await getFrame();
    if (frame && (!previous || !frame.equals(previous))) {
      frames.push(frame);
      previous = frame;
      nextAt = now() + intervalMs;
    } else {
      await wait(Math.min(40, intervalMs)); // no frame, or the same one again: look again shortly
    }
  }
  return frames;
}

/**
 * JPEG frames -> animated GIF bytes. One shared colour palette (built from a sample of every frame) keeps colours steady
 * from frame to frame instead of flickering. `boomerang` plays forwards then backwards for a loop that feels seamless.
 */
export async function encodeGif({ frames, width = 640, delayMs = 250, boomerang = true, loop = true }) {
  if (!frames?.length) throw new GifError('no_frames', 'There are no frames to encode');
  const first = await sharp(frames[0], { failOn: 'none' }).metadata();
  const scale = Math.min(1, width / first.width);
  const w = Math.max(2, Math.round(first.width * scale));
  const h = Math.max(2, Math.round(first.height * scale));

  const decoded = [];
  for (const jpeg of frames) {
    const { data } = await sharp(jpeg, { failOn: 'none' }).resize(w, h, { fit: 'cover' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    decoded.push(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length));
  }

  // Palette from a sample of all frames (every Nth pixel), not just the first.
  const stride = Math.max(1, Math.floor((w * h) / 16000));
  const sample = new Uint8ClampedArray(Math.ceil((w * h) / stride) * 4 * decoded.length);
  let at = 0;
  for (const data of decoded) {
    for (let i = 0; i < w * h; i += stride) {
      sample[at++] = data[i * 4];
      sample[at++] = data[i * 4 + 1];
      sample[at++] = data[i * 4 + 2];
      sample[at++] = 255;
    }
  }
  const palette = quantize(sample.subarray(0, at), 256);

  const sequence = boomerang && decoded.length > 2 ? [...decoded, ...decoded.slice(1, -1).reverse()] : decoded;
  const gif = GIFEncoder();
  sequence.forEach((data, i) => {
    gif.writeFrame(applyPalette(data, palette), w, h, { palette: i === 0 ? palette : undefined, delay: delayMs, repeat: loop ? 0 : -1 });
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}
