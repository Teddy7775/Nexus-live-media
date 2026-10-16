import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { newShareToken } from './share.js';

export const SESSION_ID = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
const EVENT_SLUG = /^[A-Za-z0-9_-]{1,64}$/;

const pad = (n) => String(n).padStart(2, '0');

export function newSessionId(now = new Date()) {
  const d = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${d}-${t}-${randomBytes(2).toString('hex')}`;
}

/** "Sarah & James' Wedding" -> "2026-10-16-sarah-james-wedding" (safe as a folder name). */
export function slugifyEvent(name, now = new Date()) {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${base || 'event'}`;
}

/**
 * One folder per session: <storage>/<event>/<session id>/{originals,previews,final.jpg,print.pdf,session.json}
 * Paths stored in session.json are relative to the session folder, so the whole storage folder can be moved or copied.
 */
export class SessionStore {
  #active = new Map();
  #saving = new Map(); // session id -> the save in progress (or queued)

  constructor({ rootDir, onSave = null }) {
    this.rootDir = rootDir;
    this.onSave = onSave; // called after every save: how the station learns that a session changed
  }

  eventDir(eventSlug) {
    if (!EVENT_SLUG.test(eventSlug)) throw new Error(`Invalid event folder name: ${eventSlug}`);
    return path.join(this.rootDir, eventSlug);
  }

  sessionDir(session) {
    return path.join(this.eventDir(session.eventSlug), session.id);
  }

  /** Absolute path inside the session folder; refuses anything that would escape it. */
  resolve(session, relative) {
    const base = this.sessionDir(session);
    const full = path.resolve(base, relative);
    if (full !== base && !full.startsWith(base + path.sep)) throw new Error('Path escapes the session folder');
    return full;
  }

  mediaUrl(session, relative) {
    return `/media/${encodeURIComponent(session.eventSlug)}/${session.id}/${relative.split(path.sep).join('/')}`;
  }

  async create({ eventSlug, eventName, templateId, shotsNeeded, share = false, background = null, now = new Date() }) {
    const session = {
      id: newSessionId(now),
      eventSlug,
      eventName,
      templateId,
      shotsNeeded,
      // Green screen: the picture chosen for behind the guest and the keying settings in force when the session began,
      // so every preview, the print and the GIF of this session look alike even if the operator tunes the keyer meanwhile.
      background, // { id, name, key } | null
      createdAt: now.toISOString(),
      status: 'shooting', // shooting -> composed
      shots: [], // [{ index, attempt, file, preview }]
      final: null, // { file, preview }
      pdf: null,
      gif: null, // { file, frames, bytes, version } - a short live-view animation, if one was recorded
      prints: [], // [{ jobId, copies, at }]
      // Private gallery address (only when sharing is on). builtVersion/uploadedVersion = which picture version the
      // gallery folder / the web host currently holds, so a retake is noticed and re-published.
      share: share ? { token: newShareToken(), builtVersion: null, uploadedVersion: null, uploadedAt: null, files: [] } : null,
    };
    await fs.mkdir(path.join(this.sessionDir(session), 'originals'), { recursive: true });
    await fs.mkdir(path.join(this.sessionDir(session), 'previews'), { recursive: true });
    this.#active.set(session.id, session);
    await this.save(session);
    return session;
  }

  /**
   * Saves one after another per session, each writing the session as it is when its turn comes. Two saves at once used the
   * same temporary file, so one of them failed (and a slow older one could land after a newer one).
   */
  save(session) {
    const run = (this.#saving.get(session.id) ?? Promise.resolve()).catch(() => {}).then(() => this.#write(session));
    this.#saving.set(session.id, run);
    const clear = () => this.#saving.get(session.id) === run && this.#saving.delete(session.id);
    run.then(clear, clear);
    return run;
  }

  async #write(session) {
    const file = path.join(this.sessionDir(session), 'session.json');
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(session, null, 2));
    await fs.rename(tmp, file);
    try {
      this.onSave?.(session);
    } catch {
      /* a listener must never break saving */
    }
  }

  /** In-memory first (the session in progress), then a scan of the event folders (older sessions). */
  async find(id) {
    if (!SESSION_ID.test(id)) return null;
    if (this.#active.has(id)) return this.#active.get(id);
    let events;
    try {
      events = await fs.readdir(this.rootDir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of events) {
      if (!entry.isDirectory() || !EVENT_SLUG.test(entry.name)) continue;
      try {
        const session = JSON.parse(await fs.readFile(path.join(this.rootDir, entry.name, id, 'session.json'), 'utf8'));
        this.#active.set(session.id, session);
        return session;
      } catch {
        /* not in this event folder */
      }
    }
    return null;
  }

  async list({ eventSlug, limit = 24 }) {
    let dir;
    try {
      dir = this.eventDir(eventSlug);
    } catch {
      return [];
    }
    let names;
    try {
      names = (await fs.readdir(dir)).filter((n) => SESSION_ID.test(n)).sort().reverse().slice(0, limit);
    } catch {
      return [];
    }
    const sessions = [];
    for (const name of names) {
      const known = this.#active.get(name);
      if (known) {
        sessions.push(known);
        continue;
      }
      try {
        sessions.push(JSON.parse(await fs.readFile(path.join(dir, name, 'session.json'), 'utf8')));
      } catch {
        /* a half-written session folder is skipped */
      }
    }
    return sessions;
  }
}
