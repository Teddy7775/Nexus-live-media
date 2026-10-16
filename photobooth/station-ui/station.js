// Attendant station. All dynamic text goes through textContent / text nodes: event names, reasons and error messages are
// free-form, so nothing from the server is ever inserted as HTML.

import { isValidEmail, normalizeEmail, suggestEmail } from './email-utils.js';

const $ = (selector) => document.querySelector(selector);
const SOUND_KEY = 'booth-station-sound';

const st = {
  sessions: new Map(), // id -> summary
  approvals: new Map(), // id -> pending approval
  approval: { required: false, timeoutSeconds: 120, onTimeout: 'cancel', maxCopies: 4 },
  email: { enabled: false, marketingOptIn: { enabled: false } },
  printEnabled: true,
  payments: { enabled: false, needs: new Map(), totals: null, lastError: null, notes: [] },
  skew: 0, // server clock minus this device's clock, so the "waiting" timers are right even if the clocks differ
  source: null,
  copies: new Map(), // approval id -> chosen copies
  fresh: new Set(),
  sound: false,
  wall: { open: false, index: 0, timer: null, shown: new Set() },
  share: { session: null, confirmedTypo: false },
  timers: [],
};
try {
  st.sound = localStorage.getItem(SOUND_KEY) === '1';
} catch {
  /* storage can be blocked: sound simply starts off */
}

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value);
  }
  el.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

function say(el, text, kind) {
  el.hidden = !text;
  el.textContent = text ?? '';
  el.className = `msg${kind ? ` ${kind}` : ''}`;
}

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error('Cannot reach the booth'), { code: 'offline' });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.error === 'login_required') showLogin();
  if (!res.ok) throw Object.assign(new Error(data.message || 'Request failed'), { status: res.status, code: data.error });
  return data;
}

// ------------------------------------------------------------------ sign in / out

function showLogin(message) {
  st.source?.close();
  st.source = null;
  for (const t of st.timers.splice(0)) clearInterval(t);
  closeWall();
  $('#app').hidden = true;
  $('#login').hidden = false;
  say($('#loginError'), message ?? '', 'bad');
  $('#pin').value = '';
  $('#pin').focus();
}

function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  say($('#loginError'), '');
  try {
    await api('POST', '/station/api/login', { pin: $('#pin').value });
    start();
  } catch (err) {
    say($('#loginError'), err.message, 'bad');
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('POST', '/station/api/logout').catch(() => {});
  showLogin();
});

// ------------------------------------------------------------------ live feed

function setConn(on) {
  const el = $('#conn');
  el.textContent = on ? 'Live' : 'Reconnecting…';
  el.className = `pill ${on ? 'ok' : 'bad'}`;
}

function start() {
  showApp();
  const source = new EventSource('/station/api/events');
  st.source = source;
  source.addEventListener('snapshot', (e) => {
    setConn(true);
    applySnapshot(JSON.parse(e.data));
  });
  source.addEventListener('session', (e) => upsertSession(JSON.parse(e.data)));
  source.addEventListener('approval', (e) => onApproval(JSON.parse(e.data)));
  source.addEventListener('payment', () => refreshPayments());
  source.onerror = async () => {
    setConn(false);
    try {
      await api('GET', '/station/api/me'); // a 401 here sends us back to the sign-in page
    } catch {
      /* still offline: EventSource keeps retrying by itself */
    }
  };
  st.timers.push(setInterval(() => api('POST', '/station/api/ping').catch(() => {}), 8000));
  st.timers.push(setInterval(refreshHealth, 15000));
  st.timers.push(setInterval(tickWaits, 1000));
  api('POST', '/station/api/ping').catch(() => {});
  refreshHealth();
  renderSound();
}

function applySnapshot(data) {
  st.skew = Date.parse(data.serverTime) - Date.now();
  st.approval = data.approval;
  st.email = data.email;
  st.printEnabled = data.printEnabled;
  applyPayments(data.payments);
  $('#eventName').textContent = data.event.name;
  st.sessions = new Map(data.sessions.map((s) => [s.id, s]));
  st.approvals = new Map(data.approvals.map((a) => [a.id, a]));
  for (const a of data.approvals) st.wall.shown.add(a.id);
  render();
}

