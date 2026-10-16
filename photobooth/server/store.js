import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

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

  constructor({ rootDir }) {
    this.rootDir = rootDir;
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

  async create({ eventSlug, eventName, templateId, shotsNeeded, now = new Date() }) {
    const session = {
      id: newSessionId(now),
      eventSlug,
      eventName,
      templateId,
      shotsNeeded,
      createdAt: now.toISOString(),
      status: 'shooting', // shooting -> composed
      shots: [], // [{ index, attempt, file, preview }]
      final: null, // { file, preview }
      pdf: null,
      prints: [], // [{ jobId, copies, at }]
    };
    await fs.mkdir(path.join(this.sessionDir(session), 'originals'), { recursive: true });
    await fs.mkdir(path.join(this.sessionDir(session), 'previews'), { recursive: true });
    this.#active.set(session.id, session);
    await this.save(session);
    return session;
  }

  async save(session) {
    const file = path.join(this.sessionDir(session), 'session.json');
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(session, null, 2));
    await fs.rename(tmp, file);
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
