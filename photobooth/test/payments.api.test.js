import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { StripeProvider } from '../server/stripe.js';
import { startFakeStripe } from './fakeStripe.js';
import { startBooth, waitFor } from './helpers.js';

const RETURN_URL = 'https://example.com/booth/paid.html';
const PIN = 'station-pin-9';

/** A booth that charges. `payments` overrides merge over a Stripe setup pointed at the fake. */
async function withPay({ payments = {}, station = false, overrides = {}, provider = 'fake', ...options } = {}, fn) {
  const fake = await startFakeStripe();
  const stripe = new StripeProvider({ secretKey: fake.key, returnUrl: RETURN_URL, baseUrl: fake.base, timeoutMs: 1500 });
  const booth = await startBooth({
    paymentProvider: provider === 'fake' ? stripe : provider,
    ...options,
    overrides: {
      payments: { enabled: true, mode: 'print', provider: 'stripe', stripe: { secretKey: fake.key, returnUrl: RETURN_URL }, timeoutSeconds: 60, ...payments },
      ...(station ? { station: { enabled: true, pin: PIN, approval: { enabled: station === 'approval', timeoutSeconds: 30 } } } : {}),
      ...overrides,
    },
  });
  try {
    await fn({ booth, fake });
  } finally {
    await booth.close();
    await fake.close();
  }
}

async function finish(booth, body) {
  const created = await booth.api('POST', '/api/sessions', body);
  assert.equal(created.status, 201, created.text);
  const session = created.json;
  for (let i = 0; i < session.shotsNeeded; i++) assert.equal((await booth.api('POST', `/api/sessions/${session.id}/shots`)).status, 200);
  return session;
}

