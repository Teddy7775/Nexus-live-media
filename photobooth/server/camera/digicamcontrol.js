import fs from 'node:fs/promises';
import path from 'node:path';
import { CameraError } from './errors.js';

/**
 * Drives a DSLR through digiCamControl's built-in web server (Windows, free, supports most Canon and Nikon bodies).
 *
 * Contract (read from digiCamControl's source, WebServerModule.cs / CommandLineProcessor.cs):
 *   GET /?slc=capture&param1=<full path without extension>   take a photo; blocks until done; replies "OK",
 *                                                              or the error text (still HTTP 200!)
 *   GET /?slc=get&param1=lastcaptured                         file NAME of the last photo, or "-"
 *   GET /?slc=list&param1=cameras                             serial numbers of connected cameras, one per line
 *                                                              (an empty list is reported as "OK")
 *   GET /?slc=do&param1=LiveViewWnd_Show | LiveViewWnd_Hide   start / stop live view
 *   GET /liveview.jpg                                          current live view frame (only while live view runs)
 *   GET /image/<name>                                          a photo from the current session
 * The web server is OFF by default and commands need "Allow web server actions" - see the README.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const enc = encodeURIComponent;

/**
 * The path we hand to `capture`. On Windows digiCamControl only treats it as "folder + file name" when it is a
 * full path ("C:\..." or "\\server\..."); it then picks the extension itself, so we send none.
 */
export function toCameraPath(dir, baseName, platform = process.platform) {
  return platform === 'win32' ? path.win32.join(path.win32.resolve(dir), baseName) : path.join(dir, baseName);
}
const JPEG_EXT = new Set(['.jpg', '.jpeg']);
const RAW_EXT = new Set(['.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.dng', '.orf', '.raf', '.rw2', '.pef']);

export class DigiCamControlCamera {
  #chain = Promise.resolve();

  constructor(cfg, { logger, fetchImpl = globalThis.fetch, platform = process.platform } = {}) {
    this.name = 'digicamcontrol';
    this.cfg = cfg;
    this.log = logger;
    this.fetch = fetchImpl;
    this.platform = platform;
    this.liveViewOn = false;
  }

  async init() {}

  async close() {
    if (this.liveViewOn) await this.stopLiveView().catch(() => {});
  }

