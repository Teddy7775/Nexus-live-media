// Guest-facing photo booth. One guest at a time moves through: attract -> countdown/photo (x N) -> review -> print -> done.
// Everything the guest waits on is cancellable, so "Start over" or an error timeout can never leave a stray timer running.

import { createKeyboard } from './keyboard.js';
import { isValidEmail, maskEmail, normalizeEmail, suggestEmail } from './email-utils.js';

const $ = (selector) => document.querySelector(selector);
const screens = [...document.querySelectorAll('.screen')];

const app = { state: null, flow: null, session: null };
const email = { open: false, value: '', sent: [], waiters: [], confirmedTypo: false, stopKeyboard: null, sending: false };

class FlowCancelled extends Error {}

// ------------------------------------------------------------------ helpers

function show(name) {
  for (const screen of screens) screen.classList.toggle('active', screen.dataset.screen === name);
  document.body.dataset.screen = name;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new FlowCancelled());
    const onAbort = () => {
      clearTimeout(timer);
      reject(new FlowCancelled());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Like pick(), but while the email screen is open the timeout never fires (the guest is typing), then it starts afresh. */
async function pickHeld(signal, pairs, timeoutMs) {
  for (;;) {
    const choice = await pick(signal, pairs, timeoutMs);
    if (choice !== 'timeout' || !email.open) return choice;
    await emailClosed(signal);
  }
}

/** Resolves when the email screen is closed (immediately if it is not open). */
function emailClosed(signal) {
  if (!email.open) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new FlowCancelled());
    email.waiters.push(resolve);
    signal?.addEventListener('abort', () => reject(new FlowCancelled()), { once: true });
    return undefined;
  });
}

/** Resolves with the value of whichever [element, value] pair is clicked first, or 'timeout'. */
function pick(signal, pairs, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cleanups = [];
    const finish = (fn, value) => {
      cleanups.forEach((cleanup) => cleanup());
      fn(value);
    };
    if (signal.aborted) return reject(new FlowCancelled());
    for (const [element, value] of pairs) {
      const onClick = () => finish(resolve, value);
      element.addEventListener('click', onClick);
      cleanups.push(() => element.removeEventListener('click', onClick));
    }
    const onAbort = () => finish(reject, new FlowCancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    cleanups.push(() => signal.removeEventListener('abort', onAbort));
    if (timeoutMs) {
      const timer = setTimeout(() => finish(resolve, 'timeout'), timeoutMs);
      cleanups.push(() => clearTimeout(timer));
    }
  });
}

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error('Cannot reach the booth. Please ask the attendant for help.'), { code: 'offline' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || 'Something went wrong.'), { status: res.status, code: data.error });
  return data;
}