const qrText = async (svg) => {
  const { data, info } = await sharp(Buffer.from(svg)).resize(600).flatten({ background: '#fff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
};
const ledgerOf = (booth) => {
  try {
    return fs.readFileSync(path.join(booth.config.storage.dir, booth.settings.eventSlug, 'payments.csv'), 'utf8');
  } catch {
    return '';
  }
};
const paid = (booth, id) => waitFor(async () => (await booth.api('GET', `/api/payments/${id}`)).json.payment.status === 'paid', { timeoutMs: 3000, intervalMs: 20 });

// ------------------------------------------------------------------ off

test('payments are off by default and change nothing', async () => {
  const booth = await startBooth();
  try {
    assert.deepEqual((await booth.api('GET', '/api/state')).json.payments.enabled, false);
    assert.equal((await booth.api('GET', '/api/state')).json.payments.mode, 'off');
    assert.equal((await booth.api('POST', '/api/payments', { kind: 'session' })).status, 409);
    assert.equal((await booth.api('GET', '/api/payments/abc')).status, 404);
    const session = await finish(booth);
    assert.ok((await booth.api('POST', `/api/sessions/${session.id}/print`, { copies: 1 })).json.job, 'printing is free for guests, as before');
    assert.deepEqual((await booth.operator('GET', '/api/operator/status')).json.payments, { enabled: false });
    assert.equal((await booth.operator('POST', '/api/operator/check-payments')).json.error, 'payments_disabled');
    assert.match((await booth.operator('POST', '/api/operator/settings', { payMode: 'print' })).json.message, /Payments are not turned on/);
  } finally {
    await booth.close();
  }
});

test('payments enabled but mode "off" (the host pays): nothing is charged', async () => {
  await withPay({ payments: { mode: 'off' } }, async ({ booth, fake }) => {
    const session = await finish(booth);
    assert.ok((await booth.api('POST', `/api/sessions/${session.id}/print`, { copies: 1 })).json.job);
    assert.equal(fake.state.sessions.size, 0, 'Stripe was never even contacted');
  });
});

// ------------------------------------------------------------- pay per print

test('PAY PER PRINT: the guest scans a QR code, pays on their phone, and only then does the print happen - once', async () => {
  await withPay({}, async ({ booth, fake }) => {
    const state = (await booth.api('GET', '/api/state')).json.payments;
    assert.deepEqual(state, { enabled: true, mode: 'print', currency: 'usd', pricePerPrintCents: 500, pricePerSessionCents: 1000, copies: 1, provider: 'stripe' });
    await booth.operator('POST', '/api/operator/settings', { copies: 2 });
    const session = await finish(booth);

    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`, {})).json;
    assert.equal(asked.job, undefined, 'no print yet');
    assert.equal(asked.payment.status, 'pending');
    assert.equal(asked.payment.amountCents, 1000, '2 copies at $5.00 each (the price is worked out by the booth, never by the screen)');
    assert.equal(asked.payment.via, 'stripe');
    assert.equal(await qrText(asked.payment.qrSvg), asked.payment.url, 'the QR code is exactly the payment page');
    assert.equal(booth.queue.list().length, 0);
    const page = fake.byRef(asked.payment.id);
    assert.equal(page.amount_total, 1000);
    assert.match(page.name, /^Photo prints - /);
    assert.equal((await booth.api('GET', `/api/payments/${asked.payment.id}`)).json.payment.qrSvg, undefined, 'the QR is sent once, not on every poll');

    fake.pay(page.id); // the guest pays on their phone
    await paid(booth, asked.payment.id);

    // Cheating attempt: paid for 2 copies, asks for 9.
    const printed = await booth.api('POST', `/api/sessions/${session.id}/print`, { paymentId: asked.payment.id, copies: 9 });
    assert.equal(printed.status, 200, printed.text);
    assert.ok(printed.json.job);
    assert.equal(booth.queue.list().length, 1);
    assert.equal(booth.queue.list()[0].copies, 2, 'what was paid for is what is printed');
    assert.equal(booth.queue.list()[0].paymentId, asked.payment.id);

    const again = await booth.api('POST', `/api/sessions/${session.id}/print`, { paymentId: asked.payment.id });
    assert.equal(again.status, 402, 'the same payment cannot print a second time');
    assert.equal(again.json.error, 'payment_required');
    assert.equal(booth.queue.list().length, 1);

    await booth.payments.flush();
    const ledger = ledgerOf(booth).trim().split('\n');
    assert.equal(ledger.length, 2);
    assert.match(ledger[1], new RegExp(`"paid","${asked.payment.id}","${session.id}","print","10\\.00","usd","card"`));
  });
});

test('nothing prints without a real, paid, unused payment for THIS guest', async () => {
  await withPay({}, async ({ booth, fake }) => {
    const a = await finish(booth);
    const b = await finish(booth);
    const post = (session, paymentId) => booth.api('POST', `/api/sessions/${session.id}/print`, paymentId === undefined ? { copies: 1 } : { paymentId });

    assert.equal((await post(a, 'made-up')).json.payment.status, 'pending', 'an unknown payment id simply starts a payment');
    const pendingId = (await post(a)).json.payment.id;
    assert.equal((await post(a, pendingId)).status, 402, 'a payment still waiting does not print');
    fake.pay(fake.byRef(pendingId).id);
    await paid(booth, pendingId);
    assert.equal((await post(b, pendingId)).status, 402, 'guest A\'s payment cannot print guest B\'s photos');
    assert.equal(booth.queue.list().length, 0);
    assert.equal((await post(a, pendingId)).status, 200);
    assert.equal(booth.queue.list().length, 1);
  });
});

test('a frantic double tap and two simultaneous kiosks cannot turn one payment into two prints', async () => {
  await withPay({ station: false }, async ({ booth, fake }) => {
    const session = await finish(booth);
    const [a, b] = await Promise.all([booth.api('POST', `/api/sessions/${session.id}/print`, {}), booth.api('POST', `/api/sessions/${session.id}/print`, {})]);
    assert.equal(a.json.payment.id, b.json.payment.id, 'one payment request, not two');
    assert.equal(fake.state.sessions.size, 1, 'one payment page at Stripe');
    fake.pay(fake.byRef(a.json.payment.id).id);
    await paid(booth, a.json.payment.id);
    const results = await Promise.all(Array.from({ length: 4 }, () => booth.api('POST', `/api/sessions/${session.id}/print`, { paymentId: a.json.payment.id })));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 402, 402, 402]);
    assert.equal(booth.queue.list().length, 1);
  });
});

test('a guest who paid but whose screen lost track is not charged again', async () => {
  await withPay({}, async ({ booth, fake }) => {
    const session = await finish(booth);
    const first = (await booth.api('POST', `/api/sessions/${session.id}/print`, {})).json.payment;
    fake.pay(fake.byRef(first.id).id);
    await paid(booth, first.id);
    // The kiosk reloaded and simply presses Print again, without remembering the payment id.
    const retry = await booth.api('POST', `/api/sessions/${session.id}/print`, {});
    assert.equal(retry.status, 200);
    assert.ok(retry.json.job, 'the payment they already made is used');
    assert.equal(fake.state.sessions.size, 1, 'no second payment page');
  });
});

test('cancelling closes the payment page, so nobody can pay it afterwards', async () => {
  await withPay({}, async ({ booth, fake }) => {
    const session = await finish(booth);
    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`, {})).json.payment;
    const res = await booth.api('DELETE', `/api/payments/${asked.id}`);
    assert.equal(res.json.status, 'cancelled');
    assert.equal(fake.byRef(asked.id).status, 'expired', 'Stripe closed it');
    assert.throws(() => fake.pay(fake.byRef(asked.id).id), /cannot pay/);
    assert.equal((await booth.api('GET', `/api/payments/${asked.id}`)).json.payment.status, 'cancelled');
    assert.equal((await booth.api('DELETE', '/api/payments/nope')).status, 404);
  });
});

