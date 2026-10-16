import path from 'node:path';
import express from 'express';
import { SESSION_ID } from './store.js';
import { SHARE_FILE, SHARE_TOKEN } from './share.js';

const NOT_FOUND = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Photos not found</title>
<style>body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center;background:#f4f6fa;color:#111827}@media(prefers-color-scheme:dark){body{background:#0b0f16;color:#eef1f7}}p{max-width:30em;color:#5b6578}</style></head>
<body><main><h1>Photos not found</h1><p>The link may be mistyped, or your photos are not ready yet. If you have just taken them, wait a minute and refresh this page.</p></main></body></html>`;

/**
 * The only part of the booth that phones and a second station can reach over the network. It serves guests'
 * galleries (read-only, by unguessable token) and nothing else: the camera, printer and operator controls live on
 * the booth's own localhost-only server. Every failure looks identical, so a stranger learns nothing from probing.
 */
export function createLanApp({ shareIndex, store, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
    next();
  });

  const notFound = (res) => res.status(404).type('html').send(NOT_FOUND);

  app.get('/health', (req, res) => res.type('text').send('ok'));

  app.get('/s/:token/:file?', (req, res) => {
    const { token } = req.params;
    const file = req.params.file ?? 'index.html';
    if (!SHARE_TOKEN.test(token) || !SHARE_FILE.test(file)) return notFound(res);
    const ref = shareIndex.get(token);
    if (!ref || !SESSION_ID.test(ref.sessionId)) return notFound(res);
    // The gallery lives at /s/<token>/ so its relative image links resolve; add the slash if it is missing.
    if (!req.params.file && !req.path.endsWith('/')) return res.redirect(301, `${req.path}/`);

    let dir;
    try {
      dir = path.join(store.eventDir(ref.eventSlug), ref.sessionId, 'share');
    } catch {
      return notFound(res);
    }
    res.set('Cache-Control', 'private, max-age=60');
    return res.sendFile(file, { root: dir, dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) notFound(res);
    });
  });

  app.use((req, res) => notFound(res));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger?.error?.(`lan ${req.method} ${req.originalUrl}: ${err?.stack ?? err}`);
    if (!res.headersSent) notFound(res);
  });
  return app;
}
