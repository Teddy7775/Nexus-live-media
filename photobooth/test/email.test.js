import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { EmailQueue, EmailRejected, Mailer, appendOptIn, buildEmail, classifySmtpError } from '../server/email.js';
import { startFakeSmtp, smtpRefusal } from './fakeSmtp.js';
import { waitFor } from './helpers.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'email-test-'));
const URL_A = 'https://photos.example.com/booth/s/AAAAAAAAAAAAAAAAAAAAAA/';
const LIMITS = { maxPerSession: 3, maxPerAddressPerHour: 3 };

async function previewJpeg(dir) {
  const file = path.join(dir, 'final-preview.jpg');
  await sharp({ create: { width: 120, height: 180, channels: 3, background: '#336699' } }).jpeg().toFile(file);
  return file;
}

/** Builds a queue wired to a real SMTP server; `ready` lets a test hold the link back. */
async function setup({ smtp, dir, ready = () => true, limits = LIMITS, extra = {} }) {
  const logs = [];
  const logger = { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) };
  const sent = [];
  const queue = await new EmailQueue({
    mailer: new Mailer({ smtp: smtp.smtp(), from: 'Nexus Booth <booth@test.local>' }),
    file: path.join(dir, 'email-queue.json'),
    isShareReady: async () => ready(),
    onSent: async (item) => sent.push(item),
    logger,
    limits,
    intro: 'Thanks for celebrating with us! Your photos are ready:',
    subject: 'Your photos from {event}',
    brandName: 'Nexus Live Media',
    retryDelaysMs: [20, 20, 20],
    readyPollMs: 10,
    maxAgeMs: 60_000,
    ...extra,
  }).load();
  return { queue, logs, sent };
}

const enqueue = (queue, dir, over = {}) => queue.enqueue({ sessionId: 's1', email: 'jane.doe@example.com', shareUrl: URL_A, eventName: 'Sarah & James Wedding', eventSlug: 'ev', previewFile: path.join(dir, 'final-preview.jpg'), ...over });

// ------------------------------------------------------------------- content

test('the email carries the link, an inline preview, and an honest note about the address', () => {
  const mail = buildEmail({ eventName: 'Sarah & James <Wedding>', intro: 'Your photos are ready:', url: URL_A, subject: 'Your photos from {event}', brandName: 'Nexus Live Media' });
  assert.equal(mail.subject, 'Your photos from Sarah & James <Wedding>');
  assert.ok(mail.text.includes(URL_A));
  assert.match(mail.text, /We have not kept your email address/);
  assert.ok(mail.html.includes(`href="${URL_A}"`));
  assert.ok(mail.html.includes('cid:photos-preview'));
  assert.equal(mail.html.includes('<Wedding>'), false, 'the event name is escaped in the HTML');
  assert.match(mail.html, /Sarah &amp; James &lt;Wedding&gt;/);
  assert.match(buildEmail({ eventName: 'x', intro: 'i', url: URL_A, subject: 's', optedIn: true }).text, /hear about future events/);
});

test('a hostile event name cannot inject extra mail headers through the subject', () => {
  const mail = buildEmail({ eventName: 'Gala\r\nBcc: victim@example.com', intro: 'i', url: URL_A, subject: 'Photos from {event}' });
  assert.equal(/[\r\n]/.test(mail.subject), false);
  assert.match(mail.subject, /Gala Bcc: victim@example\.com/);
});

test('SMTP errors are classified: login problems and refusals never retry, "try later" and network trouble do', () => {
  const retry = (e) => classifySmtpError(e).retryable;
  assert.equal(retry(Object.assign(new Error('x'), { code: 'EAUTH', responseCode: 535 })), false);
  assert.match(classifySmtpError({ code: 'EAUTH' }).message, /rejected the login/);
  assert.equal(retry({ code: 'EENVELOPE', responseCode: 550, response: '550 No such user' }), false);
  assert.equal(retry({ responseCode: 552, response: '552 Message too large' }), false);
  assert.equal(retry({ code: 'EENVELOPE', responseCode: 451, response: '451 Greylisted, try again' }), true, '4xx is temporary even when labelled an envelope error');
  assert.equal(retry({ responseCode: 421 }), true);
  assert.equal(retry({ code: 'ECONNECTION', message: 'connect ECONNREFUSED' }), true);
  assert.equal(retry({ code: 'ETIMEDOUT' }), true);
  assert.equal(retry(new Error('getaddrinfo ENOTFOUND smtp.example.com')), true);
});

