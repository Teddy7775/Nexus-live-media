import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalQueue } from '../server/approval.js';

/** A queue with a clock and timers the test controls. */
function make(overrides = {}) {
  const clock = { t: 1_700_000_000_000 };
  const timers = new Map();
  let nextTimer = 1;
  const changes = [];
  const printed = [];
  const queue = new ApprovalQueue({
    timeoutMs: 60_000,
    onTimeout: 'cancel',
    maxCopies: 4,
    now: () => clock.t,
    setTimer: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    onApprove: async (item) => {
      printed.push({ sessionId: item.sessionId, copies: item.copies });
      return { job: { id: `job-${printed.length}` }, queueAhead: 0, estimatedSeconds: 15 };
    },
    onChange: (item) => changes.push(`${item.status}:${item.sessionId}`),
    ...overrides,
  });
  const fire = async () => {
    const [id, timer] = [...timers].at(-1) ?? [];
    timers.delete(id);
    await timer?.fn();
  };
  return { queue, timers, changes, printed, clock, fire };
}

test('a request waits, and approving it starts the print with the chosen copies', async () => {
  const { queue, printed, changes } = make();
  const item = await queue.request({ sessionId: 's1', copies: 2 });
  assert.equal(item.status, 'pending');
  assert.equal(item.copies, 2);
  assert.equal(new Date(item.expiresAt) - new Date(item.createdAt), 60_000);
  assert.deepEqual(queue.pending().map((i) => i.id), [item.id]);
  assert.deepEqual(printed, [], 'nothing printed yet');

  const approved = await queue.approve(item.id, { copies: 3 });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.decidedBy, 'station');
  assert.deepEqual(printed, [{ sessionId: 's1', copies: 3 }], 'printed once, with the attendant\'s copies');
  assert.equal(approved.job.id, 'job-1');
  assert.equal(queue.pending().length, 0);
  assert.deepEqual(changes, ['pending:s1', 'approved:s1']);
});

test('copies are kept within 1..maxCopies, and nonsense becomes 1', async () => {
  const { queue, printed } = make();
  const a = await queue.request({ sessionId: 'a', copies: 99 });
  assert.equal(a.copies, 4);
  const b = await queue.request({ sessionId: 'b', copies: 0 });
  assert.equal(b.copies, 1);
  const c = await queue.request({ sessionId: 'c', copies: 'lots' });
  assert.equal(c.copies, 1);
  await queue.approve(c.id, { copies: -5 });
  await queue.approve(b.id, { copies: 1000 });
  assert.deepEqual(printed.map((p) => p.copies), [1, 4]);
});

test('only one decision ever counts: a second station, a timeout or a late guest cannot undo or repeat it', async () => {
  const { queue, printed, fire } = make();
  const item = await queue.request({ sessionId: 's1' });
  const [first, second] = await Promise.all([queue.approve(item.id), queue.approve(item.id)]);
  assert.ok([first, second].filter(Boolean).length === 1, 'exactly one of two simultaneous approvals wins');
  assert.equal(printed.length, 1, 'and the photos are printed exactly once');
  assert.equal(queue.reject(item.id), null);
  assert.equal(queue.cancel(item.id), null);
  assert.equal(await queue.approve(item.id), null);
  await fire(); // the timer was cleared when it was decided
  assert.equal(queue.get(item.id).status, 'approved');
  assert.equal(await queue.approve('nope'), null);
});

test('rejecting records a short reason and prints nothing', async () => {
  const { queue, printed } = make();
  const item = await queue.request({ sessionId: 's1' });
  const rejected = queue.reject(item.id, `  ${'x'.repeat(500)}  `);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.reason.length, 120, 'the reason is kept short');
  assert.deepEqual(printed, []);
  const other = await queue.request({ sessionId: 's2' });
  assert.equal(queue.reject(other.id, '   ').reason, null, 'a blank reason is no reason');
});

test('a guest who walks away cancels the request', async () => {
  const { queue, printed } = make();
  const item = await queue.request({ sessionId: 's1' });
  assert.equal(queue.cancel(item.id).status, 'cancelled');
  assert.equal(queue.cancel(item.id), null);
  assert.deepEqual(printed, []);
  assert.equal(queue.pending().length, 0);
});