async function preload(url) {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    /* show it anyway */
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// -------------------------------------------------------------- live preview

function startLive() {
  const live = $('#live');
  live.classList.toggle('mirror', app.state.ui.mirrorPreview);
  $('#liveImg').src = `/api/camera/stream?ts=${Date.now()}`;
}

function stopLive() {
  $('#liveImg').removeAttribute('src'); // closes the stream so the camera can leave live view
}

function flash() {
  if (!app.state.ui.flash) return;
  const el = $('#flash');
  el.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on')));
}

function setCount(text, { word = false } = {}) {
  const el = $('#count');
  el.textContent = text;
  el.classList.toggle('word', word);
  el.classList.remove('pop');
  void el.offsetWidth; // restart the animation
  el.classList.add('pop');
}

// ------------------------------------------------------------ share (QR code)

/**
 * Starts sharing for this session: shows the QR code at once (the link is known immediately) and keeps the status line
 * honest while the gallery is prepared or uploaded. Failures here never block printing - they only change the message.
 */
function startShare(session, signal) {
  const { sharing } = app.state;
  if (!sharing?.enabled) return null;
  const status = $('#shareStatus');
  const setStatus = (text, kind = '') => {
    status.textContent = text;
    status.className = `share-status ${kind}`.trim();
  };
  const hint = sharing.mode === 'local' ? (sharing.wifiHint || 'Your phone must be on the venue Wi-Fi.') : '';
  const waiting = `Preparing your link…${hint ? ` ${hint}` : ''}`;

  return (async () => {
    setStatus('Preparing your link…');
    let state;
    try {
      state = await api('POST', `/api/sessions/${session.id}/share`);
    } catch {
      setStatus('Sharing is not available right now. Please ask the attendant.', 'bad');
      return;
    }
    $('#qrImg').src = `data:image/svg+xml;utf8,${encodeURIComponent(state.qrSvg)}`;
    $('#sharePanel').hidden = false;
    updateEmailButton();
    for (;;) {
      if (state.ready) return setStatus(`Ready - scan the code with your phone camera.${hint ? ` ${hint}` : ''}`, 'ok');
      if (state.state === 'failed') return setStatus('Your link could not be created. Please ask the attendant.', 'bad');
      setStatus(waiting);
      try {
        await delay(1500, signal);
        state = { ...state, ...(await api('GET', `/api/sessions/${session.id}/share`)) };
      } catch (error) {
        if (error instanceof FlowCancelled) return;
        // a failed poll just means "try again": the guest is not blocked by it
      }
    }
  })();
}

function placeSharePanel(slotSelector) {
  const panel = $('#sharePanel');
  if (!app.state.sharing?.enabled) return;
  $(slotSelector).append(panel);
}

// ------------------------------------------------------------ email entry

function updateEmailButton() {
  const enabled = app.state.email?.enabled && app.state.sharing?.enabled;
  $('#emailBtn').hidden = !(enabled && email.sent.length < app.state.email.maxPerSession);
  $('#emailSent').hidden = email.sent.length === 0;
  $('#emailSent').textContent = email.sent.length ? `Sent to ${email.sent.join(', ')}. It can take a minute - check your spam folder too.` : '';
}

function renderEmail() {
  const value = email.value;
  $('#emailText').textContent = value;
  $('#emailSend').disabled = email.sending || !isValidEmail(value);
  const suggestion = suggestEmail(value);
  const suggest = $('#emailSuggest');
  suggest.hidden = !suggestion;
  suggest.textContent = suggestion ? `Did you mean ${suggestion}?` : '';
  suggest.dataset.value = suggestion ?? '';
}

function setEmailHint(text) {
  $('#emailHint').textContent = text;
}

function openEmail() {
  if (!app.session || email.open) return;
  const opt = app.state.email.marketingOptIn;
  email.open = true;
  email.value = '';
  email.confirmedTypo = false;
  email.sending = false;
  $('#optIn').checked = false;
  $('#optInRow').hidden = !opt?.enabled;
  $('#optInLabel').textContent = opt?.label ?? '';
  $('#emailPrivacy').textContent = opt?.enabled ? 'We use your email to send these photos. We only keep it if you tick the box above.' : 'We use your email only to send these photos, and we do not keep it.';
  setEmailHint('');
  email.stopKeyboard = createKeyboard({ container: $('#keyboard'), onKey: onEmailKey });
  $('#emailOverlay').hidden = false;
  renderEmail();
}

function closeEmail() {
  if (!email.open) return;
  email.open = false;
  email.stopKeyboard?.();
  email.stopKeyboard = null;
  $('#emailOverlay').hidden = true;
  for (const resolve of email.waiters.splice(0)) resolve();
}

function onEmailKey(key) {
  if (key.type === 'char') email.value = (email.value + key.value).slice(0, 254);
  else if (key.type === 'backspace') email.value = email.value.slice(0, -1);
  else email.value = '';
  email.confirmedTypo = false;
  setEmailHint('');
  renderEmail();
}

async function submitEmail() {
  if (email.sending || !isValidEmail(email.value)) return;
  // A likely typo ("...@gmial.com") is the most common reason a guest never receives their photos: ask once.
  if (suggestEmail(email.value) && !email.confirmedTypo) {
    email.confirmedTypo = true;
    setEmailHint('Please double-check the address. Tap Send again if it is right.');
    return;
  }
  email.sending = true;
  renderEmail();
  setEmailHint('Sending…');
  try {
    const result = await api('POST', `/api/sessions/${app.session.id}/email`, { email: normalizeEmail(email.value), optIn: $('#optIn').checked });
    if (!email.sent.includes(result.masked)) email.sent.push(result.masked);
    closeEmail();
    updateEmailButton();
  } catch (error) {
    email.sending = false;
    setEmailHint(error.message || 'That did not work. Please try again.');
    renderEmail();
  }
}

$('#emailBtn').addEventListener('click', openEmail);
$('#emailCancel').addEventListener('click', closeEmail);
$('#emailSend').addEventListener('click', submitEmail);
$('#emailSuggest').addEventListener('click', () => {
  email.value = $('#emailSuggest').dataset.value;
  email.confirmedTypo = false;
  setEmailHint('');
  renderEmail();
});
// A real keyboard works too (handy for staff and for testing).
document.addEventListener('keydown', (event) => {
  if (!email.open || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Escape') closeEmail();
  else if (event.key === 'Enter') submitEmail();
  else if (event.key === 'Backspace') onEmailKey({ type: 'backspace' });
  else if (/^[a-zA-Z0-9@._+-]$/.test(event.key)) onEmailKey({ type: 'char', value: event.key.toLowerCase() });
  else return;
  event.preventDefault();
});

// ------------------------------------------------------------------ screens

async function loadState() {
  app.state = await api('GET', '/api/state');
}

function renderAttract() {
  const { event, template, printer } = app.state;
  $('#eventName').textContent = event.name;
  const outcome = printer.enabled ? 'printed on the spot' : 'saved for you';
  $('#eventInfo').textContent = `${plural(template.shots, 'photo')}, ${outcome}`;
}

async function goAttract() {
  show('attract');
  stopLive();
  try {
    await loadState();
    renderAttract();
  } catch {
    /* the offline banner tells the attendant; the previous state stays on screen */
  }
}

/** Shows the error screen and resolves with 'retry' or 'home'. */
async function errorScreen(error, signal) {
  stopLive();
  $('#errorMsg').textContent = error.message || 'Something went wrong';
  $('#retryBtn').hidden = error.code === 'session_full';
  show('error');
  const choice = await pick(signal, [[$('#retryBtn'), 'retry'], [$('#homeBtn'), 'home']], app.state.ui.errorSeconds * 1000);
  return choice === 'retry' ? 'retry' : 'home';
}

/** Runs a step; on failure shows the error screen and either repeats the step or sends the guest home. */
async function guarded(signal, step) {
  for (;;) {
    try {
      return await step();
    } catch (error) {
      if (error instanceof FlowCancelled) throw error;
      console.error(error);
      if ((await errorScreen(error, signal)) === 'home') throw new FlowCancelled();
    }
  }
}

async function countdown(session, index, signal) {
  const { ui } = app.state;
  $('#shotChip').textContent = session.shotsNeeded > 1 ? `Photo ${index + 1} of ${session.shotsNeeded}` : '';
  $('#hint').textContent = index === 0 ? 'Get ready — look at the camera!' : 'Next pose!';
  $('#count').textContent = '';
  show('countdown');
  startLive();
  await delay(600, signal); // let the preview appear before numbers start
  for (let n = ui.countdownSeconds; n >= 1; n -= 1) {
    setCount(String(n));
    await delay(1000, signal);
  }
  setCount('Smile!', { word: true });
  $('#hint').textContent = 'Hold still…';
}

async function takePhoto(session, index, shots, signal) {
  await guarded(signal, async () => {
    await countdown(session, index, signal);
    const shot = await api('POST', `/api/sessions/${session.id}/shots`, { index });
    flash();
    shots[index] = shot.previewUrl;
    await preload(shot.previewUrl);
    $('#shotImg').src = shot.previewUrl;
    $('#shotChip2').textContent = session.shotsNeeded > 1 ? `Photo ${index + 1} of ${session.shotsNeeded}` : '';
    show('shot');
    stopLive();
    await delay(app.state.ui.shotPreviewSeconds * 1000, signal);
  });
}

/** Resolves with { action: 'print' | 'done' | 'retake', index? }. */
async function review(session, shots, signal) {
  const { ui, printer } = app.state;
  $('#busyMsg').textContent = 'Creating your photos…';
  show('busy');
  const composed = await guarded(signal, () => api('POST', `/api/sessions/${session.id}/compose`));
  await preload(composed.previewUrl);
  $('#finalImg').src = composed.previewUrl;

  const canPrint = printer.enabled;
  $('#reviewTitle').textContent = 'Looking good!';
  $('#reviewSub').textContent = canPrint ? 'Happy with them? Tap to print.' : 'Your photos are saved.';
  $('#printBtn').textContent = canPrint ? 'Print my photos' : 'Done';

  const pairs = [[$('#printBtn'), { action: canPrint ? 'print' : 'done' }]];
  const retakes = $('#retakes');
  retakes.replaceChildren();
  if (ui.allowRetake && session.shotsNeeded > 1) {
    for (let i = 0; i < session.shotsNeeded; i += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'retake';
      const img = document.createElement('img');
      img.src = shots[i];
      img.alt = '';
      button.append(img, document.createTextNode(`Retake ${i + 1}`));
      retakes.append(button);
      pairs.push([button, { action: 'retake', index: i }]);
    }
  } else if (ui.allowRetake) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn secondary';
    button.textContent = 'Retake';
    retakes.append(button);
    pairs.push([button, { action: 'retake', index: 0 }]);
  }

  const bar = $('#timerBar');
  bar.style.transition = 'none';
  bar.style.transform = 'scaleX(1)';
  show('review');
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      bar.style.transition = `transform ${ui.reviewSeconds}s linear`;
      bar.style.transform = 'scaleX(0)';
    }),
  );

  const choice = await pick(signal, pairs, ui.reviewSeconds * 1000);
  if (choice === 'timeout') return { action: canPrint && printer.autoPrint ? 'print' : 'done' };
  return choice;
}

