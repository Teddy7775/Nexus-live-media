import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigError, DEFAULTS, configWarnings, deepMerge, loadConfig, redactedConfig, validateConfig } from '../server/config.js';

const make = (override) => deepMerge(DEFAULTS, override);
const problemsOf = (override) => {
  try {
    validateConfig(make(override));
    return [];
  } catch (err) {
    assert.ok(err instanceof ConfigError, `expected ConfigError, got ${err}`);
    return err.problems;
  }
};

test('defaults are valid', () => {
  assert.doesNotThrow(() => validateConfig(make({})));
});

test('deepMerge overrides nested keys without dropping their siblings', () => {
  const merged = make({ ui: { countdownSeconds: 5 } });
  assert.equal(merged.ui.countdownSeconds, 5);
  assert.equal(merged.ui.reviewSeconds, DEFAULTS.ui.reviewSeconds);
});

test('rejects obviously wrong values with a message that names the setting', () => {
  assert.match(problemsOf({ port: 99999 }).join('|'), /port/);
  assert.match(problemsOf({ camera: { driver: 'canon-magic' } }).join('|'), /camera\.driver/);
  assert.match(problemsOf({ operatorPin: '12' }).join('|'), /operatorPin/);
  assert.match(problemsOf({ ui: { countdownSeconds: 0 } }).join('|'), /countdownSeconds/);
  assert.match(problemsOf({ printer: { copies: 0 } }).join('|'), /copies/);
  assert.match(problemsOf({ printer: { scale: 'stretch' } }).join('|'), /scale/);
  assert.match(problemsOf({ event: { slug: '../etc' } }).join('|'), /slug/);
});

test('windows printing refuses to start without a printer name (so it can never print to the office printer)', () => {
  assert.match(problemsOf({ printer: { mode: 'windows', name: '' } }).join('|'), /printer\.name/);
  assert.deepEqual(problemsOf({ printer: { mode: 'windows', name: 'DNP DS620' } }), []);
});

test('reports every problem at once, not just the first', () => {
  const problems = problemsOf({ port: 0, operatorPin: 'x', camera: { driver: 'nope' } });
  assert.ok(problems.length >= 3, `got: ${problems.join(' | ')}`);
});

test('digicamcontrol baseUrl must not have a trailing slash or path', () => {
  assert.match(problemsOf({ camera: { driver: 'digicamcontrol', digicamcontrol: { baseUrl: 'http://127.0.0.1:5513/' } } }).join('|'), /baseUrl/);
  assert.deepEqual(problemsOf({ camera: { driver: 'digicamcontrol' } }), []);
});

test('warnings flag the default PIN, mock camera, dry-run printing and network exposure', () => {
  const warnings = configWarnings(make({ host: '0.0.0.0' })).join('|');
  assert.match(warnings, /operatorPin/);
  assert.match(warnings, /mock/);
  assert.match(warnings, /dryrun/);
  assert.match(warnings, /other devices/);
});

test('a copied placeholder PIN is flagged just like the default', () => {
  assert.match(configWarnings(make({ operatorPin: 'CHANGE-ME-TO-SOMETHING' })).join('|'), /operatorPin/);
  assert.doesNotMatch(configWarnings(make({ operatorPin: 's3cret-9x' })).join('|'), /operatorPin/);
});

test('warns about storage paths digiCamControl may mishandle', () => {
  const warnings = configWarnings(make({ camera: { driver: 'digicamcontrol' }, storage: { dir: 'C:\\My Photos\\events' } })).join('|');
  assert.match(warnings, /spaces/);
});

