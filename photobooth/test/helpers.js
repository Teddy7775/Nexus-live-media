import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULTS, deepMerge, validateConfig } from '../server/config.js';
import { createBooth } from '../server/index.js';
import { createLogger } from '../server/logger.js';

/** Starts a complete booth (mock camera, dry-run printer by default) on a random port with its own temp folder. */
export async function startBooth({ overrides = {}, camera, printer } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-test-'));
  const base = { storage: { dir: path.join(dir, 'events') }, camera: { mock: { captureDelayMs: 5 } }, printer: { dryRunDelayMs: 20 } };
  const config = validateConfig(deepMerge(DEFAULTS, deepMerge(base, overrides)));
  const booth = await createBooth(config, {
    logger: createLogger({ quiet: true }),
    settingsFile: path.join(dir, 'runtime-settings.json'),
    camera,
    printer,
  });
  const server = await new Promise((resolve) => {
    const s = booth.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}`;

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
    dir,
    api,
    operator,
    async close() {
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