test('a request nobody answers expires without printing (onTimeout: cancel)', async () => {
  const { queue, printed, fire, timers } = make();
  const item = await queue.request({ sessionId: 's1' });
  assert.equal([...timers.values()][0].ms, 60_000, 'a timer of exactly the configured length');
  await fire();
  const settled = queue.get(item.id);
  assert.equal(settled.status, 'expired');
  assert.equal(settled.reason, 'timeout');
  assert.equal(settled.decidedBy, 'timeout');
  assert.deepEqual(printed, []);
});

test('with onTimeout: print, an unanswered request is printed after all', async () => {
  const { queue, printed, fire } = make({ onTimeout: 'print' });
  const item = await queue.request({ sessionId: 's1', copies: 2 });
  await fire();
  assert.equal(queue.get(item.id).status, 'approved');
  assert.equal(queue.get(item.id).decidedBy, 'timeout');
  assert.deepEqual(printed, [{ sessionId: 's1', copies: 2 }]);
});

test('with no station connected nobody is asked: it is settled at once, the way a timeout would be', async () => {
  const cancel = make();
  const a = await cancel.queue.request({ sessionId: 's1', stationOnline: false });
  assert.equal(a.status, 'expired');
  assert.equal(a.reason, 'no_station');
  assert.equal(cancel.timers.size, 0, 'no timer is left running');
  assert.deepEqual(cancel.printed, []);

  const print = make({ onTimeout: 'print' });
  const b = await print.queue.request({ sessionId: 's2', copies: 2, stationOnline: false });
  assert.equal(b.status, 'approved');
  assert.equal(b.decidedBy, 'no_station');
  assert.deepEqual(print.printed, [{ sessionId: 's2', copies: 2 }]);
});

test('asking twice for the same session (a double tap) gives the same pending request', async () => {
  const { queue } = make();
  const a = await queue.request({ sessionId: 's1' });
  const b = await queue.request({ sessionId: 's1' });
  assert.equal(a.id, b.id);
  assert.equal(queue.pending().length, 1);
  queue.reject(a.id);
  const c = await queue.request({ sessionId: 's1' });
  assert.notEqual(c.id, a.id, 'after it was answered, a new request is a new request');
});

test('if starting the print fails, the guest is told and the failure is not lost', async () => {
  const { queue } = make({
    onApprove: async () => {
      throw new Error('the print file could not be made');
    },
    logger: { error: () => {} },
  });
  const item = await queue.request({ sessionId: 's1' });
  const result = await queue.approve(item.id);
  assert.equal(result.status, 'error');
  assert.equal(result.error, 'the print file could not be made');
  assert.equal(result.job, null);
});

test('approve-all prints every waiting request, oldest first, and reports how many', async () => {
  const { queue, printed, clock } = make();
  await queue.request({ sessionId: 'first' });
  clock.t += 1000;
  await queue.request({ sessionId: 'second' });
  clock.t += 1000;
  await queue.request({ sessionId: 'third' });
  const rejected = await queue.request({ sessionId: 'fourth' });
  queue.reject(rejected.id);
  assert.equal(await queue.approveAll(), 3);
  assert.deepEqual(printed.map((p) => p.sessionId), ['first', 'second', 'third']);
  assert.equal(await queue.approveAll(), 0);
});

test('forSession returns the latest request for that session; old decided ones are trimmed, pending never', async () => {
  const { queue } = make({ keep: 3 });
  const first = await queue.request({ sessionId: 'a' });
  queue.reject(first.id);
  const second = await queue.request({ sessionId: 'a' });
  assert.equal(queue.forSession('a').id, second.id);
  assert.equal(queue.forSession('zzz'), null);
  const waiting = await queue.request({ sessionId: 'keeps-waiting' });
  for (let i = 0; i < 6; i++) {
    const item = await queue.request({ sessionId: `filler-${i}` });
    queue.reject(item.id);
  }
  assert.equal(queue.get(waiting.id).status, 'pending', 'a request still waiting is never trimmed away');
  assert.equal(queue.get(first.id), null, 'the oldest decided one was trimmed');
});

test('stop() clears every timer, so nothing fires after shutdown', async () => {
  const { queue, timers } = make();
  await queue.request({ sessionId: 'a' });
  await queue.request({ sessionId: 'b' });
  assert.equal(timers.size, 2);
  queue.stop();
  assert.equal(timers.size, 0);
});

test('a broken change listener never breaks a decision', async () => {
  const { queue } = make({
    onChange: () => {
      throw new Error('listener bug');
    },
    logger: { error: () => {} },
  });
  const item = await queue.request({ sessionId: 's1' });
  assert.equal((await queue.approve(item.id)).status, 'approved');
});
