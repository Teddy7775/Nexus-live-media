import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '../server/store.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-'));

test('many saves of one session at once all succeed and the file ends up with the LAST state', async () => {
  const root = tmp();
  try {
    const saved = [];
    const store = new SessionStore({ rootDir: root, onSave: (s) => saved.push(s.id) });
    const session = await store.create({ eventSlug: 'e', eventName: 'E', templateId: 't', shotsNeeded: 3 });
    saved.length = 0;
    const saves = [];
    for (let i = 1; i <= 30; i++) {
      session.counter = i;
      saves.push(store.save(session));
    }
    await Promise.all(saves); // none of them throws
    const onDisk = JSON.parse(fs.readFileSync(path.join(store.sessionDir(session), 'session.json'), 'utf8'));
    assert.equal(onDisk.counter, 30, 'an older save never lands after a newer one');
    assert.equal(saved.length, 30, 'the listener hears about every save');
    assert.deepEqual(fs.readdirSync(store.sessionDir(session)).filter((n) => n.endsWith('.tmp')), [], 'no temporary files are left behind');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('saves of different sessions do not wait for each other, and one failing save does not block the next', async () => {
  const root = tmp();
  try {
    const store = new SessionStore({ rootDir: root });
    const a = await store.create({ eventSlug: 'e', eventName: 'E', templateId: 't', shotsNeeded: 1 });
    const b = await store.create({ eventSlug: 'e', eventName: 'E', templateId: 't', shotsNeeded: 1 });
    await Promise.all([store.save(a), store.save(b)]);

    const broken = { ...a, eventSlug: 'bad slug!' };
    await assert.rejects(() => store.save(broken), /Invalid event folder name/);
    a.note = 'still works';
    await store.save(a);
    assert.equal(JSON.parse(fs.readFileSync(path.join(store.sessionDir(a), 'session.json'), 'utf8')).note, 'still works');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a listener that throws never breaks saving', async () => {
  const root = tmp();
  try {
    const store = new SessionStore({ rootDir: root, onSave: () => { throw new Error('listener bug'); } });
    const session = await store.create({ eventSlug: 'e', eventName: 'E', templateId: 't', shotsNeeded: 1 });
    session.x = 1;
    await store.save(session);
    assert.equal(JSON.parse(fs.readFileSync(path.join(store.sessionDir(session), 'session.json'), 'utf8')).x, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
