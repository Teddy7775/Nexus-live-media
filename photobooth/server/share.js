import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Sharing = giving each session a private, unguessable web address that shows the guest's photos.
 *   https://example.com/booth/s/<token>/        (upload mode)    http://192.168.1.50:3001/s/<token>/   (local mode)
 * The token is 128 random bits; there is no listing of tokens anywhere, so a link only works for whoever was given it.
 */

export const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/;
/** The only file names a gallery folder may contain (also enforced by the web host's upload script). */
export const SHARE_FILE = /^(index\.html|final\.jpg|animation\.gif|shot-[1-8]\.jpg)$/;

export const newShareToken = () => crypto.randomBytes(16).toString('base64url');

/** This PC's address on the local network, for "local" sharing when no publicBaseUrl is configured. */
export function lanAddress(interfaces = os.networkInterfaces()) {
  const candidates = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      // Prefer real LAN ranges and skip typical virtual adapters (WSL, Hyper-V, VPN) where we can recognise them.
      const virtual = /vethernet|wsl|virtual|vmware|vbox|docker|hyper-v|tailscale|zerotier/i.test(name);
      candidates.push({ address: entry.address, rank: (virtual ? 10 : 0) + (/^192\.168\.|^10\./.test(entry.address) ? 0 : 1) });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank);
  return candidates[0]?.address ?? null;
}

/** Base address the guest's phone should use (no trailing slash). */
export function shareBaseUrl(config, { lanIp = lanAddress() } = {}) {
  if (config.sharing.publicBaseUrl) return config.sharing.publicBaseUrl;
  return `http://${lanIp ?? 'localhost'}:${config.lan.port}`;
}

export const shareUrl = (baseUrl, token) => `${baseUrl}/s/${token}/`;

/**
 * Is the guest's link live? "local": once the gallery folder for the current picture is built.
 * "upload": once the web host holds that exact picture version. (A retake changes the version, so an old upload never counts.)
 */