async function printFlow(session, signal) {
  const { printer } = app.state;
  placeSharePanel('#printShareSlot');
  show('printing');
  const bar = $('#printBar');
  bar.style.transition = 'none';
  bar.style.transform = 'scaleX(0)';
  $('#printMsg').textContent = 'Sending to the printer…';

  await guarded(signal, async () => {
    const queued = await api('POST', `/api/sessions/${session.id}/print`);
    const seconds = (queued.estimatedSeconds || printer.estimatedSeconds) * (1 + queued.queueAhead);
    $('#printMsg').textContent = queued.queueAhead > 0 ? `${plural(queued.queueAhead, 'print')} ahead of yours — about ${seconds} seconds` : `About ${seconds} seconds`;
    bar.style.transition = `transform ${seconds}s linear`;
    requestAnimationFrame(() => requestAnimationFrame(() => (bar.style.transform = 'scaleX(1)')));

    const deadline = Date.now() + (seconds * 3 + 60) * 1000;
    for (;;) {
      await delay(700, signal);
      const { job } = await api('GET', `/api/print/jobs/${queued.job.id}`);
      // Finished printing: if the guest is mid-way through typing their email, wait for them before the thank-you screen.
      if (job.status === 'done') return emailClosed(signal);
      if (job.status === 'error') throw new Error('Your photos are saved, but they could not be printed.');
      if (Date.now() > deadline) throw new Error('The printer is taking too long.');
    }
  });
}