  /** digiCamControl handles one command at a time; never overlap them. */
  #serial(task) {
    const run = this.#chain.then(task);
    this.#chain = run.catch(() => {});
    return run;
  }

  async #request(pathAndQuery, { timeoutMs = this.cfg.requestTimeoutMs, binary = false } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetch(this.cfg.baseUrl + pathAndQuery, { signal: controller.signal });
      if (!res.ok) throw new CameraError('unavailable', `digiCamControl answered HTTP ${res.status}`);
      if (binary) return { buffer: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? '' };
      return (await res.text()).trim();
    } catch (err) {
      if (err instanceof CameraError) throw err;
      if (err.name === 'AbortError') throw new CameraError('timeout', `digiCamControl did not answer within ${Math.round(timeoutMs / 1000)} s`);
      throw new CameraError('unavailable', `Cannot reach digiCamControl at ${this.cfg.baseUrl} - is it running with its web server enabled? (${err.cause?.code ?? err.message})`);
    } finally {
      clearTimeout(timer);
    }
  }

  async #command(slc, param1, param2, options) {
    let query = `/?slc=${enc(slc)}`;
    if (param1 !== undefined) query += `&param1=${enc(param1)}`;
    if (param2 !== undefined) query += `&param2=${enc(param2)}`;
    const reply = await this.#request(query, options);
    if (reply.startsWith('<')) {
      throw new CameraError('unavailable', 'digiCamControl returned a web page instead of a command reply - enable "Allow web server actions" in its settings');
    }
    return reply;
  }

  async #expectOk(reply, what) {
    if (reply.toUpperCase() !== 'OK') throw new CameraError('capture_failed', `${what} failed: ${reply}`);
  }

  async status() {
    try {
      const reply = await this.#command('list', 'cameras');
      const lines = reply.split('\n').map((l) => l.trim()).filter((l) => l && l.toUpperCase() !== 'OK');
      // Serial numbers have no spaces; a line with spaces is an error message from digiCamControl.
      if (lines.some((l) => /\s/.test(l))) return { driver: this.name, connected: false, cameras: [], detail: `digiCamControl: ${lines.join(' ')}` };
      return {
        driver: this.name,
        connected: lines.length > 0,
        cameras: lines,
        detail: lines.length > 0 ? `Connected: ${lines.join(', ')}` : 'digiCamControl is running, but no camera is connected',
      };
    } catch (err) {
      return { driver: this.name, connected: false, cameras: [], detail: err.message, code: err.code };
    }
  }

  startLiveView() {
    return this.#serial(() => this.#startLiveViewNow());
  }

  stopLiveView() {
    return this.#serial(() => this.#stopLiveViewNow());
  }

  async #startLiveViewNow() {
    if (!this.cfg.liveView) return;
    await this.#expectOk(await this.#command('do', 'LiveViewWnd_Show'), 'Starting live view');
    await sleep(500);
    // Same steps digiCamControl's own web UI uses: keep its windows out of the way, skip image processing.
    await this.#command('do', 'All_Minimize').catch(() => {});
    await this.#command('do', 'LiveView_NoProcess').catch(() => {});
    this.liveViewOn = true;
  }

  async #stopLiveViewNow() {
    this.liveViewOn = false;
    await this.#command('do', 'LiveViewWnd_Hide').catch((err) => this.log?.warn?.(`stop live view: ${err.message}`));
  }

  /** Latest live view JPEG, or null when live view is not running. Never throws. */
  async liveFrame() {
    if (!this.liveViewOn) return null;
    try {
      const { buffer } = await this.#request('/liveview.jpg', { timeoutMs: 2000, binary: true });
      const isJpeg = buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8;
      return isJpeg ? buffer : null;
    } catch {
      return null;
    }
  }

  capture({ dir, baseName }) {
    return this.#serial(async () => {
      const resumeLiveView = this.liveViewOn && this.cfg.stopLiveViewForCapture;
      if (resumeLiveView) await this.#stopLiveViewNow();
      try {
        await fs.mkdir(dir, { recursive: true });
        const target = toCameraPath(dir, baseName, this.platform);
        // Remember what was last captured BEFORE shooting, so a stale answer can never be mistaken for the new photo.
        const baseline = await this.#command('get', 'lastcaptured').catch(() => null);
        const startedAt = Date.now();
        const reply = await this.#command('capture', target, undefined, { timeoutMs: this.cfg.captureTimeoutMs });
        await this.#expectOk(reply, 'Capture');
        const file = await this.#waitForPhoto(dir, baseName, { baseline, startedAt });
        return { file };
      } finally {
        // Resume the preview in the background; it queues behind this capture.
        if (resumeLiveView) this.#serial(() => this.#startLiveViewNow()).catch((err) => this.log?.warn?.(`resume live view: ${err.message}`));
      }
    });
  }

  async #findPhoto(dir, baseName) {
    let names;
    try {
      names = await fs.readdir(dir);
    } catch {
      return { jpeg: null, raw: null };
    }
    const prefix = `${baseName.toLowerCase()}.`;
    let jpeg = null;
    let raw = null;
    for (const name of names) {
      if (!name.toLowerCase().startsWith(prefix)) continue;
      const ext = path.extname(name).toLowerCase();
      if (JPEG_EXT.has(ext)) jpeg = path.join(dir, name);
      else if (RAW_EXT.has(ext)) raw = name;
    }
    return { jpeg, raw };
  }

  async #isStable(file) {
    const first = (await fs.stat(file)).size;
    if (first === 0) return false;
    await sleep(200);
    return (await fs.stat(file)).size === first;
  }

  async #waitForPhoto(dir, baseName, { baseline, startedAt }) {
    const deadline = Date.now() + this.cfg.fileWaitMs;
    // If the photo is not under the name we asked for, ask digiCamControl what it saved (first after a short grace period).
    const lastCheckEvery = 1000;
    let nextLastCheck = Date.now() + Math.min(1500, this.cfg.fileWaitMs / 2);
    let sawRaw = null;
    while (Date.now() < deadline) {
      const { jpeg, raw } = await this.#findPhoto(dir, baseName);
      if (jpeg && (await this.#isStable(jpeg).catch(() => false))) return jpeg;
      if (raw) sawRaw = raw;
      if (Date.now() >= nextLastCheck) {
        nextLastCheck = Date.now() + lastCheckEvery;
        const found = await this.#photoFromLastCaptured(dir, baseName, { baseline, startedAt }).catch(() => null);
        if (found) return found;
      }
      await sleep(150);
    }
    if (sawRaw) {
      throw new CameraError('capture_failed', `The camera saved a RAW file (${sawRaw}) but no JPEG. Set the camera image quality to JPEG Large/Fine.`);
    }
    throw new CameraError('file_missing', `The camera reported success but no new photo appeared in ${dir}. Check digiCamControl's session folder and the camera's storage settings.`);
  }

  /**
   * The photo is not under the name we asked for (e.g. digiCamControl is set to keep the camera's own file names).
   * Use `get lastcaptured`, but only ever accept a photo that is provably NEW - handing a guest the previous
   * guest's picture would be worse than an error.
   */
  async #photoFromLastCaptured(dir, baseName, { baseline, startedAt }) {
    const name = await this.#command('get', 'lastcaptured');
    if (!name || name === '-' || !JPEG_EXT.has(path.extname(name).toLowerCase())) return null;
    if (baseline !== null && baseline !== undefined && name === baseline) return null; // nothing new was captured

    // 1) Saved in our folder under the camera's own name: accept it only if it was written during this capture.
    const local = path.join(dir, path.basename(name));
    const stat = await fs.stat(local).catch(() => null);
    if (stat && stat.mtimeMs >= startedAt - 2000 && (await this.#isStable(local).catch(() => false))) return local;

    // 2) Not on disk where we can see it: pull it over HTTP. Needs a known baseline to prove it is new.
    if (baseline === null || baseline === undefined) return null;
    const { buffer, type } = await this.#request(`/image/${enc(name)}`, { binary: true, timeoutMs: this.cfg.captureTimeoutMs });
    if (!type.includes('image') || buffer.length === 0) return null;
    const file = path.join(dir, `${baseName}.jpg`);
    await fs.writeFile(file, buffer);
    this.log?.warn?.(`photo was not in ${dir} under the requested name; used ${name} reported by digiCamControl`);
    return file;
  }
}
