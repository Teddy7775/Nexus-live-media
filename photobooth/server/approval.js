import { randomBytes } from 'node:crypto';

const messageOf = (err) => (err instanceof Error ? err.message : String(err ?? 'unknown error'));

/**
 * Print approval: a guest asks to print, an attendant at the station says yes or no.
 *
 *   pending -> approved | rejected | expired | cancelled | error
 *
 * A guest never waits for ever: after `timeoutMs` the request is settled by `onTimeout` ("cancel" = it expires without
 * printing, "print" = it is approved automatically). Nothing here touches the printer; `onApprove` does the actual work,
 * so a failure to build or queue the print is reported to the guest instead of being lost.
 */
export class ApprovalQueue {
  #items = new Map();
  #timers = new Map();

  constructor({ timeoutMs, onTimeout = 'cancel', maxCopies = 4, onApprove, onChange, logger, now = () => Date.now(), keep = 100, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.timeoutMs = timeoutMs;
    this.onTimeout = onTimeout;
    this.maxCopies = maxCopies;
    this.onApprove = onApprove;
    this.onChange = onChange;
    this.log = logger;
    this.now = now;
    this.keep = keep;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  view(item) {
    const { id, sessionId, paymentId, copies, status, reason, decidedBy, createdAt, expiresAt, decidedAt, job, queueAhead, estimatedSeconds, error } = item;
    return { id, sessionId, paymentId, copies, status, reason, decidedBy, createdAt, expiresAt, decidedAt, job, queueAhead, estimatedSeconds, error, timeoutMs: this.timeoutMs };
  }

  get(id) {
    const item = this.#items.get(id);
    return item ? this.view(item) : null;
  }

  /** Newest first. */
  list() {
    return [...this.#items.values()].reverse().map((i) => this.view(i));
  }

  pending() {
    return this.list().filter((i) => i.status === 'pending').reverse(); // oldest first: the guest who has waited longest
  }

  forSession(sessionId) {
    return [...this.#items.values()].reverse().map((i) => this.view(i)).find((i) => i.sessionId === sessionId) ?? null;
  }

  clampCopies(copies) {
    const n = Number.isInteger(copies) ? copies : 1;
    return Math.min(this.maxCopies, Math.max(1, n));
  }

  /**
   * A guest asks to print. If no station is connected there is nobody to ask, so it is settled at once the way a timeout would be
   * (the guest is told straight away rather than made to wait for nothing).
   */
  async request({ sessionId, copies = 1, label = 'print', stationOnline = true, paymentId = null }) {
    const existing = [...this.#items.values()].find((i) => i.sessionId === sessionId && i.status === 'pending');
    if (existing) return this.view(existing); // a double tap must not create two requests
    const created = this.now();
    const item = {
      id: randomBytes(5).toString('hex'),
      sessionId,
      paymentId,
      copies: this.clampCopies(copies),
      label,
      status: 'pending',
      reason: null,
      decidedBy: null,
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + this.timeoutMs).toISOString(),
      decidedAt: null,
      job: null,
      queueAhead: null,
      estimatedSeconds: null,
      error: null,
    };
    this.#items.set(item.id, item);
    this.#trim();
    this.#changed(item);
    if (!stationOnline) {
      this.log?.warn?.(`print approval ${item.id}: no station is connected, settling as "${this.onTimeout}"`);
      if (this.onTimeout === 'print') return this.approve(item.id, {}, 'no_station');
      return this.#settle(item, 'expired', { reason: 'no_station', by: 'no_station' });
    }
    const timer = this.setTimer(() => this.#timedOut(item.id), this.timeoutMs);
    timer.unref?.();
    this.#timers.set(item.id, timer);
    return this.view(item);
  }

  /** Returns the updated request, or null when it is unknown or was already decided (so two stations cannot both act). */
  async approve(id, { copies } = {}, by = 'station') {
    const item = this.#items.get(id);
    if (!item || item.status !== 'pending') return null;
    this.#stopTimer(id);
    item.status = 'approving'; // taken: a second click on another station finds it no longer pending
    if (copies !== undefined) item.copies = this.clampCopies(copies);
    try {
      const printed = await this.onApprove(this.view(item));
      item.job = printed.job;
      item.queueAhead = printed.queueAhead ?? 0;
      item.estimatedSeconds = printed.estimatedSeconds ?? null;
      return this.#settle(item, 'approved', { by });
    } catch (err) {
      this.log?.error?.(`print approval ${id}: could not start the print: ${messageOf(err)}`);
      item.error = messageOf(err);
      return this.#settle(item, 'error', { by });
    }
  }

  reject(id, reason = null, by = 'station') {
    const item = this.#items.get(id);
    if (!item || item.status !== 'pending') return null;
    this.#stopTimer(id);
    return this.#settle(item, 'rejected', { reason: typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 120) : null, by });
  }

  /** The guest walked away. */
  cancel(id) {
    const item = this.#items.get(id);
    if (!item || item.status !== 'pending') return null;
    this.#stopTimer(id);
    return this.#settle(item, 'cancelled', { by: 'guest' });
  }

  /** Approves every waiting request (a busy event). Returns how many were approved. */
  async approveAll() {
    let n = 0;
    for (const item of this.pending()) {
      if (await this.approve(item.id)) n += 1;
    }
    return n;
  }

  stop() {
    for (const id of [...this.#timers.keys()]) this.#stopTimer(id);
  }

  async #timedOut(id) {
    this.#timers.delete(id);
    const item = this.#items.get(id);
    if (!item || item.status !== 'pending') return;
    if (this.onTimeout === 'print') await this.approve(id, {}, 'timeout');
    else this.#settle(item, 'expired', { reason: 'timeout', by: 'timeout' });
  }

  #stopTimer(id) {
    const timer = this.#timers.get(id);
    if (timer) this.clearTimer(timer);
    this.#timers.delete(id);
  }

  #settle(item, status, { reason = item.reason, by }) {
    item.status = status;
    item.reason = reason;
    item.decidedBy = by;
    item.decidedAt = new Date(this.now()).toISOString();
    this.#changed(item);
    return this.view(item);
  }

  #changed(item) {
    try {
      this.onChange?.(this.view(item));
    } catch (err) {
      this.log?.error?.(`approval change handler: ${messageOf(err)}`);
    }
  }

  #trim() {
    if (this.#items.size <= this.keep) return;
    for (const [id, item] of this.#items) {
      if (this.#items.size <= this.keep) break;
      if (item.status !== 'pending' && item.status !== 'approving') this.#items.delete(id);
    }
  }
}
