import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { CameraError } from './camera/errors.js';
import { ComposeError, composeTemplate, makePreview, renderTestPattern } from './compose.js';
import { PrintError, buildPrintPdf } from './print.js';
import { configWarnings } from './config.js';

class HttpError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

// What a guest sees. The technical detail goes to the log and the operator panel.
const FRIENDLY_CAMERA = {
  unavailable: 'The camera is not responding. Please ask the attendant for help.',
  timeout: 'The camera took too long to respond. Please try again.',
  capture_failed: 'The camera could not take the photo. Please try again.',
  file_missing: 'The photo could not be saved. Please try again.',
};

const FRAME_INTERVAL_MS = 80;
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const clampCopies = (value, fallback) => {
  const n = Number.isInteger(value) ? value : fallback;
  return Math.min(10, Math.max(1, n));
};

export function createApp({ config, settings, templates, templateProblems = [], templatesDir, camera, liveView, printer, queue, store, logger, version = '0.0.0', publicDir }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  let capturing = false; // one camera, one photo at a time

  const templateFor = (session) => {
    const template = templates.get(session.templateId);
    if (!template) throw new HttpError(409, 'template_missing', `Template "${session.templateId}" no longer exists`);
    return template;
  };

  const requireSession = async (id) => {
    const session = await store.find(id);
    if (!session) throw new HttpError(404, 'no_session', 'Session not found');
    return session;
  };

  const toHttp = (err) => {
    if (err instanceof CameraError) {
      logger.error(`camera ${err.code}: ${err.message}`);
      return new HttpError(503, err.code, FRIENDLY_CAMERA[err.code] ?? 'The camera had a problem. Please try again.', err.message);
    }
    if (err instanceof ComposeError) return new HttpError(409, 'not_ready', err.message);
    if (err instanceof PrintError) return new HttpError(502, 'print_failed', 'Could not send to the printer.', err.message);
    return err;
  };

  const sessionView = (session) => ({
    id: session.id,
    templateId: session.templateId,
    shotsNeeded: session.shotsNeeded,
    status: session.status,
    shots: session.shots.map((s) => ({ index: s.index, attempt: s.attempt, previewUrl: store.mediaUrl(session, s.preview) })),
    finalPreviewUrl: finalPreviewUrl(session),
  });

  const finalPreviewUrl = (session) => (session.final ? `${store.mediaUrl(session, session.final.preview)}?v=${session.final.version}` : null);
  const templateView = (t) => ({ id: t.id, name: t.name, description: t.description ?? '', shots: t.shots });

  async function ensureComposed(session) {
    if (session.status === 'composed' && session.final) return;
    const template = templateFor(session);
    const shotFiles = [];
    for (const shot of session.shots) shotFiles[shot.index] = store.resolve(session, shot.file);
    try {
      await composeTemplate({
        template,
        shotFiles,
        event: session.eventName,
        outFile: store.resolve(session, 'final.jpg'),
        previewFile: store.resolve(session, 'final-preview.jpg'),
        templatesDir,
        now: new Date(session.createdAt),
      });
    } catch (err) {
      throw toHttp(err);
    }
    session.final = { file: 'final.jpg', preview: 'final-preview.jpg', version: Date.now() };
    session.status = 'composed';
    await store.save(session);
  }

  async function printSession(session, copies, label) {
    await ensureComposed(session);
    const template = templateFor(session);
    if (!session.pdf) {
      await buildPrintPdf({ imageFile: store.resolve(session, session.final.file), template, outFile: store.resolve(session, 'print.pdf') });
      session.pdf = 'print.pdf';
    }
    const job = queue.enqueue({ sessionId: session.id, pdfFile: store.resolve(session, session.pdf), copies, label });
    session.prints.push({ jobId: job.id, copies, at: new Date().toISOString() });
    await store.save(session);
    return job;
  }

  // ---------------------------------------------------------------- guest API

  app.get('/api/health', (req, res) => res.json({ ok: true, version }));

  app.get('/api/state', (req, res) => {
    res.json({
      event: { name: settings.eventName },
      template: templateView(settings.activeTemplate),
      templates: [...templates.values()].map(templateView),
      ui: config.ui,
      printer: {
        mode: printer.mode,
        enabled: settings.printEnabled,
        autoPrint: config.printer.autoPrint,
        copies: settings.copies,
        estimatedSeconds: config.printer.estimatedSeconds,
      },
    });
  });

  app.post(
    '/api/sessions',
    wrap(async (req, res) => {
      const template = settings.activeTemplate;
      const session = await store.create({ eventSlug: settings.eventSlug, eventName: settings.eventName, templateId: template.id, shotsNeeded: template.shots });
      logger.info(`session ${session.id} started (${template.id}, event ${settings.eventSlug})`);
      res.status(201).json({ ...sessionView(session), template: templateView(template) });
    }),
  );

  app.post(
    '/api/sessions/:id/shots',
    wrap(async (req, res) => {
      const session = await requireSession(req.params.id);
      const wanted = req.body?.index;
      let index;
      if (wanted !== undefined) {
        if (!Number.isInteger(wanted) || wanted < 0 || wanted >= session.shotsNeeded) throw new HttpError(400, 'bad_index', 'Invalid photo number');
        index = wanted;
      } else {
        index = [...Array(session.shotsNeeded).keys()].find((i) => !session.shots.some((s) => s.index === i)) ?? -1;
        if (index === -1) throw new HttpError(409, 'session_full', 'All photos have already been taken');
      }
      if (capturing) throw new HttpError(409, 'busy', 'The camera is busy');
      capturing = true;
      try {
        const attempt = (session.shots.find((s) => s.index === index)?.attempt ?? 0) + 1;
        const baseName = `shot-${index + 1}-a${attempt}`;
        let result;
        try {
          result = await camera.capture({ dir: store.resolve(session, 'originals'), baseName });
        } catch (err) {
          throw toHttp(err);
        }
        const previewRel = path.join('previews', `${baseName}.jpg`);
        await makePreview(result.file, store.resolve(session, previewRel), 1600);
        const entry = { index, attempt, file: path.relative(store.sessionDir(session), result.file), preview: previewRel };
        session.shots = [...session.shots.filter((s) => s.index !== index), entry].sort((a, b) => a.index - b.index);
        // A different photo invalidates the finished picture and its print file.
        session.status = 'shooting';
        session.final = null;
        session.pdf = null;
        await store.save(session);
        logger.info(`session ${session.id}: photo ${index + 1}/${session.shotsNeeded} taken (attempt ${attempt})`);
        res.json({ index, attempt, previewUrl: store.mediaUrl(session, previewRel), taken: session.shots.length, needed: session.shotsNeeded });
      } finally {
        capturing = false;
      }
    }),
  );

  app.post(
    '/api/sessions/:id/compose',
    wrap(async (req, res) => {
      const session = await requireSession(req.params.id);
      await ensureComposed(session);
      res.json({ previewUrl: finalPreviewUrl(session) });
    }),
  );

  app.post(
    '/api/sessions/:id/print',
    wrap(async (req, res) => {
      if (!settings.printEnabled) throw new HttpError(409, 'printing_disabled', 'Printing is turned off');
      const session = await requireSession(req.params.id);
      const job = await printSession(session, clampCopies(req.body?.copies, settings.copies), 'print');
      res.json({ job, queueAhead: Math.max(0, queue.pending() - 1), estimatedSeconds: config.printer.estimatedSeconds });
    }),
  );

  app.get('/api/print/jobs/:id', (req, res, next) => {
    const job = queue.get(req.params.id);
    if (!job) return next(new HttpError(404, 'no_job', 'Print job not found'));
    return res.json({ job });
  });

  /** Live preview as a motion-JPEG stream (a plain <img src> in the browser). */
  app.get('/api/camera/stream', async (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Connection: 'keep-alive',
    });
    let open = true;
    req.on('close', () => {
      open = false;
    });
    await liveView.acquire();
    try {
      let last = null;
      while (open) {
        const frame = await camera.liveFrame();
        const current = frame ?? last;
        if (current && open && !res.writableNeedDrain) {
          res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${current.length}\r\n\r\n`);
          res.write(current);
          res.write('\r\n');
          last = current;
        }
        await sleep(frame ? FRAME_INTERVAL_MS : 250);
      }
    } finally {
      liveView.release();
      res.end();
    }
  });

  // ------------------------------------------------------------- operator API

  app.use('/api/operator', async (req, res, next) => {
    const given = Buffer.from(String(req.get('x-operator-pin') ?? ''));
    const expected = Buffer.from(config.operatorPin);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
    await sleep(500); // slows down PIN guessing
    return next(new HttpError(401, 'bad_pin', 'Wrong or missing operator PIN'));
  });

  app.get(
    '/api/operator/status',
    wrap(async (req, res) => {
      const [cameraStatus, printerStatus] = await Promise.all([camera.status(), printer.status()]);
      res.json({
        version,
        camera: cameraStatus,
        printer: { ...printerStatus, name: config.printer.name, paperSize: config.printer.paperSize },
        settings: { ...settings.values },
        templates: [...templates.values()].map(templateView),
        templateProblems,
        queue: queue.list().slice(0, 8),
        warnings: configWarnings(config),
      });
    }),
  );

  app.post(
    '/api/operator/settings',
    wrap(async (req, res) => {
      const result = await settings.update(req.body ?? {});
      if (!result.ok) throw new HttpError(400, 'bad_settings', result.problems.join('; '));
      logger.info(`operator changed settings: ${JSON.stringify(req.body)}`);
      res.json({ settings: { ...settings.values } });
    }),
  );

  app.post(
    '/api/operator/test-capture',
    wrap(async (req, res) => {
      if (capturing) throw new HttpError(409, 'busy', 'The camera is busy');
      capturing = true;
      try {
        const dir = path.join(config.storage.dir, '_tests');
        const baseName = `test-${Date.now()}`;
        let result;
        try {
          result = await camera.capture({ dir, baseName });
        } catch (err) {
          throw toHttp(err);
        }
        await makePreview(result.file, path.join(dir, `${baseName}-preview.jpg`), 1600);
        res.json({ previewUrl: `/media/_tests/${baseName}-preview.jpg`, file: result.file });
      } finally {
        capturing = false;
      }
    }),
  );

  app.post(
    '/api/operator/test-print',
    wrap(async (req, res) => {
      const template = settings.activeTemplate;
      const dir = path.join(config.storage.dir, '_tests');
      const stamp = Date.now();
      const imageFile = path.join(dir, `testprint-${stamp}.jpg`);
      await renderTestPattern({ width: template.canvas.width, height: template.canvas.height, dpi: template.canvas.dpi ?? 300, label: 'PRINT TEST' }, imageFile);
      const pdfFile = path.join(dir, `testprint-${stamp}.pdf`);
      await buildPrintPdf({ imageFile, template, outFile: pdfFile });
      const job = queue.enqueue({ sessionId: 'test', pdfFile, copies: 1, label: 'test print' });
      logger.info(`operator queued test print ${job.id}`);
      res.json({ job, pdf: pdfFile });
    }),
  );

  app.get(
    '/api/operator/sessions',
    wrap(async (req, res) => {
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit ?? '24', 10) || 24));
      const sessions = await store.list({ eventSlug: settings.eventSlug, limit });
      res.json({
        event: { name: settings.eventName, slug: settings.eventSlug },
        sessions: sessions.map((s) => ({
          id: s.id,
          createdAt: s.createdAt,
          status: s.status,
          templateId: s.templateId,
          prints: s.prints.length,
          previewUrl: s.final ? `${store.mediaUrl(s, s.final.preview)}?v=${s.final.version}` : (s.shots[0] ? store.mediaUrl(s, s.shots[0].preview) : null),
        })),
      });
    }),
  );

  app.post(
    '/api/operator/sessions/:id/reprint',
    wrap(async (req, res) => {
      const session = await requireSession(req.params.id);
      if (session.shots.length < session.shotsNeeded) throw new HttpError(409, 'not_ready', 'That session did not finish taking its photos');
      const job = await printSession(session, clampCopies(req.body?.copies, 1), 'reprint');
      res.json({ job });
    }),
  );

  // ------------------------------------------------------------------- files

  app.use('/media', express.static(config.storage.dir, { dotfiles: 'deny', index: false, setHeaders: (res) => res.set('Cache-Control', 'no-store') }));
  app.use(express.static(publicDir, { extensions: ['html'] }));

  app.use('/api', (req, res, next) => next(new HttpError(404, 'not_found', 'Unknown API route')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.code, message: err.message, ...(err.detail ? { detail: err.detail } : {}) });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Invalid request' });
    logger.error(`${req.method} ${req.originalUrl}: ${err?.stack ?? err}`);
    return res.status(500).json({ error: 'internal', message: 'Something went wrong. Please ask the attendant for help.' });
  });

  return app;
}
