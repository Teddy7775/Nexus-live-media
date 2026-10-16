import { randomBytes } from 'node:crypto';

const messageOf = (err) => (err instanceof Error ? err.message : String(err ?? 'unknown error'));

/**
 * One print at a time, in order. Jobs are kept in memory (last `keep`) so the UI can poll them.
 * status: queued -> printing -> done | error
 */
export class PrintQueue {
  #jobs = new Map();
  #waiting = [];
  #running = false;

  constructor(printer, { logger, keep = 100, onChange = null } = {}) {
    this.printer = printer;
    this.log = logger;
    this.keep = keep;
    this.onChange = onChange; // called with a job whenever its status changes
  }

  #changed(job) {
    try {
      this.onChange?.(this.view(job));
    } catch {
      /* a listener must never break printing */
    }
  }

  enqueue({ sessionId, pdfFile, copies = 1, label = 'print' }) {
    const job = {
      id: randomBytes(5).toString('hex'),
      sessionId,
      pdfFile,
      copies,
      label,
      status: 'queued',
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    };
    this.#jobs.set(job.id, job);
    this.#waiting.push(job);
    this.#trim();
    queueMicrotask(() => this.#drain());
    this.#changed(job);
    return this.view(job);
  }

  get(id) {
    const job = this.#jobs.get(id);
    return job ? this.view(job) : null;
  }

  list() {
    return [...this.#jobs.values()].reverse().map((job) => this.view(job));
  }

  /** Jobs ahead of (and including) this one that have not finished. */
  pending() {
    return this.#waiting.length + (this.#running ? 1 : 0);
  }

  view(job) {
    const { id, sessionId, copies, label, status, error, createdAt, startedAt, finishedAt } = job;
    return { id, sessionId, copies, label, status, error, createdAt, startedAt, finishedAt };
  }

  async #drain() {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#waiting.length > 0) {
        const job = this.#waiting.shift();
        job.status = 'printing';
        job.startedAt = new Date().toISOString();
        this.#changed(job);
        try {
          await this.printer.print({ pdfFile: job.pdfFile, copies: job.copies });
          job.status = 'done';
        } catch (err) {
          job.status = 'error';
          job.error = messageOf(err);
          this.log?.error?.(`print job ${job.id} failed: ${job.error}`);
        }
        job.finishedAt = new Date().toISOString();
        this.#changed(job);
      }
    } finally {
      this.#running = false;
    }
  }

  #trim() {
    if (this.#jobs.size <= this.keep) return;
    for (const [id, job] of this.#jobs) {
      if (this.#jobs.size <= this.keep) break;
      if (job.status === 'done' || job.status === 'error') this.#jobs.delete(id);
    }
  }
}
