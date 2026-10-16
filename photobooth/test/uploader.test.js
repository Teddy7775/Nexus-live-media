import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UploadError, UploadQueue, WebHostUploader, signUpload } from '../server/uploader.js';
import { newShareToken } from '../server/share.js';
import { waitFor } from './helpers.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'uploader-test-'));

function bundle(dir, names = ['final.jpg', 'shot-1.jpg', 'index.html']) {
  for (const n of names) fs.writeFileSync(path.join(dir, n), `bytes of ${n}`);
  return names;
}

/** An uploader whose behaviour each test scripts. */
function scripted(handler) {
  const calls = [];
  return {
    calls,
    uploadFile: async (args) => {
      calls.push(args.name);
      return handler(args, calls.length);
    },
  };
}

const fast = { retryDelaysMs: [15, 15, 15], maxAgeMs: 60_000 };

test('signatures cover the timestamp, token, file name and body (changing any one changes it)', () => {
  const base = { secret: 's3cret-s3cret-s3cret', timestamp: '1760000000', token: 'a'.repeat(22), name: 'final.jpg', body: Buffer.from('x') };
  const sig = signUpload(base);
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.equal(signUpload(base), sig, 'deterministic');
  for (const change of [{ secret: 'other-other-other-1' }, { timestamp: '1760000001' }, { token: 'b'.repeat(22) }, { name: 'shot-1.jpg' }, { body: Buffer.from('y') }]) {
    assert.notEqual(signUpload({ ...base, ...change }), sig, JSON.stringify(Object.keys(change)));
  }
});

test('the uploader refuses to send anything outside the gallery whitelist', async () => {
  const up = new WebHostUploader({ url: 'https://example.com/booth/upload.php', secret: 'x'.repeat(20), fetchImpl: async () => assert.fail('must not reach the network') });
  assert.throws(() => up.uploadFile({ token: newShareToken(), name: '../../etc/passwd', buffer: Buffer.from('x') }), (e) => e instanceof UploadError && !e.retryable);
  assert.throws(() => up.uploadFile({ token: 'short', name: 'final.jpg', buffer: Buffer.from('x') }), UploadError);
});

test('HTTP outcomes are classified: server trouble retries, misconfiguration fails fast with the reason', async () => {
  const answer = (status, json, text) => async () => ({ ok: status < 400, status, json: async () => { if (json === undefined) throw new Error('not json'); return json; }, text: async () => text ?? '' });
  const attempt = (fetchImpl) => new WebHostUploader({ url: 'https://h/u.php', secret: 'x'.repeat(20), fetchImpl }).uploadFile({ token: newShareToken(), name: 'final.jpg', buffer: Buffer.from('x') });

  await assert.rejects(attempt(answer(401, { ok: false, error: 'bad signature' })), (e) => !e.retryable && e.status === 401 && /bad signature/.test(e.message));
  await assert.rejects(attempt(answer(400, { ok: false, error: 'not a JPEG image' })), (e) => !e.retryable);
  await assert.rejects(attempt(answer(413, { ok: false, error: 'file too large' })), (e) => !e.retryable);
  await assert.rejects(attempt(answer(500, { ok: false, error: 'cannot write' })), (e) => e.retryable);
  await assert.rejects(attempt(answer(503, undefined)), (e) => e.retryable, 'host maintenance page');
  await assert.rejects(attempt(answer(429, { ok: false, error: 'slow down' })), (e) => e.retryable);
  await assert.rejects(attempt(async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }), (e) => e.retryable && /ENOTFOUND/.test(e.message));
  await assert.rejects(attempt(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }), (e) => e.retryable && /did not answer/.test(e.message));
  await assert.doesNotReject(attempt(answer(200, { ok: true })));
});