function upsertSession(summary) {
  if (!st.sessions.has(summary.id)) st.fresh.add(summary.id);
  st.sessions.set(summary.id, summary);
  render();
  if (st.wall.open && summary.finalUrl && !st.wall.shown.has(summary.finalUrl)) {
    st.wall.shown.add(summary.finalUrl);
    st.wall.index = 0; // a brand-new picture jumps the queue
    showWallPicture();
  }
}

function onApproval(item) {
  if (item.status === 'pending') {
    const isNew = !st.approvals.has(item.id);
    st.approvals.set(item.id, item);
    if (isNew) beep();
  } else {
    st.approvals.delete(item.id);
  }
  render();
}

function render() {
  renderApprovals();
  renderPayments();
  renderSessions();
  const waiting = st.approvals.size;
  document.title = waiting ? `(${waiting}) Booth station` : 'Booth station';
  const info = $('#approvalInfo');
  info.hidden = false;
  if (st.approval.required) {
    info.textContent = `Prints wait for your approval. A guest waits up to ${st.approval.timeoutSeconds} s; with no answer it is ${st.approval.onTimeout === 'print' ? 'printed anyway' : 'not printed (their photos are still saved and shared)'}.`;
  } else {
    info.textContent = 'Print approval is off: guests print straight away. (Switch it on in the operator panel.)';
  }
  info.className = st.approval.required ? 'notice' : 'muted small';
  $('#empty').hidden = st.sessions.size > 0;
}

// ------------------------------------------------------------------ approvals

const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const serverNow = () => Date.now() + st.skew;

function tickWaits() {
  for (const el of document.querySelectorAll('[data-expires]')) {
    const now = serverNow();
    const left = Date.parse(el.dataset.expires) - now;
    const waited = now - Date.parse(el.dataset.created);
    el.textContent = left > 0 ? `Guest waiting ${clock(Math.max(0, waited))} · answer within ${clock(left)}` : 'Time is up – the booth is settling this one';
    el.classList.toggle('late', left < 20000);
  }
}

