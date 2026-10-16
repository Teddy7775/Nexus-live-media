import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigError, ROOT_DIR, configWarnings, loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { loadTemplates } from './templates.js';
import { createCamera, LiveViewController } from './camera/index.js';
import { createPrinter } from './print.js';
import { PrintQueue } from './printQueue.js';
import { SessionStore } from './store.js';
import { RuntimeSettings } from './settings.js';
import { createApp } from './app.js';
import { createLanApp } from './lan.js';
import { ShareIndex, computeShareState, lanAddress, shareBaseUrl } from './share.js';
import { StationHub, createStationRouter } from './station.js';
import { UploadQueue, WebHostUploader } from './uploader.js';
import { EmailQueue, Mailer, appendOptIn } from './email.js';
import { Backgrounds } from './greenscreen.js';
import { StripeProvider } from './stripe.js';
import { Payments } from './payments.js';

const version = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).version;

/** Builds every part of the booth from a config object. Exported so tests can start a booth on a random port. */
export async function createBooth(
  config,
  {
    logger = createLogger({ file: path.join(ROOT_DIR, 'logs', 'booth.log') }),
    templatesDir = path.join(ROOT_DIR, 'templates'),
    settingsFile = path.join(ROOT_DIR, 'runtime-settings.json'),
    camera: injectedCamera,
    printer: injectedPrinter,
    uploader: injectedUploader,
    mailer: injectedMailer,
    shareBase: injectedShareBase,
    paymentProvider: injectedPaymentProvider, // tests give a Stripe pointed at a fake
    paymentPollMs = 2500, // how often open Stripe payments are looked at
    now: clock = Date.now, // injectable so tests can move time (station presence, login expiry)
  } = {},
) {
  fs.mkdirSync(config.storage.dir, { recursive: true });

  const { templates, problems: templateProblems } = loadTemplates({ templatesDir, qr: config.sharing.enabled && config.sharing.qrOnPrint });
  for (const p of templateProblems) logger.warn(`template ${p.file} ignored: ${p.issues.join('; ')}`);
  if (!templates.has(config.activeTemplate)) {
    throw new ConfigError([`activeTemplate "${config.activeTemplate}" does not exist. Available: ${[...templates.keys()].join(', ')}`]);
  }

  // Green screen: the pictures guests can choose from. Loaded (and checked) before the settings, which refer to them.
  let backgrounds = null;
  if (config.greenScreen.enabled) {
    backgrounds = await new Backgrounds({ dir: config.greenScreen.dir, builtin: config.greenScreen.builtinBackgrounds, logger }).load();
    if (backgrounds.list().length === 0) {
      throw new ConfigError([`greenScreen.enabled is on but there are no backgrounds: put .jpg or .png files in ${config.greenScreen.dir}, or set greenScreen.builtinBackgrounds to true`]);
    }
    if (config.greenScreen.defaultBackdrop !== 'guest' && !backgrounds.has(config.greenScreen.defaultBackdrop)) {
      logger.warn(`greenScreen.defaultBackdrop "${config.greenScreen.defaultBackdrop}" does not match any background - guests will choose. Available: ${backgrounds.list().map((b) => b.id).join(', ')}`);
    }
    await backgrounds.warm();
    logger.info(`green screen: ${backgrounds.list().length} backgrounds (${backgrounds.list().map((b) => b.id).join(', ')})`);
  }

  const settings = await new RuntimeSettings({ config, templates, file: settingsFile, backgrounds }).load();
  const camera = injectedCamera ?? createCamera(config, { logger });
  await camera.init();
  const liveView = new LiveViewController(camera, { logger });
  const printer = injectedPrinter ?? createPrinter(config, { logger });
  // The station hears about every change to a session or a print job through these two hooks.
  const hub = config.station.enabled ? new StationHub({ logger, now: clock }) : null;
  let payments = null; // set up below; a print that FAILS after the guest paid is flagged for a refund decision
  const queue = new PrintQueue(printer, {
    logger,
    onChange: (job) => {
      hub?.touch(job.sessionId);
      if (job.status === 'error' && job.paymentId) payments?.flagRefund(job.paymentId, 'print_failed');
    },
  });
  const store = new SessionStore({ rootDir: config.storage.dir, onSave: (session) => hub?.touch(session.id) });
  const stationUrl = config.station.enabled ? `http://${lanAddress() ?? 'localhost'}:${config.lan.port}/station/` : null;

  // Sharing: a token index, a minimal network listener for galleries, and (upload mode) the durable upload queue.
  const queuesDir = path.join(config.storage.dir, '_queues');
  const shareIndex = await new ShareIndex({ file: path.join(queuesDir, 'share-index.json') }).load();
  const shareBase = injectedShareBase ?? (config.sharing.enabled ? shareBaseUrl(config) : '');
  let uploader = null;
  let uploadQueue = null;
  if (config.sharing.enabled && config.sharing.mode === 'upload') {
    const { url, secret, timeoutMs, maxAgeHours } = config.sharing.upload;
    uploader = injectedUploader ?? new WebHostUploader({ url, secret, timeoutMs });
    uploadQueue = await new UploadQueue({
      uploader,
      file: path.join(queuesDir, 'upload-queue.json'),
      logger,
      maxAgeMs: maxAgeHours * 3600_000,
      onUploaded: async (sessionId, uploadedVersion) => {
        const session = await store.find(sessionId);
        if (session?.share && (session.share.uploadedVersion ?? -1) < uploadedVersion) {
          session.share.uploadedVersion = uploadedVersion;
          session.share.uploadedAt = new Date().toISOString();
          await store.save(session);
        }
      },
    }).load();
  }

  // Email: a durable queue that waits for the guest's link to be live, retries, and never keeps an address after sending.
  let mailer = null;
  let emailQueue = null;
  if (config.email.enabled) {
    const em = config.email;
    mailer = injectedMailer ?? new Mailer({ smtp: em.smtp, from: em.from });
    emailQueue = await new EmailQueue({
      mailer,
      file: path.join(queuesDir, 'email-queue.json'),
      logger,
      limits: { maxPerSession: em.maxPerSession, maxPerAddressPerHour: em.maxPerAddressPerHour },
      intro: em.intro,
      subject: em.subject,
      brandName: config.sharing.brandName,
      maxAgeMs: em.maxAgeHours * 3600_000,
      isShareReady: async (item) => {
        const session = await store.find(item.sessionId);
        if (!session) return false;
        const uploadItem = uploadQueue?.list().find((i) => i.sessionId === session.id && i.version === session.final?.version) ?? null;
        return computeShareState({ config, session, uploadItem, shareBase }).ready;
      },
      // The one place an address is kept longer: only for a guest who ticked the marketing opt-in.
      onSent: async (item) => {
        if (item.optIn && item.eventSlug) await appendOptIn({ file: path.join(store.eventDir(item.eventSlug), 'optin-emails.csv'), email: item.to, eventName: item.eventName });
      },
    }).load();
  }

  // Payments: what guests pay (Stripe QR code, or an attendant confirming cash/Zelle), kept on disk with a plain CSV ledger.
  if (config.payments.enabled) {
    const pay = config.payments;
    const provider = injectedPaymentProvider !== undefined ? injectedPaymentProvider : pay.provider === 'stripe' ? new StripeProvider({ secretKey: pay.stripe.secretKey, returnUrl: pay.stripe.returnUrl, timeoutMs: pay.stripe.timeoutMs }) : null;
    payments = await new Payments({
      file: path.join(queuesDir, 'payments.json'),
      provider,
      timeoutMs: pay.timeoutSeconds * 1000,
      offline: pay.offline,
      pollMs: paymentPollMs,
      ledgerFile: (item) => path.join(store.eventDir(item.eventSlug), 'payments.csv'),
      describe: (item) => `Photo ${item.kind === 'session' ? 'session' : 'prints'} - ${settings.eventName}`.slice(0, 100),
      logger,
      onChange: (view) => {
        hub?.publish('payment', view);
        if (view.sessionId) hub?.touch(view.sessionId);
      },
    }).load();
  }

  const publicDir = path.join(ROOT_DIR, 'public');
  const app = createApp({ config, settings, templates, templateProblems, templatesDir, camera, liveView, printer, queue, store, logger, version, publicDir, shareIndex, shareBase, uploader, uploadQueue, mailer, emailQueue, backgrounds, hub, stationUrl, payments });
  const station = hub
    ? createStationRouter({ config, hub, approvals: app.approvals, payments, actions: app.actions, store, queue, camera, printer, settings, emailQueue, uploadQueue, publicDir, uiDir: path.join(ROOT_DIR, 'station-ui'), logger, now: clock })
    : null;
  const lanApp = createLanApp({ shareIndex, store, logger, station });
  return { app, lanApp, camera, printer, queue, store, settings, logger, templates, shareIndex, shareBase, uploader, uploadQueue, mailer, emailQueue, backgrounds, hub, approvals: app.approvals, payments, stationUrl };
}

