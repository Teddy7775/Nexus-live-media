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
  // A small network listener for things phones and a second station must reach. The booth's own API above stays
  // on localhost; only the gallery (and later the station) is exposed here. Only started when something needs it.
  lan: {
    host: '0.0.0.0',
    port: 3001,
  },
  sharing: {
    enabled: false,
    // "local": this PC serves each guest's gallery (guests must be on the same network, no internet needed).
    // "upload": photos are pushed to your own web host (works from anywhere, needs internet at the venue).
    mode: 'local',
    // Address guests' phones use. Upload mode: your site, e.g. https://example.com/booth (no trailing slash).
    // Local mode: leave empty to use this PC's network address, e.g. http://192.168.1.50:3001.
    publicBaseUrl: '',
    // Upload every finished session right away (needed for the QR code printed on the photos to work).
    autoUpload: true,
    // Print a QR code on layouts that have room for one.
    qrOnPrint: true,
    // How long the share screen stays up when the guest is not printing.
    shareSeconds: 45,
    brandName: '',
    // Local mode only: shown under the QR code, e.g. "Join the Wi-Fi network NexusGuests first".
    wifiHint: '',
    upload: {
      url: '', // e.g. https://example.com/booth/upload.php
      secret: '', // same value as in the web host's config.php. Better set via BOOTH_UPLOAD_SECRET.
      timeoutMs: 30000,
      maxAgeHours: 72, // give up on a session that cannot be uploaded for this long
    },
  },
  email: {
    enabled: false,
    from: '', // e.g. Nexus Booth <booth@example.com> - must be the mailbox you log in with
    smtp: { host: '', port: 465, secure: true, user: '', pass: '' }, // pass: better set via BOOTH_SMTP_PASS
    subject: 'Your photos from {event}',
    intro: 'Thanks for celebrating with us! Your photos are ready:',
    // Adds a tick-box on the email screen. Addresses are only kept when the guest ticks it.
    marketingOptIn: { enabled: false, label: 'Keep me posted about future events' },
    maxPerSession: 3,
    maxPerAddressPerHour: 3,
    maxAgeHours: 24, // give up on an email that cannot be sent for this long
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
const BASE_URL = /^https?:\/\/[^\s/]+(\/[^\s]*[^\s/])?$/;
const UPLOAD_URL = /^(https:\/\/[^\s/]+\S*|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\S*)$/;

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

  need(Number.isInteger(cfg.lan?.port) && cfg.lan.port >= 1 && cfg.lan.port <= 65535 && cfg.lan.port !== cfg.port, 'lan.port must be an integer from 1 to 65535 and different from port');
  need(typeof cfg.lan?.host === 'string' && cfg.lan.host.length > 0, 'lan.host must be a non-empty string');

  const sh = cfg.sharing ?? {};
  need(typeof sh.enabled === 'boolean', 'sharing.enabled must be true or false');
  need(['local', 'upload'].includes(sh.mode), 'sharing.mode must be "local" or "upload"');
  need(typeof sh.publicBaseUrl === 'string' && (sh.publicBaseUrl === '' || BASE_URL.test(sh.publicBaseUrl)), 'sharing.publicBaseUrl must look like https://example.com/booth (no trailing slash)');
  need(posNum(sh.shareSeconds) && sh.shareSeconds >= 5, 'sharing.shareSeconds must be a number >= 5');
  if (sh.enabled && sh.mode === 'upload') {
    const u = sh.upload ?? {};
    need(typeof u.url === 'string' && UPLOAD_URL.test(u.url), 'sharing.upload.url must be an https:// address (e.g. https://example.com/booth/upload.php)');
    need(typeof u.secret === 'string' && u.secret.length >= 16, 'sharing.upload.secret must be at least 16 characters (or set BOOTH_UPLOAD_SECRET)');
    need(typeof sh.publicBaseUrl === 'string' && /^https:\/\//.test(sh.publicBaseUrl), 'sharing.publicBaseUrl is required in upload mode and must start with https://');
    need(posNum(u.timeoutMs) && u.timeoutMs > 0, 'sharing.upload.timeoutMs must be a positive number');
  }

  const em = cfg.email ?? {};
  need(typeof em.enabled === 'boolean', 'email.enabled must be true or false');
  if (em.enabled) {
    need(sh.enabled === true, 'email.enabled needs sharing.enabled (the email contains the link to the photos)');
    need(typeof em.smtp?.host === 'string' && em.smtp.host.length > 0, 'email.smtp.host is required (e.g. smtp.hostinger.com)');
    need(Number.isInteger(em.smtp?.port) && em.smtp.port >= 1 && em.smtp.port <= 65535, 'email.smtp.port must be an integer from 1 to 65535');
    need(typeof em.smtp?.user === 'string' && em.smtp.user.length > 0, 'email.smtp.user is required');
    need(typeof em.smtp?.pass === 'string' && em.smtp.pass.length > 0, 'email.smtp.pass is required (or set BOOTH_SMTP_PASS)');
    need(typeof em.from === 'string' && /@/.test(em.from), 'email.from must contain an email address, e.g. Nexus Booth <booth@example.com>');
  }
  need(typeof em.subject === 'string' && em.subject.length > 0, 'email.subject must be a non-empty string');
  need(Number.isInteger(em.maxPerSession) && em.maxPerSession >= 1 && em.maxPerSession <= 20, 'email.maxPerSession must be an integer from 1 to 20');
  need(Number.isInteger(em.maxPerAddressPerHour) && em.maxPerAddressPerHour >= 1 && em.maxPerAddressPerHour <= 50, 'email.maxPerAddressPerHour must be an integer from 1 to 50');

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
  if (cfg.sharing.enabled && cfg.sharing.mode === 'local') {
    warnings.push(`sharing.mode is "local": guests can only open their link while their phone is on the same network as this PC (listening on port ${cfg.lan.port}; Windows may ask to allow it)`);
  }
  if (cfg.sharing.enabled && cfg.sharing.mode === 'upload' && cfg.sharing.upload.secret && !process.env.BOOTH_UPLOAD_SECRET) {
    warnings.push('the upload secret is stored in config.json; consider the BOOTH_UPLOAD_SECRET environment variable instead');
  }
  if (cfg.email.enabled && cfg.email.smtp.pass && !process.env.BOOTH_SMTP_PASS) {
    warnings.push('the SMTP password is stored in config.json; consider the BOOTH_SMTP_PASS environment variable instead');
  }
  return warnings;
}

/** The configuration with every secret hidden - safe to show in the operator panel or write to a log. */
export function redactedConfig(cfg) {
  const copy = JSON.parse(JSON.stringify(cfg));
  copy.operatorPin = '***';
  if (copy.sharing?.upload?.secret) copy.sharing.upload.secret = '***';
  if (copy.email?.smtp?.pass) copy.email.smtp.pass = '***';
  return copy;
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
  const env = process.env;
  const fromEnv = {};
  if (env.BOOTH_OPERATOR_PIN) fromEnv.operatorPin = env.BOOTH_OPERATOR_PIN;
  if (env.BOOTH_UPLOAD_SECRET) fromEnv.sharing = { upload: { secret: env.BOOTH_UPLOAD_SECRET } };
  if (env.BOOTH_SMTP_PASS) fromEnv.email = { smtp: { pass: env.BOOTH_SMTP_PASS } };
  const merged = validateConfig(deepMerge(deepMerge(DEFAULTS, user), fromEnv));
  const storageDir = path.resolve(rootDir, merged.storage.dir);
  return { ...merged, storage: { ...merged.storage, dir: storageDir }, _meta: { configPath, rootDir, usedFile: fs.existsSync(configPath) } };
}
