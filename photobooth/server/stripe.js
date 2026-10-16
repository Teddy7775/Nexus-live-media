/**
 * Stripe Checkout, spoken directly over HTTPS (no SDK, no card data ever touches this PC).
 *
 * The booth creates a Checkout Session, shows its URL as a QR code, and then ASKS Stripe whether it was paid (polling).
 * Polling is deliberate: a webhook would need a public address pointing at this PC, which a venue's hotspot cannot give.
 */

export class StripeError extends Error {
  /** kind: "network" | "timeout" | "auth" | "api" */
  constructor(kind, message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'StripeError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** Anything that looks like a Stripe key is hidden, whatever message it appears in. */
export const hideKeys = (text) => String(text ?? '').replace(/\b(sk|rk|pk)_(test|live)_[A-Za-z0-9*._-]+/g, '$1_$2_****');

/** { a: { b: 1 }, c: [x] } -> "a[b]=1&c[0]=x" (Stripe's form encoding). */
export function encodeForm(object, prefix = '') {
  const parts = [];
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) value.forEach((item, i) => parts.push(typeof item === 'object' ? encodeForm(item, `${name}[${i}]`) : `${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(item)}`));
    else if (typeof value === 'object') parts.push(encodeForm(value, name));
    else parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  }
  return parts.filter(Boolean).join('&');
}

const API_VERSION = '2024-06-20';

export class StripeProvider {
  constructor({ secretKey, returnUrl, timeoutMs = 8000, baseUrl = 'https://api.stripe.com', fetchImpl = fetch, now = () => Date.now() }) {
    this.name = 'stripe';
    this.key = secretKey;
    this.returnUrl = returnUrl;
    this.timeoutMs = timeoutMs;
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
    this.now = now;
    this.mode = /_test_/.test(secretKey) ? 'test' : 'live';
  }

  async #call(method, path, { form = null, idempotencyKey = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.key}`,
          'Stripe-Version': API_VERSION,
          ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: form ? encodeForm(form) : undefined,
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw new StripeError('timeout', `Stripe did not answer within ${Math.round(this.timeoutMs / 1000)} seconds`);
      throw new StripeError('network', `Cannot reach Stripe (${hideKeys(err?.cause?.code ?? err?.message ?? 'network error')})`);
    } finally {
      clearTimeout(timer);
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    if (res.ok) return body;
    const message = hideKeys(body?.error?.message ?? `Stripe answered ${res.status}`);
    if (res.status === 401 || res.status === 403) throw new StripeError('auth', `Stripe refused the key: ${message}`, { status: res.status, code: body?.error?.code ?? null });
    throw new StripeError('api', message, { status: res.status, code: body?.error?.code ?? null });
  }

  /** Starts a payment. `reference` ties it back to the booth's own record. */
  async createCheckout({ amountCents, currency = 'usd', description, reference }) {
    const session = await this.#call('POST', '/v1/checkout/sessions', {
      idempotencyKey: `create-${reference}`,
      form: {
        mode: 'payment',
        success_url: this.returnUrl,
        cancel_url: this.returnUrl,
        client_reference_id: reference,
        metadata: { booth_payment: reference },
        // Stripe will not accept an expiry under 30 minutes; the booth expires the session itself when its own timer runs out.
        expires_at: Math.floor(this.now() / 1000) + 31 * 60,
        line_items: [{ quantity: 1, price_data: { currency, unit_amount: amountCents, product_data: { name: description } } }],
      },
    });
    if (!session?.id || !session?.url) throw new StripeError('api', 'Stripe did not return a payment page');
    return { ref: session.id, url: session.url };
  }

  /** { state: "pending" | "paid" | "expired", paymentIntent } */
  async status(ref) {
    const s = await this.#call('GET', `/v1/checkout/sessions/${encodeURIComponent(ref)}`);
    if (s.payment_status === 'paid' || s.payment_status === 'no_payment_required') return { state: 'paid', paymentIntent: s.payment_intent ?? null };
    if (s.status === 'expired') return { state: 'expired', paymentIntent: null };
    return { state: 'pending', paymentIntent: null };
  }

  /**
   * Closes the payment page so a guest can no longer pay it. If they paid in the meantime we say so (never lose a paid session).
   * Returns { state: "expired" | "paid", paymentIntent }.
   */
  async expire(ref) {
    try {
      await this.#call('POST', `/v1/checkout/sessions/${encodeURIComponent(ref)}/expire`, { form: {} });
      return { state: 'expired', paymentIntent: null };
    } catch (err) {
      if (err.kind !== 'api') throw err;
      const now = await this.status(ref); // "cannot be expired" usually means it was just paid
      if (now.state === 'pending') throw err;
      return now;
    }
  }

  async refund(paymentIntent, reference) {
    if (!paymentIntent) throw new StripeError('api', 'There is no Stripe payment to refund');
    const refund = await this.#call('POST', '/v1/refunds', { idempotencyKey: `refund-${reference}`, form: { payment_intent: paymentIntent, metadata: { booth_payment: reference } } });
    return { id: refund.id, status: refund.status };
  }

  /** Is the key accepted? (Reads one Checkout Session, which the recommended restricted key is allowed to do.) */
  async check() {
    try {
      await this.#call('GET', '/v1/checkout/sessions?limit=1');
      return { ok: true, mode: this.mode, detail: `Stripe reachable, the key works (${this.mode} mode)` };
    } catch (err) {
      return { ok: false, mode: this.mode, kind: err.kind, detail: err instanceof StripeError ? err.message : hideKeys(err?.message) };
    }
  }
}