async function main() {
  const logger = createLogger({ file: path.join(ROOT_DIR, 'logs', 'booth.log') });
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const booth = await createBooth(config, { logger });
  const server = booth.app.listen(config.port, config.host, () => {
    logger.info(`Nexus Booth ${version} running: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}  (operator panel: /operator.html)`);
    logger.info(`camera=${config.camera.driver} printer=${config.printer.mode} template=${booth.settings.values.activeTemplate} event="${booth.settings.eventName}"`);
    for (const w of configWarnings(config)) logger.warn(w);
    if (!config._meta.usedFile) logger.warn(`no ${path.basename(config._meta.configPath)} found - using defaults (copy config.example.json to config.json)`);
  });
  // Galleries for guests' phones: a separate listener that exposes nothing but /s/<token>/ (local mode only).
  let lanServer = null;
  if ((config.sharing.enabled && config.sharing.mode === 'local') || config.station.enabled) {
    lanServer = booth.lanApp.listen(config.lan.port, config.lan.host, () => {
      logger.info(`network listener on ${config.lan.host}:${config.lan.port}${config.sharing.enabled && config.sharing.mode === 'local' ? `: guest galleries at ${booth.shareBase}/s/<token>/` : ''}`);
      if (config.station.enabled) logger.info(`attendant station: ${booth.stationUrl} (needs the station PIN${config.station.approval.enabled ? '; prints wait for approval' : ''})`);
    });
    lanServer.on('error', (err) => {
      logger.error(err.code === 'EADDRINUSE' ? `Gallery port ${config.lan.port} is already in use (config: lan.port)` : err.message);
      process.exit(1);
    });
  }
  server.on('error', (err) => {
    logger.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use - is another copy of the booth running?` : err.message);
    process.exit(1);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down`);
    server.close();
    lanServer?.close();
    booth.hub?.closeAll();
    booth.approvals?.stop();
    booth.payments?.stop();
    booth.uploadQueue?.stop();
    booth.emailQueue?.stop();
    await booth.camera.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error(`unhandled rejection: ${reason?.stack ?? reason}`));
}

// Run the booth only when started directly (`node server/index.js`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
