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
import net from 'node:net';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { startFakeSmtp } from '../test/fakeSmtp.js';
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

const waitForMail = async (smtp, count, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (smtp.state.messages.length < count) {
    if (Date.now() > deadline) throw new Error('the email never arrived at the SMTP server');
    await new Promise((r) => setTimeout(r, 50));
  }
};

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

  // ------------------------------------------------------------------ sharing + email scenario
  log('sharing + email: type an address on the touch keyboard, scan the QR on a phone');
  const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
  const lanPort = await freePort();
  const smtp = await startFakeSmtp();
  const work2 = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-e2e-share-'));
  const config2 = validateConfig(
    deepMerge(DEFAULTS, {
      storage: { dir: path.join(work2, 'events') },
      event: { name: 'Sarah & James Wedding' },
      ui: { countdownSeconds: 1, shotPreviewSeconds: 1, reviewSeconds: 60, doneSeconds: 8, errorSeconds: 60 },
      camera: { mock: { captureDelayMs: 100 } },
      printer: { dryRunDelayMs: 3500, estimatedSeconds: 4 },
      sharing: { enabled: true, mode: 'local', publicBaseUrl: `http://127.0.0.1:${lanPort}`, shareSeconds: 30, wifiHint: 'Join the Wi-Fi network NexusGuests first.' },
      gif: { enabled: true, frames: 4, intervalMs: 120, countdownSeconds: 1, width: 480 },
      email: { enabled: true, from: 'Nexus Booth <booth@test.local>', smtp: smtp.smtp(), marketingOptIn: { enabled: true, label: 'Keep me posted about future events' } },
    }),
  );
  const booth2 = await createBooth(config2, { logger: createLogger({ quiet: true }), settingsFile: path.join(work2, 'runtime-settings.json') });
  const server2 = await new Promise((resolve) => { const s = booth2.app.listen(0, '127.0.0.1', () => resolve(s)); });
  const lanServer2 = await new Promise((resolve) => { const s = booth2.lanApp.listen(lanPort, '127.0.0.1', () => resolve(s)); });
  const base2 = `http://127.0.0.1:${server2.address().port}`;
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const snapPage = async (pg, name, settleMs = 450) => {
    await pg.waitForTimeout(settleMs);
    step += 1;
    await pg.screenshot({ path: path.join(shotsDir, `${String(step).padStart(2, '0')}-${name}.jpg`), type: 'jpeg', quality: 82 });
    console.log(`  screenshot docs/screens/${String(step).padStart(2, '0')}-${name}.jpg`);
  };
  // Tap keys on the on-screen keyboard exactly as a guest would.
  const typeOnKeyboard = async (pg, text) => {
    for (const ch of text) await pg.click(`#keyboard .key[data-key="${ch}"]`);
  };
  try {
    const page2 = await context.newPage();
    page2.on('pageerror', (err) => problems.push(`page error (sharing): ${err.message}`));
    await page2.goto(base2);
    await page2.waitForSelector('body[data-ready="true"]');
    await page2.click('#startBtn');
    // After the 3 photos comes the bonus GIF, recorded from the live view.
    await page2.waitForFunction(() => document.querySelector('#shotChip').textContent === 'Bonus: a GIF!', null, { timeout: 60000 });
    await page2.waitForFunction(() => document.querySelector('#count').textContent === '1');
    await snapPage(page2, 'gif-countdown', 150);
    await page2.waitForFunction(() => document.querySelector('#shotChip').textContent === 'Recording…', null, { timeout: 10000 });
    assert.equal(await page2.locator('#shotChip.rec').count(), 1, 'a recording indicator is shown');
    await page2.waitForSelector('body[data-screen="review"]', { timeout: 60000 });
    assert.match(await page2.textContent('#reviewSub'), /Your GIF will be in your online gallery/);
    await page2.click('#printBtn');
    await page2.waitForSelector('body[data-screen="printing"]');
    await page2.waitForSelector('#sharePanel:not([hidden])');
    await page2.waitForFunction(() => document.querySelector('#shareStatus').classList.contains('ok'), null, { timeout: 15000 });
    assert.match(await page2.textContent('#shareStatus'), /Ready.*scan.*Join the Wi-Fi network NexusGuests first\./);
    await snapPage(page2, 'share-while-printing', 250);

    // --- email, while the print is still coming out
    await page2.click('#emailBtn');
    await page2.waitForSelector('#emailOverlay:not([hidden])');
    assert.equal(await page2.isDisabled('#emailSend'), true, 'Send is disabled until the address is valid');
    await snapPage(page2, 'email-keyboard', 150);
    await typeOnKeyboard(page2, 'ana@gmial.com');
    assert.equal(await page2.textContent('#emailText'), 'ana@gmial.com');
    await page2.waitForSelector('#emailSuggest:not([hidden])');
    assert.equal((await page2.textContent('#emailSuggest')).trim(), 'Did you mean ana@gmail.com?');
    await snapPage(page2, 'email-did-you-mean', 150);
    await page2.click('#emailSuggest');
    assert.equal(await page2.textContent('#emailText'), 'ana@gmail.com');
    await page2.check('#optIn');

    // The print finishes while the guest is still on the email screen: the kiosk must NOT jump to "Thank you".
    await page2.waitForTimeout(4200);
    assert.equal(await page2.evaluate(() => document.body.dataset.screen), 'printing', 'the screen waits while the guest is typing');
    assert.equal(await page2.locator('#emailOverlay').isVisible(), true);

    await page2.click('#emailSend');
    await page2.waitForSelector('#emailOverlay', { state: 'hidden' });
    await page2.waitForSelector('body[data-screen="done"]', { timeout: 15000 });
    assert.match(await page2.textContent('#emailSent'), /Sent to a\*\*\*@gmail\.com/);
    await waitForMail(smtp, 1);
    const mail = smtp.state.messages[0];
    assert.equal(mail.to.value[0].address, 'ana@gmail.com', 'the corrected address received the email');

    // --- the QR on screen and the link in the email are the same gallery
    const qrPng = await page2.locator('#qrImg').screenshot();
    const { data, info } = await sharp(qrPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const scanned = jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
    assert.ok(scanned && scanned.startsWith(`http://127.0.0.1:${lanPort}/s/`), `the on-screen QR decodes to a gallery link (got ${scanned})`);
    assert.ok(mail.text.includes(scanned), 'the email links to the same gallery as the QR code');
    const optIn = path.join(config2.storage.dir, booth2.settings.eventSlug, 'optin-emails.csv');
    assert.match(fs.readFileSync(optIn, 'utf8'), /ana@gmail\.com,/, 'the guest who ticked the box was recorded');

    const phonePage = await phone.newPage();
    phonePage.on('pageerror', (err) => problems.push(`page error (gallery): ${err.message}`));
    await phonePage.goto(scanned);
    assert.match(await phonePage.title(), /Sarah & James Wedding - your photos/);
    await phonePage.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    assert.ok((await phonePage.locator('img').count()) >= 5, 'final picture, the GIF and the individual photos');
    assert.equal(await phonePage.locator('img[src="animation.gif"]').count(), 1, 'the GIF is in the gallery');
    assert.ok(await phonePage.evaluate(() => document.querySelector('img[src="animation.gif"]').naturalWidth > 0), 'and it loads');
    await snapPage(phonePage, 'guest-gallery-phone', 200);

    await snapPage(page2, 'done-with-qr', 250);
    await page2.close();
  } finally {
    await phone.close();
    booth2.emailQueue?.stop();
    lanServer2.closeAllConnections();
    lanServer2.close();
    server2.closeAllConnections();
    server2.close();
    await smtp.close();
    fs.rmSync(work2, { recursive: true, force: true });
  }

  // ------------------------------------------------------------------ green screen scenario
  log('green screen: pick a background while watching yourself on it, photos and print come out with no green');
  const work3 = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-e2e-green-'));
  const config3 = validateConfig(
    deepMerge(DEFAULTS, {
      storage: { dir: path.join(work3, 'events') },
      event: { name: 'Sarah & James Wedding' },
      ui: { countdownSeconds: 1, shotPreviewSeconds: 1, reviewSeconds: 60, doneSeconds: 30, errorSeconds: 60 },
      camera: { mock: { captureDelayMs: 100, scene: 'greenscreen' } },
      printer: { dryRunDelayMs: 1500, estimatedSeconds: 2 },
      greenScreen: { enabled: true, dir: path.join(work3, 'backgrounds') },
    }),
  );
  const booth3 = await createBooth(config3, { logger: createLogger({ quiet: true }), settingsFile: path.join(work3, 'runtime-settings.json') });
  const server3 = await new Promise((resolve) => { const s = booth3.app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base3 = `http://127.0.0.1:${server3.address().port}`;
  /** Share of pixels that are clearly green (greener than red and blue by 25+). */
  const greenShareOf = async (bytes) => {
    const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let p = 0; p < data.length; p += 3) if (data[p + 1] - Math.max(data[p], data[p + 2]) > 25) n += 1;
    return n / (info.width * info.height);
  };
  const imageOf = async (selector) => Buffer.from(await (await fetch(new URL(await page.getAttribute(selector, 'src'), base3))).arrayBuffer());
  try {
    await page.goto(base3);
    await page.waitForSelector('body[data-ready="true"]');
    assert.match(await page.textContent('#eventInfo'), /on a background you choose/);
    await page.click('#startBtn');
    await onScreen('pick');
    assert.equal(await page.locator('.pick-thumb').count(), 3, 'the three built-in backgrounds are offered');
    await page.waitForFunction(() => document.querySelector('#pickImg').naturalWidth > 0, null, { timeout: 15000 });
    assert.match(await page.getAttribute('#pickImg', 'src'), /stream\?bg=builtin-sunset/);
    assert.ok((await greenShareOf(await page.locator('#pickImg').screenshot())) < 0.02, 'the live picture shows the guest on the background, not on green');
    await snap('greenscreen-pick', 700);

    await page.locator('.pick-thumb').nth(1).click(); // Night sky
    assert.equal(await page.locator('.pick-thumb').nth(1).getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(() => /bg=builtin-night/.test(document.querySelector('#pickImg').getAttribute('src')));
    await page.waitForFunction(() => document.querySelector('#pickImg').naturalWidth > 0, null, { timeout: 15000 });
    await snap('greenscreen-pick-night', 700);

    await page.click('#pickGo');
    await onScreen('countdown');
    assert.match(await page.getAttribute('#liveImg', 'src'), /stream\?session=\d{8}-\d{6}-[0-9a-f]{4}&mirror=1/, 'the countdown preview follows the session and mirrors only the person');
    assert.equal(await page.locator('#live.mirror').count(), 0, 'and the whole picture is NOT mirrored on top of that');
    await page.waitForFunction(() => document.querySelector('#liveImg').naturalWidth > 0, null, { timeout: 15000 });
    await snap('greenscreen-countdown', 500);

    await onScreen('shot');
    assert.ok((await greenShareOf(await imageOf('#shotImg'))) < 0.01, 'the photo just taken has no green');
    await snap('greenscreen-photo');
    await onScreen('review', 60000);
    assert.ok((await greenShareOf(await imageOf('#finalImg'))) < 0.005, 'the finished layout has no green');
    await snap('greenscreen-review');
    await page.click('#printBtn');
    await onScreen('done', 30000);
    const only = (await (await fetch(`${base3}/api/operator/sessions`, { headers: { 'x-operator-pin': config3.operatorPin } })).json()).sessions;
    const saved3 = JSON.parse(fs.readFileSync(path.join(config3.storage.dir, booth3.settings.eventSlug, only[0].id, 'session.json'), 'utf8'));
    assert.equal(saved3.background.id, 'builtin-night', 'the session remembers the chosen background');
    assert.ok((await greenShareOf(path.join(config3.storage.dir, booth3.settings.eventSlug, only[0].id, 'originals', 'shot-1-a1.jpg'))) > 0.3, 'while the original is still the untouched green photo');
    await page.click('#doneBtn');
    await onScreen('attract');

    log('green screen: the operator tuner shows the matte, calibrates, saves');
    await page.goto(`${base3}/operator.html`);
    await page.fill('#pin', config3.operatorPin);
    await page.click('#pinForm button[type=submit]');
    await page.waitForSelector('#dash:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#gsText').textContent === 'Green screen is on');
    await page.click('#gsToggle');
    await page.waitForFunction(() => !document.querySelector('#gsImg').hidden && document.querySelector('#gsImg').naturalWidth > 0, null, { timeout: 20000 });
    await page.click('.seg-btn[data-view="matte"]');
    await page.waitForTimeout(900);
    await page.locator('#gsCard').scrollIntoViewIfNeeded();
    step += 1;
    await page.locator('#gsCard').screenshot({ path: path.join(shotsDir, `${String(step).padStart(2, '0')}-operator-greenscreen-tuner.jpg`), type: 'jpeg', quality: 82 });
    console.log(`  screenshot docs/screens/${String(step).padStart(2, '0')}-operator-greenscreen-tuner.jpg`);

    await page.click('#gsCalibrate');
    await page.waitForFunction(() => /standing in front|not green/i.test(document.querySelector('#gsMsg').textContent), null, { timeout: 15000 });
    await page.click('.seg-btn[data-view="composite"]');
    await page.locator('#gs-sensitivity').fill('80');
    assert.equal(await page.textContent('#gs-sensitivity-out'), '80');
    await page.click('#gsSave');
    await page.waitForFunction(() => /Saved/.test(document.querySelector('#gsMsg').textContent));
    assert.equal(booth3.settings.key.sensitivity, 80, 'the slider value was saved on the booth');
    await page.click('#gsToggle');
    assert.equal(await page.textContent('#gsToggle'), 'Start live tuner');
    await page.click('#gsTestPhoto');
    await page.waitForSelector('#gsPhotoImg:not([hidden])', { timeout: 20000 });
    assert.ok((await greenShareOf(await imageOf('#gsPhotoImg'))) < 0.005, 'the test photo is shown with its background replaced');
  } finally {
    server3.closeAllConnections();
    server3.close();
    fs.rmSync(work3, { recursive: true, force: true });
  }

  // ------------------------------------------------------------------ attendant station scenario
  log('station: a second screen shows the booth live, approves prints, shares and runs the live wall');
  const work4 = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-e2e-station-'));
  const lanPort4 = await freePort();
  const smtp4 = await startFakeSmtp();
  const STATION_PIN = 'station-pin-9';
  const config4 = validateConfig(
    deepMerge(DEFAULTS, {
      storage: { dir: path.join(work4, 'events') },
      event: { name: 'Sarah & James Wedding' },
      ui: { countdownSeconds: 1, shotPreviewSeconds: 1, reviewSeconds: 60, doneSeconds: 60, errorSeconds: 60 },
      camera: { mock: { captureDelayMs: 100 } },
      printer: { dryRunDelayMs: 1500, estimatedSeconds: 2 },
      sharing: { enabled: true, mode: 'local', publicBaseUrl: `http://127.0.0.1:${lanPort4}` },
      email: { enabled: true, from: 'Nexus Booth <booth@test.local>', smtp: smtp4.smtp() },
      station: { enabled: true, pin: STATION_PIN, approval: { enabled: true, timeoutSeconds: 90 } },
    }),
  );
  const booth4 = await createBooth(config4, { logger: createLogger({ quiet: true }), settingsFile: path.join(work4, 'runtime-settings.json') });
  const server4 = await new Promise((resolve) => { const s = booth4.app.listen(0, '127.0.0.1', () => resolve(s)); });
  const lanServer4 = await new Promise((resolve) => { const s = booth4.lanApp.listen(lanPort4, '127.0.0.1', () => resolve(s)); });
  const base4 = `http://127.0.0.1:${server4.address().port}`;
  const stationBase = `http://127.0.0.1:${lanPort4}/station/`;
  const stationCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  try {
    const tablet = await stationCtx.newPage();
    tablet.on('pageerror', (err) => problems.push(`page error (station): ${err.message}`));
    tablet.on('console', (msg) => {
      if (msg.type() === 'error' && !EXPECTED.test(msg.text())) problems.push(`console error (station): ${msg.text()}`);
    });

    // 1. sign in
    await tablet.goto(stationBase);
    await tablet.waitForSelector('#login:not([hidden])');
    await tablet.fill('#pin', 'wrong-pin-1');
    await tablet.click('#loginForm button[type=submit]');
    await tablet.waitForSelector('#loginError:not([hidden])');
    assert.match(await tablet.textContent('#loginError'), /Wrong PIN/);
    await snapPage(tablet, 'station-login', 150);
    await tablet.fill('#pin', STATION_PIN);
    await tablet.click('#loginForm button[type=submit]');
    await tablet.waitForSelector('#app:not([hidden])');
    await tablet.waitForFunction(() => document.querySelector('#conn').textContent === 'Live');
    assert.equal(await tablet.textContent('#eventName'), 'Sarah & James Wedding');
    assert.match(await tablet.textContent('#approvalInfo'), /Prints wait for your approval/);
    await tablet.waitForFunction(() => document.querySelectorAll('#health .pill').length >= 2);

    // 2. a guest takes photos on the kiosk and asks to print
    await page.goto(base4);
    await page.waitForSelector('body[data-ready="true"]');
    await page.click('#startBtn');
    await onScreen('review', 60000);
    await tablet.waitForSelector('.session');
    await page.click('#printBtn');
    await onScreen('printing');
    await page.waitForFunction(() => document.querySelector('#printTitle').textContent === 'One moment…');
    assert.match(await page.textContent('#printMsg'), /attendant is checking/);
    await snap('station-kiosk-waiting', 400);
    assert.equal(booth4.queue.list().length, 0, 'nothing has been printed yet');

    // 3. the attendant sees the finished picture, picks 2 copies and approves
    await tablet.waitForSelector('.approval');
    await tablet.waitForFunction(() => document.querySelector('.approval img'));
    assert.ok(await tablet.evaluate(() => document.querySelector('.approval img').complete));
    assert.match(await tablet.textContent('.approval .wait'), /Guest waiting/);
    await tablet.click('.approval .stepper button[aria-label="More copies"]');
    assert.equal(await tablet.textContent('.approval output'), '2×');
    await snapPage(tablet, 'station-approval', 400);
    await tablet.click('.approval .btn.ok');
    await tablet.waitForSelector('.approval', { state: 'detached' });
    await onScreen('done', 30000);
    assert.equal(booth4.queue.list().length, 1);
    assert.equal(booth4.queue.list()[0].copies, 2, 'printed with the copies the attendant chose');
    await page.click('#doneBtn');
    await onScreen('attract');

    // 4. a second guest is not approved
    await page.click('#startBtn');
    await onScreen('review', 60000);
    await page.click('#printBtn');
    await tablet.waitForSelector('.approval');
    await tablet.click('.approval .btn.bad');
    await onScreen('done', 30000);
    assert.match(await page.textContent('#doneMsg'), /attendant did not print these/);
    assert.equal(booth4.queue.list().length, 1, 'no second print');
    await snap('station-kiosk-not-approved', 400);
    await page.click('#doneBtn');
    await onScreen('attract');

    // 5. live list with print states, then share a session from the station
    await tablet.waitForFunction(() => document.querySelectorAll('.session').length === 2);
    await tablet.waitForFunction(() => [...document.querySelectorAll('.session .pill')].some((p) => /Sent to the printer/.test(p.textContent)) && [...document.querySelectorAll('.session .pill')].some((p) => /Not printed/.test(p.textContent)));
    await snapPage(tablet, 'station-live', 300);

    await tablet.locator('.session', { hasText: 'Sent to the printer' }).getByRole('button', { name: 'Share…' }).click();
    await tablet.waitForSelector('#shareOverlay:not([hidden])');
    await tablet.waitForSelector('#shareQr:not([hidden])');
    assert.match(await tablet.textContent('#shareStatus'), /Ready/);
    const shareUrl = await tablet.textContent('#shareUrl');
    assert.match(shareUrl, new RegExp(`^http://127.0.0.1:${lanPort4}/s/`));
    const qrShot = await tablet.locator('#shareQr').screenshot();
    const decoded = await sharp(qrShot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(jsQR(new Uint8ClampedArray(decoded.data), decoded.info.width, decoded.info.height)?.data, shareUrl, 'the QR on the station decodes to the guest\'s gallery link');
    await tablet.fill('#emailTo', 'lena@example.com');
    await tablet.click('#emailSend');
    await tablet.waitForFunction(() => /Queued for l\*\*\*@example\.com/.test(document.querySelector('#emailMsg').textContent));
    await waitForMail(smtp4, 1);
    assert.equal(smtp4.state.messages[0].to.value[0].address, 'lena@example.com');
    assert.ok(smtp4.state.messages[0].text.includes(shareUrl), 'the email links to the same gallery as the QR');
    await snapPage(tablet, 'station-share', 300);
    await tablet.click('#shareClose');

    // 6. the live wall
    await tablet.click('#wallBtn');
    await tablet.waitForSelector('#wall:not([hidden])');
    await tablet.waitForFunction(() => document.querySelector('#wallImg').naturalWidth > 0);
    assert.equal(await tablet.textContent('#wallCaption'), 'Sarah & James Wedding');
    await snapPage(tablet, 'station-wall', 300);
    await tablet.keyboard.press('Escape');
    await tablet.waitForSelector('#wall', { state: 'hidden' });

    // 7. the station is told when it is signed out
    await tablet.click('#logoutBtn');
    await tablet.waitForSelector('#login:not([hidden])');
    assert.equal((await fetch(`${stationBase}api/me`)).status, 401);
  } finally {
    await stationCtx.close();
    booth4.emailQueue?.stop();
    booth4.approvals?.stop();
    booth4.hub?.closeAll();
    lanServer4.closeAllConnections();
    lanServer4.close();
    server4.closeAllConnections();
    server4.close();
    await smtp4.close();
    fs.rmSync(work4, { recursive: true, force: true });
  }

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
