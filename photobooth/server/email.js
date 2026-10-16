import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { isValidEmail, maskEmail, normalizeEmail } from '../public/email-utils.js';
import { escapeHtml } from './share.js';

/**
 * Emails the guest the link to their photos. Principles:
 *  - the address is used ONLY to send the photos: once sent it is gone from disk (only a salted hash is kept, for rate limits);
 *    it is kept longer only if the guest explicitly ticked the marketing opt-in;
 *  - nothing is sent before the guest's link is live, so nobody receives a link that does not open yet;
 *  - a flaky connection retries; a rejection (bad address, wrong login) fails at once with a reason the operator can act on;
 *  - addresses never appear in logs or in the operator panel in full.
 */

export class EmailRejected extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'EmailRejected';
    this.code = code;
    this.status = status;
  }
}

const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
const messageOf = (err) => (err instanceof Error ? err.message : String(err));

/** The message a guest receives (plain text + HTML, with a small inline preview). */
export function buildEmail({ eventName, intro, url, subject, brandName = '', optedIn = false }) {
  const event = oneLine(eventName);
  const subjectLine = oneLine(subject).replaceAll('{event}', event);
  const text = [
    intro,
    '',
    `View and download your photos: ${url}`,
    '',
    `You are receiving this because you asked for your photos at ${event}.`,
    optedIn ? 'You also asked to hear about future events.' : 'We have not kept your email address.',
    brandName ? `\n${brandName}` : '',
  ].join('\n');
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="padding:24px 24px 8px"><h1 style="margin:0;font-size:22px">${escapeHtml(event)}</h1></td></tr>
<tr><td style="padding:0 24px 16px;color:#374151;font-size:16px;line-height:1.5">${escapeHtml(intro)}</td></tr>
<tr><td align="center" style="padding:0 24px"><a href="${escapeHtml(url)}"><img src="cid:photos-preview" alt="Your photos" width="300" style="max-width:100%;height:auto;border-radius:8px;border:1px solid #e5e7eb"></a></td></tr>
<tr><td align="center" style="padding:20px 24px 8px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#0b7bd6;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:999px">View and download your photos</a></td></tr>
<tr><td style="padding:8px 24px 24px;color:#6b7280;font-size:12px;line-height:1.5;text-align:center">You are receiving this because you asked for your photos at ${escapeHtml(event)}.<br>${optedIn ? 'You also asked to hear about future events.' : 'We have not kept your email address.'}${brandName ? `<br>${escapeHtml(brandName)}` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: subjectLine, text, html };
}

/** Turns nodemailer/SMTP errors into "retry later" or "this will never work, here is why". */
export function classifySmtpError(err) {
  const code = err?.responseCode;
  const detail = oneLine(err?.response ?? messageOf(err)).slice(0, 200);
  if (err?.code === 'EAUTH' || code === 535 || code === 534 || code === 530) {
    return { retryable: false, message: 'The mail server rejected the login. Check email.smtp.user and email.smtp.pass.' };
  }
  // 4xx means "try again later" (greylisting, busy server) - even when nodemailer labels it an envelope error.
  if (code >= 400 && code < 500) return { retryable: true, message: `The mail server asked us to try again later (${code}): ${detail}` };
  if (err?.code === 'EENVELOPE' || (code >= 500 && code < 600)) {
    return { retryable: false, message: `The mail server refused the message${code ? ` (${code})` : ''}: ${detail}` };
  }
  // Network trouble, timeouts, DNS: the venue's connection may simply be down for a while.
  return { retryable: true, message: `Cannot send right now: ${detail}` };
}

export class Mailer {
  constructor({ smtp, from, createTransport = nodemailer.createTransport }) {
    this.from = from;
    this.transport = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }

  send({ to, subject, text, html, attachments }) {
    return this.transport.sendMail({ from: this.from, to, subject, text, html, attachments });
  }

  /** Connects and logs in without sending anything - run it before the event. */
  async verify() {
    try {
      await this.transport.verify();
      return { ok: true, detail: 'The mail server accepted the login' };
    } catch (err) {
      return { ok: false, detail: classifySmtpError(err).message };
    }
  }
}