test('loadConfig reads a file, merges it over the defaults and resolves the storage folder against the project root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
  try {
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ port: 4000, event: { name: 'Gala' } }));
    const cfg = loadConfig({ rootDir: root });
    assert.equal(cfg.port, 4000);
    assert.equal(cfg.event.name, 'Gala');
    assert.equal(cfg.event.slug, 'default');
    assert.equal(cfg.storage.dir, path.join(root, 'events'));
    assert.equal(cfg._meta.usedFile, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadConfig with no file falls back to defaults', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
  try {
    const cfg = loadConfig({ rootDir: root });
    assert.equal(cfg._meta.usedFile, false);
    assert.equal(cfg.port, DEFAULTS.port);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadConfig explains a JSON typo instead of crashing with a stack trace', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
  try {
    fs.writeFileSync(path.join(root, 'config.json'), '{ "port": 3000, }');
    assert.throws(() => loadConfig({ rootDir: root }), (err) => err instanceof ConfigError && /not valid JSON/.test(err.message));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('green screen settings are validated, with messages that name the setting', () => {
  assert.doesNotThrow(() => validateConfig(make({ greenScreen: { enabled: true, key: { sensitivity: 70 } } })));
  const bad = problemsOf({ greenScreen: { enabled: true, pickSeconds: 1, previewWidth: 50, defaultBackdrop: '', key: { sensitivity: 500, softness: 0, despill: 3, edgeBlur: 'a lot' } } }).join('|');
  assert.match(bad, /greenScreen\.pickSeconds/);
  assert.match(bad, /greenScreen\.previewWidth/);
  assert.match(bad, /greenScreen\.defaultBackdrop/);
  assert.match(bad, /greenScreen\.key: sensitivity must be a number from 1 to 100/);
  assert.match(bad, /greenScreen\.key: softness/);
  assert.match(bad, /greenScreen\.key: despill/);
  assert.match(bad, /greenScreen\.key: edgeBlur/);
  assert.match(problemsOf({ camera: { mock: { scene: 'sunset' } } }).join('|'), /camera\.mock\.scene must be "portrait" or "greenscreen"/);
});

test('green screen: the backgrounds folder is resolved against the app folder, and rehearsal hints appear only when they matter', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
  try {
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ greenScreen: { enabled: true, dir: 'my-backdrops' } }));
    const cfg = loadConfig({ rootDir: root });
    assert.equal(cfg.greenScreen.dir, path.join(root, 'my-backdrops'));
    assert.match(configWarnings(cfg).join('|'), /mock camera scene is "portrait".*"greenscreen" to rehearse/);

    const rehearsal = make({ greenScreen: { enabled: true }, camera: { mock: { scene: 'greenscreen' } } });
    assert.doesNotMatch(configWarnings(rehearsal).join('|'), /greenScreen/);
    assert.doesNotMatch(configWarnings(make({})).join('|'), /greenScreen/, 'nothing is said when green screen is off');

    const noLive = make({ greenScreen: { enabled: true }, camera: { driver: 'digicamcontrol', digicamcontrol: { liveView: false } } });
    assert.match(configWarnings(noLive).join('|'), /liveView is off/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('station settings are validated; the PIN protects the booth on the network, so it must be real', () => {
  assert.doesNotThrow(() => validateConfig(make({ station: { enabled: true, pin: 'a-good-pin', approval: { enabled: true } } })));
  assert.doesNotThrow(() => validateConfig(make({ station: { enabled: false } })), 'off needs no PIN');
  const noPin = problemsOf({ station: { enabled: true, pin: '' } }).join('|');
  assert.match(noPin, /station\.pin must be at least 6 characters/);
  assert.match(problemsOf({ station: { enabled: true, pin: '12345' } }).join('|'), /station\.pin/);
  assert.match(problemsOf({ station: { enabled: false, approval: { enabled: true } } }).join('|'), /station\.approval\.enabled needs station\.enabled/);
  const bad = problemsOf({ station: { enabled: true, pin: 'a-good-pin', recentSessions: 1, approval: { timeoutSeconds: 0, onTimeout: 'shrug', maxCopies: 11 } } }).join('|');
  assert.match(bad, /station\.approval\.timeoutSeconds/);
  assert.match(bad, /station\.approval\.onTimeout must be "cancel" or "print"/);
  assert.match(bad, /station\.approval\.maxCopies/);
  assert.match(bad, /station\.recentSessions/);
});

test('station: warnings about reachability and PIN hygiene, the PIN from the environment, and redaction', () => {
  const on = make({ station: { enabled: true, pin: 'same-secret' }, operatorPin: 'same-secret' });
  const warnings = configWarnings(on).join('|');
  assert.match(warnings, /anyone on this network who knows the station PIN/);
  assert.match(warnings, /station\.pin is the same as operatorPin/);
  assert.doesNotMatch(configWarnings(make({})).join('|'), /station/, 'nothing is said when the station is off');
  assert.match(configWarnings(make({ station: { enabled: true, pin: 'another-pin' }, lan: { host: '127.0.0.1' } })).join('|'), /lan\.host is localhost, so no other device can reach the station/);

  assert.equal(redactedConfig(on).station.pin, '***');
  assert.equal(on.station.pin, 'same-secret', 'redaction works on a copy');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
  const before = process.env.BOOTH_STATION_PIN;
  try {
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ station: { enabled: true } }));
    assert.throws(() => loadConfig({ rootDir: root }), /station\.pin/);
    process.env.BOOTH_STATION_PIN = 'pin-from-environment';
    assert.equal(loadConfig({ rootDir: root }).station.pin, 'pin-from-environment');
    assert.doesNotMatch(configWarnings(loadConfig({ rootDir: root })).join('|'), /station PIN is stored in config\.json/);
  } finally {
    if (before === undefined) delete process.env.BOOTH_STATION_PIN;
    else process.env.BOOTH_STATION_PIN = before;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const stripeCfg = (extra = {}) => ({ payments: { enabled: true, mode: 'print', stripe: { secretKey: 'sk_test_abcdefgh12345678', returnUrl: 'https://example.com/booth/paid.html' }, ...extra } });

test('payments: off needs nothing; on needs a real Stripe key and an https return page (or no Stripe at all)', () => {
  assert.doesNotThrow(() => validateConfig(make({})));
  assert.doesNotThrow(() => validateConfig(make(stripeCfg())));
  assert.doesNotThrow(() => validateConfig(make(stripeCfg({ stripe: { secretKey: 'rk_live_abcdefgh12345678', returnUrl: 'https://example.com/p' } }))), 'a restricted key is what we recommend');
  assert.doesNotThrow(() => validateConfig(make({ payments: { enabled: true, mode: 'session', provider: 'attendant' } })), 'attendant mode needs no key');
  const noKey = problemsOf({ payments: { enabled: true } }).join('|');
  assert.match(noKey, /payments\.stripe\.secretKey must be a Stripe secret or restricted key.*BOOTH_STRIPE_KEY/);
  assert.match(noKey, /payments\.stripe\.returnUrl must be an https/);
  for (const key of ['pk_test_abcdefgh12345678', 'sk_test_short', 'whsec_abcdefgh12345678', '  sk_test_abcdefgh12345678']) {
    assert.match(problemsOf(stripeCfg({ stripe: { secretKey: key, returnUrl: 'https://example.com/p' } })).join('|'), /secretKey/, key);
  }
  assert.match(problemsOf(stripeCfg({ stripe: { secretKey: 'sk_test_abcdefgh12345678', returnUrl: 'http://example.com/p' } })).join('|'), /returnUrl/);
});

test('payments: prices, mode, currency and timeouts are checked', () => {
  const bad = problemsOf({ payments: { enabled: false, mode: 'sometimes', provider: 'paypal', currency: 'eur', pricePerPrintCents: 49, pricePerSessionCents: 5.5, timeoutSeconds: 2, offline: 'shrug' } }).join('|');
  assert.match(bad, /payments\.mode must be "off", "print" or "session"/);
  assert.match(bad, /payments\.provider must be "stripe" or "attendant"/);
  assert.match(bad, /payments\.currency must be "usd"/);
  assert.match(bad, /payments\.pricePerPrintCents must be a whole number of cents from 50/);
  assert.match(bad, /payments\.pricePerSessionCents/);
  assert.match(bad, /payments\.timeoutSeconds/);
  assert.match(bad, /payments\.offline must be "attendant" or "free"/);
  assert.match(problemsOf({ payments: { enabled: false, mode: 'print' } }).join('|'), /payments\.mode needs payments\.enabled/);
  assert.match(problemsOf({ payments: { pricePerPrintCents: 100001 } }).join('|'), /pricePerPrintCents/);
});

test('payments: the Stripe key comes from the environment, is never shown, and the warnings are the ones that protect your money', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-test-'));
  const before = process.env.BOOTH_STRIPE_KEY;
  try {
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ payments: { enabled: true, mode: 'print', stripe: { returnUrl: 'https://example.com/p' } } }));
    delete process.env.BOOTH_STRIPE_KEY;
    assert.throws(() => loadConfig({ rootDir: root }), /payments\.stripe\.secretKey/);
    process.env.BOOTH_STRIPE_KEY = 'sk_live_fromtheenvironment1';
    const cfg = loadConfig({ rootDir: root });
    assert.equal(cfg.payments.stripe.secretKey, 'sk_live_fromtheenvironment1');
    assert.doesNotMatch(JSON.stringify(redactedConfig(cfg)), /fromtheenvironment1/);
    assert.equal(redactedConfig(cfg).payments.stripe.secretKey, '***');
    assert.match(configWarnings(cfg).join('|'), /LIVE Stripe key is set while the camera is "mock" or printing is "dryrun": guests would really be charged/);
    assert.doesNotMatch(configWarnings(cfg).join('|'), /stored in config\.json/, 'a key from the environment is the safe way');
  } finally {
    if (before === undefined) delete process.env.BOOTH_STRIPE_KEY;
    else process.env.BOOTH_STRIPE_KEY = before;
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.match(configWarnings(make(stripeCfg())).join('|'), /Stripe is in TEST mode/);
  assert.match(configWarnings(make(stripeCfg())).join('|'), /Stripe key is stored in config\.json/);
  assert.match(configWarnings(make(stripeCfg({ offline: 'free' }))).join('|'), /payments\.offline is "free"/);
  assert.match(configWarnings(make({ payments: { enabled: true, mode: 'print', provider: 'attendant' } })).join('|'), /"attendant" without the station/);
  assert.doesNotMatch(configWarnings(make({})).join('|'), /payments|Stripe/, 'nothing is said when payments are off');
});