function approvalCard(a) {
  const session = st.sessions.get(a.sessionId);
  const copies = st.copies.get(a.id) ?? a.copies;
  const picture = session?.finalUrl ? h('img', { src: session.finalUrl, alt: 'The guest\'s finished photos' }) : h('div', { class: 'noimg' }, 'Preparing the picture…');
  const output = h('output', {}, `${copies}×`);
  const change = (delta) => {
    const next = Math.min(st.approval.maxCopies, Math.max(1, (st.copies.get(a.id) ?? a.copies) + delta));
    st.copies.set(a.id, next);
    output.textContent = `${next}×`;
  };
  return h(
    'article',
    { class: 'approval', 'data-id': a.id },
    picture,
    h(
      'div',
      { class: 'info' },
      h('strong', {}, session ? `Session ${new Date(session.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'A guest'),
      h('span', { class: 'wait', 'data-expires': a.expiresAt, 'data-created': a.createdAt }),
      h('div', { class: 'stepper' }, h('span', { class: 'muted' }, 'Copies'), h('button', { class: 'btn', type: 'button', 'aria-label': 'Fewer copies', onclick: () => change(-1) }, '−'), output, h('button', { class: 'btn', type: 'button', 'aria-label': 'More copies', onclick: () => change(1) }, '+')),
      h(
        'div',
        { class: 'decide' },
        h('button', { class: 'btn ok', type: 'button', onclick: (e) => decide(a.id, 'approve', e.currentTarget) }, 'Approve and print'),
        h('button', { class: 'btn bad', type: 'button', onclick: (e) => decide(a.id, 'reject', e.currentTarget) }, 'Don\'t print'),
      ),
    ),
  );
}

function renderApprovals() {
  const list = [...st.approvals.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  $('#approvalsBox').hidden = list.length === 0;
  $('#approveAll').hidden = list.length < 2;
  $('#approveAll').textContent = `Approve all (${list.length})`;
  $('#approvals').replaceChildren(...list.map(approvalCard));
  tickWaits();
}

async function decide(id, action, button) {
  button.disabled = true;
  try {
    if (action === 'approve') await api('POST', `/station/api/approvals/${id}/approve`, { copies: st.copies.get(id) });
    else await api('POST', `/station/api/approvals/${id}/reject`, {});
    say($('#approvalMsg'), '');
  } catch (err) {
    // "already answered" (another station, a timeout or the guest leaving) just means the card should go away.
    say($('#approvalMsg'), err.message, 'bad');
    if (err.code === 'not_pending') st.approvals.delete(id);
  } finally {
    render();
  }
}

$('#approveAll').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  try {
    const { approved } = await api('POST', '/station/api/approvals/approve-all');
    say($('#approvalMsg'), `Approved ${approved} print${approved === 1 ? '' : 's'}.`, 'ok');
  } catch (err) {
    say($('#approvalMsg'), err.message, 'bad');
  } finally {
    e.currentTarget.disabled = false;
  }
});

// ------------------------------------------------------------------ payments

const usd = (cents) => `$${(cents / 100).toFixed(2)}`;
const REFUND_REASON = {
  print_rejected: 'Paid, but you did not approve the print.',
  print_expired: 'Paid, but nobody approved the print in time.',
  print_cancelled: 'Paid, but the guest left before the print was approved.',
  print_error: 'Paid, but the print could not be started.',
  print_failed: 'Paid, but the print failed at the printer.',
  paid_after_timeout: 'Paid on their phone AFTER the payment screen had timed out: they did not get what they paid for.',
  session_not_started: 'Paid, but their session could not start.',
};
const NOTE_LABEL = { cash: 'Cash', zelle: 'Zelle', venmo: 'Venmo', cashapp: 'Cash App', 'card-reader': 'Card reader', other: 'Other' };

function applyPayments(p) {
  st.payments = { enabled: Boolean(p?.enabled), needs: new Map((p?.needs ?? []).map((x) => [x.id, x])), totals: p?.totals ?? null, lastError: p?.lastError ?? null, notes: p?.notes ?? [], mode: p?.mode ?? 'off', provider: p?.provider ?? null };
}

async function refreshPayments() {
  try {
    applyPayments(await api('GET', '/station/api/payments'));
    renderPayments();
    renderSessions();
  } catch {
    /* the next event or reconnect fixes it */
  }
}

function payCard(p) {
  const what = p.kind === 'session' ? 'Photo session' : `Print x${p.copies}`;
  const buttons = [];
  let why = null;
  let select = null;
  if (p.status === 'pending') {
    why = p.reason === 'offline' ? 'Card payments are not available right now: this guest was asked to pay you.' : 'This guest was asked to pay you.';
    select = h('select', { 'aria-label': 'How they paid' }, ...(st.payments.notes.length ? st.payments.notes : Object.keys(NOTE_LABEL)).map((n) => h('option', { value: n }, NOTE_LABEL[n] ?? n)));
    buttons.push(h('button', { class: 'btn ok', type: 'button', onclick: (e) => payAction(p.id, 'paid', e.currentTarget, { note: select.value }) }, 'Mark paid'));
    buttons.push(h('button', { class: 'btn', type: 'button', onclick: (e) => payAction(p.id, 'waive', e.currentTarget) }, 'Waive'));
  } else {
    why = REFUND_REASON[p.refundDue] ?? 'Paid, but not used yet.';
    if (p.refundDue && p.kind === 'print' && p.sessionId) buttons.push(h('button', { class: 'btn ok', type: 'button', onclick: (e) => payAction(p.id, 'honour', e.currentTarget) }, 'Print it anyway'));
    buttons.push(h('button', { class: 'btn bad', type: 'button', onclick: (e) => payAction(p.id, 'refund', e.currentTarget) }, p.method === 'card' ? `Refund ${usd(p.amountCents)} to their card` : 'Mark refunded (money given back)'));
    if (p.refundDue) buttons.push(h('button', { class: 'btn', type: 'button', onclick: (e) => payAction(p.id, 'clear-flag', e.currentTarget) }, 'Dismiss'));
  }
  return h('article', { class: 'paycard', 'data-id': p.id }, h('div', { class: 'amount' }, usd(p.amountCents)), h('div', {}, `${what}${p.method ? ` · paid by ${p.method === 'card' ? 'card' : p.note ? NOTE_LABEL[p.note] ?? p.note : p.method}` : ''}`), h('div', { class: 'why' }, why), h('div', { class: 'row' }, select, ...buttons));
}

function renderPayments() {
  const list = [...st.payments.needs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  $('#payBox').hidden = list.length === 0;
  $('#payCards').replaceChildren(...list.map(payCard));
  const t = st.payments.totals;
  const line = $('#takings');
  line.hidden = !st.payments.enabled;
  if (st.payments.enabled && t) {
    const methods = Object.entries(t.byMethod).map(([m, c]) => `${m === 'card' ? 'card' : 'cash/Zelle'} ${usd(c)}`);
    line.textContent = `Takings this event: ${usd(t.net)}${methods.length ? ` (${methods.join(' · ')})` : ''}${t.refunded ? ` · refunded ${usd(t.refunded)}` : ''}${t.waived ? ` · ${t.waived} waived` : ''}${st.payments.lastError ? ' · card payments are currently unreachable' : ''}`;
  }
}

async function payAction(id, action, button, body = {}) {
  button.disabled = true;
  try {
    await api('POST', `/station/api/payments/${id}/${action}`, body);
    say($('#payMsg'), action === 'refund' ? 'Refunded.' : action === 'honour' ? 'Printing it now.' : '', 'ok');
  } catch (err) {
    say($('#payMsg'), err.message, 'bad');
  } finally {
    await refreshPayments();
  }
}

// ------------------------------------------------------------------ sessions

const PRINT_LABEL = {
  awaiting: ['Waiting for your approval', 'warn'],
  queued: ['Print queued', 'warn'],
  printing: ['Printing…', 'warn'],
  done: ['Sent to the printer', 'ok'],
  error: ['Print failed', 'bad'],
  rejected: ['Not printed', 'bad'],
  expired: ['Not printed – no answer', 'bad'],
  cancelled: ['Guest left', 'off'],
};
const IDLE_MS = 10 * 60 * 1000;

function sessionStatus(s) {
  if (s.shotsTaken >= s.shotsNeeded) return ['Photos done', 'ok'];
  const idle = serverNow() - Date.parse(s.createdAt) > IDLE_MS;
  return idle ? [`Left early (${s.shotsTaken}/${s.shotsNeeded})`, 'off'] : [`Taking photos ${s.shotsTaken}/${s.shotsNeeded}`, 'warn'];
}

function sessionCard(s) {
  const [statusText, statusKind] = sessionStatus(s);
  const printLabel = PRINT_LABEL[s.print.state];
  const pic = s.finalUrl ? h('div', { class: 'pic' }, h('img', { src: s.finalUrl, alt: 'Finished photos', loading: 'lazy' })) : s.shots.length ? h('div', { class: 'pic shots' }, h('img', { src: s.shots.at(-1), alt: 'Latest photo', loading: 'lazy' })) : h('div', { class: 'pic' }, 'Starting…');
  const done = s.shotsTaken >= s.shotsNeeded;
  const card = h(
    'article',
    { class: `session${st.fresh.has(s.id) ? ' fresh' : ''}`, 'data-id': s.id },
    pic,
    h(
      'div',
      { class: 'meta' },
      h('div', { class: 'when' }, `${new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${s.background ? ` · ${s.background}` : ''}${s.gifUrl ? ' · GIF' : ''}`),
      h(
        'div',
        { class: 'badges' },
        h('span', { class: `pill ${statusKind}` }, statusText),
        printLabel ? h('span', { class: `pill ${printLabel[1]}`, title: s.print.reason ?? s.print.error ?? '' }, printLabel[0]) : null,
        s.payment ? h('span', { class: `pill ${s.payment.refundDue ? 'bad' : s.payment.status === 'refunded' ? 'off' : s.payment.status === 'paid' ? (s.payment.method === 'waived' ? 'off' : 'ok') : 'warn'}` }, s.payment.refundDue ? 'Refund due' : s.payment.status === 'refunded' ? 'Refunded' : s.payment.status === 'paid' ? (s.payment.method === 'waived' ? 'Waived' : `Paid ${usd(s.payment.amountCents)}`) : 'Awaiting payment') : null,
        s.share ? h('span', { class: `pill ${s.share.ready ? 'ok' : s.share.state === 'failed' ? 'bad' : 'warn'}` }, s.share.ready ? 'Link ready' : s.share.state === 'failed' ? 'Link failed' : 'Link preparing') : null,
      ),
      done
        ? h(
            'div',
            { class: 'actions' },
            s.share || st.email.enabled ? h('button', { class: 'btn', type: 'button', onclick: () => openShare(s) }, 'Share…') : null,
            st.printEnabled ? h('button', { class: 'btn', type: 'button', onclick: (e) => reprint(s, e.currentTarget) }, 'Print again') : null,
          )
        : null,
    ),
  );
  return card;
}

function renderSessions() {
  const list = [...st.sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $('#sessions').replaceChildren(...list.map(sessionCard));
  st.fresh.clear();
}

async function reprint(session, button) {
  button.disabled = true;
  try {
    await api('POST', `/station/api/sessions/${session.id}/reprint`, { copies: 1 });
    button.textContent = 'Queued';
  } catch (err) {
    button.textContent = 'Failed';
    button.title = err.message;
  }
  setTimeout(() => {
    button.disabled = false;
    button.textContent = 'Print again';
  }, 2500);
}

// ------------------------------------------------------------------ booth health

async function refreshHealth() {
  const pills = [];
  try {
    const s = await api('GET', '/station/api/status');
    pills.push(h('span', { class: `pill ${s.camera.connected ? 'ok' : 'bad'}`, title: s.camera.detail ?? '' }, s.camera.connected ? 'Camera ready' : 'Camera problem'));
    pills.push(h('span', { class: `pill ${s.printer.mode === 'dryrun' ? 'warn' : s.printer.ok ? 'ok' : 'bad'}`, title: s.printer.detail ?? '' }, s.printer.mode === 'dryrun' ? 'Printer: test mode' : s.printer.ok ? 'Printer ready' : 'Printer problem'));
    if (s.prints.waiting) pills.push(h('span', { class: 'pill warn' }, `${s.prints.waiting} printing`));
    if (s.prints.failed) pills.push(h('span', { class: 'pill bad', title: s.prints.lastError ?? '' }, `${s.prints.failed} print(s) failed`));
    if (s.email.failed) pills.push(h('span', { class: 'pill bad' }, `${s.email.failed} email(s) failed`));
    if (s.uploads.failed) pills.push(h('span', { class: 'pill bad' }, `${s.uploads.failed} upload(s) failed`));
  } catch {
    pills.push(h('span', { class: 'pill off' }, 'Status unavailable'));
  }
  $('#health').replaceChildren(...pills);
}

// ------------------------------------------------------------------ share

function openShare(session) {
  st.share = { session, confirmedTypo: false };
  $('#shareOverlay').hidden = false;
  $('#shareQr').hidden = true;
  $('#shareUrl').textContent = '';
  say($('#shareStatus'), session.share ? 'Preparing the link…' : 'Sharing by link is turned off.');
  say($('#emailMsg'), '');
  say($('#emailSuggest'), '');
  $('#emailTo').value = '';
  $('#emailForm').hidden = !st.email.enabled;
  const opt = st.email.marketingOptIn;
  $('#optInRow').hidden = !opt?.enabled;
  $('#optIn').checked = false;
  $('#optInLabel').textContent = opt?.label ?? '';
  $('#emailTo').focus();
  if (!session.share) return;
  api('POST', `/station/api/sessions/${session.id}/share`)
    .then((state) => {
      if (st.share.session?.id !== session.id) return;
      $('#shareQr').src = `data:image/svg+xml;utf8,${encodeURIComponent(state.qrSvg)}`;
      $('#shareQr').hidden = false;
      $('#shareUrl').textContent = state.url;
      say($('#shareStatus'), state.ready ? 'Ready – the guest can scan this with their phone.' : 'The link is being prepared; it works in a moment.', state.ready ? 'ok' : '');
    })
    .catch((err) => say($('#shareStatus'), err.message, 'bad'));
}

function closeShare() {
  $('#shareOverlay').hidden = true;
  $('#shareQr').removeAttribute('src');
  st.share.session = null;
}

$('#shareClose').addEventListener('click', closeShare);
$('#emailTo').addEventListener('input', () => {
  st.share.confirmedTypo = false;
  say($('#emailSuggest'), '');
});

$('#emailForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const session = st.share.session;
  const value = normalizeEmail($('#emailTo').value);
  if (!session) return;
  if (!isValidEmail(value)) return say($('#emailMsg'), 'That does not look like an email address.', 'bad');
  const suggestion = suggestEmail(value);
  if (suggestion && !st.share.confirmedTypo) {
    st.share.confirmedTypo = true;
    return say($('#emailSuggest'), `Did you mean ${suggestion}? Press Send again if ${value} is right.`, 'bad');
  }
  $('#emailSend').disabled = true;
  say($('#emailMsg'), 'Sending…');
  try {
    const result = await api('POST', `/station/api/sessions/${session.id}/email`, { email: value, optIn: $('#optIn').checked });
    say($('#emailMsg'), `Queued for ${result.masked}. It can take a minute to arrive.`, 'ok');
    $('#emailTo').value = '';
  } catch (err) {
    say($('#emailMsg'), err.message, 'bad');
  } finally {
    $('#emailSend').disabled = false;
  }
  return undefined;
});

// ------------------------------------------------------------------ live wall

function wallPictures() {
  return [...st.sessions.values()].filter((s) => s.finalUrl).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function showWallPicture() {
  const list = wallPictures();
  $('#wallEmpty').hidden = list.length > 0;
  if (!list.length) {
    $('#wallImg').hidden = true;
    $('#wallCaption').textContent = '';
    return;
  }
  const s = list[st.wall.index % list.length];
  const img = $('#wallImg');
  img.hidden = false;
  img.src = s.finalUrl;
  $('#wallCaption').textContent = s.eventName;
  for (const item of list) st.wall.shown.add(item.finalUrl);
}

function openWall() {
  st.wall.open = true;
  st.wall.index = 0;
  $('#wall').hidden = false;
  document.documentElement.requestFullscreen?.().catch(() => {});
  showWallPicture();
  st.wall.timer = setInterval(() => {
    st.wall.index += 1;
    showWallPicture();
  }, 6000);
}

function closeWall() {
  if (!st.wall.open) return;
  st.wall.open = false;
  clearInterval(st.wall.timer);
  $('#wall').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

$('#wallBtn').addEventListener('click', openWall);
$('#wallClose').addEventListener('click', closeWall);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (st.wall.open) closeWall();
  else if (!$('#shareOverlay').hidden) closeShare();
});

// ------------------------------------------------------------------ sound

let audio = null;
function beep() {
  if (!st.sound) return;
  try {
    audio ??= new AudioContext();
    for (const [i, freq] of [880, 1175].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.18, audio.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + i * 0.18 + 0.15);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + i * 0.18);
      osc.stop(audio.currentTime + i * 0.18 + 0.16);
    }
  } catch {
    /* no audio available: the card itself is still shown */
  }
}

function renderSound() {
  $('#soundBtn').textContent = st.sound ? 'Sound on' : 'Sound off';
  $('#soundBtn').setAttribute('aria-pressed', String(st.sound));
}

$('#soundBtn').addEventListener('click', () => {
  st.sound = !st.sound;
  try {
    localStorage.setItem(SOUND_KEY, st.sound ? '1' : '0');
  } catch {
    /* fine */
  }
  renderSound();
  beep(); // a click is the user gesture browsers require before they allow sound
});

// ------------------------------------------------------------------ go

try {
  await api('GET', '/station/api/me');
  start();
} catch (err) {
  if (err.code === 'offline') showLogin('Cannot reach the booth. Check the address and that the booth is running.');
  else showLogin();
}