async function doneScreen(printed, signal) {
  const { ui, sharing } = app.state;
  $('#doneTitle').textContent = 'Thank you!';
  $('#doneMsg').textContent = printed ? 'Your photos have been sent to the printer.' : 'Your photos have been saved.';
  placeSharePanel('#doneShareSlot');
  show('done');
  // With a QR code on screen, give guests time to scan it.
  const seconds = sharing?.enabled ? Math.max(ui.doneSeconds, sharing.shareSeconds) : ui.doneSeconds;
  await pickHeld(signal, [[$('#doneBtn'), 'done']], seconds * 1000);
}

async function guestFlow(signal) {
  const session = await guarded(signal, () => api('POST', '/api/sessions'));
  app.session = session;
  email.sent = [];
  updateEmailButton();
  const shots = [];
  for (let i = 0; i < session.shotsNeeded; i += 1) await takePhoto(session, i, shots, signal);

  let printed = false;
  let sharing = null;
  for (;;) {
    const result = await review(session, shots, signal);
    if (result.action === 'retake') {
      await takePhoto(session, result.index, shots, signal);
      continue;
    }
    // Start sharing now so the QR code is ready while the photos print (or on the thank-you screen).
    sharing = startShare(session, signal);
    if (result.action === 'print') {
      await printFlow(session, signal);
      printed = true;
    }
    break;
  }
  await doneScreen(printed, signal);
  void sharing; // runs to completion on its own; it stops when the flow is cancelled
}

async function runGuestFlow() {
  if (app.flow) return;
  const controller = new AbortController();
  app.flow = controller;
  try {
    await guestFlow(controller.signal);
  } catch (error) {
    if (!(error instanceof FlowCancelled)) console.error(error);
  } finally {
    app.flow = null;
    closeEmail();
    app.session = null;
    email.sent = [];
    $('#sharePanel').hidden = true;
    $('#qrImg').removeAttribute('src');
    goAttract();
  }
}

// -------------------------------------------------------------------- start

$('#startBtn').addEventListener('click', runGuestFlow);

// Five quick taps in the top-left corner open the operator panel.
{
  let taps = [];
  $('#hotspot').addEventListener('click', () => {
    const now = Date.now();
    taps = [...taps.filter((t) => now - t < 3000), now];
    if (taps.length >= 5) window.location.href = '/operator.html';
  });
}

// Show a banner if the booth server stops answering.
setInterval(async () => {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    $('#offline').hidden = res.ok;
  } catch {
    $('#offline').hidden = false;
  }
}, 5000);

try {
  await loadState();
  renderAttract();
} catch {
  $('#offline').hidden = false;
}

// For tests and the operator: lets a page-level script know the UI finished starting up.
document.body.dataset.ready = 'true';
