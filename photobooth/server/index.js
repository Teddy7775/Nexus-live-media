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
  } = {},
) {
  fs.mkdirSync(config.storage.dir, { recursive: true });

  const { templates, problems: templateProblems } = loadTemplates({ templatesDir });
  for (const p of templateProblems) logger.warn(`template ${p.file} ignored: ${p.issues.join('; ')}`);
  if (!templates.has(config.activeTemplate)) {
    throw new ConfigError([`activeTemplate "${config.activeTemplate}" does not exist. Available: ${[...templates.keys()].join(', ')}`]);
  }

  const settings = await new RuntimeSettings({ config, templates, file: settingsFile }).load();
  const camera = injectedCamera ?? createCamera(config, { logger });
  await camera.init();
  const liveView = new LiveViewController(camera, { logger });
  const printer = injectedPrinter ?? createPrinter(config, { logger });
  const queue = new PrintQueue(printer, { logger });
  const store = new SessionStore({ rootDir: config.storage.dir });

  const app = createApp({ config, settings, templates, templateProblems, templatesDir, camera, liveView, printer, queue, store, logger, version, publicDir: path.join(ROOT_DIR, 'public') });
  return { app, camera, printer, queue, store, settings, logger, templates };
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
  server.on('error', (err) => {
    logger.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use - is another copy of the booth running?` : err.message);
    process.exit(1);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down`);
    server.close();
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
