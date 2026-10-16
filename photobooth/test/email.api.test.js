import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startBooth, waitFor } from './helpers.js';
import { startFakeSmtp, smtpRefusal } from './fakeSmtp.js';

const emailOverrides = (smtp, extra = {}) => ({
  sharing: { enabled: true, mode: 'local', publicBaseUrl: 'http://gallery.test:3001', brandName: 'Nexus Live Media' },
  email: { enabled: true, from: 'Nexus Booth <booth@test.local>', smtp: smtp.smtp(), marketingOptIn: { enabled: true, label: 'Keep me posted' }, maxPerSession: 2, maxPerAddressPerHour: 5, ...extra },
});

async function withBooth(smtp, options, fn) {
  const booth = await startBooth({ ...options, overrides: options.overrides ?? emailOverrides(smtp) });
  try {
    await fn(booth);
  } finally {
    booth.emailQueue?.stop();
    await booth.close();
  }
}

async function finishSession(booth, { share = true } = {}) {
  const session = (await booth.api('POST', '/api/sessions')).json;
  for (let i = 0; i < session.shotsNeeded; i++) assert.equal((await booth.api('POST', `/api/sessions/${session.id}/shots`)).status, 200);
  if (share) await booth.api('POST', `/api/sessions/${session.id}/share`);
  return session;
}

const optInFile = (booth) => path.join(booth.config.storage.dir, 'default', 'optin-emails.csv');

test('the guest gets an email whose link really opens their gallery', async () => {
  const smtp = await startFakeSmtp();
  try {
    await withBooth(smtp, {}, async (booth) => {
      const session = await finishSession(booth);
      const share = (await booth.api('GET', `/api/sessions/${session.id}/share`)).json;
      const res = await booth.api('POST', `/api/sessions/${session.id}/email`, { email: 'Jane.Doe@Example.com' });
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.json, { queued: true, masked: 'j***@example.com', duplicate: false });

      await waitFor(() => smtp.state.messages.length === 1);
      const mail = smtp.state.messages[0];
      assert.equal(mail.to.value[0].address, 'jane.doe@example.com');
      assert.equal(mail.subject, 'Your photos from Nexus Photo Booth');
      assert.ok(mail.text.includes(share.url), 'the email contains the same link as the QR code');
      assert.ok(mail.attachments.some((a) => a.cid === 'photos-preview'), 'with an inline preview picture');
      assert.match(mail.text, /Nexus Live Media/);

      // Follow the link from the email: serve it through the real gallery listener.
      const token = share.url.split('/s/')[1].replace('/', '');
      const page = await fetch(`${booth.lanUrl}/s/${token}/`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Nexus Photo Booth/);
    });
  } finally {
    await smtp.close();
  }
});