// ------------------------------------------------------------ pay per session

test('PAY PER SESSION: no session starts until it is paid, and one payment opens one session', async () => {
  await withPay({ payments: { mode: 'session' } }, async ({ booth, fake }) => {
    assert.equal((await booth.api('POST', '/api/sessions')).status, 402, 'no payment, no session');
    assert.equal((await booth.api('POST', '/api/sessions', { paymentId: 'made-up' })).status, 402);

    const asked = (await booth.api('POST', '/api/payments', {})).json.payment;
    assert.equal(asked.kind, 'session');
    assert.equal(asked.amountCents, 1000);
    assert.equal((await booth.api('POST', '/api/sessions', { paymentId: asked.id })).status, 402, 'not paid yet');
    fake.pay(fake.byRef(asked.id).id);
    await paid(booth, asked.id);

    const [first, second] = await Promise.all([booth.api('POST', '/api/sessions', { paymentId: asked.id }), booth.api('POST', '/api/sessions', { paymentId: asked.id })]);
    assert.deepEqual([first.status, second.status].sort(), [201, 402], 'two taps, one session');
    const session = [first, second].find((r) => r.status === 201).json;
    const stored = JSON.parse(fs.readFileSync(path.join(booth.config.storage.dir, 'default', session.id, 'session.json'), 'utf8'));
    assert.deepEqual(stored.payment, { id: asked.id, method: 'card', amountCents: 1000 });

    for (let i = 0; i < session.shotsNeeded; i++) await booth.api('POST', `/api/sessions/${session.id}/shots`);
    const print = await booth.api('POST', `/api/sessions/${session.id}/print`, { copies: 1 });
    assert.ok(print.json.job, 'a paid session includes its prints: no second charge');
    assert.equal(fake.state.sessions.size, 1);

    // Even if the host switches to "pay per print" part-way through the event, a guest who already paid for their session is not charged again.
    await booth.operator('POST', '/api/operator/settings', { payMode: 'print' });
    assert.ok((await booth.api('POST', `/api/sessions/${session.id}/print`, { copies: 1 })).json.job, 'no second charge');
    assert.equal(fake.state.sessions.size, 1);
    await booth.operator('POST', '/api/operator/settings', { payMode: 'session' });

    assert.equal((await booth.api('POST', '/api/sessions', { paymentId: asked.id })).status, 402, 'the payment is used up');
    assert.equal((await booth.api('GET', '/api/state')).json.payments.mode, 'session');
  });
});

