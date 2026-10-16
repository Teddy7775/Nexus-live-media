import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Payments, formatUsd } from '../server/payments.js';
import { StripeError } from '../server/stripe.js';
import { waitFor } from './helpers.js';

/** A payment service that answers like Stripe, except the test decides what happens. */
function fakeProvider() {
  const pages = new Map();
  let n = 0;
  const p = {
    name: 'stripe',
    calls: [],
    failCreate: null,
    failStatus: false,
    failExpire: false,
    failRefund: false,
    async createCheckout(args) {
      p.calls.push(['create', args]);
      if (p.failCreate) throw p.failCreate;
      const ref = `cs_${++n}`;
      pages.set(ref, { state: 'pending' });
      return { ref, url: `https://pay.test/${ref}` };
    },
    async status(ref) {
      if (p.failStatus) throw new StripeError('network', 'Cannot reach Stripe');
      const s = pages.get(ref);
      return { state: s.state, paymentIntent: s.pi ?? null };
    },
    async expire(ref) {
      p.calls.push(['expire', ref]);
      if (p.failExpire) throw new StripeError('network', 'Cannot reach Stripe');
      const s = pages.get(ref);
      if (s.state === 'paid') return { state: 'paid', paymentIntent: s.pi };
      s.state = 'expired';
      return { state: 'expired', paymentIntent: null };
    },
    async refund(pi, reference) {
      p.calls.push(['refund', pi, reference]);
      if (p.failRefund) throw new StripeError('api', 'Stripe said no');
      await new Promise((r) => setTimeout(r, 15));
      return { id: 're_1', status: 'succeeded' };
    },
    pay(ref) {
      const s = pages.get(ref);
      s.state = 'paid';
      s.pi = `pi_${ref}`;
    },
    pageOf: (ref) => pages.get(ref),
  };
  return p;
}

