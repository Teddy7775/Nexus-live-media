import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigError, DEFAULTS, configWarnings, deepMerge, loadConfig, validateConfig } from '../server/config.js';

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