const csvCell = (v) => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheets treating an address as a formula
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** Records an address ONLY when the guest ticked the marketing opt-in. */
export async function appendOptIn({ file, email, eventName, now = new Date() }) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  let exists = true;
  try {
    await fs.access(file);
  } catch {
    exists = false;
  }
  const line = [email, now.toISOString(), eventName].map(csvCell).join(',');
  await fs.appendFile(file, `${exists ? '' : 'email,opted_in_at,event\n'}${line}\n`);
}

export const DEFAULT_EMAIL_RETRY_MS = [30_000, 120_000, 600_000, 1_800_000, 3_600_000, 7_200_000];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export class EmailQueue {
  #items = [];
  #recent = []; // [{ h: salted hash, s: session id, at }] - counts for the limits, holds no readable address
  #salt = null;
  #timer = null;
  #running = false;
  #saving = Promise.resolve();

  constructor({ mailer, file, isShareReady, onSent, logger, limits, intro = '', subject = 'Your photos from {event}', brandName = '', retryDelaysMs = DEFAULT_EMAIL_RETRY_MS, maxAgeMs = DAY, readyPollMs = 3000, now = () => Date.now() }) {
    this.mailer = mailer;
    this.intro = intro;
    this.subject = subject;
    this.brandName = brandName;
    this.file = file;
    this.isShareReady = isShareReady;
    this.onSent = onSent;
    this.log = logger;
    this.limits = limits;
    this.retryDelaysMs = retryDelaysMs;
    this.maxAgeMs = maxAgeMs;
    this.readyPollMs = readyPollMs;
    this.now = now;
  }

  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.#salt = typeof saved.salt === 'string' ? saved.salt : null;
      this.#items = (saved.items ?? []).filter((i) => i && isValidEmail(i.to));
      this.#recent = (saved.recent ?? []).filter((r) => r && r.h && r.at > this.now() - DAY);
    } catch {
      /* first run */
    }
    this.#salt ??= crypto.randomBytes(16).toString('hex');
    for (const item of this.#items) if (item.status === 'sending') item.status = 'queued';
    // Failed addresses are only kept for a week, for the operator to retry; then they are erased.
    this.#items = this.#items.filter((i) => i.status !== 'failed' || this.now() - i.createdAt < 7 * DAY);
    this.#schedule();
    return this;
  }

  #hash(email) {
    return crypto.createHmac('sha256', this.#salt).update(normalizeEmail(email)).digest('hex').slice(0, 32);
  }

  /** Queues an email for a session. Throws EmailRejected (with a guest-safe message) when it must not be sent. */
  enqueue({ sessionId, email, shareUrl, eventName, eventSlug, previewFile, optIn = false }) {
    if (!isValidEmail(email)) throw new EmailRejected('invalid_email', 'That does not look like an email address. Please check it and try again.');
    const to = normalizeEmail(email);
    const h = this.#hash(to);
    const nowMs = this.now();

    if (this.#recent.some((r) => r.h === h && r.s === sessionId)) return { id: null, masked: maskEmail(to), duplicate: true };
    if (this.#recent.filter((r) => r.s === sessionId).length >= this.limits.maxPerSession) {
      throw new EmailRejected('too_many_for_session', `You can email your photos to up to ${this.limits.maxPerSession} addresses.`, 429);
    }
    if (this.#recent.filter((r) => r.h === h && r.at > nowMs - HOUR).length >= this.limits.maxPerAddressPerHour) {
      throw new EmailRejected('too_many_for_address', 'That address has already received several emails from this booth. Please use a different address, or ask the attendant.', 429);
    }

    const item = { id: crypto.randomBytes(5).toString('hex'), sessionId, to, shareUrl, eventName, eventSlug, previewFile, optIn: Boolean(optIn), status: 'queued', attempts: 0, nextAt: nowMs, createdAt: nowMs, error: null };
    this.#items.push(item);
    this.#recent.push({ h, s: sessionId, at: nowMs });
    this.#persist();
    this.#schedule(0);
    return { id: item.id, masked: maskEmail(to), duplicate: false };
  }

  /** Masked view for the operator panel (never the full address). */
  list() {
    return this.#items.map((i) => ({ id: i.id, to: maskEmail(i.to), sessionId: i.sessionId, status: i.status, attempts: i.attempts, error: i.error }));
  }

  pending() {
    return this.#items.filter((i) => i.status === 'queued' || i.status === 'sending').length;
  }

  retry(id) {
    const item = this.#items.find((i) => i.id === id && i.status === 'failed');
    if (!item) return false;
    item.status = 'queued';
    item.error = null;
    item.nextAt = this.now();
    item.createdAt = this.now();
    this.#persist();
    this.#schedule(0);
    return true;
  }

  /** Forget a failed email, including the address. */
  dismiss(id) {
    const before = this.#items.length;
    this.#items = this.#items.filter((i) => !(i.id === id && i.status === 'failed'));
    if (this.#items.length === before) return false;
    this.#persist();
    return true;
  }

  stop() {
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  flush() {
    return this.#saving;
  }

  #persist() {
    this.#recent = this.#recent.filter((r) => r.at > this.now() - DAY);
    const snapshot = JSON.stringify({ salt: this.#salt, items: this.#items, recent: this.#recent });
    this.#saving = this.#saving
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, snapshot, { mode: 0o600 });
        await fs.rename(tmp, this.file);
      })
      .catch(() => {});
  }

  #schedule(forceDelay) {
    clearTimeout(this.#timer);
    const waiting = this.#items.filter((i) => i.status === 'queued');
    if (waiting.length === 0) return;
    const delay = forceDelay ?? Math.max(0, Math.min(...waiting.map((i) => i.nextAt)) - this.now());
    this.#timer = setTimeout(() => this.tick(), delay);
    this.#timer.unref?.();
  }

  async tick() {
    if (this.#running) return;
    this.#running = true;
    try {
      for (;;) {
        const item = this.#items.find((i) => i.status === 'queued' && i.nextAt <= this.now());
        if (!item) break;
        await this.#process(item);
      }
    } finally {
      this.#running = false;
      this.#schedule();
    }
  }

  async #process(item) {
    const age = this.now() - item.createdAt;
    // Not before the link works: otherwise the guest would receive a link that shows "photos not found".
    let ready = true;
    try {
      ready = await this.isShareReady(item);
    } catch {
      ready = false;
    }
    if (!ready) {
      if (age > this.maxAgeMs) return this.#fail(item, 'Gave up: the guest gallery never became available, so the link was not sent.');
      item.nextAt = this.now() + this.readyPollMs;
      return undefined;
    }

    item.status = 'sending';
    item.attempts += 1;
    try {
      const content = buildEmail({ eventName: item.eventName, intro: this.intro, url: item.shareUrl, subject: this.subject, brandName: this.brandName, optedIn: item.optIn });
      const attachments = [];
      if (item.previewFile) {
        try {
          await fs.access(item.previewFile);
          attachments.push({ filename: 'photos.jpg', path: item.previewFile, cid: 'photos-preview' });
        } catch {
          /* the email is still useful without the preview picture */
        }
      }
      await this.mailer.send({ to: item.to, ...content, attachments });
      this.#items = this.#items.filter((i) => i !== item);
      this.log?.info?.(`emailed session ${item.sessionId} to ${maskEmail(item.to)}`);
      this.#persist();
      await this.onSent?.(item); // the only place a kept address (marketing opt-in) is written
      return undefined;
    } catch (err) {
      const { retryable, message } = classifySmtpError(err);
      item.error = message;
      if (!retryable) return this.#fail(item, message);
      if (age > this.maxAgeMs) return this.#fail(item, `Gave up after ${Math.round(this.maxAgeMs / 3_600_000)} hours: ${message}`);
      item.status = 'queued';
      item.nextAt = this.now() + this.retryDelaysMs[Math.min(item.attempts - 1, this.retryDelaysMs.length - 1)];
      this.log?.warn?.(`email to ${maskEmail(item.to)} will retry: ${message}`);
      this.#persist();
      return undefined;
    }
  }

  #fail(item, message) {
    item.status = 'failed';
    item.error = message;
    this.log?.warn?.(`email to ${maskEmail(item.to)} FAILED: ${message}`);
    this.#persist();
  }
}