function make({ provider = fakeProvider(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-test-')), ...extra } = {}) {
  const clock = { t: 1_700_000_000_000 };
  const timers = new Map();
  let nextTimer = 1;
  const changes = [];
  const service = new Payments({
    file: path.join(dir, 'payments.json'),
    provider,
    timeoutMs: 180_000,
    offline: 'attendant',
    ledgerFile: (item) => path.join(dir, item.eventSlug, 'payments.csv'),
    describe: () => 'Photo prints',
    now: () => clock.t,
    pollMs: 10_000_000, // the tests call poll() themselves
    setTimer: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    onChange: (v) => changes.push(`${v.status}:${v.id}`),
    ...extra,
  });
  const fire = async () => {
    const [id, timer] = [...timers].at(-1) ?? [];
    timers.delete(id);
    await timer?.fn();
  };
  return { service, provider, dir, clock, timers, changes, fire, ledger: () => { try { return fs.readFileSync(path.join(dir, 'ev', 'payments.csv'), 'utf8'); } catch { return ''; } } };
}
const ask = (service, over = {}) => service.request({ kind: 'print', sessionId: 's1', copies: 2, amountCents: 1000, eventSlug: 'ev', ...over });

test('a guest is given a payment page for exactly the amount, and Stripe\'s own references stay on the server', async () => {
  const { service, provider } = make();
  const view = await ask(service);
  assert.equal(view.status, 'pending');
  assert.equal(view.via, 'stripe');
  assert.equal(view.amountCents, 1000);
  assert.match(view.url, /^https:\/\/pay\.test\/cs_1$/);
  assert.equal(view.providerRef, undefined);
  assert.equal(view.paymentIntent, undefined);
  assert.deepEqual(provider.calls[0][1], { amountCents: 1000, currency: 'usd', description: 'Photo prints', reference: view.id });
  assert.equal(new Date(view.expiresAt) - new Date(view.createdAt), 180_000);
  assert.equal(formatUsd(1000), '$10.00');
  assert.equal(formatUsd(50), '$0.50');
  service.stop();
});

test('when the guest pays, the next look at Stripe settles it as a card payment and writes it to the ledger', async () => {
  const { service, provider, ledger, changes } = make();
  const view = await ask(service);
  await service.poll();
  assert.equal(service.get(view.id).status, 'pending', 'nothing paid yet');
  provider.pay('cs_1');
  await service.poll();
  const paid = service.get(view.id);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.method, 'card');
  assert.equal(paid.url, null, 'a paid page is no longer offered');
  await service.flush();
  const lines = ledger().trim().split('\n');
  assert.equal(lines[0], 'time,event,payment,session,kind,amount,currency,method,note,reference');
  assert.match(lines[1], new RegExp(`"paid","${view.id}","s1","print","10\\.00","usd","card","","pi_cs_1"`));
  assert.deepEqual(changes, [`pending:${view.id}`, `paid:${view.id}`]);
  service.stop();
});

test('a payment buys exactly one thing, once - even when two requests use it in the same instant', async () => {
  const { service, provider } = make();
  const view = await ask(service);
  provider.pay('cs_1');
  await service.poll();
  const results = await Promise.all([1, 2, 3].map(async () => service.consume(view.id, { kind: 'print', sessionId: 's1' })));
  assert.equal(results.filter(Boolean).length, 1, 'only one of three simultaneous uses gets it');
  assert.equal(service.consume(view.id, { kind: 'print', sessionId: 's1' }), null, 'and never again');
  assert.equal(service.get(view.id).consumed, true);

  const other = await ask(service, { sessionId: 's2' });
  provider.pay('cs_2');
  await service.poll();
  assert.equal(service.consume(other.id, { kind: 'print', sessionId: 'someone-else' }), null, 'a print payment cannot be used for a different guest');
  assert.equal(service.consume(other.id, { kind: 'session', sessionId: 's2' }), null, 'nor as a session payment');
  assert.ok(service.consume(other.id, { kind: 'print', sessionId: 's2' }));
  assert.equal(service.consume('nope', { kind: 'print', sessionId: 's1' }), null);
  service.stop();
});

test('an unpaid payment cannot be used', async () => {
  const { service } = make();
  const view = await ask(service);
  assert.equal(service.consume(view.id, { kind: 'print', sessionId: 's1' }), null);
  service.stop();
});

test('a session payment is attached to the session when it is used', async () => {
  const { service, provider } = make();
  const view = await service.request({ kind: 'session', amountCents: 1500, eventSlug: 'ev' });
  provider.pay('cs_1');
  await service.poll();
  assert.equal(service.consume(view.id, { kind: 'print', sessionId: 'new' }), null);
  const used = service.consume(view.id, { kind: 'session', sessionId: '20261016-120000-abcd' });
  assert.equal(used.sessionId, '20261016-120000-abcd');
  service.stop();
});

test('a double tap does not charge twice, and a paid-but-unused payment is offered again instead of asking for more money', async () => {
  const { service, provider } = make();
  const a = await ask(service);
  const b = await ask(service);
  assert.equal(a.id, b.id);
  assert.equal(provider.calls.filter((c) => c[0] === 'create').length, 1, 'one payment page only');
  provider.pay('cs_1');
  await service.poll();
  const again = await ask(service); // the kiosk lost track after the guest paid
  assert.equal(again.id, a.id);
  assert.equal(again.status, 'paid');
  service.consume(a.id, { kind: 'print', sessionId: 's1' });
  const fresh = await ask(service);
  assert.notEqual(fresh.id, a.id, 'once used, a new print order is a new payment');
  service.stop();
});

test('OFFLINE: if a card payment cannot be started, the guest is asked to pay the attendant, who confirms it', async () => {
  const { service, provider, ledger } = make();
  provider.failCreate = new StripeError('network', 'Cannot reach Stripe (ENOTFOUND)');
  const view = await ask(service);
  assert.equal(view.status, 'pending');
  assert.equal(view.via, 'attendant');
  assert.equal(view.reason, 'offline');
  assert.equal(view.url, null, 'no QR code to show');
  assert.equal(service.lastProviderError.kind, 'network');
  assert.deepEqual(service.needsAttention().map((i) => i.id), [view.id], 'it appears for the attendant to collect');

  const paid = await service.markPaid(view.id, { note: 'zelle' });
  assert.equal(paid.status, 'paid');
  assert.equal(paid.method, 'attendant');
  assert.equal(paid.note, 'zelle');
  assert.ok(service.consume(view.id, { kind: 'print', sessionId: 's1' }), 'and it works exactly like a card payment from then on');
  await service.flush();
  assert.match(ledger(), /"paid","[0-9a-f]+","s1","print","10\.00","usd","attendant","zelle",""/);
  assert.equal(await service.markPaid(view.id), null, 'confirming twice does nothing');
  service.stop();
});

test('OFFLINE with offline:"free": the guest goes through without paying, and the ledger says so', async () => {
  const { service, provider, ledger } = make({ offline: 'free' });
  provider.failCreate = new StripeError('timeout', 'Stripe did not answer');
  const view = await ask(service);
  assert.equal(view.status, 'paid');
  assert.equal(view.method, 'waived');
  assert.equal(view.reason, 'offline');
  assert.ok(service.consume(view.id, { kind: 'print', sessionId: 's1' }));
  await service.flush();
  assert.match(ledger(), /"waived"/);
  await assert.rejects(() => service.refund(view.id), /waived: nothing was paid/);
  assert.equal(service.totals('ev').waived, 1);
  assert.equal(service.totals('ev').paid, 0);
  service.stop();
});

test('with no payment service at all (cash and Zelle only), every payment waits for the attendant', async () => {
  const { service } = make({ provider: null });
  const view = await ask(service);
  assert.equal(view.via, 'attendant');
  assert.equal(view.reason, null, 'not a fallback: this is simply how this booth takes payment');
  const free = await ask(service, { sessionId: 's2' });
  assert.equal((await service.waive(free.id)).method, 'waived', 'the attendant can waive a charge');
  assert.equal((await service.markPaid(view.id, { note: '<script>' })).note, 'other', 'a note can only be one of the known words');
  service.stop();
});

test('a payment nobody finishes is closed at Stripe when time runs out, so it can never be paid afterwards', async () => {
  const { service, provider, fire } = make();
  const view = await ask(service);
  await fire();
  const settled = service.get(view.id);
  assert.equal(settled.status, 'expired');
  assert.equal(settled.reason, 'timeout');
  assert.equal(provider.pageOf('cs_1').state, 'expired', 'the payment page was really closed');
  assert.equal(settled.unresolved, false);
  await service.poll();
  assert.equal(provider.calls.filter((c) => c[0] === 'expire').length, 1, 'and nothing keeps asking about it');
  service.stop();
});

test('a guest who pays at the very last moment is NOT lost: closing the page reports it paid', async () => {
  const { service, provider, fire } = make();
  const view = await ask(service);
  provider.pay('cs_1'); // paid, but the booth has not looked yet
  await fire();
  const settled = service.get(view.id);
  assert.equal(settled.status, 'paid');
  assert.equal(settled.method, 'card');
  assert.equal(settled.paidLate, false, 'they were still on the pay screen: this is a normal payment');
  assert.ok(service.consume(view.id, { kind: 'print', sessionId: 's1' }));
  service.stop();
});

test('cancelling closes the page, and a payment made just before cancelling still counts', async () => {
  const a = make();
  const first = await ask(a.service);
  assert.equal((await a.service.cancel(first.id)).status, 'cancelled');
  assert.equal(a.provider.pageOf('cs_1').state, 'expired');
  assert.equal(await a.service.cancel(first.id), null);

  const b = make();
  const second = await ask(b.service);
  b.provider.pay('cs_1');
  assert.equal((await b.service.cancel(second.id)).status, 'paid', 'they had paid: the money is not thrown away');
  a.service.stop();
  b.service.stop();
});

test('NO INTERNET AT THE MOMENT OF TIMEOUT: the page cannot be closed, so it is remembered and a late payment is caught and flagged', async () => {
  const { service, provider, fire } = make();
  const view = await ask(service);
  provider.failExpire = true;
  await fire();
  assert.equal(service.get(view.id).status, 'expired');
  assert.equal(service.get(view.id).unresolved, true, 'the open payment page is remembered');

  // The guest pays after all (their phone still has the page); the hotspot comes back later.
  provider.failExpire = false;
  provider.pay('cs_1');
  await service.poll();
  const late = service.get(view.id);
  assert.equal(late.status, 'paid');
  assert.equal(late.paidLate, true);
  assert.equal(late.refundDue, 'paid_after_timeout', 'a person must decide: refund, or honour it');
  assert.equal(service.consume(view.id, { kind: 'print', sessionId: 's1' }), null, 'it does not silently print for nobody');
  assert.deepEqual(service.needsAttention().map((i) => i.id), [view.id]);
  const refunded = await service.refund(view.id);
  assert.equal(refunded.status, 'refunded');
  service.stop();
});

test('NO INTERNET, and nobody pays: once the connection is back the leftover page is closed', async () => {
  const { service, provider, fire } = make();
  const view = await ask(service);
  provider.failExpire = true;
  await fire();
  provider.failExpire = false;
  await service.poll();
  assert.equal(service.get(view.id).unresolved, false);
  assert.equal(provider.pageOf('cs_1').state, 'expired');
  service.stop();
});

test('while Stripe cannot be reached, a payment that may have happened stays pending - nothing is invented', async () => {
  const { service, provider } = make();
  const view = await ask(service);
  provider.failStatus = true;
  await service.poll();
  await service.poll();
  assert.equal(service.get(view.id).status, 'pending');
  provider.failStatus = false;
  provider.pay('cs_1');
  await service.poll();
  assert.equal(service.get(view.id).status, 'paid');
  service.stop();
});

test('the attendant taking cash closes any open card page, so the guest cannot pay twice', async () => {
  const a = make();
  const view = await ask(a.service);
  const paid = await a.service.markPaid(view.id, { note: 'cash' });
  assert.equal(paid.method, 'attendant');
  assert.equal(a.provider.pageOf('cs_1').state, 'expired');

  const b = make();
  const raced = await ask(b.service);
  b.provider.pay('cs_1'); // the guest paid by card in the same moment the attendant tapped "Mark paid"
  const result = await b.service.markPaid(raced.id, { note: 'cash' });
  assert.equal(result.method, 'card', 'the card payment is the real one');
  a.service.stop();
  b.service.stop();
});

test('refunds: a card goes back through Stripe once; cash is recorded; failures leave it paid and say why', async () => {
  const { service, provider, ledger } = make();
  const card = await ask(service);
  provider.pay('cs_1');
  await service.poll();
  provider.failRefund = true;
  await assert.rejects(() => service.refund(card.id), /Stripe said no/);
  assert.equal(service.get(card.id).status, 'paid', 'a failed refund changes nothing');
  provider.failRefund = false;
  const results = await Promise.allSettled([service.refund(card.id), service.refund(card.id)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'two clicks, one refund');
  assert.equal(provider.calls.filter((c) => c[0] === 'refund' && c[2] === card.id).length, 2, 'one failed attempt, one real one (never a duplicate)');
  assert.deepEqual(provider.calls.filter((c) => c[0] === 'refund').at(-1).slice(1), ['pi_cs_1', card.id], 'refunds the right payment');
  assert.equal(service.get(card.id).status, 'refunded');
  await assert.rejects(() => service.refund(card.id), /not a paid payment/);

  const cash = await ask(service, { sessionId: 's2' });
  await service.markPaid(cash.id, { note: 'cash' });
  assert.equal((await service.refund(cash.id)).status, 'refunded');
  assert.equal(provider.calls.filter((c) => c[0] === 'refund').length, 2, 'cash never touches Stripe');
  await service.flush();
  assert.equal(ledger().split('\n').filter((l) => l.includes('"refunded"')).length, 2);
  assert.equal(service.totals('ev').refunded, 2000);
  assert.equal(service.totals('ev').paid, 0, 'refunded money is not counted as takings');
  service.stop();
});

test('something that goes wrong after payment is flagged for a person, blocks use, and can be cleared', async () => {
  const { service, provider } = make();
  const view = await ask(service);
  provider.pay('cs_1');
  await service.poll();
  assert.equal(service.flagRefund(view.id, 'print_not_approved').refundDue, 'print_not_approved');
  assert.equal(service.flagRefund(view.id, 'again'), null, 'flagged once');
  assert.equal(service.consume(view.id, { kind: 'print', sessionId: 's1' }), null);
  assert.equal(service.clearRefundFlag(view.id).refundDue, null);
  assert.equal(service.flagRefund('nope', 'x'), null);
  service.stop();
});

test('payments survive a restart; a guest cannot still be waiting, so pending ones are closed or found paid', async () => {
  const first = make();
  const paid = await ask(first.service, { sessionId: 's1' });
  first.provider.pay('cs_1');
  await first.service.poll();
  first.service.consume(paid.id, { kind: 'print', sessionId: 's1' });
  const waiting = await ask(first.service, { sessionId: 's2' });
  const paidWhileDown = await ask(first.service, { sessionId: 's3' });
  await first.service.flush();
  first.service.stop();

  // The booth restarts. The guest for s3 paid on their phone while it was down.
  first.provider.pay('cs_3');
  const second = new Payments({ file: path.join(first.dir, 'payments.json'), provider: first.provider, timeoutMs: 180_000, ledgerFile: (i) => path.join(first.dir, i.eventSlug, 'payments.csv'), pollMs: 10_000_000 });
  await second.load();
  assert.equal(second.get(paid.id).consumed, true, 'a used payment stays used (nobody can print twice)');
  assert.equal(second.get(waiting.id).status, 'expired');
  assert.equal(second.get(waiting.id).reason, 'restart');
  await second.poll();
  assert.equal(first.provider.pageOf('cs_2').state, 'expired', 'the abandoned payment page is closed');
  const late = second.get(paidWhileDown.id);
  assert.equal(late.status, 'paid');
  assert.equal(late.paidLate, true);
  assert.equal(late.refundDue, 'paid_after_timeout');
  second.stop();
});

test('what needs a person: cash waiting, money owed back, and paid-but-unused payments', async () => {
  const { service, provider, clock } = make();
  const unused = await service.request({ kind: 'session', amountCents: 1000, eventSlug: 'ev' });
  provider.pay('cs_1');
  await service.poll();
  assert.deepEqual(service.needsAttention(), [], 'fresh: the guest is probably about to use it');
  clock.t += 121_000;
  assert.deepEqual(service.needsAttention().map((i) => i.id), [unused.id], 'two minutes later it is worth a look');
  service.stop();
});

test('totals add up by method and ignore other events', async () => {
  const { service, provider } = make();
  const a = await ask(service, { amountCents: 500 });
  provider.pay('cs_1');
  await service.poll();
  const b = await ask(service, { sessionId: 's2', amountCents: 700 });
  await service.markPaid(b.id, { note: 'cash' });
  await ask(service, { sessionId: 's3', amountCents: 900, eventSlug: 'other-event' }).then((v) => service.markPaid(v.id, { note: 'cash' }));
  assert.deepEqual(service.totals('ev'), { paid: 1200, refunded: 0, waived: 0, count: 2, byMethod: { card: 500, attendant: 700 }, net: 1200 });
  void a;
  service.stop();
});

test('the polling loop runs by itself and stops when nothing is open', async () => {
  const provider = fakeProvider();
  const { service } = make({ provider, pollMs: 15, setTimer: setTimeout, clearTimer: clearTimeout });
  const view = await ask(service);
  provider.pay('cs_1');
  await waitFor(() => service.get(view.id).status === 'paid', { timeoutMs: 2000, intervalMs: 10 });
  const before = provider.calls.length;
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(provider.calls.length, before);
  service.stop();
});

test('a broken change listener never breaks a payment', async () => {
  const { service } = make({ provider: null, onChange: () => { throw new Error('listener bug'); }, logger: { error: () => {} } });
  const view = await ask(service);
  assert.equal((await service.markPaid(view.id)).status, 'paid');
  service.stop();
});