test('queue: uploads every file in order, then reports the session as uploaded', async () => {
  const dir = tmp();
  try {
    const files = bundle(dir);
    const up = scripted(() => ({ ok: true }));
    const uploaded = [];
    const queue = new UploadQueue({ uploader: up, file: path.join(dir, 'q.json'), onUploaded: async (id, v) => uploaded.push([id, v]), ...fast });
    queue.enqueue({ sessionId: 's1', token: newShareToken(), dir, files, version: 3 });
    await waitFor(() => uploaded.length === 1);
    assert.deepEqual(up.calls, files);
    assert.deepEqual(uploaded, [['s1', 3]]);
    assert.equal(queue.pending(), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('queue: a flaky connection retries, and does not re-send files that already went through', async () => {
  const dir = tmp();
  try {
    const files = bundle(dir);
    let failures = 1;
    const up = scripted(({ name }) => {
      if (name === 'shot-1.jpg' && failures-- > 0) throw new UploadError('Cannot reach the web host', { retryable: true });
      return { ok: true };
    });
    const uploaded = [];
    const queue = new UploadQueue({ uploader: up, file: path.join(dir, 'q.json'), onUploaded: async (id) => uploaded.push(id), ...fast });
    queue.enqueue({ sessionId: 's1', token: newShareToken(), dir, files, version: 1 });
    await waitFor(() => uploaded.length === 1);
    assert.deepEqual(up.calls, ['final.jpg', 'shot-1.jpg', 'shot-1.jpg', 'index.html'], 'final.jpg was not re-sent after the retry');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('queue: a misconfigured host (rejected upload) fails at once with the reason, instead of retrying forever', async () => {
  const dir = tmp();
  try {
    const files = bundle(dir);
    const up = scripted(() => {
      throw new UploadError('The web host rejected the upload (401): bad signature', { status: 401, retryable: false });
    });
    const queue = new UploadQueue({ uploader: up, file: path.join(dir, 'q.json'), ...fast });
    const item = queue.enqueue({ sessionId: 's1', token: newShareToken(), dir, files, version: 1 });
    await waitFor(() => queue.list()[0].status === 'failed');
    assert.match(queue.list()[0].error, /bad signature/);
    assert.equal(queue.list()[0].attempts, 1);
    assert.equal(queue.pending(), 0);

    // The operator can retry after fixing the secret.
    up.uploadFile = async () => ({ ok: true });
    assert.equal(queue.retry(item.id), true);
    await waitFor(() => queue.list().length === 0 || queue.list()[0].status === 'done');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('queue: gives up visibly after maxAge when the internet never comes back', async () => {
  const dir = tmp();
  try {
    const files = bundle(dir);
    const up = scripted(() => {
      throw new UploadError('Cannot reach the web host', { retryable: true });
    });
    const queue = new UploadQueue({ uploader: up, file: path.join(dir, 'q.json'), retryDelaysMs: [10], maxAgeMs: 60 });
    queue.enqueue({ sessionId: 's1', token: newShareToken(), dir, files, version: 1 });
    await waitFor(() => queue.list()[0]?.status === 'failed', { timeoutMs: 3000 });
    assert.match(queue.list()[0].error, /Gave up after/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('queue: survives a crash or reboot - pending uploads resume from the file on disk', async () => {
  const dir = tmp();
  try {
    const files = bundle(dir);
    const file = path.join(dir, 'q.json');
    const down = scripted(() => {
      throw new UploadError('offline', { retryable: true });
    });
    const first = new UploadQueue({ uploader: down, file, retryDelaysMs: [60_000], maxAgeMs: 60_000 });
    first.enqueue({ sessionId: 's1', token: newShareToken(), dir, files, version: 2 });
    await waitFor(() => first.list()[0]?.attempts === 1);
    await first.flush();
    first.stop(); // "the PC lost power"

    const up = scripted(() => ({ ok: true }));
    const uploaded = [];
    const second = await new UploadQueue({ uploader: up, file, onUploaded: async (id, v) => uploaded.push([id, v]), ...fast }).load();
    assert.equal(second.list().length, 1, 'the pending upload was reloaded');
    second.retry(second.list()[0].id); // the real queue would wait out its back-off; do not make the test wait a minute
    await waitFor(() => uploaded.length === 1);
    assert.deepEqual(uploaded, [['s1', 2]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('queue: a retake supersedes the older, unfinished upload of the same session (and leaves other sessions alone)', async () => {
  const dir = tmp();
  try {
    const files = bundle(dir);
    const up = scripted(() => {
      throw new UploadError('offline', { retryable: true });
    });
    const queue = new UploadQueue({ uploader: up, file: path.join(dir, 'q.json'), retryDelaysMs: [60_000], maxAgeMs: 60_000 });
    queue.stop();
    queue.enqueue({ sessionId: 's1', token: newShareToken(), dir, files, version: 1 });
    queue.enqueue({ sessionId: 's2', token: newShareToken(), dir, files, version: 1 });
    queue.enqueue({ sessionId: 's1', token: newShareToken(), dir, files, version: 2 });
    await waitFor(() => queue.list().every((i) => i.attempts >= 1));
    const items = queue.list().map((i) => `${i.sessionId}@${i.version}`).sort();
    assert.deepEqual(items, ['s1@2', 's2@1']);
    queue.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('queue: a gallery file that disappeared fails that item with a clear reason (not a crash loop)', async () => {
  const dir = tmp();
  try {
    const up = scripted(() => ({ ok: true }));
    const queue = new UploadQueue({ uploader: up, file: path.join(dir, 'q.json'), ...fast });
    queue.enqueue({ sessionId: 's1', token: newShareToken(), dir, files: ['final.jpg'], version: 1 });
    await waitFor(() => queue.list()[0]?.status === 'failed');
    assert.match(queue.list()[0].error, /final\.jpg is missing/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
