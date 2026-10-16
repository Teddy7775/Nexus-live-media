import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StripeError, StripeProvider, encodeForm, hideKeys } from '../server/stripe.js';
import { startFakeStripe } from './fakeStripe.js';

const KEY = 'sk_test_fakefakefake1234';
const make = (fake, extra = {}) => new StripeProvider({ secretKey: fake.key, returnUrl: 'https://example.com/booth/paid.html', baseUrl: fake.base, timeoutMs: 1500, ...extra });

test('form encoding follows Stripe\'s rules, including nested keys and arrays', () => {
  assert.equal(encodeForm({ a: 1, b: { c: 'x y', d: { e: 2 } }, f: [{ g: 3 }, 'z'], h: undefined, i: null }), 'a=1&b%5Bc%5D=x%20y&b%5Bd%5D%5Be%5D=2&f%5B0%5D%5Bg%5D=3&f%5B1%5D=z');
  assert.equal(encodeForm({ 'x&y': 'a=b&c' }), 'x%26y=a%3Db%26c', 'special characters cannot break out of a value');
  assert.equal(encodeForm({}), '');
});

test('keys are hidden in any text', () => {
  assert.equal(hideKeys('Invalid API Key provided: sk_live_abc123XYZdef and rk_test_999aaa'), 'Invalid API Key provided: sk_live_**** and rk_test_****');
  assert.equal(hideKeys(undefined), '');
});

test('starting a payment sends exactly the amount, currency, reference and return page, and gets a payment page URL back', async () => {
  const fake = await startFakeStripe();
  try {
    const stripe = make(fake);
    const { ref, url } = await stripe.createCheckout({ amountCents: 1250, description: 'Photo prints - Sarah & James', reference: 'pay123' });
    assert.match(ref, /^cs_test_/);
    assert.equal(url, `${fake.base}/pay/${ref}`);
    const call = fake.calls('POST', '/v1/checkout/sessions')[0];
    assert.equal(call.form['line_items[0][price_data][unit_amount]'], '1250');
    assert.equal(call.form['line_items[0][price_data][currency]'], 'usd');
    assert.equal(call.form['line_items[0][price_data][product_data][name]'], 'Photo prints - Sarah & James');
    assert.equal(call.form.client_reference_id, 'pay123');
    assert.equal(call.form.success_url, 'https://example.com/booth/paid.html');
    assert.equal(call.form.mode, 'payment');
    assert.equal(call.headers.authorization, `Bearer ${KEY}`);
    assert.equal(call.headers['idempotency-key'], 'create-pay123', 'a retry can never create a second payment page');
    assert.equal(stripe.mode, 'test');
    assert.equal(fake.state.sessions.get(ref).payment_status, 'unpaid');
  } finally {
    await fake.close();
  }
});

test('asking again with the same reference returns the SAME payment page (idempotent)', async () => {
  const fake = await startFakeStripe();
  try {
    const stripe = make(fake);
    const a = await stripe.createCheckout({ amountCents: 500, description: 'x', reference: 'same' });
    const b = await stripe.createCheckout({ amountCents: 500, description: 'x', reference: 'same' });
    assert.equal(a.ref, b.ref);
    assert.equal(fake.state.sessions.size, 1);
  } finally {
    await fake.close();
  }
});

test('status: pending until the guest pays, then paid with the payment to refund; an expired page is reported as expired', async () => {
  const fake = await startFakeStripe();
  try {
    const stripe = make(fake);
    const { ref } = await stripe.createCheckout({ amountCents: 500, description: 'x', reference: 'a' });
    assert.deepEqual(await stripe.status(ref), { state: 'pending', paymentIntent: null });
    const pi = fake.pay(ref);
    assert.deepEqual(await stripe.status(ref), { state: 'paid', paymentIntent: pi });
    const other = await stripe.createCheckout({ amountCents: 500, description: 'x', reference: 'b' });
    assert.equal((await stripe.expire(other.ref)).state, 'expired');
    assert.equal((await stripe.status(other.ref)).state, 'expired');
  } finally {
    await fake.close();
  }
});

