import http from 'node:http';
import fs from 'node:fs/promises';
import sharp from 'sharp';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const sampleJpeg = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } }).jpeg().toBuffer();

/**
 * A stand-in for digiCamControl's web server that follows the contract read from its source
 * (WebServerModule.cs / CommandLineProcessor.cs). It mirrors the SOURCE, not a real running instance -
 * the adapter still has to be verified against real software and a real camera.
 */
export async function startFakeDigiCamControl(overrides = {}) {
  const jpeg = await sampleJpeg();
  const state = {
    requests: [], // raw request URLs, in order
    commands: [], // [slc, param1, param2]
    cameras: ['TESTSERIAL1'],
    actionsEnabled: true,
    captureReply: 'OK',
    captureDelayMs: 30,
    writeFile: true,
    writeAs: null, // save under this file name (in the same folder) instead of the requested one
    lastCapturedAfter: null, // value `get lastcaptured` returns once a capture succeeds, even if no file was written
    extension: 'jpg',
    lastCaptured: '-',
    liveFrame: jpeg,
    hangCapture: false,
    concurrent: 0,
    maxConcurrent: 0,
    images: new Map(), // name -> Buffer served from /image/<name>
    ...overrides,
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake');
    state.requests.push(req.url);

    if (url.pathname === '/liveview.jpg') {
      if (!state.liveFrame) {
        res.setHeader('content-type', 'text/html');
        return res.end('<html>no live view</html>');
      }
      res.setHeader('content-type', 'image/jpeg');
      return res.end(state.liveFrame);
    }
    if (url.pathname.startsWith('/image/')) {
      const image = state.images.get(decodeURIComponent(url.pathname.slice('/image/'.length)));
      if (!image) {
        res.statusCode = 404;
        return res.end('not found');
      }
      res.setHeader('content-type', 'image/jpeg');
      return res.end(image);
    }

    const slc = url.searchParams.get('slc');
    if (!state.actionsEnabled || !slc) {
      // Real behaviour when actions are disabled: the normal web page comes back instead of a command reply.
      res.setHeader('content-type', 'text/html');
      return res.end('<!DOCTYPE html><html><body>digiCamControl</body></html>');
    }

    const p1 = url.searchParams.get('param1');
    const p2 = url.searchParams.get('param2');
    state.commands.push([slc, p1, p2]);
    state.concurrent += 1;
    state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent);
    try {
      switch (slc.toLowerCase()) {
        case 'list':
          // An empty list is reported as "OK" by the real server.
          return res.end(state.cameras.length > 0 ? `${state.cameras.join('\n')}\n` : 'OK');
        case 'get':
          return res.end(p1 === 'lastcaptured' ? state.lastCaptured : 'OK');
        case 'do':
          return res.end('OK');
        case 'capture': {
          if (state.hangCapture) return undefined; // never answer
          await sleep(state.captureDelayMs);
          if (state.captureReply !== 'OK') return res.end(state.captureReply); // errors come back as HTTP 200 text
          if (state.writeFile) {
            const requested = `${p1}.${state.extension}`;
            const file = state.writeAs ? requested.replace(/[^\\/]+$/, state.writeAs) : requested;
            await fs.writeFile(file, jpeg);
            state.lastCaptured = file.split(/[\\/]/).pop();
          }
          if (state.lastCapturedAfter) state.lastCaptured = state.lastCapturedAfter;
          return res.end('OK');
        }
        default:
          return res.end('Unknown command');
      }
    } finally {
      state.concurrent -= 1;
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    state,
    baseUrl,
    jpeg,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
