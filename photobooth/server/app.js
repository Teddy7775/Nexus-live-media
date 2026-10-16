import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { CameraError } from './camera/errors.js';
import { ComposeError, composeTemplate, makePreview, renderTestPattern } from './compose.js';
import { HttpError } from './http-error.js';
import { ApprovalQueue } from './approval.js';
import { PrintError, buildPrintPdf } from './print.js';
import { configWarnings } from './config.js';
import { qrSvg } from './qr.js';
import { GifError, encodeGif, grabFrames } from './gif.js';
import { DEFAULT_KEY, keyToJpeg, mergeKey, suggestKeyFromJpeg } from './greenscreen.js';
import { buildShareBundle, computeShareState, shareUrl } from './share.js';
import { EmailRejected, buildEmail, classifySmtpError } from './email.js';
import { isValidEmail, maskEmail, normalizeEmail } from '../public/email-utils.js';

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

export function createApp({ config, settings, templates, templateProblems = [], templatesDir, camera, liveView, printer, queue, store, logger, version = '0.0.0', publicDir, shareIndex = null, shareBase = '', uploader = null, uploadQueue = null, mailer = null, emailQueue = null, backgrounds = null, hub = null, stationUrl = null }) {
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

  // ------------------------------------------------------------ green screen
  const greenOn = Boolean(backgrounds);
  const previewWidth = config.greenScreen.previewWidth;
  const backgroundPixels = (id) => (w, h) => backgrounds.raw(id, w, h);
  const thumbUrl = (id) => `/api/greenscreen/backgrounds/${encodeURIComponent(id)}/thumb.jpg`;
  const requireGreen = () => {
    if (!greenOn) throw new HttpError(409, 'greenscreen_disabled', 'Green screen is not turned on (greenScreen.enabled in config.json)');
  };

  /** What a new session gets: the operator's fixed background if there is one, otherwise the guest's pick (or the first). */
  function chooseBackground(requested) {
    if (!greenOn) return null;
    const fixed = settings.backdrop !== 'guest' && backgrounds.has(settings.backdrop) ? settings.backdrop : null;
    const wanted = requested === undefined || requested === null ? backgrounds.firstId() : requested;
    const id = fixed ?? wanted;
    if (typeof id !== 'string' || !backgrounds.has(id)) throw new HttpError(400, 'bad_background', 'That background does not exist');
    return { id, name: backgrounds.get(id).name, key: { ...settings.key } };
  }

  /** How to key this session's pictures, or null when it has no background. */
  function keyingFor(session) {
    if (!session.background) return null;
    if (!backgrounds?.has(session.background.id)) throw new ComposeError(`The background "${session.background.name}" is no longer available`);
    return { background: backgroundPixels(session.background.id), key: session.background.key };
  }

  /** The screen-size picture of one photo: the original, or the original with its backdrop replaced. */
  async function writePreview(session, sourceFile, destFile, width) {
    const keying = keyingFor(session);
    if (!keying) return makePreview(sourceFile, destFile, width);
    await fs.mkdir(path.dirname(destFile), { recursive: true });
    await fs.writeFile(destFile, await keyToJpeg({ source: sourceFile, background: keying.background, width, key: keying.key, quality: 85 }));
    return destFile;
  }

  /** One current live-view picture (the camera's live view is started if nobody is watching it). */
  async function grabLiveFrame() {
    await liveView.acquire();
    try {
      for (let attempt = 0; attempt < 20; attempt++) {
        const frame = await camera.liveFrame();
        if (frame) return frame;
        await sleep(150);
      }
    } finally {
      liveView.release();
    }
    throw new HttpError(503, 'no_live_view', 'No live view picture yet. Is the camera connected and live view switched on?');
  }

  const sessionView = (session) => ({
    id: session.id,
    templateId: session.templateId,
    shotsNeeded: session.shotsNeeded,
    status: session.status,
    shots: session.shots.map((s) => ({ index: s.index, attempt: s.attempt, previewUrl: store.mediaUrl(session, s.preview) })),
    finalPreviewUrl: finalPreviewUrl(session),
    background: session.background ? { id: session.background.id, name: session.background.name } : null,
  });

  const finalPreviewUrl = (session) => (session.final ? `${store.mediaUrl(session, session.final.preview)}?v=${session.final.version}` : null);
  const templateView = (t) => ({ id: t.id, name: t.name, description: t.description ?? '', shots: t.shots });

  /**
   * Runs `fn` after any earlier call with the same key has finished. Building a session's picture, gallery or print file
   * writes the SAME files, and libvips reads images by memory-mapping them: two builds at once (a double tap on Print, the
   * kiosk and the station both asking) can truncate a file another one is reading, which kills the whole process (SIGBUS).
   */
  const locks = new Map();
  function withLock(key, fn) {
    const next = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    locks.set(key, next);
    next.then(
      () => locks.get(key) === next && locks.delete(key),
      () => locks.get(key) === next && locks.delete(key),
    );
    return next;
  }

  const sharingOn = config.sharing.enabled;
  const shareLink = (session) => (session.share ? shareUrl(shareBase, session.share.token) : null);

  /** Builds the gallery folder for the current picture and (upload mode) queues it for the web host. */
  function ensureShareBundle(session, { upload }) {
    if (!sharingOn || !session.share || !session.final) return Promise.resolve();
    return withLock(`bundle:${session.id}`, async () => {
      if (!session.final) return;
      if (session.share.builtVersion !== session.final.version) {
        const bundle = await buildShareBundle({ session, sessionDir: store.sessionDir(session), brandName: config.sharing.brandName });
        session.share.builtVersion = session.final.version;
        session.share.files = bundle.files;
        await store.save(session);
      }
      if (config.sharing.mode === 'upload' && upload && uploadQueue && session.share.uploadedVersion !== session.final.version) {
        const version = session.final.version;
        const queued = uploadQueue.list().some((i) => i.sessionId === session.id && i.version === version && i.status !== 'failed');
        if (!queued) uploadQueue.enqueue({ sessionId: session.id, token: session.share.token, dir: path.join(store.sessionDir(session), 'share'), files: session.share.files, version });
      }
    });
  }

  /** What the kiosk needs to know: is the guest's link live yet? */
  function shareState(session) {
    const uploadItem = uploadQueue?.list().find((i) => i.sessionId === session.id && i.version === session.final?.version) ?? null;
    return computeShareState({ config, session, uploadItem, shareBase });
  }

  function ensureComposed(session) {
    if (session.status === 'composed' && session.final) return Promise.resolve();
    return withLock(`compose:${session.id}`, () => compose(session));
  }

  async function compose(session) {
    if (session.status === 'composed' && session.final) return; // another request finished it while this one waited
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
        qrUrl: sharingOn && config.sharing.qrOnPrint ? shareLink(session) : null,
        keying: keyingFor(session),
        now: new Date(session.createdAt),
      });
    } catch (err) {
      throw toHttp(err);
    }
    session.final = { file: 'final.jpg', preview: 'final-preview.jpg', version: Date.now() };
    session.status = 'composed';
    await store.save(session);
    // Local mode: the gallery is built straight away (cheap). Upload mode: queue it unless uploads are on-demand only.
    await ensureShareBundle(session, { upload: config.sharing.autoUpload }).catch((err) => logger.error(`share bundle for ${session.id}: ${err.message}`));
  }

  async function printSession(session, copies, label) {
    await ensureComposed(session);
    const template = templateFor(session);
    await withLock(`pdf:${session.id}`, async () => {
      if (session.pdf) return;
      await buildPrintPdf({ imageFile: store.resolve(session, session.final.file), template, outFile: store.resolve(session, 'print.pdf') });
      session.pdf = 'print.pdf';
    });
    const job = queue.enqueue({ sessionId: session.id, pdfFile: store.resolve(session, session.pdf), copies, label });
    session.prints.push({ jobId: job.id, copies, at: new Date().toISOString() });
    await store.save(session);
    return job;
  }

  /** Queues an email of the finished photos (shared by the guest's kiosk and the attendant's station). */
  async function queueEmail(session, body) {
    if (!emailQueue) throw new HttpError(409, 'email_disabled', 'Email is turned off');
    await ensureComposed(session);
    await ensureShareBundle(session, { upload: true }); // make sure the link the email points to will go live
    let result;
    try {
      result = emailQueue.enqueue({
        sessionId: session.id,
        email: body?.email,
        shareUrl: shareLink(session),
        eventName: session.eventName,
        eventSlug: session.eventSlug,
        previewFile: store.resolve(session, session.final.preview),
        optIn: config.email.marketingOptIn.enabled && body?.optIn === true,
      });
    } catch (err) {
      if (err instanceof EmailRejected) throw new HttpError(err.status, err.code, err.message);
      throw err;
    }
    return { queued: true, masked: result.masked, duplicate: result.duplicate };
  }

  // ------------------------------------------------------------ print approval (station)
  // Created only when the station is on. Whether prints actually WAIT for it is a runtime setting (settings.approvalRequired).
  const approvals = config.station.enabled
    ? new ApprovalQueue({
        timeoutMs: config.station.approval.timeoutSeconds * 1000,
        onTimeout: config.station.approval.onTimeout,
        maxCopies: config.station.approval.maxCopies,
        logger,
        onApprove: async (item) => {
          const session = await requireSession(item.sessionId);
          const job = await printSession(session, item.copies, 'print');
          return { job, queueAhead: Math.max(0, queue.pending() - 1), estimatedSeconds: config.printer.estimatedSeconds };
        },
        onChange: (item) => {
          hub?.publish('approval', item);
          hub?.touch(item.sessionId);
        },
      })
    : null;

  /** What the guest's kiosk is told about a print request. Never includes anything an attendant typed beyond the short reason. */
  const approvalView = (item) => ({
    id: item.id,
    status: item.status === 'approving' ? 'pending' : item.status,
    reason: item.reason,
    timeoutSeconds: Math.round(item.timeoutMs / 1000),
    expiresAt: item.expiresAt,
    ...(item.status === 'approved' ? { job: item.job, queueAhead: item.queueAhead, estimatedSeconds: item.estimatedSeconds ?? config.printer.estimatedSeconds } : {}),
    ...(item.status === 'error' ? { error: 'The print could not be started.' } : {}),
  });

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
      sharing: { enabled: sharingOn, mode: config.sharing.mode, shareSeconds: config.sharing.shareSeconds, wifiHint: config.sharing.wifiHint },
      gif: { enabled: config.gif.enabled, countdownSeconds: config.gif.countdownSeconds, frames: config.gif.frames, intervalMs: config.gif.intervalMs },
      email: { enabled: Boolean(emailQueue), maxPerSession: config.email.maxPerSession, marketingOptIn: config.email.marketingOptIn },
      station: { approval: Boolean(approvals) && settings.approvalRequired },
      greenScreen: greenOn
        ? {
            enabled: true,
            // Guests choose when the operator has not fixed one - and when there is actually something to choose between.
            guestChoice: settings.backdrop === 'guest' && backgrounds.list().length > 1,
            backdrop: settings.backdrop === 'guest' ? backgrounds.firstId() : settings.backdrop,
            pickSeconds: config.greenScreen.pickSeconds,
            backgrounds: backgrounds.list().map((b) => ({ id: b.id, name: b.name, thumbUrl: thumbUrl(b.id) })),
          }
        : { enabled: false },
    });
  });

  app.get(
    '/api/greenscreen/backgrounds/:id/thumb.jpg',
    wrap(async (req, res) => {
      requireGreen();
      const jpeg = await backgrounds.thumb(req.params.id);
      if (!jpeg) throw new HttpError(404, 'no_background', 'No such background');
      res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }).send(jpeg);
    }),
  );

  app.post(
    '/api/sessions',
    wrap(async (req, res) => {
      const template = settings.activeTemplate;
      const background = chooseBackground(req.body?.background);
      const session = await store.create({ eventSlug: settings.eventSlug, eventName: settings.eventName, templateId: template.id, shotsNeeded: template.shots, share: sharingOn, background });
      if (session.share) await shareIndex?.set(session.share.token, { eventSlug: session.eventSlug, sessionId: session.id });
      logger.info(`session ${session.id} started (${template.id}, event ${settings.eventSlug}${background ? `, background ${background.id}` : ''})`);
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
        await writePreview(session, result.file, store.resolve(session, previewRel), 1600);
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

  /** Records a short animation from the live view (no still photo is taken, so the camera can keep its live view running). */
  app.post(
    '/api/sessions/:id/gif',
    wrap(async (req, res) => {
      if (!config.gif.enabled) throw new HttpError(409, 'gif_disabled', 'GIFs are turned off');
      const session = await requireSession(req.params.id);
      if (capturing) throw new HttpError(409, 'busy', 'The camera is busy');
      capturing = true;
      try {
        await liveView.acquire(); // makes sure live view is running (the kiosk's preview stream usually already holds it)
        let frames;
        try {
          frames = await grabFrames({ getFrame: () => camera.liveFrame(), count: config.gif.frames, intervalMs: config.gif.intervalMs });
        } catch (err) {
          if (err instanceof GifError) {
            logger.warn(`gif for ${session.id}: ${err.message}`);
            throw new HttpError(503, err.code, 'The GIF could not be recorded.', err.message);
          }
          throw err;
        } finally {
          liveView.release();
        }
        const keying = keyingFor(session);
        if (keying) frames = await Promise.all(frames.map((source) => keyToJpeg({ source, background: keying.background, width: config.gif.width, key: keying.key, quality: 88 })));
        const bytes = await encodeGif({ frames, width: config.gif.width, delayMs: config.gif.intervalMs, boomerang: config.gif.boomerang, loop: true });
        await fs.writeFile(store.resolve(session, 'animation.gif'), bytes);
        const version = Date.now();
        session.gif = { file: 'animation.gif', frames: frames.length, bytes: bytes.length, version };
        // New media makes the finished picture (and its gallery) out of date, exactly like a retake.
        session.status = 'shooting';
        session.final = null;
        session.pdf = null;
        await store.save(session);
        logger.info(`session ${session.id}: GIF recorded (${frames.length} frames, ${Math.round(bytes.length / 1024)} KB)`);
        res.json({ ok: true, frames: frames.length, bytes: bytes.length, url: `${store.mediaUrl(session, 'animation.gif')}?v=${version}` });
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
      const copies = clampCopies(req.body?.copies, settings.copies);
      if (approvals && settings.approvalRequired) {
        // The attendant looks at the finished picture before it is printed, so make sure there is one.
        await ensureComposed(session);
        const item = await approvals.request({ sessionId: session.id, copies, label: 'print', stationOnline: Boolean(hub?.online()) });
        return res.json({ approval: approvalView(item) });
      }
      const job = await printSession(session, copies, 'print');
      return res.json({ job, queueAhead: Math.max(0, queue.pending() - 1), estimatedSeconds: config.printer.estimatedSeconds });
    }),
  );

  app.get('/api/print/approvals/:id', (req, res, next) => {
    const item = approvals?.get(req.params.id);
    if (!item) return next(new HttpError(404, 'no_approval', 'Print request not found'));
    return res.json({ approval: approvalView(item) });
  });

  /** The guest walked away while waiting: take the request off the attendant's screen. */
  app.delete('/api/print/approvals/:id', (req, res, next) => {
    if (!approvals?.get(req.params.id)) return next(new HttpError(404, 'no_approval', 'Print request not found'));
    approvals.cancel(req.params.id);
    return res.json({ ok: true });
  });

  app.get('/api/print/jobs/:id', (req, res, next) => {
    const job = queue.get(req.params.id);
    if (!job) return next(new HttpError(404, 'no_job', 'Print job not found'));
    return res.json({ job });
  });

  app.post(
    '/api/sessions/:id/share',
    wrap(async (req, res) => {
      if (!sharingOn) throw new HttpError(409, 'sharing_disabled', 'Sharing is turned off');
      const session = await requireSession(req.params.id);
      await ensureComposed(session);
      await ensureShareBundle(session, { upload: true });
      const state = shareState(session);
      res.json({ ...state, qrSvg: await qrSvg(state.url) });
    }),
  );

  app.post(
    '/api/sessions/:id/email',
    wrap(async (req, res) => {
      if (!emailQueue) throw new HttpError(409, 'email_disabled', 'Email is turned off');
      res.json(await queueEmail(await requireSession(req.params.id), req.body ?? {}));
    }),
  );

  app.get(
    '/api/sessions/:id/share',
    wrap(async (req, res) => {
      if (!sharingOn) throw new HttpError(409, 'sharing_disabled', 'Sharing is turned off');
      res.json(shareState(await requireSession(req.params.id)));
    }),
  );

  /**
   * Live preview as a motion-JPEG stream (a plain <img src> in the browser).
   * With green screen: ?session=<id> keys it onto that session's background with that session's settings (what the guest
   * sees is what gets printed); ?bg=<id> does the same for a guest who is still choosing. &mirror=1 flips only the person.
   */
  app.get('/api/camera/stream', async (req, res) => {
    let open = true;
    req.on('close', () => {
      open = false;
    });
    let keying = null;
    if (greenOn && (req.query.session || req.query.bg)) {
      const session = req.query.session ? await store.find(String(req.query.session)) : null;
      if (session?.background && backgrounds.has(session.background.id)) keying = { id: session.background.id, key: session.background.key };
      else if (!req.query.session && backgrounds.has(String(req.query.bg))) keying = { id: String(req.query.bg), key: settings.key };
      if (!keying) return res.status(404).json({ error: 'bad_background', message: 'That background does not exist' });
    }
    const mirror = Boolean(keying) && req.query.mirror === '1';
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Connection: 'keep-alive',
    });
    await liveView.acquire();
    try {
      let last = null;
      let warned = false;
      while (open) {
        const frame = await camera.liveFrame();
        let current = last;
        if (frame) {
          current = frame;
          if (keying) {
            try {
              current = await keyToJpeg({ source: frame, background: backgroundPixels(keying.id), width: previewWidth, key: keying.key, mirror, quality: 72 });
            } catch (err) {
              // A damaged live frame (it happens) must not end the preview: show the previous picture instead.
              if (!warned) logger.warn(`live preview keying failed: ${err.message}`);
              warned = true;
              current = last;
            }
          }
        }
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
    return undefined;
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
        sharing: {
          enabled: sharingOn,
          mode: config.sharing.mode,
          baseUrl: sharingOn ? shareBase : null,
          qrOnPrint: config.sharing.qrOnPrint,
          autoUpload: config.sharing.autoUpload,
          uploads: uploadQueue ? uploadQueue.list().filter((i) => i.status !== 'done').slice(0, 12) : [],
        },
        email: { enabled: Boolean(emailQueue), from: emailQueue ? config.email.from : null, host: emailQueue ? config.email.smtp.host : null, queue: emailQueue ? emailQueue.list().slice(0, 12) : [], marketingOptIn: config.email.marketingOptIn.enabled },
        station: { enabled: config.station.enabled, url: stationUrl, online: Boolean(hub?.online()), approvalRequired: Boolean(approvals) && settings.approvalRequired, timeoutSeconds: config.station.approval.timeoutSeconds, onTimeout: config.station.approval.onTimeout, waiting: approvals ? approvals.pending().length : 0 },
        greenScreen: greenOn ? { enabled: true, key: { ...settings.key }, defaults: { ...DEFAULT_KEY }, backdrop: settings.backdrop, backgrounds: backgrounds.list().map((b) => ({ ...b, thumbUrl: thumbUrl(b.id) })), folder: config.greenScreen.dir } : { enabled: false },
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

  /** One keyed live picture with settings that are NOT yet saved: what the operator sees while moving the sliders. */
  app.post(
    '/api/operator/greenscreen/frame',
    wrap(async (req, res) => {
      requireGreen();
      const { view = 'composite', background, key: patch = {}, mirror = false } = req.body ?? {};
      if (!['composite', 'matte', 'raw'].includes(view)) throw new HttpError(400, 'bad_view', 'view must be composite, matte or raw');
      const id = background ?? backgrounds.list().find((b) => b.id === settings.backdrop)?.id ?? backgrounds.firstId();
      if (!backgrounds.has(id)) throw new HttpError(400, 'bad_background', 'That background does not exist');
      const merged = mergeKey(settings.key, patch);
      if (merged.problems) throw new HttpError(400, 'bad_key', merged.problems.join('; '));
      if (capturing) throw new HttpError(409, 'busy', 'A guest is using the camera right now');
      const frame = await grabLiveFrame();
      const jpeg = await keyToJpeg({ source: frame, background: backgroundPixels(id), width: previewWidth, key: merged.key, view, mirror: mirror === true, quality: 78 });
      res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }).send(jpeg);
    }),
  );

  /** Looks at the EMPTY backdrop and suggests settings (they are shown to the operator, not saved until they say so). */
  app.post(
    '/api/operator/greenscreen/calibrate',
    wrap(async (req, res) => {
      requireGreen();
      if (capturing) throw new HttpError(409, 'busy', 'A guest is using the camera right now');
      const suggestion = await suggestKeyFromJpeg(await grabLiveFrame());
      logger.info(`operator calibrated the backdrop: ${suggestion.ok ? `sensitivity ${suggestion.sensitivity}, softness ${suggestion.softness}` : 'could not (see advice)'}`);
      res.json(suggestion);
    }),
  );

  app.post(
    '/api/operator/check-email',
    wrap(async (req, res) => {
      if (!mailer) throw new HttpError(409, 'email_disabled', 'Email is not enabled (email.enabled in config.json)');
      res.json(await mailer.verify());
    }),
  );

  app.post(
    '/api/operator/test-email',
    wrap(async (req, res) => {
      if (!mailer) throw new HttpError(409, 'email_disabled', 'Email is not enabled (email.enabled in config.json)');
      const to = normalizeEmail(req.body?.to);
      if (!isValidEmail(to)) throw new HttpError(400, 'invalid_email', 'That does not look like an email address');
      const dir = path.join(config.storage.dir, '_tests');
      const sample = path.join(dir, 'test-email-preview.jpg');
      await renderTestPattern({ width: 600, height: 900, dpi: 300, label: 'TEST EMAIL' }, sample);
      const content = buildEmail({ eventName: settings.eventName, intro: config.email.intro, url: `${shareBase || 'https://example.com'}/s/test-link/`, subject: `[Test] ${config.email.subject}`, brandName: config.sharing.brandName });
      try {
        await mailer.send({ to, ...content, attachments: [{ filename: 'photos.jpg', path: sample, cid: 'photos-preview' }] });
        logger.info(`operator sent a test email to ${maskEmail(to)}`);
        res.json({ ok: true, detail: `Test email sent to ${maskEmail(to)}. Check that inbox (and its spam folder).` });
      } catch (err) {
        res.json({ ok: false, detail: classifySmtpError(err).message });
      }
    }),
  );

  app.post('/api/operator/email/:id/retry', (req, res, next) => {
    if (!emailQueue?.retry(req.params.id)) return next(new HttpError(404, 'no_email', 'No such failed email'));
    return res.json({ ok: true });
  });

  app.delete('/api/operator/email/:id', (req, res, next) => {
    if (!emailQueue?.dismiss(req.params.id)) return next(new HttpError(404, 'no_email', 'No such failed email'));
    return res.json({ ok: true });
  });

  app.post(
    '/api/operator/check-upload',
    wrap(async (req, res) => {
      if (!uploader) throw new HttpError(409, 'not_upload_mode', 'Uploading to a web host is not enabled (sharing.mode is not "upload")');
      res.json(await uploader.check());
    }),
  );

  app.post('/api/operator/uploads/:id/retry', (req, res, next) => {
    if (!uploadQueue?.retry(req.params.id)) return next(new HttpError(404, 'no_upload', 'No such upload'));
    return res.json({ ok: true });
  });

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
        // With green screen: also show the photo with its backdrop replaced, using the settings as they are now.
        let keyedPreviewUrl = null;
        const wanted = req.body?.background;
        if (greenOn && wanted !== undefined && backgrounds.has(wanted)) {
          await fs.writeFile(path.join(dir, `${baseName}-keyed.jpg`), await keyToJpeg({ source: result.file, background: backgroundPixels(wanted), width: 1600, key: settings.key, quality: 85 }));
          keyedPreviewUrl = `/media/_tests/${baseName}-keyed.jpg`;
        }
        res.json({ previewUrl: `/media/_tests/${baseName}-preview.jpg`, keyedPreviewUrl, file: result.file });
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

  // What the station (a second part of the booth) is allowed to do on a session. It is handed these rather than reaching in.
  app.actions = { requireSession, ensureComposed, ensureShareBundle, shareState, printSession, queueEmail, isCapturing: () => capturing };
  app.approvals = approvals;
  return app;
}