test('asking to email before anything was composed or shared still produces a working link', async () => {
  const smtp = await startFakeSmtp();
  try {
    await withBooth(smtp, {}, async (booth) => {
      const session = await finishSession(booth, { share: false });
      assert.equal((await booth.api('POST', `/api/sessions/${session.id}/email`, { email: 'a@example.com' })).status, 200);
      await waitFor(() => smtp.state.messages.length === 1);
      const token = smtp.state.messages[0].text.match(/\/s\/([A-Za-z0-9_-]{22})\//)[1];
      assert.equal((await fetch(`${booth.lanUrl}/s/${token}/final.jpg`)).status, 200);
    });
  } finally {
    await smtp.close();
  }
});

test('bad addresses, repeats and the per-session cap get clear, guest-safe answers', async () => {
  const smtp = await startFakeSmtp();
  try {
    await withBooth(smtp, {}, async (booth) => {
      const session = await finishSession(booth);
      const post = (email, extra) => booth.api('POST', `/api/sessions/${session.id}/email`, { email, ...extra });

      const bad = await post('not-an-email');
      assert.equal(bad.status, 400);
      assert.equal(bad.json.error, 'invalid_email');
      assert.equal((await post(undefined)).status, 400);
      assert.equal((await post({ nested: 'object' })).status, 400);

      assert.equal((await post('a@example.com')).json.duplicate, false);
      assert.equal((await post(' A@EXAMPLE.com ')).json.duplicate, true, 'the same address twice is not emailed twice');
      assert.equal((await post('b@example.com')).status, 200);
      const capped = await post('c@example.com');
      assert.equal(capped.status, 429);
      assert.equal(capped.json.error, 'too_many_for_session');
      assert.match(capped.json.message, /up to 2 addresses/);

      await waitFor(() => smtp.state.messages.length === 2);
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(smtp.state.messages.length, 2, 'exactly one email per distinct accepted address');
    });
  } finally {
    await smtp.close();
  }
});

test('with email switched off the endpoints say so', async () => {
  await withBooth(null, { overrides: { sharing: { enabled: true, mode: 'local', publicBaseUrl: 'http://gallery.test:3001' } } }, async (booth) => {
    const session = await finishSession(booth);
    const res = await booth.api('POST', `/api/sessions/${session.id}/email`, { email: 'a@example.com' });
    assert.equal(res.status, 409);
    assert.equal(res.json.error, 'email_disabled');
    assert.equal((await booth.api('GET', '/api/state')).json.email.enabled, false);
    assert.equal((await booth.operator('POST', '/api/operator/check-email')).status, 409);
  });
});

test('marketing opt-in: an address is recorded only when the guest ticked the box AND the feature is on', async () => {
  const smtp = await startFakeSmtp();
  try {
    await withBooth(smtp, {}, async (booth) => {
      const s1 = await finishSession(booth);
      const s2 = await finishSession(booth);
      const s3 = await finishSession(booth);
      await booth.api('POST', `/api/sessions/${s1.id}/email`, { email: 'private@example.com' });
      await booth.api('POST', `/api/sessions/${s2.id}/email`, { email: 'happy@example.com', optIn: true });
      await booth.api('POST', `/api/sessions/${s3.id}/email`, { email: 'sneaky@example.com', optIn: 'yes' }); // not literally true
      await waitFor(() => smtp.state.messages.length === 3);
      await waitFor(() => fs.existsSync(optInFile(booth)));
      const csv = fs.readFileSync(optInFile(booth), 'utf8');
      assert.match(csv, /happy@example\.com,/);
      assert.equal(csv.includes('private@example.com'), false);
      assert.equal(csv.includes('sneaky@example.com'), false);
    });
  } finally {
    await smtp.close();
  }
});

test('when the opt-in feature is off, a client claiming opt-in is ignored and nothing is recorded', async () => {
  const smtp = await startFakeSmtp();
  try {
    await withBooth(smtp, { overrides: emailOverrides(smtp, { marketingOptIn: { enabled: false, label: '' } }) }, async (booth) => {
      const session = await finishSession(booth);
      await booth.api('POST', `/api/sessions/${session.id}/email`, { email: 'happy@example.com', optIn: true });
      await waitFor(() => smtp.state.messages.length === 1);
      await new Promise((r) => setTimeout(r, 120));
      assert.equal(fs.existsSync(optInFile(booth)), false);
    });
  } finally {
    await smtp.close();
  }
});

test('upload mode: the email waits until the gallery is on the web host, then goes out with the web address', async () => {
  const smtp = await startFakeSmtp();
  let release;
  const gate = new Promise((r) => (release = r));
  const uploaded = [];
  const uploader = { uploadFile: async (a) => { await gate; uploaded.push(a.name); return { ok: true }; }, check: async () => ({ ok: true, detail: 'fake' }) };
  try {
    const overrides = emailOverrides(smtp);
    overrides.sharing = { enabled: true, mode: 'upload', publicBaseUrl: 'https://photos.example.com/booth', upload: { url: 'https://photos.example.com/booth/upload.php', secret: 'x'.repeat(24) } };
    await withBooth(smtp, { overrides, uploader }, async (booth) => {
      const session = await finishSession(booth);
      assert.equal((await booth.api('POST', `/api/sessions/${session.id}/email`, { email: 'a@example.com' })).status, 200);
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(smtp.state.messages.length, 0, 'not sent while the upload is still in progress');
      release();
      await waitFor(() => smtp.state.messages.length === 1, { timeoutMs: 8000 });
      assert.match(smtp.state.messages[0].text, /https:\/\/photos\.example\.com\/booth\/s\/[A-Za-z0-9_-]{22}\//);
      assert.ok(uploaded.includes('index.html'));
    });
  } finally {
    await smtp.close();
  }
});

// ------------------------------------------------------------------ operator

test('operator: sees a masked queue, can verify the login, send a test email, retry and dismiss failures - never sees secrets', async () => {
  const smtp = await startFakeSmtp();
  try {
    await withBooth(smtp, {}, async (booth) => {
      for (const route of ['check-email', 'test-email']) assert.equal((await booth.api('POST', `/api/operator/${route}`, { to: 'a@example.com' })).status, 401, 'needs the PIN');

      const ok = await booth.operator('POST', '/api/operator/check-email');
      assert.deepEqual(ok.json, { ok: true, detail: 'The mail server accepted the login' });

      assert.equal((await booth.operator('POST', '/api/operator/test-email', { to: 'nope' })).status, 400);
      const test = await booth.operator('POST', '/api/operator/test-email', { to: 'Boss@Example.com' });
      assert.equal(test.json.ok, true);
      assert.match(test.json.detail, /b\*\*\*@example\.com/);
      await waitFor(() => smtp.state.messages.length === 1);
      assert.match(smtp.state.messages[0].subject, /^\[Test\] Your photos from/);
      assert.ok(smtp.state.messages[0].attachments.some((a) => a.cid === 'photos-preview'));

      // A refused address shows up as failed (masked); after the problem is gone the operator can retry.
      smtp.state.rejectRcpt = () => smtpRefusal(550, 'Mailbox unavailable');
      const session = await finishSession(booth);
      await booth.api('POST', `/api/sessions/${session.id}/email`, { email: 'guest.person@example.com' });
      const failed = await waitFor(async () => {
        const status = (await booth.operator('GET', '/api/operator/status')).json;
        return status.email.queue.find((i) => i.status === 'failed') ?? null;
      });
      assert.equal(failed.to, 'g***@example.com');
      assert.match(failed.error, /550/);
      const statusJson = JSON.stringify((await booth.operator('GET', '/api/operator/status')).json);
      assert.equal(statusJson.includes('guest.person'), false, 'no full address in the operator view');
      assert.equal(statusJson.includes(smtp.state.pass), false, 'no SMTP password in the operator view');

      smtp.state.rejectRcpt = null;
      assert.equal((await booth.operator('POST', `/api/operator/email/${failed.id}/retry`)).status, 200);
      await waitFor(() => smtp.state.messages.length === 2);

      // Dismiss: a second failure can be forgotten, erasing the address.
      smtp.state.rejectRcpt = () => smtpRefusal(550, 'Mailbox unavailable');
      const s2 = await finishSession(booth);
      await booth.api('POST', `/api/sessions/${s2.id}/email`, { email: 'second.guest@example.com' });
      const failed2 = await waitFor(async () => (await booth.operator('GET', '/api/operator/status')).json.email.queue.find((i) => i.status === 'failed') ?? null);
      assert.equal((await booth.operator('DELETE', `/api/operator/email/${failed2.id}`)).status, 200);
      assert.equal((await booth.operator('DELETE', `/api/operator/email/${failed2.id}`)).status, 404);
      await booth.emailQueue.flush();
      assert.equal(fs.readFileSync(path.join(booth.config.storage.dir, '_queues', 'email-queue.json'), 'utf8').includes('second.guest'), false);
    });
  } finally {
    await smtp.close();
  }
});

test('operator: a wrong mail password is reported in plain words by "check mail login"', async () => {
  const smtp = await startFakeSmtp();
  try {
    const overrides = emailOverrides(smtp);
    overrides.email.smtp = { ...smtp.smtp(), pass: 'not-the-password' };
    await withBooth(smtp, { overrides }, async (booth) => {
      const res = await booth.operator('POST', '/api/operator/check-email');
      assert.equal(res.json.ok, false);
      assert.match(res.json.detail, /rejected the login/);
    });
  } finally {
    await smtp.close();
  }
});