test('expiring a page the guest has JUST paid reports "paid" instead of losing their money', async () => {
  const fake = await startFakeStripe();
  try {
    const stripe = make(fake);
    const { ref } = await stripe.createCheckout({ amountCents: 500, description: 'x', reference: 'race' });
    const pi = fake.pay(ref);
    const result = await stripe.expire(ref);
    assert.deepEqual(result, { state: 'paid', paymentIntent: pi });
  } finally {
    await fake.close();
  }
});

test('a refund goes to the right payment, once', async () => {
  const fake = await startFakeStripe();
  try {
    const stripe = make(fake);
    const { ref } = await stripe.createCheckout({ amountCents: 500, description: 'x', reference: 'r' });
    const pi = fake.pay(ref);
    const refund = await stripe.refund(pi, 'r');
    assert.equal(refund.status, 'succeeded');
    assert.deepEqual(await stripe.refund(pi, 'r'), refund, 'the same refund request is not made twice (idempotency key)');
    await assert.rejects(() => stripe.refund(pi, 'another-reference'), /already been refunded/);
    await assert.rejects(() => stripe.refund(null, 'x'), /no Stripe payment to refund/);
  } finally {
    await fake.close();
  }
});

test('errors are classified so the booth can react: no network, too slow, bad key, and Stripe saying no', async () => {
  const fake = await startFakeStripe();
  try {
    // bad key
    const wrong = make(fake, { secretKey: 'sk_test_thewrongkey99999' });
    await assert.rejects(() => wrong.createCheckout({ amountCents: 500, description: 'x', reference: 'k' }), (e) => e instanceof StripeError && e.kind === 'auth' && !e.message.includes('thewrongkey99999') && /sk_test_\*\*\*\*/.test(e.message));
    // Stripe refuses the request itself
    await assert.rejects(() => make(fake).createCheckout({ amountCents: 20, description: 'x', reference: 'small' }), (e) => e.kind === 'api' && e.code === 'amount_too_small' && /at least \$0\.50/.test(e.message));
    // too slow
    fake.state.delayMs = 400;
    await assert.rejects(() => make(fake, { timeoutMs: 100 }).createCheckout({ amountCents: 500, description: 'x', reference: 'slow' }), (e) => e.kind === 'timeout');
    fake.state.delayMs = 0;
    // connection dropped
    fake.state.failNext.push('destroy');
    await assert.rejects(() => make(fake).createCheckout({ amountCents: 500, description: 'x', reference: 'drop' }), (e) => e.kind === 'network');
    // Stripe having a bad day
    fake.state.failNext.push('500');
    await assert.rejects(() => make(fake).createCheckout({ amountCents: 500, description: 'x', reference: 'five' }), (e) => e.kind === 'api' && e.status === 500);
  } finally {
    await fake.close();
  }
  // nothing listening at all
  await assert.rejects(() => new StripeProvider({ secretKey: KEY, returnUrl: 'https://x.test/p', baseUrl: 'http://127.0.0.1:1', timeoutMs: 800 }).createCheckout({ amountCents: 500, description: 'x', reference: 'n' }), (e) => e.kind === 'network' && /Cannot reach Stripe/.test(e.message));
});

test('check() says whether the key works, in plain words, and never shows the key', async () => {
  const fake = await startFakeStripe();
  try {
    const good = await make(fake).check();
    assert.deepEqual([good.ok, good.mode], [true, 'test']);
    assert.match(good.detail, /Stripe reachable, the key works \(test mode\)/);
    const bad = await make(fake, { secretKey: 'sk_live_wrongwrongwrong1' }).check();
    assert.equal(bad.ok, false);
    assert.equal(bad.mode, 'live');
    assert.equal(bad.kind, 'auth');
    assert.doesNotMatch(bad.detail, /wrongwrongwrong1/);
  } finally {
    await fake.close();
  }
});
