import http from 'node:http';
import { randomBytes } from 'node:crypto';

/**
 * A stand-in for the parts of Stripe's API the booth uses (Checkout Sessions, refunds), following Stripe's documented behaviour:
 * form-encoded requests, Bearer key, idempotency keys, a session being open -> complete | expired, expire() failing on a paid session.
 * Tests drive it like a guest would: `pay(id)` is "the guest paid on their phone".
 */
export async function startFakeStripe({ key = 'sk_test_fakefakefake1234' } = {}) {
  const state = { sessions: new Map(), refunds: new Map(), idem: new Map(), requests: [], failNext: [], delayMs: 0, down: false, key };

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    const url = new URL(req.url, 'http://x');
    const form = Object.fromEntries(new URLSearchParams(raw));
    state.requests.push({ method: req.method, path: url.pathname, query: url.search, form, raw, headers: req.headers });

    if (state.down) return req.socket.destroy();
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const error = (status, code, message) => reply(status, { error: { type: 'invalid_request_error', code, message } });

    const injected = state.failNext.shift();
    if (injected === 'destroy') return req.socket.destroy();
    if (injected === '500') return error(500, 'api_error', 'An unknown error occurred');

    if (req.headers.authorization !== `Bearer ${state.key}`) {
      return reply(401, { error: { type: 'invalid_request_error', message: `Invalid API Key provided: ${(req.headers.authorization ?? '').replace('Bearer ', '')}` } });
    }

    const idemKey = req.headers['idempotency-key'];
    if (req.method === 'POST' && idemKey && state.idem.has(idemKey)) return reply(200, state.idem.get(idemKey));
    const answer = (body) => {
      if (req.method === 'POST' && idemKey) state.idem.set(idemKey, body);
      reply(200, body);
    };

    if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const amount = Number(form['line_items[0][price_data][unit_amount]']);
      if (form.mode !== 'payment') return error(400, 'parameter_invalid_empty', 'mode is required');
      if (!(amount >= 50)) return error(400, 'amount_too_small', 'The Checkout Session\'s total amount due must add up to at least $0.50 usd');
      if (form['line_items[0][price_data][currency]'] !== 'usd') return error(400, 'invalid_currency', 'Unsupported currency');
      if (!/^https:\/\//.test(form.success_url ?? '')) return error(400, 'url_invalid', 'Not a valid URL');
      const expiresAt = Number(form.expires_at);
      if (expiresAt - Date.now() / 1000 < 30 * 60) return error(400, 'parameter_invalid_integer', 'The expires_at timestamp must be at least 30 minutes in the future');
      const id = `cs_test_${randomBytes(8).toString('hex')}`;
      const session = { id, object: 'checkout.session', url: `${state.base}/pay/${id}`, status: 'open', payment_status: 'unpaid', payment_intent: null, amount_total: amount, currency: 'usd', client_reference_id: form.client_reference_id, metadata: { booth_payment: form['metadata[booth_payment]'] }, name: form['line_items[0][price_data][product_data][name]'] };
      state.sessions.set(id, session);
      return answer(session);
    }
    let m = /^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/.exec(url.pathname);
    if (m) {
      const session = state.sessions.get(m[1]);
      if (!session) return error(404, 'resource_missing', `No such checkout.session: '${m[1]}'`);
      if (req.method === 'GET') return reply(200, session);
      if (req.method === 'POST' && m[2]) {
        if (session.status !== 'open') return error(400, 'checkout_session_not_open', 'Only Checkout Sessions with a status in open can be expired.');
        session.status = 'expired';
        return answer(session);
      }
    }
    if (req.method === 'GET' && url.pathname === '/v1/checkout/sessions') return reply(200, { object: 'list', data: [...state.sessions.values()].slice(0, 1) });
    if (req.method === 'POST' && url.pathname === '/v1/refunds') {
      const pi = form.payment_intent;
      const paid = [...state.sessions.values()].find((s) => s.payment_intent === pi);
      if (!paid) return error(400, 'resource_missing', `No such payment_intent: '${pi}'`);
      if (state.refunds.has(pi)) return error(400, 'charge_already_refunded', 'Charge has already been refunded.');
      const refund = { id: `re_${randomBytes(6).toString('hex')}`, status: 'succeeded', payment_intent: pi };
      state.refunds.set(pi, refund);
      return answer(refund);
    }
    return error(404, 'resource_missing', 'Unrecognized request URL');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.base = `http://127.0.0.1:${server.address().port}`;

  return {
    state,
    base: state.base,
    key,
    /** The guest paid on their phone. */
    pay(id) {
      const s = state.sessions.get(id);
      if (!s || s.status !== 'open') throw new Error(`cannot pay ${id}: ${s?.status}`);
      s.status = 'complete';
      s.payment_status = 'paid';
      s.payment_intent = `pi_${randomBytes(8).toString('hex')}`;
      return s.payment_intent;
    },
    open: () => [...state.sessions.values()].filter((s) => s.status === 'open'),
    byRef: (reference) => [...state.sessions.values()].find((s) => s.client_reference_id === reference),
    calls: (method, pathPart) => state.requests.filter((r) => r.method === method && r.path.includes(pathPart)),
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}
