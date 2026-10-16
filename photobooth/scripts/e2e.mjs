// End-to-end check: drives the real guest and operator UI in a real browser against a running booth
// (mock camera, dry-run printer) and saves a screenshot of every screen into docs/screens/.
//
//   npm run e2e                 (uses a Chromium/Chrome it can find, or set CHROME_PATH)
//
// This proves the interface and the server work together. It does NOT prove a real camera or printer work.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { DEFAULTS, ROOT_DIR, deepMerge, validateConfig } from '../server/config.js';
import { createBooth } from '../server/index.js';
import { createLogger } from '../server/logger.js';

const shotsDir = path.resolve(ROOT_DIR, process.env.SCREENSHOT_DIR ?? 'docs/screens');
fs.mkdirSync(shotsDir, { recursive: true });

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-e2e-'));
const config = validateConfig(
  deepMerge(DEFAULTS, {
    storage: { dir: path.join(work, 'events') },
    event: { name: 'Sarah & James Wedding' },
    ui: { countdownSeconds: 2, shotPreviewSeconds: 1, reviewSeconds: 60, doneSeconds: 60, errorSeconds: 60 },
    camera: { mock: { captureDelayMs: 150 } },
    printer: { dryRunDelayMs: 2500, estimatedSeconds: 3 },
  }),
);
const booth = await createBooth(config, { logger: createLogger({ quiet: true }), settingsFile: path.join(work, 'runtime-settings.json') });
const server = await new Promise((resolve) => {
  const s = booth.app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

const candidates = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].filter(Boolean);
const executablePath = candidates.find((p) => fs.existsSync(p));
const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox'] } : { channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

const problems = [];
page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
// This script deliberately breaks the camera (503) and enters a wrong PIN (401), so exactly those are expected.
// Anything else the browser logs as an error fails the run.
const EXPECTED = /status of (503|401)|The camera could not take the photo/i;
page.on('console', (msg) => {
  if (msg.type() === 'error' && !EXPECTED.test(msg.text())) problems.push(`console error: ${msg.text()}`);
});

// Record which URL failed, so an unexpected 4xx/5xx is diagnosable (the console message alone omits the URL).
const failedRequests = [];
page.on('response', (res) => {
  if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.request().method()} ${res.url().replace(base, '')}`);
});

let step = 0;
// Wait for the 0.25 s screen cross-fade to finish so the screenshot shows the screen, not a blend of two.
const snap = async (name, settleMs = 450) => {
  await page.waitForTimeout(settleMs);
  step += 1;
  const file = path.join(shotsDir, `${String(step).padStart(2, '0')}-${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
  console.log(`  screenshot ${path.relative(ROOT_DIR, file)}`);
};
const onScreen = (name, timeout = 20000) => page.waitForSelector(`body[data-screen="${name}"]`, { timeout });
const log = (msg) => console.log(`\n# ${msg}`);

try {
  log('guest: attract screen');
  await page.goto(base);
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.textContent('#eventName'), 'Sarah & James Wedding');
  assert.match(await page.textContent('#eventInfo'), /3 photos, printed on the spot/);
  await snap('attract');

  log('guest: 3 photos with live preview and countdown');
  await page.click('#startBtn');
  await onScreen('countdown');
  await page.waitForFunction(() => document.querySelector('#liveImg').naturalWidth > 0, null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#count').textContent === '2');
  assert.equal(await page.textContent('#shotChip'), 'Photo 1 of 3');
  await snap('countdown', 350);

  await onScreen('shot');
  assert.ok(await page.evaluate(() => document.querySelector('#shotImg').naturalWidth > 0), 'photo shown');
  await snap('photo-taken');

  await onScreen('review', 40000);
  assert.ok(await page.evaluate(() => document.querySelector('#finalImg').naturalWidth > 0), 'composed picture shown');
  assert.equal(await page.locator('.retake').count(), 3, 'one retake button per photo');
  assert.equal((await page.textContent('#printBtn')).trim(), 'Print my photos');
  await snap('review');

  log('guest: retake photo 2, then it returns to review with a fresh composite');
  const before = await page.getAttribute('#finalImg', 'src');
  await page.locator('.retake').nth(1).click();
  await onScreen('countdown');
  assert.equal(await page.textContent('#shotChip'), 'Photo 2 of 3');
  await onScreen('review', 40000);
  await page.waitForFunction((old) => document.querySelector('#finalImg').getAttribute('src') !== old, before);

  log('guest: print, wait for completion');
  await page.click('#printBtn');
  await onScreen('printing');
  await snap('printing');
  await onScreen('done', 30000);
  await snap('done');
  const sessions = (await (await fetch(`${base}/api/operator/sessions`, { headers: { 'x-operator-pin': config.operatorPin } })).json()).sessions;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].prints, 1);
  const sessionDir = path.join(config.storage.dir, booth.settings.eventSlug, sessions[0].id);
  assert.ok(fs.existsSync(path.join(sessionDir, 'print.pdf')), 'print.pdf written');
  assert.ok(fs.existsSync(path.join(sessionDir, 'originals', 'shot-2-a2.jpg')), 'the retake kept the original and saved attempt 2');
  await page.click('#doneBtn');
  await onScreen('attract');

  log('guest: camera failure shows a plain-language error, "Try again" recovers');
  booth.camera.failEveryNth = 1;
  booth.camera.captureCount = 0;
  await page.click('#startBtn');
  await onScreen('error', 30000);
  assert.match(await page.textContent('#errorMsg'), /could not take the photo/i);
  await snap('error');
  booth.camera.failEveryNth = 0;
  await page.click('#retryBtn');
  await onScreen('shot', 30000);
  await page.click('body'); // nothing to tap; just proves the page is still responsive
  await onScreen('review', 40000);
  await page.click('#printBtn');
  await onScreen('done', 30000);
  await page.click('#doneBtn');
  await onScreen('attract');

  log('guest: "Start over" from the error screen returns to the attract screen');
  booth.camera.failEveryNth = 1;
  await page.click('#startBtn');
  await onScreen('error', 30000);
  await page.click('#homeBtn');
  await onScreen('attract');
  booth.camera.failEveryNth = 0;

  log('guest: portrait layout of the review screen');
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.click('#startBtn');
  await onScreen('review', 60000);
  await snap('review-portrait');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.click('#printBtn');
  await onScreen('done', 30000);
  await page.click('#doneBtn');
  await onScreen('attract');

  log('operator: PIN gate, status, test capture, test print, settings');
  await page.goto(`${base}/operator.html`);
  await page.fill('#pin', 'wrong-pin');
  await page.click('#pinForm button[type=submit]');
  await page.waitForSelector('#pinError:not([hidden])');
  assert.match(await page.textContent('#pinError'), /Wrong PIN/);
  await snap('operator-locked');

  await page.fill('#pin', config.operatorPin);
  await page.click('#pinForm button[type=submit]');
  await page.waitForSelector('#dash:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#camText').textContent === 'Camera ready');
  assert.match(await page.textContent('#warnings'), /operatorPin is still the default/);

  await page.click('#testCapture');
  await page.waitForSelector('#captureImg:not([hidden])');
  assert.match(await page.textContent('#captureMsg'), /Test photo OK/);

  await page.click('#testPrint');
  await page.waitForSelector('#jobs .badge');
  await page.waitForFunction(() => [...document.querySelectorAll('#jobs .badge')].some((b) => b.textContent === 'done'), null, { timeout: 15000 }).catch(() => {});

  await page.fill('#eventName', 'Acme <b>Gala</b> & Co');
  await page.selectOption('#template', 'duo-4x6');
  await page.fill('#copies', '2');
  await page.click('#settingsForm button[type=submit]');
  await page.waitForSelector('#saveMsg.ok');
  assert.equal(await page.locator('#eventName').inputValue(), 'Acme <b>Gala</b> & Co');
  assert.equal(await page.locator('#dash b').count(), 0, 'event name must be shown as text, never as HTML');
  await snap('operator');

  log('guest: the saved settings reach the guest screen');
  await page.goto(base);
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.textContent('#eventName'), 'Acme <b>Gala</b> & Co');
  assert.match(await page.textContent('#eventInfo'), /2 photos/);
  await snap('attract-after-settings');

  assert.deepEqual(problems, [], `browser reported problems:\n${problems.join('\n')}\nfailed requests:\n${failedRequests.join('\n')}`);
  console.log('\nE2E PASSED');
} catch (err) {
  console.error('\nE2E FAILED:', err.message);
  try {
    await page.screenshot({ path: path.join(shotsDir, 'FAILURE.jpg'), type: 'jpeg', quality: 70 });
    console.error(`state at failure: screen=${await page.evaluate(() => document.body.dataset.screen)} (see docs/screens/FAILURE.jpg)`);
  } catch {
    /* page already gone */
  }
  process.exitCode = 1;
} finally {
  await browser.close();
  server.closeAllConnections();
  server.close();
  fs.rmSync(work, { recursive: true, force: true });
}
