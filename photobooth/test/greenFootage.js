// Synthetic green-screen footage with KNOWN ground truth, so the keyer can be judged against facts, not by eye.
// Backdrop: unevenly lit green (bright centre, dark corners, a soft shadow) with camera noise.
// Subject: skin-toned face, dark hair, blue shirt - none of which should be removed.

export function prng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const gauss = (rnd) => {
  let u = 0;
  for (let i = 0; i < 6; i++) u += rnd();
  return (u - 3) * Math.SQRT2; // roughly normal, sigma ~1
};

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/**
 * Returns { rgb, width, height, truth, edge, backdropColour }
 *   truth[i] = 1 where the pixel is clearly the person, 0 where it is clearly backdrop
 *   edge[i]  = 1 within `edgeBand` px of the person's outline (excluded from strict checks)
 */
export function greenScene({ width = 640, height = 427, noise = 5, seed = 1, vignette = 0.45, shadow = true, subject = true, spill = 0, shirt = [40, 70, 160], dx = 0, backdrop = [35, 190, 70] } = {}) {
  const rnd = prng(seed);
  const rgb = Buffer.alloc(width * height * 3);
  const truth = new Uint8Array(width * height);
  const cx = width / 2 + dx;
  const headR = height * 0.16;
  const headY = height * 0.4;
  const inEllipse = (x, y, ex, ey, rx, ry) => ((x - ex) / rx) ** 2 + ((y - ey) / ry) ** 2 <= 1;

  const regionAt = (x, y) => {
    if (!subject) return 'none';
    if (inEllipse(x, y, cx, headY + headR * 0.08, headR * 0.78, headR * 0.95)) return y < headY - headR * 0.35 ? 'hair' : 'skin';
    if (inEllipse(x, y, cx, headY - headR * 0.1, headR * 0.92, headR * 1.12)) return 'hair';
    if (x > cx - headR * 0.35 && x < cx + headR * 0.35 && y > headY + headR * 0.7 && y < headY + headR * 1.7) return 'skin';
    if (inEllipse(x, y, cx, height * 1.0, width * 0.27, height * 0.3)) return 'shirt';
    return 'none';
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const region = regionAt(x, y);
      let r;
      let g;
      let b;
      if (region === 'none') {
        // Backdrop: bright centre, dark edges (vignette), a soft shadow to the right of the person.
        const dxn = (x - width / 2) / (width / 2);
        const dyn = (y - height * 0.42) / (height / 2);
        const light = 1 - vignette * Math.min(1, dxn * dxn + dyn * dyn);
        let shade = 1;
        if (shadow && subject) shade -= 0.3 * Math.exp(-(((x - (cx + width * 0.07)) / (width * 0.2)) ** 2 + ((y - height * 0.8) / (height * 0.35)) ** 2));
        const k = light * shade;
        r = backdrop[0] * k;
        g = backdrop[1] * k;
        b = backdrop[2] * k;
      } else if (region === 'skin') {
        [r, g, b] = [226, 172, 142];
        truth[i] = 1;
      } else if (region === 'hair') {
        [r, g, b] = [62, 42, 30];
        truth[i] = 1;
      } else {
        [r, g, b] = shirt;
        truth[i] = 1;
      }
      if (region !== 'none' && spill > 0) {
        // green light bouncing off the backdrop onto the person
        g += spill;
      }
      const p = i * 3;
      rgb[p] = clamp(r + gauss(rnd) * noise);
      rgb[p + 1] = clamp(g + gauss(rnd) * noise);
      rgb[p + 2] = clamp(b + gauss(rnd) * noise);
    }
  }

  // The outline band: pixels within `edgeBand` px of a truth change are ambiguous (anti-aliased by the keyer's own blur).
  const edgeBand = 4;
  const edge = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = truth[y * width + x];
      let near = false;
      for (let oy = -edgeBand; oy <= edgeBand && !near; oy += 2) {
        for (let ox = -edgeBand; ox <= edgeBand; ox += 2) {
          const xx = x + ox;
          const yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          if (truth[yy * width + xx] !== t) {
            near = true;
            break;
          }
        }
      }
      if (near) edge[y * width + x] = 1;
    }
  }
  return { rgb, width, height, truth, edge };
}

/** A flat picture, e.g. a replacement background of one colour. */
export function flat(width, height, [r, g, b]) {
  const out = Buffer.alloc(width * height * 3);
  for (let p = 0; p < out.length; p += 3) {
    out[p] = r;
    out[p + 1] = g;
    out[p + 2] = b;
  }
  return out;
}

/** A background with structure (diagonal stripes of two colours), so "the background shows through" is unmistakable. */
export function stripes(width, height, a = [200, 30, 120], b = [250, 220, 40]) {
  const out = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = Math.floor((x + y) / 24) % 2 === 0 ? a : b;
      const p = (y * width + x) * 3;
      out[p] = c[0];
      out[p + 1] = c[1];
      out[p + 2] = c[2];
    }
  }
  return out;
}

/** Statistics of a keyed result against the scene's ground truth and the replacement background. */
export function judge({ out, scene, bg, tolerance = 14 }) {
  const { width, height, truth, edge, rgb } = scene;
  let backdropN = 0;
  let backdropOk = 0;
  let subjectN = 0;
  let subjectOk = 0;
  let greenest = 0; // strongest remaining green cast on the person (G above max(R, B)) in the interior
  for (let i = 0; i < width * height; i++) {
    if (edge[i]) continue;
    const p = i * 3;
    if (truth[i] === 0) {
      backdropN += 1;
      if (Math.abs(out[p] - bg[p]) <= tolerance && Math.abs(out[p + 1] - bg[p + 1]) <= tolerance && Math.abs(out[p + 2] - bg[p + 2]) <= tolerance) backdropOk += 1;
    } else {
      subjectN += 1;
      // The interior of the person must come out as it went in (noise included): same pixel, within a small tolerance.
      if (Math.abs(out[p] - rgb[p]) <= tolerance && Math.abs(out[p + 1] - rgb[p + 1]) <= tolerance && Math.abs(out[p + 2] - rgb[p + 2]) <= tolerance) subjectOk += 1;
      greenest = Math.max(greenest, out[p + 1] - Math.max(out[p], out[p + 2]));
    }
  }
  return { backdropShare: backdropOk / backdropN, subjectShare: subjectOk / subjectN, backdropN, subjectN, greenest };
}