test('the wrong kind of payment cannot be used: a session payment does not print, a print payment does not open a session', async () => {
  await withPay({}, async ({ booth, fake }) => {
    const session = await finish(booth);
    await booth.operator('POST', '/api/operator/settings', { payMode: 'session' });
    const sessionPayment = (await booth.api('POST', '/api/payments', {})).json.payment;
    fake.pay(fake.byRef(sessionPayment.id).id);
    await paid(booth, sessionPayment.id);
    await booth.operator('POST', '/api/operator/settings', { payMode: 'print' });
    assert.equal((await booth.api('POST', `/api/sessions/${session.id}/print`, { paymentId: sessionPayment.id })).status, 402);
    assert.equal((await booth.api('POST', '/api/payments', {})).status, 409, 'in print mode there is no session payment to make');
  });
});

// -------------------------------------------------------------------- offline

test('NO INTERNET: the guest is asked to pay the attendant instead, who confirms it, and then everything works as normal', async () => {
  await withPay({ station: true }, async ({ booth, fake }) => {
    const session = await finish(booth);
    fake.state.down = true; // the hotspot dropped
    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`, {})).json.payment;
    assert.equal(asked.status, 'pending');
    assert.equal(asked.via, 'attendant');
    assert.equal(asked.reason, 'offline');
    assert.equal(asked.url, null);
    assert.equal(asked.qrSvg, undefined, 'there is no QR code to show');
    const status = (await booth.operator('GET', '/api/operator/status')).json.payments;
    assert.equal(status.lastError.kind, 'network');
    assert.deepEqual(status.needs.map((n) => n.id), [asked.id], 'the operator panel shows it as waiting for cash');

    const stationCookie = (await fetch(`${booth.lanUrl}/station/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: PIN }) })).headers.get('set-cookie').split(';')[0];
    const confirm = await fetch(`${booth.lanUrl}/station/api/payments/${asked.id}/paid`, { method: 'POST', headers: { cookie: stationCookie, 'content-type': 'application/json' }, body: JSON.stringify({ note: 'zelle' }) });
    assert.equal(confirm.status, 200);
    assert.equal((await confirm.json()).payment.method, 'attendant');
    assert.equal((await booth.api('GET', `/api/payments/${asked.id}`)).json.payment.status, 'paid');
    assert.ok((await booth.api('POST', `/api/sessions/${session.id}/print`, { paymentId: asked.id })).json.job);
    await booth.payments.flush();
    assert.match(ledgerOf(booth), /"attendant","zelle"/);
  });
});

test('NO INTERNET with offline:"free": guests keep printing, and the ledger records every waived payment', async () => {
  await withPay({ payments: { offline: 'free' } }, async ({ booth, fake }) => {
    fake.state.down = true;
    const session = await finish(booth);
    const res = await booth.api('POST', `/api/sessions/${session.id}/print`, {});
    assert.equal(res.status, 200);
    assert.ok(res.json.job, 'printed straight away');
    await booth.payments.flush();
    assert.match(ledgerOf(booth), /"waived"/);
    assert.equal((await booth.operator('GET', '/api/operator/status')).json.payments.totals.waived, 1);
  });
});

test('a bad or revoked Stripe key behaves like being offline (the booth keeps working) and the operator is told why', async () => {
  const wrongKey = (fake) => new StripeProvider({ secretKey: 'sk_test_thewrongkey99999', returnUrl: RETURN_URL, baseUrl: fake.base });
  const fake = await startFakeStripe();
  const booth = await startBooth({ paymentProvider: wrongKey(fake), overrides: { payments: { enabled: true, mode: 'print', stripe: { secretKey: fake.key, returnUrl: RETURN_URL } } } });
  try {
    const session = await finish(booth);
    const res = (await booth.api('POST', `/api/sessions/${session.id}/print`, {})).json.payment;
    assert.equal(res.via, 'attendant');
    const status = (await booth.operator('GET', '/api/operator/status')).json.payments;
    assert.equal(status.lastError.kind, 'auth');
    assert.doesNotMatch(JSON.stringify(status), /thewrongkey99999/, 'the key is never shown');
    const check = (await booth.operator('POST', '/api/operator/check-payments')).json;
    assert.equal(check.ok, false);
    assert.equal(check.kind, 'auth');
    assert.doesNotMatch(check.detail, /thewrongkey99999/);
  } finally {
    await booth.close();
    await fake.close();
  }
});

// ----------------------------------------------------------- attendant-only

