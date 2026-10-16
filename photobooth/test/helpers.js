import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULTS, deepMerge, validateConfig } from '../server/config.js';
import { createBooth } from '../server/index.js';
import { createLogger } from '../server/logger.js';

/** Starts a complete booth (mock camera, dry-run printer by default) on a random port with its own temp folder. */
export async function startBooth({ overrides = {}, camera, printer, uploader } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-test-'));
  const base = { storage: { dir: path.join(dir, 'events') }, camera: { mock: { captureDelayMs: 5 } }, printer: { dryRunDelayMs: 20 } };
  const config = validateConfig(deepMerge(DEFAULTS, deepMerge(base, overrides)));
  const booth = await createBooth(config, {
    logger: createLogger({ quiet: true }),
    settingsFile: path.join(dir, 'runtime-settings.json'),
    camera,
    printer,
    uploader,
  });
  const server = await new Promise((resolve) => {
    const s = booth.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  // The guest-gallery listener (what phones reach), on its own port, exactly as in production.
  const lanServer = await new Promise((resolve) => {
    const s = booth.lanApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  const lanUrl = `http://127.0.0.1:${lanServer.address().port}`;

  const api = async (method, route, body, headers = {}) => {
    const res = await fetch(url + route, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text, headers: res.headers };
  };
  const operator = (method, route, body) => api(method, route, body, { 'x-operator-pin': config.operatorPin });

  return {
    ...booth,
    config,
    url,
    lanUrl,
    dir,
    api,
    operator,
    async close() {
      booth.uploadQueue?.stop();
      lanServer.closeAllConnections();
      await new Promise((resolve) => lanServer.close(resolve));
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function waitFor(check, { timeoutMs = 3000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Reads the first complete JPEG from a motion-JPEG stream, then hangs up. */
export async function firstStreamFrame(url, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status !== 200) throw Object.assign(new Error(`stream answered ${res.status}`), { status: res.status });
    const reader = res.body.getReader();
    let buf = Buffer.alloc(0);
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('the stream ended before a picture arrived');
      buf = Buffer.concat([buf, Buffer.from(value)]);
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd < 0) continue;
      const length = Number(/Content-Length: (\d+)/i.exec(buf.toString('latin1', 0, headerEnd))?.[1]);
      if (buf.length >= headerEnd + 4 + length) {
        controller.abort();
        return buf.subarray(headerEnd + 4, headerEnd + 4 + length);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