// ------------------------------------------------------------------ delivery

test('delivers the real message over SMTP; the address is not left on disk or in the logs afterwards', async () => {
  const smtp = await startFakeSmtp();
  const dir = tmp();
  try {
    const preview = await previewJpeg(dir);
    const { queue, logs, sent } = await setup({ smtp, dir });
    enqueue(queue, dir);
    await waitFor(() => smtp.state.messages.length === 1);

    const mail = smtp.state.messages[0];
    assert.equal(mail.to.value[0].address, 'jane.doe@example.com');
    assert.equal(mail.from.value[0].address, 'booth@test.local');
    assert.equal(mail.subject, 'Your photos from Sarah & James Wedding');
    assert.ok(mail.text.includes(URL_A));
    assert.ok(mail.html.includes('cid:photos-preview'));
    const attached = mail.attachments.find((a) => a.cid === 'photos-preview' || a.contentId === '<photos-preview>');
    assert.ok(attached, 'the preview picture is attached inline');
    assert.deepEqual(attached.content, fs.readFileSync(preview));

    await waitFor(() => queue.list().length === 0);
    assert.equal(sent.length, 1);
    await queue.flush();
    const onDisk = fs.readFileSync(path.join(dir, 'email-queue.json'), 'utf8');
    assert.equal(onDisk.includes('jane.doe'), false, 'no readable address remains on disk after sending');
    assert.equal(onDisk.includes('example.com'), false);
    assert.match(onDisk, /"recent":\[\{"h":"[0-9a-f]{32}"/, 'only a salted hash is kept, for the rate limits');
    assert.equal(logs.join('\n').includes('jane.doe'), false, 'logs never contain the full address');
    assert.match(logs.join('\n'), /j\*\*\*@example\.com/);
    queue.stop();
  } finally {
    await smtp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nothing is sent until the guest link is live', async () => {
  const smtp = await startFakeSmtp();
  const dir = tmp();
  try {
    await previewJpeg(dir);
    let live = false;
    const { queue } = await setup({ smtp, dir, ready: () => live });
    enqueue(queue, dir);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(smtp.state.messages.length, 0, 'held back while the gallery is still uploading');
    assert.equal(queue.list()[0].status, 'queued');
    assert.equal(queue.list()[0].attempts, 0, 'waiting is not a failed attempt');
    live = true;
    await waitFor(() => smtp.state.messages.length === 1);
    queue.stop();
  } finally {
    await smtp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a temporary refusal (451) is retried and then delivered', async () => {
  const smtp = await startFakeSmtp();
  const dir = tmp();
  try {
    await previewJpeg(dir);
    smtp.state.rejectRcpt = (addr, call) => (call === 1 ? smtpRefusal(451, 'Greylisted, please retry later') : undefined);
    const { queue } = await setup({ smtp, dir });
    enqueue(queue, dir);
    await waitFor(() => smtp.state.messages.length === 1);
    assert.equal(smtp.state.rcptCalls, 2, 'one refusal, then one success');
    queue.stop();
  } finally {
    await smtp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a permanent refusal (550) fails at once with the reason, is not retried, and the operator can dismiss it (erasing the address)', async () => {
  const smtp = await startFakeSmtp();
  const dir = tmp();
  try {
    await previewJpeg(dir);
    smtp.state.rejectRcpt = () => smtpRefusal(550, 'Mailbox does not exist');
    const { queue } = await setup({ smtp, dir });
    const { id } = enqueue(queue, dir, { email: 'nobody@example.com' });
    await waitFor(() => queue.list()[0]?.status === 'failed');
    assert.match(queue.list()[0].error, /refused the message \(550\).*Mailbox does not exist/);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(smtp.state.rcptCalls, 1, 'no retries for a permanent failure');
    assert.equal(queue.list()[0].to, 'n***@example.com', 'the operator sees a masked address only');

    await queue.flush();
    assert.ok(fs.readFileSync(path.join(dir, 'email-queue.json'), 'utf8').includes('nobody@example.com'), 'a failed address is kept briefly so it can be retried');
    assert.equal(queue.dismiss(id), true);
    await queue.flush();
    assert.equal(fs.readFileSync(path.join(dir, 'email-queue.json'), 'utf8').includes('nobody'), false, 'dismissing erases it');
    assert.equal(queue.dismiss('nope'), false);
    queue.stop();
  } finally {
    await smtp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a wrong mail login fails with a clear message; after fixing the config and restarting, Retry delivers it', async () => {
  const smtp = await startFakeSmtp();
  const dir = tmp();
  try {
    await previewJpeg(dir);
    // The booth is configured with an old password; the mail server expects the current one.
    const wrongMailer = new Mailer({ smtp: { ...smtp.smtp(), pass: 'old-password' }, from: 'x@test.local' });
    const first = await setup({ smtp, dir, extra: { mailer: wrongMailer } });
    const { id } = enqueue(first.queue, dir);
    await waitFor(() => first.queue.list()[0]?.status === 'failed');
    assert.match(first.queue.list()[0].error, /rejected the login.*email\.smtp\.user and email\.smtp\.pass/);
    assert.equal(smtp.state.messages.length, 0);
    await first.queue.flush();
    first.queue.stop();

    // The operator fixes config.json and restarts the booth: the failed email is still there, then Retry sends it.
    const second = await setup({ smtp, dir });
    assert.equal(second.queue.list()[0].status, 'failed');
    assert.equal(second.queue.retry(id), true);
    await waitFor(() => smtp.state.messages.length === 1);
    second.queue.stop();
  } finally {
    await smtp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('when the venue connection is down it keeps retrying, then gives up visibly after the maximum age', async () => {
  const dir = tmp();
  const dead = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => dead.once('listening', r));
  const port = dead.address().port;
  await new Promise((r) => dead.close(r)); // nothing listens on this port any more
  try {
    await previewJpeg(dir);
    const logs = [];
    const queue = await new EmailQueue({
      mailer: new Mailer({ smtp: { host: '127.0.0.1', port, secure: false, user: 'u', pass: 'p' }, from: 'x@test.local' }),
      file: path.join(dir, 'q.json'),
      isShareReady: async () => true,
      logger: { info: () => {}, warn: (m) => logs.push(m), error: () => {} },
      limits: LIMITS,
      retryDelaysMs: [15],
      maxAgeMs: 250,
    }).load();
    enqueue(queue, dir);
    await waitFor(() => queue.list()[0]?.attempts >= 2, { timeoutMs: 4000 });
    assert.equal(queue.list()[0].status === 'queued' || queue.list()[0].status === 'sending', true, 'still trying');
    await waitFor(() => queue.list()[0]?.status === 'failed', { timeoutMs: 6000 });
    assert.match(queue.list()[0].error, /Gave up after/);
    queue.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('queued emails survive a crash or reboot and are sent when the booth comes back', async () => {
  const dir = tmp();
  const smtp = await startFakeSmtp();
  try {
    await previewJpeg(dir);
    let live = false;
    const first = await setup({ smtp, dir, ready: () => live });
    enqueue(first.queue, dir);
    await first.queue.flush();
    first.queue.stop(); // "power cut"

    const second = await setup({ smtp, dir, ready: () => true });
    assert.equal(second.queue.list().length, 1, 'the pending email was reloaded');
    await waitFor(() => smtp.state.messages.length === 1);
    second.queue.stop();
  } finally {
    await smtp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------- limits

test('limits: bad addresses, repeats, per-session and per-address caps (the kiosk cannot be used to spam strangers)', async () => {
  const smtp = await startFakeSmtp();
  const dir = tmp();
  try {
    await previewJpeg(dir);
    const { queue } = await setup({ smtp, dir, limits: { maxPerSession: 2, maxPerAddressPerHour: 2 }, ready: () => false });
    const code = (fn) => { try { fn(); return null; } catch (e) { assert.ok(e instanceof EmailRejected); return `${e.code}/${e.status}`; } };

    assert.equal(code(() => enqueue(queue, dir, { email: 'not-an-email' })), 'invalid_email/400');
    assert.equal(code(() => enqueue(queue, dir, { email: 'a@example.com' })), null);
    const again = enqueue(queue, dir, { email: ' A@Example.com ' });
    assert.equal(again.duplicate, true, 'the same address for the same session is not sent twice');
    assert.equal(code(() => enqueue(queue, dir, { email: 'b@example.com' })), null);
    assert.equal(code(() => enqueue(queue, dir, { email: 'c@example.com' })), 'too_many_for_session/429');

    // Another guest's session: one address may only receive so many emails per hour from this booth.
    assert.equal(code(() => enqueue(queue, dir, { sessionId: 's2', email: 'a@example.com' })), null);
    assert.equal(code(() => enqueue(queue, dir, { sessionId: 's3', email: 'a@example.com' })), 'too_many_for_address/429');
    assert.equal(queue.list().length, 3);
    queue.stop();
  } finally {
    await smtp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the rate limits are remembered across a restart', async () => {
  const smtp = await startFakeSmtp();
  const dir = tmp();
  try {
    await previewJpeg(dir);
    const first = await setup({ smtp, dir, limits: { maxPerSession: 1, maxPerAddressPerHour: 5 }, ready: () => false });
    enqueue(first.queue, dir, { email: 'a@example.com' });
    await first.queue.flush();
    first.queue.stop();
    const second = await setup({ smtp, dir, limits: { maxPerSession: 1, maxPerAddressPerHour: 5 }, ready: () => false });
    assert.throws(() => enqueue(second.queue, dir, { email: 'b@example.com' }), (e) => e.code === 'too_many_for_session');
    second.queue.stop();
  } finally {
    await smtp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------- marketing

test('the marketing opt-in file is written only for guests who ticked the box, after a successful send', async () => {
  const smtp = await startFakeSmtp();
  const dir = tmp();
  try {
    await previewJpeg(dir);
    const optFile = path.join(dir, 'optin-emails.csv');
    const { queue } = await setup({
      smtp,
      dir,
      extra: { onSent: async (item) => item.optIn && appendOptIn({ file: optFile, email: item.to, eventName: item.eventName, now: new Date('2026-10-16T12:00:00Z') }) },
    });
    enqueue(queue, dir, { sessionId: 's1', email: 'private@example.com', optIn: false });
    enqueue(queue, dir, { sessionId: 's2', email: 'happy@example.com', optIn: true });
    await waitFor(() => smtp.state.messages.length === 2);
    await waitFor(() => fs.existsSync(optFile));
    const csv = fs.readFileSync(optFile, 'utf8');
    assert.equal(csv, 'email,opted_in_at,event\nhappy@example.com,2026-10-16T12:00:00.000Z,Sarah & James Wedding\n');
    assert.equal(csv.includes('private@example.com'), false, 'a guest who did not opt in is never recorded');
    queue.stop();
  } finally {
    await smtp.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('opt-in CSV cannot be turned into a spreadsheet formula, and quotes/commas are escaped', async () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'optin.csv');
    await appendOptIn({ file, email: '=cmd|calc@example.com', eventName: 'Smith, "Jones" & Co', now: new Date('2026-10-16T12:00:00Z') });
    await appendOptIn({ file, email: 'ok@example.com', eventName: '+1+1', now: new Date('2026-10-16T12:00:00Z') });
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines[0], 'email,opted_in_at,event');
    assert.equal(lines[1], "'=cmd|calc@example.com,2026-10-16T12:00:00.000Z,\"Smith, \"\"Jones\"\" & Co\"");
    assert.equal(lines[2], "ok@example.com,2026-10-16T12:00:00.000Z,'+1+1");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Mailer.verify reports a good login, a bad one and an unreachable server in plain words', async () => {
  const smtp = await startFakeSmtp();
  try {
    assert.deepEqual(await new Mailer({ smtp: smtp.smtp(), from: 'x@test.local' }).verify(), { ok: true, detail: 'The mail server accepted the login' });
    const bad = await new Mailer({ smtp: { ...smtp.smtp(), pass: 'nope' }, from: 'x@test.local' }).verify();
    assert.equal(bad.ok, false);
    assert.match(bad.detail, /rejected the login/);
  } finally {
    await smtp.close();
  }
  const down = await new Mailer({ smtp: { host: '127.0.0.1', port: 1, secure: false, user: 'u', pass: 'p' }, from: 'x@test.local' }).verify();
  assert.equal(down.ok, false);
  assert.match(down.detail, /Cannot send right now/);
});
