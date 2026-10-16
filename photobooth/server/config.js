import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateKey } from './greenscreen.js';

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
    // scene: "portrait" = a coloured picture with a silhouette; "greenscreen" = a person in front of a green backdrop.
    mock: { captureDelayMs: 400, failEveryNth: 0, scene: 'portrait' },
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
  // A short animation recorded from the camera's live view right after the photos.
  gif: {
    enabled: false,
    frames: 8,
    intervalMs: 250, // time between frames (4 per second)
    width: 640,
    countdownSeconds: 2,
    boomerang: true, // play forwards then backwards
  },
  // Replace a green backdrop with a picture the guest chooses (needs a green sheet/wall, even lighting and a Canon with live view).
  greenScreen: {
    enabled: false,
    // Your own backgrounds: put .jpg/.png files (at least 400 px wide, ideally 3000 px) in this folder.
    dir: 'backgrounds',
    builtinBackgrounds: true,
    // "guest" = each guest picks their own background. Or a background's id (e.g. "builtin-night"): everyone gets that one.
    defaultBackdrop: 'guest',
    // The guest picking a background is sent back to the start screen after this many seconds without a tap.
    pickSeconds: 60,
    // Width of the live keyed preview in pixels (lower = smoother on a slow PC).
    previewWidth: 640,
    // How the green is judged. Easiest to set from the operator panel (Green screen card), which also saves them.
    key: { sensitivity: 50, softness: 30, despill: 1, edgeBlur: 0.8 },
  },
  // A second screen (an attendant's PC or tablet on the same network) that shows sessions live and can approve prints
  // before they are sent to the printer. Opens at http://<this PC's address>:<lan.port>/station/ and needs the PIN below.
  station: {
    enabled: false,
    pin: '', // at least 6 characters: it protects the booth on your network. Better set via BOOTH_STATION_PIN
    approval: {
      // Every print waits for an attendant at the station to say yes (can also be switched on and off in the operator panel).
      enabled: false,
      // How long a guest waits for an answer. If nobody answers (or no station is connected) it is settled by onTimeout:
      // "cancel" = not printed (the photos are still saved and shared), "print" = printed anyway.
      timeoutSeconds: 120,
      onTimeout: 'cancel',
      maxCopies: 4,
    },
    recentSessions: 30, // how many recent sessions the station shows
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

  const gf = cfg.gif ?? {};
  need(typeof gf.enabled === 'boolean', 'gif.enabled must be true or false');
  need(Number.isInteger(gf.frames) && gf.frames >= 3 && gf.frames <= 16, 'gif.frames must be an integer from 3 to 16');
  need(Number.isInteger(gf.intervalMs) && gf.intervalMs >= 100 && gf.intervalMs <= 1000, 'gif.intervalMs must be an integer from 100 to 1000');
  need(Number.isInteger(gf.width) && gf.width >= 240 && gf.width <= 1280, 'gif.width must be an integer from 240 to 1280');
  need(Number.isInteger(gf.countdownSeconds) && gf.countdownSeconds >= 0 && gf.countdownSeconds <= 5, 'gif.countdownSeconds must be an integer from 0 to 5');
  if (gf.enabled && cfg.camera?.driver === 'digicamcontrol') {
    need(cfg.camera.digicamcontrol?.liveView === true, 'gif.enabled needs live view: set camera.digicamcontrol.liveView to true');
  }

  need(['portrait', 'greenscreen'].includes(cfg.camera?.mock?.scene), 'camera.mock.scene must be "portrait" or "greenscreen"');
  const gs = cfg.greenScreen ?? {};
  need(typeof gs.enabled === 'boolean', 'greenScreen.enabled must be true or false');
  need(typeof gs.dir === 'string' && gs.dir.length > 0, 'greenScreen.dir must be a folder path');
  need(typeof gs.builtinBackgrounds === 'boolean', 'greenScreen.builtinBackgrounds must be true or false');
  need(typeof gs.defaultBackdrop === 'string' && gs.defaultBackdrop.length > 0, 'greenScreen.defaultBackdrop must be "guest" or a background id');
  need(posNum(gs.pickSeconds) && gs.pickSeconds >= 5, 'greenScreen.pickSeconds must be a number >= 5');
  need(Number.isInteger(gs.previewWidth) && gs.previewWidth >= 240 && gs.previewWidth <= 1280, 'greenScreen.previewWidth must be an integer from 240 to 1280');
  for (const problem of validateKey(gs.key)) problems.push(`greenScreen.key: ${problem}`);

  const st = cfg.station ?? {};
  need(typeof st.enabled === 'boolean', 'station.enabled must be true or false');
  if (st.enabled) {
    need(typeof st.pin === 'string' && st.pin.length >= 6, 'station.pin must be at least 6 characters (it protects the booth on your network; or set BOOTH_STATION_PIN)');
  }
  const ap = st.approval ?? {};
  need(typeof ap.enabled === 'boolean', 'station.approval.enabled must be true or false');
  if (ap.enabled) need(st.enabled === true, 'station.approval.enabled needs station.enabled (an attendant has to be able to approve)');
  need(typeof ap.timeoutSeconds === 'number' && Number.isFinite(ap.timeoutSeconds) && ap.timeoutSeconds >= 1 && ap.timeoutSeconds <= 3600, 'station.approval.timeoutSeconds must be a number from 1 to 3600');
  need(['cancel', 'print'].includes(ap.onTimeout), 'station.approval.onTimeout must be "cancel" or "print"');
  need(Number.isInteger(ap.maxCopies) && ap.maxCopies >= 1 && ap.maxCopies <= 10, 'station.approval.maxCopies must be an integer from 1 to 10');
  need(Number.isInteger(st.recentSessions) && st.recentSessions >= 5 && st.recentSessions <= 200, 'station.recentSessions must be an integer from 5 to 200');

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
  if (cfg.greenScreen.enabled && cfg.camera.driver === 'mock' && cfg.camera.mock.scene !== 'greenscreen') {
    warnings.push('greenScreen is on but the mock camera scene is "portrait" (no green backdrop to remove): set camera.mock.scene to "greenscreen" to rehearse');
  }
  if (cfg.greenScreen.enabled && cfg.camera.driver === 'digicamcontrol' && !cfg.camera.digicamcontrol.liveView) {
    warnings.push('greenScreen is on but camera.digicamcontrol.liveView is off: guests will not see themselves on the new background before the photo');
  }
  if (cfg.station.enabled) {
    warnings.push(`the station is on: anyone on this network who knows the station PIN can open http://<this PC>:${cfg.lan.port}/station/ (plain http: use a private network, not a public Wi-Fi)`);
    if (cfg.station.pin === cfg.operatorPin) warnings.push('station.pin is the same as operatorPin: use a different PIN, the station is reachable from the network');
    if (cfg.station.pin && !process.env.BOOTH_STATION_PIN) warnings.push('the station PIN is stored in config.json; consider the BOOTH_STATION_PIN environment variable instead');
    if (cfg.lan.host === '127.0.0.1' || cfg.lan.host === 'localhost') warnings.push('lan.host is localhost, so no other device can reach the station: use "0.0.0.0"');
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
  if (copy.station?.pin) copy.station.pin = '***';
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
  if (env.BOOTH_STATION_PIN) fromEnv.station = { pin: env.BOOTH_STATION_PIN };
  const merged = validateConfig(deepMerge(deepMerge(DEFAULTS, user), fromEnv));
  const storageDir = path.resolve(rootDir, merged.storage.dir);
  const backgroundsDir = path.resolve(rootDir, merged.greenScreen.dir);
  return { ...merged, storage: { ...merged.storage, dir: storageDir }, greenScreen: { ...merged.greenScreen, dir: backgroundsDir }, _meta: { configPath, rootDir, usedFile: fs.existsSync(configPath) } };
}
