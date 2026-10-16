import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const formatUsd = (cents) => `$${(cents / 100).toFixed(2)}`;

/** The only notes an attendant can attach, so a ledger cell can never hold anything but a plain word. */
export const PAY_NOTES = ['cash', 'zelle', 'venmo', 'cashapp', 'card-reader', 'other'];

const messageOf = (err) => (err instanceof Error ? err.message : String(err ?? 'unknown error'));
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const MAX_KEPT = 500;

/**
 * Takes guests' money in a way that can be trusted when things go wrong.
 *
 *   pending -> paid -> refunded            (paid may be flagged refundDue)
 *   pending -> expired | cancelled         (an unfinished payment page is closed so it cannot be paid later)
 *
 * How a guest pays: "stripe" (they scan a QR code and pay on their phone) or "attendant" (they pay a person, who taps Mark paid).
 * If Stripe cannot be reached the request falls back as configured: to the attendant, or through free ("offline").
 * Every record is kept on disk, and every payment, waiver and refund is also written to a plain CSV ledger for your books.
 *
 * What a payment pays for is used EXACTLY ONCE: `consume` flips it from paid to used before anything else happens, so a double
 * tap or two kiosks can never get two prints (or two sessions) out of one payment.
 */
export class Payments {
  #items = new Map();
  #timers = new Map();
  #writing = Promise.resolve();
  #ledgerWriting = Promise.resolve();
  #pollTimer = null;
  #polling = null;
  #refunding = new Set();
  #warned = new Set();

  constructor({ file, provider = null, timeoutMs, offline = 'attendant', ledgerFile, describe = () => 'Photo booth', onChange, logger, now = () => Date.now(), pollMs = 2500, reconcileMs = 30_000, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.file = file;
    this.provider = provider;
    this.timeoutMs = timeoutMs;
    this.offline = offline;
    this.ledgerFile = ledgerFile;
    this.describe = describe;
    this.onChange = onChange;
    this.log = logger;
    this.now = now;
    this.pollMs = pollMs;
    this.reconcileMs = reconcileMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.lastProviderError = null;
  }

  // ------------------------------------------------------------------ storage

  async load() {
    let saved = [];
    try {
      saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {
      /* first run */
    }
    for (const item of Array.isArray(saved) ? saved : []) {
      if (!item?.id || !item.amountCents) continue;
      // Nobody can still be waiting at a kiosk after a restart. If a Stripe page was left open it is closed (or found paid) below.
      if (item.status === 'pending') {
        item.status = 'expired';
        item.reason = 'restart';
        item.unresolved = Boolean(item.providerRef);
      }
      this.#items.set(item.id, item);
    }
    this.#ensureReconcile();
    return this;
  }

  #save() {
    const snapshot = JSON.stringify([...this.#items.values()], null, 1);
    this.#writing = this.#writing
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, snapshot);
        await fs.rename(tmp, this.file);
      })
      .catch((err) => this.log?.error?.(`payments: could not save: ${messageOf(err)}`));
    return this.#writing;
  }