test('with provider "attendant" there is no Stripe at all: every payment is confirmed by a person', async () => {
  await withPay({ payments: { provider: 'attendant' }, provider: null }, async ({ booth }) => {
    const session = await finish(booth);
    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`, {})).json.payment;
    assert.equal(asked.via, 'attendant');
    assert.equal(asked.reason, null);
    assert.equal(asked.url, null);
    assert.equal((await booth.api('POST', `/api/sessions/${session.id}/print`, { paymentId: asked.id })).status, 402, 'not before it is confirmed');
    const res = await booth.operator('POST', `/api/operator/payments/${asked.id}/paid`, { note: 'cash' });
    assert.equal(res.status, 200, res.text);
    assert.ok((await booth.api('POST', `/api/sessions/${session.id}/print`, { paymentId: asked.id })).json.job);
    assert.equal((await booth.operator('POST', '/api/operator/check-payments')).json.ok, true);
    assert.match((await booth.operator('POST', '/api/operator/check-payments')).json.detail, /guests pay an attendant/);
    assert.equal((await booth.operator('POST', `/api/operator/payments/${asked.id}/paid`, { note: 'cash' })).status, 409, 'confirming twice is refused');
  });
});

test('the attendant can waive a charge (a friend, a free print)', async () => {
  await withPay({ payments: { provider: 'attendant' }, provider: null }, async ({ booth }) => {
    const session = await finish(booth);
    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`, {})).json.payment;
    assert.equal((await booth.operator('POST', `/api/operator/payments/${asked.id}/waive`)).json.payment.method, 'waived');
    assert.ok((await booth.api('POST', `/api/sessions/${session.id}/print`, { paymentId: asked.id })).json.job);
  });
});

// ------------------------------------------------- when something goes wrong