export function computeShareState({ config, session, uploadItem = null, shareBase }) {
  if (!config.sharing.enabled || !session?.share) return { enabled: false };
  const version = session.final?.version;
  const mode = config.sharing.mode;
  const built = Boolean(version) && session.share.builtVersion === version;
  const ready = mode === 'local' ? built : Boolean(version) && session.share.uploadedVersion === version;
  const failed = !ready && uploadItem?.status === 'failed';
  return { enabled: true, mode, ready, state: ready ? 'ready' : failed ? 'failed' : 'preparing', error: failed ? uploadItem.error : null, url: shareUrl(shareBase, session.share.token) };
}

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** A self-contained, JavaScript-free page: opens fast on a phone, works from any static web host. */
export function renderGalleryHtml({ eventName, brandName = '', createdAt, shotCount = 0, hasGif = false }) {
  const date = new Date(createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const shots = Array.from({ length: shotCount }, (_, i) => i + 1)
    .map((n) => `<figure><a href="shot-${n}.jpg"><img src="shot-${n}.jpg" alt="Photo ${n}" loading="lazy"></a><a class="dl" href="shot-${n}.jpg" download="photo-${n}.jpg">Download photo ${n}</a></figure>`)
    .join('\n      ');
  const gif = hasGif
    ? `<section><h2>Your GIF</h2><img class="hero" src="animation.gif" alt="Your animated GIF"><a class="btn" href="animation.gif" download="animation.gif">Download GIF</a></section>`
    : '';
  const brand = brandName ? `<footer>${escapeHtml(brandName)}</footer>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(eventName)} - your photos</title>
<style>
:root{--bg:#f4f6fa;--card:#fff;--text:#111827;--muted:#5b6578;--accent:#0b7bd6;--accent-text:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f16;--card:#141a25;--text:#eef1f7;--muted:#9aa5ba;--accent:#4db0ff;--accent-text:#04101c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
main{max-width:640px;margin:0 auto;padding:20px 16px 40px}header{text-align:center;margin-bottom:20px}h1{margin:0 0 4px;font-size:1.6rem}.date{margin:0;color:var(--muted)}
h2{font-size:1.1rem;margin:28px 0 10px}section{text-align:center}.hero{max-width:100%;height:auto;border-radius:12px;background:#fff;box-shadow:0 6px 24px rgb(0 0 0 / .18)}
.btn,.dl{display:inline-block;margin-top:12px;padding:12px 22px;border-radius:999px;background:var(--accent);color:var(--accent-text);font-weight:700;text-decoration:none}
.dl{padding:8px 14px;font-size:.9rem;margin-top:8px}.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
figure{margin:0;background:var(--card);border-radius:12px;padding:10px;text-align:center}figure img{width:100%;height:auto;border-radius:8px;display:block}
footer{margin-top:36px;text-align:center;color:var(--muted);font-size:.9rem}
</style>
</head>
<body>
<main>
  <header><h1>${escapeHtml(eventName)}</h1><p class="date">${escapeHtml(date)}</p></header>
  <section><img class="hero" src="final.jpg" alt="Your photos"><br><a class="btn" href="final.jpg" download="photos.jpg">Download</a></section>
  ${gif}
  ${shotCount > 1 ? `<section><h2>Your individual photos</h2><div class="grid">
      ${shots}
  </div></section>` : ''}
  ${brand}
</main>
</body>
</html>
`;
}

/** Remembers which session a token belongs to (a small JSON file next to the events). */
export class ShareIndex {
  #map = new Map();
  #writing = Promise.resolve();

  constructor({ file }) {
    this.file = file;
  }

  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      for (const [token, ref] of Object.entries(data)) {
        if (SHARE_TOKEN.test(token) && ref?.eventSlug && ref?.sessionId) this.#map.set(token, ref);
      }
    } catch {
      /* first run, or unreadable: starts empty (sessions can still be found by id) */
    }
    return this;
  }

  get(token) {
    return SHARE_TOKEN.test(token) ? (this.#map.get(token) ?? null) : null;
  }

  set(token, ref) {
    this.#map.set(token, ref);
    const snapshot = JSON.stringify(Object.fromEntries(this.#map));
    // Serialise writes so concurrent sessions cannot interleave and corrupt the file.
    this.#writing = this.#writing
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, snapshot);
        await fs.rename(tmp, this.file);
      })
      .catch(() => {});
    return this.#writing;
  }

  flush() {
    return this.#writing;
  }
}

/**
 * Writes <session>/share/ with exactly the files a guest's gallery needs (same bytes for local and upload mode):
 * index.html, final.jpg, shot-N.jpg and, when present, animation.gif. Returns the file names in upload order -
 * index.html LAST, so a gallery page never appears before the pictures it shows.
 */
export async function buildShareBundle({ session, sessionDir, brandName = '' }) {
  if (!session.final) throw new Error('The session has no finished picture yet');
  const dir = path.join(sessionDir, 'share');
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  const names = [];
  await fs.copyFile(path.join(sessionDir, session.final.file), path.join(dir, 'final.jpg'));
  names.push('final.jpg');

  const shots = [...session.shots].sort((a, b) => a.index - b.index).slice(0, 8);
  for (const [i, shot] of shots.entries()) {
    const name = `shot-${i + 1}.jpg`;
    await fs.copyFile(path.join(sessionDir, shot.preview), path.join(dir, name));
    names.push(name);
  }

  const hasGif = Boolean(session.gif?.file);
  if (hasGif) {
    await fs.copyFile(path.join(sessionDir, session.gif.file), path.join(dir, 'animation.gif'));
    names.push('animation.gif');
  }

  const html = renderGalleryHtml({ eventName: session.eventName, brandName, createdAt: session.createdAt, shotCount: shots.length, hasGif });
  await fs.writeFile(path.join(dir, 'index.html'), html);
  names.push('index.html');
  return { dir, files: names };
}
