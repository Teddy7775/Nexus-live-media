import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SHARE_FILE, SHARE_TOKEN } from './share.js';

/**
 * Pushes a session's gallery files to your own web host (see webhost/upload.php).
 *
 * Each file is one signed POST. The signature is an HMAC-SHA256 over timestamp, token, file name and the SHA-256 of the
 * body, keyed with a secret only the booth and the web host know - so the upload address cannot be used by anyone else,
 * a captured request cannot be altered, and a captured request stops working ten minutes later.
 */

export class UploadError extends Error {
  constructor(message, { status = 0, retryable = true } = {}) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
    this.retryable = retryable;
  }
}

export function signUpload({ secret, timestamp, token, name, body }) {
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  return crypto.createHmac('sha256', secret).update(`${timestamp}\n${token}\n${name}\n${bodyHash}`).digest('hex');
}

const messageOf = (err) => (err instanceof Error ? err.message : String(err));

export class WebHostUploader {
  constructor({ url, secret, timeoutMs = 30000, fetchImpl = globalThis.fetch, now = () => Math.floor(Date.now() / 1000) }) {
    this.url = url;
    this.secret = secret;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this.now = now;
  }

  async #post({ query, token, name, body }) {
    const timestamp = String(this.now());
    let res;
    try {
      res = await this.fetch(`${this.url}${this.url.includes('?') ? '&' : '?'}${query}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-booth-timestamp': timestamp,
          'x-booth-signature': signUpload({ secret: this.secret, timestamp, token, name, body }),
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new UploadError(timedOut ? `The web host did not answer within ${Math.round(this.timeoutMs / 1000)} s` : `Cannot reach the web host (${err?.cause?.code ?? messageOf(err)})`, { retryable: true });
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* not JSON: a host error page, a redirect to a login page, wrong URL... */
    }
    if (res.ok && data?.ok) return data;
    const detail = data?.error ?? `HTTP ${res.status}`;
    // 4xx (except "too many requests"/timeout) means the booth is misconfigured: retrying cannot fix it.
    const retryable = res.status >= 500 || res.status === 429 || res.status === 408 || (!data && res.status !== 404);
    throw new UploadError(`The web host rejected the upload (${res.status}): ${detail}`, { status: res.status, retryable });
  }

  uploadFile({ token, name, buffer }) {
    if (!SHARE_TOKEN.test(token) || !SHARE_FILE.test(name)) throw new UploadError(`Refusing to upload ${name}`, { retryable: false });
    return this.#post({ query: `t=${encodeURIComponent(token)}&f=${encodeURIComponent(name)}`, token, name, body: buffer });
  }

  /** Signed round trip that proves URL, secret, clock and folder permissions are all right - run it before the event. */
  async check() {
    try {
      const data = await this.#post({ query: 'ping=1', token: 'ping', name: 'ping', body: Buffer.alloc(0) });
      return { ok: true, detail: `Web host reachable (PHP ${data.php}${data.writable ? '' : ', but its folder is NOT writable'})`, writable: data.writable !== false };
    } catch (err) {
      return { ok: false, detail: messageOf(err) };
    }
  }
}

// Wait between attempts for a session that cannot be uploaded yet (flaky venue Wi-Fi): quick at first, then patient.
export const DEFAULT_RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000, 900_000, 1_800_000];

/**
 * Durable upload queue: survives a crash or reboot, retries with back-off, and gives up (visibly) after maxAgeMs.
 * An entry is { id, sessionId, token, dir, files, version, status, attempts, ... } - `version` is the picture version,
 * so a retake supersedes an older upload of the same session.
 */
export class UploadQueue {
  #items = [];
  #timer = null;
  #running = false;
  #saving = Promise.resolve();

  constructor({ uploader, file, onUploaded, logger, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS, maxAgeMs = 72 * 3600_000, now = () => Date.now() }) {
    this.uploader = uploader;
    this.file = file;
    this.onUploaded = onUploaded;
    this.log = logger;
    this.retryDelaysMs = retryDelaysMs;
    this.maxAgeMs = maxAgeMs;
    this.now = now;
  }

  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (Array.isArray(saved)) this.#items = saved.filter((i) => i && SHARE_TOKEN.test(i.token) && Array.isArray(i.files));
    } catch {
      /* no queue yet */
    }
    for (const item of this.#items) if (item.status === 'uploading') item.status = 'queued'; // interrupted by a restart
    this.#schedule();
    return this;
  }

  enqueue({ sessionId, token, dir, files, version }) {
    // A newer picture of the same session supersedes anything older that has not finished.
    this.#items = this.#items.filter((i) => !(i.sessionId === sessionId && i.status !== 'done' && i.version <= version));
    const item = { id: crypto.randomBytes(5).toString('hex'), sessionId, token, dir, files, version, status: 'queued', attempts: 0, nextAt: this.now(), createdAt: this.now(), error: null, done: [] };
    this.#items.push(item);
    this.#persist();
    this.#schedule(0);
    return this.#view(item);
  }

  list() {
    return this.#items.map((i) => this.#view(i));
  }

  /** Items still waiting (not done, not failed). */
  pending() {
    return this.#items.filter((i) => i.status === 'queued' || i.status === 'uploading').length;
  }

  retry(id) {
    const item = this.#items.find((i) => i.id === id);
    if (!item) return false;
    item.status = 'queued';
    item.nextAt = this.now();
    item.createdAt = this.now();
    item.error = null;
    this.#persist();
    this.#schedule(0);
    return true;
  }

  stop() {
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  #view(i) {
    return { id: i.id, sessionId: i.sessionId, version: i.version, status: i.status, attempts: i.attempts, error: i.error, files: i.files.length, uploaded: i.done.length };
  }

  #persist() {
    const snapshot = JSON.stringify(this.#items.filter((i) => i.status !== 'done'));
    this.#saving = this.#saving
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, snapshot);
        await fs.rename(tmp, this.file);
      })
      .catch(() => {});
  }

  flush() {
    return this.#saving;
  }

  #schedule(forceDelay) {
    clearTimeout(this.#timer);
    const waiting = this.#items.filter((i) => i.status === 'queued');
    if (waiting.length === 0) return;
    const next = Math.min(...waiting.map((i) => i.nextAt));
    const delay = forceDelay ?? Math.max(0, next - this.now());
    this.#timer = setTimeout(() => this.tick(), delay);
    this.#timer.unref?.();
  }

  /** Processes everything that is due. Exposed so tests (and the operator's "retry now") can drive it. */
  async tick() {
    if (this.#running) return;
    this.#running = true;
    try {
      for (;;) {
        const item = this.#items.find((i) => i.status === 'queued' && i.nextAt <= this.now());
        if (!item) break;
        await this.#process(item);
      }
    } finally {
      this.#running = false;
      this.#schedule();
    }
  }

  async #process(item) {
    item.status = 'uploading';
    item.attempts += 1;
    try {
      for (const name of item.files) {
        if (item.done.includes(name)) continue;
        let buffer;
        try {
          buffer = await fs.readFile(path.join(item.dir, name));
        } catch {
          throw new UploadError(`The gallery file ${name} is missing on this PC`, { retryable: false });
        }
        await this.uploader.uploadFile({ token: item.token, name, buffer });
        item.done.push(name);
      }
      item.status = 'done';
      item.error = null;
      this.#items = this.#items.filter((i) => i.status !== 'done' || i === item);
      await this.onUploaded?.(item.sessionId, item.version);
      this.log?.info?.(`session ${item.sessionId} uploaded (${item.files.length} files)`);
    } catch (err) {
      item.error = messageOf(err);
      const expired = this.now() - item.createdAt > this.maxAgeMs;
      if (err instanceof UploadError && !err.retryable) {
        item.status = 'failed';
      } else if (expired) {
        item.status = 'failed';
        item.error = `Gave up after ${Math.round(this.maxAgeMs / 3600_000)} hours: ${item.error}`;
      } else {
        item.status = 'queued';
        item.nextAt = this.now() + this.retryDelaysMs[Math.min(item.attempts - 1, this.retryDelaysMs.length - 1)];
      }
      this.log?.warn?.(`upload of session ${item.sessionId} ${item.status === 'failed' ? 'FAILED' : 'will retry'}: ${item.error}`);
    }
    this.#persist();
  }
}