test('paid, but the attendant does not approve the print: the money is flagged, can be refunded through Stripe, or honoured', async () => {
  await withPay({ station: 'approval' }, async ({ booth, fake }) => {
    const cookie = (await fetch(`${booth.lanUrl}/station/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: PIN }) })).headers.get('set-cookie').split(';')[0];
    const st = (route, body = {}) => fetch(`${booth.lanUrl}/station${route}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
    // a station must be connected for approval to wait for it
    const feed = await fetch(`${booth.lanUrl}/station/api/events`, { headers: { cookie } });
    void feed.body;

    const pay = async () => {
      const session = await finish(booth);
      const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`, {})).json.payment;
      fake.pay(fake.byRef(asked.id).id);
      await paid(booth, asked.id);
      const approval = (await booth.api('POST', `/api/sessions/${session.id}/print`, { paymentId: asked.id })).json.approval;
      return { session, asked, approval };
    };

    // 1. rejected -> refund through Stripe
    const one = await pay();
    assert.equal(one.approval.status, 'pending');
    await st(`/api/approvals/${one.approval.id}/reject`, { reason: 'eyes closed' });
    await waitFor(() => booth.payments.get(one.asked.id).refundDue === 'print_rejected');
    assert.equal(booth.queue.list().length, 0, 'nothing printed');
    const snapshot = await fetch(`${booth.lanUrl}/station/api/snapshot`, { headers: { cookie } }).then((r) => r.json());
    assert.deepEqual(snapshot.payments.needs.map((n) => [n.id, n.refundDue]), [[one.asked.id, 'print_rejected']], 'the station is told money is owed back');
    const refund = await st(`/api/payments/${one.asked.id}/refund`);
    assert.equal(refund.status, 200, JSON.stringify(refund.json));
    assert.equal(refund.json.payment.status, 'refunded');
    assert.equal(fake.calls('POST', '/v1/refunds').length, 1);
    assert.equal(fake.calls('POST', '/v1/refunds')[0].form.payment_intent, fake.state.sessions.get(fake.byRef(one.asked.id).id).payment_intent);
    assert.equal((await st(`/api/payments/${one.asked.id}/refund`)).status, 409, 'a second refund is refused');

    // 2. rejected -> the attendant changes their mind and honours it
    const two = await pay();
    await st(`/api/approvals/${two.approval.id}/reject`, {});
    await waitFor(() => booth.payments.get(two.asked.id).refundDue);
    const honoured = await st(`/api/payments/${two.asked.id}/honour`);
    assert.equal(honoured.status, 200, JSON.stringify(honoured.json));
    assert.ok(honoured.json.job);
    assert.equal(booth.queue.list().length, 1);
    assert.equal(booth.payments.get(two.asked.id).refundDue, null);
    assert.equal((await st(`/api/payments/${two.asked.id}/honour`)).status, 409, 'once only');
    feed.body.cancel().catch(() => {});
  });
});

test('paid, but the print job fails: flagged for a refund decision', async () => {
  const failing = { mode: 'windows', status: async () => ({ ok: true, detail: 'ok' }), print: async () => { throw new Error('Printer is out of paper'); } };
  await withPay({ printer: failing }, async ({ booth, fake }) => {
    const session = await finish(booth);
    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`, {})).json.payment;
    fake.pay(fake.byRef(asked.id).id);
    await paid(booth, asked.id);
    await booth.api('POST', `/api/sessions/${session.id}/print`, { paymentId: asked.id });
    await waitFor(() => booth.payments.get(asked.id).refundDue === 'print_failed');
    assert.equal((await booth.operator('GET', '/api/operator/status')).json.payments.needs[0].refundDue, 'print_failed');
  });
});

test('a refund that Stripe refuses leaves the payment paid and tells the attendant why', async () => {
  await withPay({}, async ({ booth, fake }) => {
    const session = await finish(booth);
    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`, {})).json.payment;
    fake.pay(fake.byRef(asked.id).id);
    await paid(booth, asked.id);
    fake.state.failNext.push('500');
    const res = await booth.operator('POST', `/api/operator/payments/${asked.id}/refund`);
    assert.equal(res.status, 409);
    assert.equal(res.json.error, 'payment_failed');
    assert.match(res.json.message, /unknown error/);
    assert.equal(booth.payments.get(asked.id).status, 'paid');
    assert.equal((await booth.operator('POST', `/api/operator/payments/${asked.id}/refund`)).status, 200, 'trying again works');
  });
});

test('staff reprints never ask for payment', async () => {
  await withPay({ station: true }, async ({ booth }) => {
    const session = await finish(booth);
    const reprint = await booth.operator('POST', `/api/operator/sessions/${session.id}/reprint`, { copies: 1 });
    assert.ok(reprint.json.job);
    const cookie = (await fetch(`${booth.lanUrl}/station/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: PIN }) })).headers.get('set-cookie').split(';')[0];
    const viaStation = await fetch(`${booth.lanUrl}/station/api/sessions/${session.id}/reprint`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(viaStation.status, 200);
  });
});

// ----------------------------------------------------- operator + station

