import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULTS = Object.freeze({
  // Bound to localhost so only this PC can reach the booth. Use "0.0.0.0" only if you
  // want to run the operator panel from a phone on the same network (and change the PIN).
  host: '127.0.0.1',
  port: 3000,
  operatorPin: '1234',
  event: {
    name: 'Nexus Photo Booth',
    // Used as the folder name under storage.dir. Letters, digits, dash and underscore only.
    slug: 'default',
  },
  activeTemplate: 'strip-2x6-x2',
  ui: {
    countdownSeconds: 3,
    shotPreviewSeconds: 2,
    reviewSeconds: 15,
    doneSeconds: 6,
    errorSeconds: 20,
    allowRetake: true,
    mirrorPreview: true,
    flash: true,
  },
  camera: {
    // "mock" generates test photos (no hardware needed). "digicamcontrol" drives a real DSLR.
    driver: 'mock',
    // Only used by the mock driver. failEveryNth: 3 makes every 3rd photo fail, to rehearse the error screen.
    mock: { captureDelayMs: 400, failEveryNth: 0 },
    digicamcontrol: {
      baseUrl: 'http://127.0.0.1:5513',
      captureTimeoutMs: 45000,
      requestTimeoutMs: 8000,
      // How long to wait for the photo file to appear on disk after the camera says "done".
      fileWaitMs: 15000,
      liveView: true,
      // Most DSLRs cannot take a full-resolution photo while live view is running.
      stopLiveViewForCapture: true,
    },
  },
  printer: {
    // "dryrun" only writes the print PDF. "windows" sends it to the printer named below.
    mode: 'dryrun',
    // Exact Windows printer name, e.g. "DNP DS620". Run `npm run printers` to list names.
    name: '',
    // Exact paper size name from the printer driver (e.g. the "2 inch cut" size for strips).
    // Leave empty to use whatever the driver's printing preferences are set to.
    paperSize: '',
    scale: 'fit', // "fit" | "noscale" | "shrink"
    copies: 1,
    enabled: true,
    autoPrint: true,
    estimatedSeconds: 20,
    dryRunDelayMs: 1500,
  },
  storage: {
    dir: 'events',
  },
});

export class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

const SLUG = /^[A-Za-z0-9_-]{1,64}$/;

export function validateConfig(cfg) {
  const problems = [];
  const need = (cond, msg) => {
    if (!cond) problems.push(msg);
  };
  const posNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

  need(Number.isInteger(cfg.port) && cfg.port >= 1 && cfg.port <= 65535, 'port must be an integer from 1 to 65535');
  need(typeof cfg.host === 'string' && cfg.host.length > 0, 'host must be a non-empty string');
  need(typeof cfg.operatorPin === 'string' && cfg.operatorPin.length >= 4, 'operatorPin must be a string of at least 4 characters');
  need(typeof cfg.event?.name === 'string' && cfg.event.name.trim().length > 0, 'event.name must be a non-empty string');
  need(typeof cfg.event?.slug === 'string' && SLUG.test(cfg.event.slug), 'event.slug may only contain letters, digits, dash and underscore');
  need(typeof cfg.activeTemplate === 'string' && cfg.activeTemplate.length > 0, 'activeTemplate must be a template id');

  for (const key of ['countdownSeconds', 'shotPreviewSeconds', 'reviewSeconds', 'doneSeconds', 'errorSeconds']) {
    need(posNum(cfg.ui?.[key]), `ui.${key} must be a number >= 0`);
  }
  need((cfg.ui?.countdownSeconds ?? 0) >= 1, 'ui.countdownSeconds must be at least 1');

  need(['mock', 'digicamcontrol'].includes(cfg.camera?.driver), 'camera.driver must be "mock" or "digicamcontrol"');
  if (cfg.camera?.driver === 'digicamcontrol') {
    const d = cfg.camera.digicamcontrol ?? {};
    need(/^https?:\/\/[^/\s]+$/.test(d.baseUrl ?? ''), 'camera.digicamcontrol.baseUrl must look like http://127.0.0.1:5513 (no trailing slash)');
    for (const key of ['captureTimeoutMs', 'requestTimeoutMs', 'fileWaitMs']) {
      need(posNum(d[key]) && d[key] > 0, `camera.digicamcontrol.${key} must be a positive number`);
    }
  }

  need(['dryrun', 'windows'].includes(cfg.printer?.mode), 'printer.mode must be "dryrun" or "windows"');
  if (cfg.printer?.mode === 'windows') {
    need(typeof cfg.printer.name === 'string' && cfg.printer.name.trim().length > 0, 'printer.name is required when printer.mode is "windows" (run `npm run printers` to list names)');
  }
  need(['fit', 'noscale', 'shrink'].includes(cfg.printer?.scale), 'printer.scale must be "fit", "noscale" or "shrink"');
  need(Number.isInteger(cfg.printer?.copies) && cfg.printer.copies >= 1 && cfg.printer.copies <= 10, 'printer.copies must be an integer from 1 to 10');
  need(typeof cfg.storage?.dir === 'string' && cfg.storage.dir.length > 0, 'storage.dir must be a folder path');

  if (problems.length) throw new ConfigError(problems);
  return cfg;
}

/** Non-fatal things worth telling the operator about at startup. */
export function configWarnings(cfg) {
  const warnings = [];
  if (cfg.operatorPin === DEFAULTS.operatorPin || /change-?me/i.test(cfg.operatorPin)) warnings.push('operatorPin is still the default/placeholder value - change it in config.json');
  if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') warnings.push(`host is ${cfg.host}: the booth and operator panel are reachable from other devices on the network`);
  if (cfg.camera.driver === 'mock') warnings.push('camera.driver is "mock": photos are synthetic test images');
  if (cfg.printer.mode === 'dryrun') warnings.push('printer.mode is "dryrun": nothing will be sent to a printer');
  if (cfg.camera.driver === 'digicamcontrol' && /[\s]|[^\x00-\x7F]/.test(cfg.storage.dir)) {
    warnings.push('storage.dir contains spaces or non-ASCII characters; digiCamControl may mishandle such paths - use a simple path like C:\\booth\\events');
  }
  return warnings;
}

export function loadConfig({ file, rootDir = ROOT_DIR } = {}) {
  const configPath = path.resolve(rootDir, file ?? process.env.BOOTH_CONFIG ?? 'config.json');
  let user = {};
  if (fs.existsSync(configPath)) {
    try {
      user = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new ConfigError([`${configPath} is not valid JSON: ${err.message}`]);
    }
    if (!isPlainObject(user)) throw new ConfigError([`${configPath} must contain a JSON object`]);
  }
  const merged = validateConfig(deepMerge(DEFAULTS, user));
  const storageDir = path.resolve(rootDir, merged.storage.dir);
  return { ...merged, storage: { ...merged.storage, dir: storageDir }, _meta: { configPath, rootDir, usedFile: fs.existsSync(configPath) } };
}