  flush() {
    return Promise.all([this.#writing, this.#ledgerWriting]);
  }

  #ledger(item, status) {
    if (!this.ledgerFile || !item.eventSlug) return;
    const file = this.ledgerFile(item);
    const line = [new Date(this.now()).toISOString(), status, item.id, item.consumedBy ?? item.sessionId ?? '', item.kind, (item.amountCents / 100).toFixed(2), item.currency, item.method ?? '', item.note ?? '', item.paymentIntent ?? item.providerRef ?? ''].map(csvCell).join(',');
    this.#ledgerWriting = this.#ledgerWriting
      .then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        let header = '';
        try {
          await fs.access(file);
        } catch {
          header = 'time,event,payment,session,kind,amount,currency,method,note,reference\n';
        }
        await fs.appendFile(file, `${header}${line}\n`);
      })
      .catch((err) => this.log?.error?.(`payments: could not write the ledger: ${messageOf(err)}`));
  }

  // -------------------------------------------------------------------- views

  /** Everything the screens may show. (Stripe's own references stay on the server.) */
  view(item) {
    const { id, kind, sessionId, copies, amountCents, currency, status, method, via, reason, note, consumed, consumedBy, refundDue, refundedAt, paidLate, unresolved, url, createdAt, expiresAt, paidAt } = item;
    return { id, kind, sessionId, copies, amountCents, currency, status, method, via, reason, note, consumed, consumedBy, refundDue, refundedAt, paidLate, unresolved, url: status === 'pending' && via === 'stripe' ? url : null, createdAt, expiresAt, paidAt, timeoutMs: this.timeoutMs };
  }

  get(id) {
    const item = this.#items.get(id);
    return item ? this.view(item) : null;
  }

  list() {
    return [...this.#items.values()].reverse().map((i) => this.view(i));
  }

  pending() {
    return this.list().filter((i) => i.status === 'pending').reverse();
  }

  /** Things a person has to deal with: money that is owed back, paid-but-unused payments, and cash/Zelle waiting to be confirmed. */
  needsAttention() {
    return this.list().filter((i) => (i.status === 'pending' && i.via === 'attendant') || (i.status === 'paid' && (i.refundDue || (!i.consumed && i.method !== 'waived' && this.now() - Date.parse(i.paidAt) > 120_000))));
  }

  totals(eventSlug) {
    const out = { paid: 0, refunded: 0, waived: 0, count: 0, byMethod: {} };
    for (const i of this.#items.values()) {
      if (eventSlug && i.eventSlug !== eventSlug) continue;
      if (i.status === 'paid' && i.method === 'waived') out.waived += 1;
      else if (i.status === 'paid') {
        out.paid += i.amountCents;
        out.count += 1;
        out.byMethod[i.method] = (out.byMethod[i.method] ?? 0) + i.amountCents;
      } else if (i.status === 'refunded') out.refunded += i.amountCents;
    }
    out.net = out.paid;
    return out;
  }

  #changed(item) {
    this.#save();
    try {
      this.onChange?.(this.view(item));
    } catch (err) {
      this.log?.error?.(`payments change handler: ${messageOf(err)}`);
    }
  }

  // ------------------------------------------------------------------ asking

  /**
   * A guest has to pay. A payment that is already pending for the same session (a double tap), or already paid but not yet used
   * (the kiosk lost track), is returned instead of making the guest pay twice.
   */
  async request({ kind, sessionId = null, copies = 1, amountCents, eventSlug }) {
    if (kind === 'print') {
      const existing = [...this.#items.values()].find((i) => i.kind === 'print' && i.sessionId === sessionId && !i.consumed && (i.status === 'pending' || (i.status === 'paid' && !i.refundDue)));
      if (existing) return this.view(existing);
    }
    const created = this.now();
    const item = {
      id: randomBytes(5).toString('hex'),
      kind,
      sessionId,
      copies,
      amountCents,
      currency: 'usd',
      eventSlug,
      status: 'pending',
      method: null,
      via: this.provider ? 'stripe' : 'attendant',
      reason: null,
      note: null,
      providerRef: null,
      paymentIntent: null,
      url: null,
      consumed: false,
      consumedBy: null,
      refundDue: null,
      refundedAt: null,
      refundId: null,
      paidLate: false,
      unresolved: false,
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + this.timeoutMs).toISOString(),
      paidAt: null,
    };
    this.#items.set(item.id, item);
    this.#trim();

    if (this.provider) {
      try {
        const checkout = await this.provider.createCheckout({ amountCents, currency: 'usd', description: this.describe(item), reference: item.id });
        item.providerRef = checkout.ref;
        item.url = checkout.url;
        this.lastProviderError = null;
      } catch (err) {
        // No internet, Stripe down, key refused...: the booth must not stop. Fall back as configured.
        this.lastProviderError = { at: new Date(this.now()).toISOString(), kind: err.kind ?? 'unknown', message: messageOf(err) };
        this.log?.warn?.(`payments: could not start a card payment (${this.lastProviderError.kind}): ${this.lastProviderError.message}`);
        item.reason = 'offline';
        if (this.offline === 'free') {
          this.#settlePaid(item, { method: 'waived', by: 'offline' });
          return this.view(item);
        }
        item.via = 'attendant';
      }
    }
    this.#startTimer(item);
    this.#ensurePolling();
    this.#changed(item);
    return this.view(item);
  }

  // ----------------------------------------------------------------- settling

  #settlePaid(item, { method, by, note = null, paymentIntent = undefined }) {
    this.#stopTimer(item.id);
    item.status = 'paid';
    item.method = method;
    item.decidedBy = by;
    item.note = note;
    item.paidAt = new Date(this.now()).toISOString();
    if (paymentIntent !== undefined) item.paymentIntent = paymentIntent;
    item.unresolved = false;
    this.#ledger(item, method === 'waived' ? 'waived' : 'paid');
    this.#changed(item);
  }

  /** An attendant has the money (cash, Zelle...). */
  async markPaid(id, { note = 'other', by = 'attendant' } = {}) {
    const item = this.#items.get(id);
    if (!item || item.status !== 'pending') return null;
    if (!PAY_NOTES.includes(note)) note = 'other';
    // If a card payment page is open for this guest, close it so they cannot ALSO pay there.
    if (item.providerRef && this.provider) {
      try {
        const result = await this.provider.expire(item.providerRef);
        if (result.state === 'paid') {
          if (item.status !== 'pending') return null;
          this.#settlePaid(item, { method: 'card', by: 'stripe', paymentIntent: result.paymentIntent });
          return this.view(item);
        }
      } catch (err) {
        item.unresolved = true; // could not close it: the reconcile pass keeps trying and flags a late card payment
        this.log?.warn?.(`payments: could not close the card page for ${id}: ${messageOf(err)}`);
      }
    }
    if (item.status !== 'pending') return null;
    this.#settlePaid(item, { method: 'attendant', by, note });
    return this.view(item);
  }

  /** The host waives the charge (a friend, a mistake, a free print). */
  async waive(id, by = 'attendant') {
    const item = this.#items.get(id);
    if (!item || item.status !== 'pending') return null;
    if (item.providerRef && this.provider) {
      try {
        const result = await this.provider.expire(item.providerRef);
        if (result.state === 'paid') {
          this.#settlePaid(item, { method: 'card', by: 'stripe', paymentIntent: result.paymentIntent });
          return this.view(item);
        }
      } catch {
        item.unresolved = true;
      }
    }
    if (item.status !== 'pending') return null;
    this.#settlePaid(item, { method: 'waived', by });
    return this.view(item);
  }

  /** The guest changed their mind. */
  async cancel(id) {
    const item = this.#items.get(id);
    if (!item || item.status !== 'pending') return null;
    return this.#close(item, 'cancelled', 'guest');
  }

  /** Stops waiting. Closes the Stripe page; if the guest managed to pay first, that wins (nothing is lost). */
  async #close(item, status, by) {
    this.#stopTimer(item.id);
    let paid = null;
    if (item.providerRef && this.provider) {
      try {
        const result = await this.provider.expire(item.providerRef);
        if (result.state === 'paid') paid = result;
      } catch (err) {
        item.unresolved = true;
        this.log?.warn?.(`payments: could not close the card page for ${item.id}: ${messageOf(err)}`);
      }
    }
    if (item.status !== 'pending') return this.view(item); // settled by somebody else meanwhile
    if (paid) {
      this.#settlePaid(item, { method: 'card', by: 'stripe', paymentIntent: paid.paymentIntent });
      return this.view(item);
    }
    item.status = status;
    item.reason = item.reason ?? (by === 'timeout' ? 'timeout' : null);
    item.decidedBy = by;
    this.#changed(item);
    this.#ensurePolling(); // a page that could not be closed is retried on the polling timer (not at once: the network is probably still down)
    return this.view(item);
  }

  #startTimer(item) {
    const timer = this.setTimer(() => {
      this.#timers.delete(item.id);
      if (item.status === 'pending') this.#close(item, 'expired', 'timeout');
    }, this.timeoutMs);
    timer.unref?.();
    this.#timers.set(item.id, timer);
  }

  #stopTimer(id) {
    const timer = this.#timers.get(id);
    if (timer) this.clearTimer(timer);
    this.#timers.delete(id);
  }

  // ------------------------------------------------------------------ using it

  /**
   * Uses a paid payment up. Returns it only the FIRST time, and only for what it was paid for.
   * (Synchronous check-and-set: two requests in the same instant cannot both get it.)
   */
  consume(id, { kind, sessionId }) {
    const item = this.#items.get(id);
    if (!item || item.status !== 'paid' || item.consumed || item.kind !== kind || item.refundDue) return null;
    if (kind === 'print' && item.sessionId !== sessionId) return null;
    item.consumed = true;
    item.consumedBy = sessionId;
    if (kind === 'session') item.sessionId = sessionId;
    this.#changed(item);
    return this.view(item);
  }

  /** Something went wrong after the guest paid (their print was not approved, the print job failed...). A person decides about the refund. */
  flagRefund(id, reason) {
    const item = this.#items.get(id);
    if (!item || item.status !== 'paid' || item.refundDue || item.method === 'waived') return null;
    item.refundDue = reason;
    this.#changed(item);
    return this.view(item);
  }

  /** The attendant says the refund-due flag was a mistake or has been dealt with some other way. */
  clearRefundFlag(id) {
    const item = this.#items.get(id);
    if (!item || !item.refundDue) return null;
    item.refundDue = null;
    this.#changed(item);
    return this.view(item);
  }

  /** The attendant decides to give the guest what they paid for after all (the print goes ahead): the flag is cleared and the payment is used up. */
  honour(id) {
    const item = this.#items.get(id);
    if (!item || item.status !== 'paid' || !item.refundDue) return null; // (it may already be marked used: a refused approval uses the payment up)
    item.refundDue = null;
    item.consumed = true;
    item.consumedBy = item.sessionId;
    this.#changed(item);
    return this.view(item);
  }

  /** Gives the money back: through Stripe for a card payment, or recorded as handed back for cash/Zelle. Throws a plain message on failure. */
  async refund(id, { by = 'attendant' } = {}) {
    const item = this.#items.get(id);
    if (!item || item.status !== 'paid') throw new Error('That payment cannot be refunded (it is not a paid payment).');
    if (item.method === 'waived') throw new Error('That one was waived: nothing was paid, so there is nothing to refund.');
    if (this.#refunding.has(id)) throw new Error('A refund for this payment is already being made.');
    this.#refunding.add(id);
    try {
      if (item.method === 'card') {
        if (!this.provider) throw new Error('Stripe is not set up, so a card payment cannot be refunded from here (use the Stripe dashboard).');
        const refund = await this.provider.refund(item.paymentIntent, item.id);
        item.refundId = refund.id;
      }
      item.status = 'refunded';
      item.refundedAt = new Date(this.now()).toISOString();
      item.refundDue = null;
      item.decidedBy = by;
      this.#ledger(item, 'refunded');
      this.#changed(item);
      return this.view(item);
    } finally {
      this.#refunding.delete(id);
    }
  }

  // ---------------------------------------------------- watching Stripe

  #ensurePolling() {
    if (this.#pollTimer || !this.provider) return;
    this.#pollTimer = setInterval(() => this.poll().catch(() => {}), this.pollMs);
    this.#pollTimer.unref?.();
  }

  #ensureReconcile() {
    this.#ensurePolling();
    if (this.provider && [...this.#items.values()].some((i) => i.unresolved)) this.poll().catch(() => {});
  }

  /** Asks Stripe about every open payment page (and about pages that could not be closed). Calls made meanwhile wait their turn. */
  async poll() {
    if (!this.provider) return;
    while (this.#polling) await this.#polling.catch(() => {});
    this.#polling = this.#pollOnce().finally(() => {
      this.#polling = null;
    });
    return this.#polling;
  }

  async #pollOnce() {
    try {
      const open = [...this.#items.values()].filter((i) => i.providerRef && (i.status === 'pending' || i.unresolved));
      for (const item of open) {
        let status;
        try {
          status = await this.provider.status(item.providerRef);
        } catch (err) {
          if (!this.#warned.has(err.message)) this.log?.warn?.(`payments: cannot ask Stripe about ${item.id}: ${messageOf(err)}`);
          this.#warned.add(err.message);
          continue; // try again next time: the guest may well have paid, we just cannot see it yet
        }
        this.#warned.clear();
        if (status.state === 'paid') {
          if (item.status === 'pending') this.#settlePaid(item, { method: 'card', by: 'stripe', paymentIntent: status.paymentIntent });
          else if (item.status === 'expired' || item.status === 'cancelled') {
            // Paid after we had given up on them. They have not got what they paid for: a person must decide.
            item.status = 'paid';
            item.method = 'card';
            item.paymentIntent = status.paymentIntent;
            item.paidAt = new Date(this.now()).toISOString();
            item.paidLate = true;
            item.refundDue = 'paid_after_timeout';
            item.unresolved = false;
            this.log?.warn?.(`payments: ${item.id} was paid after it had timed out - refund or honour it from the station`);
            this.#ledger(item, 'paid');
            this.#changed(item);
          }
        } else if (status.state === 'expired') {
          if (item.status === 'pending') {
            item.status = 'expired';
            item.reason = 'expired';
          }
          item.unresolved = false;
          this.#changed(item);
        } else if (item.unresolved) {
          try {
            const result = await this.provider.expire(item.providerRef); // still open although we gave up: close it now
            if (result.state === 'expired') {
              item.unresolved = false;
              this.#changed(item);
            }
          } catch {
            /* still cannot: next time */
          }
        }
      }
      if (![...this.#items.values()].some((i) => i.providerRef && (i.status === 'pending' || i.unresolved))) {
        clearInterval(this.#pollTimer);
        this.#pollTimer = null;
      }
    } catch (err) {
      this.log?.error?.(`payments: polling failed: ${messageOf(err)}`);
    }
  }

  stop() {
    for (const id of [...this.#timers.keys()]) this.#stopTimer(id);
    clearInterval(this.#pollTimer);
    this.#pollTimer = null;
  }

  #trim() {
    if (this.#items.size <= MAX_KEPT) return;
    for (const [id, item] of this.#items) {
      if (this.#items.size <= MAX_KEPT) break;
      const keep = item.status === 'pending' || item.unresolved || item.refundDue || (item.status === 'paid' && !item.consumed && item.method !== 'waived');
      if (!keep) this.#items.delete(id);
    }
  }
}