test('the station\'s payment actions need the PIN', async () => {
  await withPay({ station: true }, async ({ booth }) => {
    for (const action of ['paid', 'waive', 'refund', 'honour', 'clear-flag']) {
      const res = await fetch(`${booth.lanUrl}/station/api/payments/abc/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(res.status, 401, action);
    }
    assert.equal((await booth.api('POST', '/api/operator/payments/abc/refund', {})).status, 401, 'and so do the operator\'s');
    assert.equal((await fetch(`${booth.lanUrl}/api/payments/abc`)).status, 404, 'the guest payment endpoints are not on the network port');
  });
});

test('the station is told about payments as they happen', async () => {
  await withPay({ station: true }, async ({ booth, fake }) => {
    const cookie = (await fetch(`${booth.lanUrl}/station/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: PIN }) })).headers.get('set-cookie').split(';')[0];
    const controller = new AbortController();
    const res = await fetch(`${booth.lanUrl}/station/api/events`, { headers: { cookie }, signal: controller.signal });
    const events = [];
    (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for await (const chunk of res.body) {
          buffer += decoder.decode(chunk, { stream: true });
          for (let i = buffer.indexOf('\n\n'); i >= 0; i = buffer.indexOf('\n\n')) {
            const block = buffer.slice(0, i);
            buffer = buffer.slice(i + 2);
            const type = /^event: (.*)$/m.exec(block)?.[1];
            if (type) events.push({ type, data: JSON.parse(/^data: (.*)$/m.exec(block)[1]) });
          }
        }
      } catch { /* closed */ }
    })();
    await waitFor(() => events.find((e) => e.type === 'snapshot'));
    assert.equal(events.find((e) => e.type === 'snapshot').data.payments.enabled, true);

    const session = await finish(booth);
    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`, {})).json.payment;
    await waitFor(() => events.find((e) => e.type === 'payment' && e.data.id === asked.id && e.data.status === 'pending'));
    fake.pay(fake.byRef(asked.id).id);
    const paidEvent = await waitFor(() => events.find((e) => e.type === 'payment' && e.data.id === asked.id && e.data.status === 'paid'));
    assert.equal(paidEvent.data.method, 'card');
    assert.equal(paidEvent.data.providerRef, undefined, 'Stripe\'s references do not leave the booth');
    const seen = await waitFor(() => events.find((e) => e.type === 'session' && e.data.id === session.id && e.data.payment?.status === 'paid'));
    assert.equal(seen.data.payment.amountCents, 500);
    controller.abort();
  });
});

test('operator: choose who pays and the prices; they are checked, saved, and used for the next guest', async () => {
  await withPay({}, async ({ booth }) => {
    for (const bad of [{ payMode: 'sometimes' }, { pricePerPrintCents: 49 }, { pricePerPrintCents: 5.5 }, { pricePerSessionCents: 100001 }, { pricePerPrintCents: '5' }]) {
      assert.equal((await booth.operator('POST', '/api/operator/settings', bad)).status, 400, JSON.stringify(bad));
    }
    const ok = await booth.operator('POST', '/api/operator/settings', { pricePerPrintCents: 750, pricePerSessionCents: 1500 });
    assert.equal(ok.status, 200);
    const saved = JSON.parse(fs.readFileSync(path.join(booth.dir, 'runtime-settings.json'), 'utf8'));
    assert.equal(saved.pricePerPrintCents, 750);
    assert.equal(saved.payMode, 'print');
    const session = await finish(booth);
    assert.equal((await booth.api('POST', `/api/sessions/${session.id}/print`, {})).json.payment.amountCents, 750);

    await booth.operator('POST', '/api/operator/settings', { payMode: 'off' });
    const free = await finish(booth);
    assert.ok((await booth.api('POST', `/api/sessions/${free.id}/print`, {})).json.job, 'back to the host paying');
  });
});

test('operator: Stripe status, test/live, takings, and the connection check', async () => {
  await withPay({}, async ({ booth, fake }) => {
    const status = (await booth.operator('GET', '/api/operator/status')).json.payments;
    assert.equal(status.enabled, true);
    assert.equal(status.stripeMode, 'test');
    assert.equal(status.provider, 'stripe');
    assert.equal(status.offline, 'attendant');
    assert.deepEqual(status.totals, { paid: 0, refunded: 0, waived: 0, count: 0, byMethod: {}, net: 0 });
    assert.deepEqual(JSON.parse(JSON.stringify(status)).lastError, null);
    const good = (await booth.operator('POST', '/api/operator/check-payments')).json;
    assert.equal(good.ok, true);
    assert.match(good.detail, /the key works \(test mode\)/);

    const session = await finish(booth);
    const asked = (await booth.api('POST', `/api/sessions/${session.id}/print`, {})).json.payment;
    fake.pay(fake.byRef(asked.id).id);
    await paid(booth, asked.id);
    const after = (await booth.operator('GET', '/api/operator/status')).json.payments;
    assert.equal(after.totals.paid, 500);
    assert.deepEqual(after.totals.byMethod, { card: 500 });
    assert.doesNotMatch(JSON.stringify((await booth.operator('GET', '/api/operator/status')).json), new RegExp(fake.key), 'the Stripe key appears nowhere in the status');
  });
});

test('the Stripe key is never in the redacted configuration', async () => {
  const { redactedConfig } = await import('../server/config.js');
  await withPay({}, async ({ booth, fake }) => {
    const text = JSON.stringify(redactedConfig(booth.config));
    assert.doesNotMatch(text, new RegExp(fake.key));
    assert.match(text, /"secretKey":"\*\*\*"/);
  });
});
