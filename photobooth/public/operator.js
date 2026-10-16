// Operator panel. All dynamic text goes through textContent / text nodes - event names and camera error
// messages are free-form, so nothing from the server is ever inserted as HTML.

const $ = (selector) => document.querySelector(selector);
const PIN_KEY = 'booth-operator-pin';

let pin = null;
let pollTimer = null;
let templates = [];
let gs = null; // the last green-screen status from the server

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value);
  }
  el.append(...children.filter((c) => c !== null && c !== undefined));
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
    res = await fetch(url, {
      method,
      headers: { 'x-operator-pin': pin ?? '', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Cannot reach the booth server'), { code: 'offline' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.detail ? `${data.message} (${data.detail})` : data.message || 'Request failed'), { status: res.status, code: data.error });
  return data;
}

const dot = (el, kind) => {
  el.className = `dot ${kind}`;
};

// ---------------------------------------------------------------- rendering

function renderStatus(s) {
  const warnings = [...s.warnings, ...s.templateProblems.map((p) => `Template ${p.file} was ignored: ${p.issues.join('; ')}`)];
  $('#warnCard').hidden = warnings.length === 0;
  $('#warnings').replaceChildren(...warnings.map((w) => h('li', {}, w)));

  dot($('#camDot'), s.camera.connected ? 'ok' : 'bad');
  $('#camText').textContent = s.camera.connected ? 'Camera ready' : 'Camera not ready';
  $('#camDriver').textContent = `${s.camera.driver}: ${s.camera.detail}`;

  dot($('#prnDot'), s.printer.mode === 'dryrun' ? 'warn' : s.printer.ok ? 'ok' : 'bad');
  $('#prnText').textContent = s.printer.mode === 'dryrun' ? 'Dry run (not printing)' : s.printer.ok ? 'Printer ready' : 'Printer problem';
  $('#prnMode').textContent = s.printer.detail;

  const printers = s.printer.printers ?? [];
  $('#printersBox').hidden = printers.length === 0;
  $('#printers').replaceChildren(
    ...printers.map((p) =>
      h('li', {}, h('strong', {}, p.name), h('br'), h('span', { class: 'muted' }, `Paper sizes: ${p.paperSizes.length ? p.paperSizes.join(' | ') : '(none reported)'}`)),
    ),
  );

  $('#jobs').replaceChildren(
    ...(s.queue.length
      ? s.queue.map((j) =>
          h('li', {}, h('span', { class: `badge ${j.status}` }, j.status), `${j.label} x${j.copies}`, j.error ? h('div', { class: 'muted' }, j.error) : null),
        )
      : [h('li', {}, 'No prints yet')]),
  );

  renderSharing(s.sharing);
  renderMail(s.email);
  renderGreenScreen(s.greenScreen);
  renderStation(s.station);

  templates = s.templates;
  const select = $('#template');
  if (document.activeElement !== select) {
    select.replaceChildren(...templates.map((t) => h('option', { value: t.id }, `${t.name} (${t.shots} photo${t.shots === 1 ? '' : 's'})`)));
    select.value = s.settings.activeTemplate;
  }
  describeTemplate();
  if (!$('#settingsForm').contains(document.activeElement)) {
    $('#eventName').value = s.settings.eventName;
    $('#copies').value = s.settings.copies;
    $('#printEnabled').checked = s.settings.printEnabled;
  }
  $('#slug').textContent = s.settings.eventSlug;
}

function renderSharing(sh) {
  $('#shareCard').hidden = false;
  const failed = sh.uploads.filter((u) => u.status === 'failed').length;
  const waiting = sh.uploads.filter((u) => u.status !== 'failed').length;
  if (!sh.enabled) {
    dot($('#shareDot'), '');
    $('#shareText').textContent = 'Sharing is off';
    $('#shareDetail').textContent = 'Turn it on in config.json (sharing.enabled) to get QR codes and guest galleries.';
  } else {
    dot($('#shareDot'), failed ? 'bad' : waiting ? 'warn' : 'ok');
    $('#shareText').textContent = failed ? 'Some uploads failed' : waiting ? `${waiting} gallery upload(s) waiting` : 'Sharing ready';
    $('#shareDetail').textContent = sh.mode === 'local' ? `Local galleries at ${sh.baseUrl} - phones must be on this network.` : `Uploading galleries to ${sh.baseUrl}${sh.autoUpload ? '' : ' (on request only)'}.${sh.qrOnPrint && waiting ? ' QR codes on prints will not work until these finish uploading.' : ''}`;
  }
  $('#checkUpload').hidden = !(sh.enabled && sh.mode === 'upload');
  $('#uploads').replaceChildren(
    ...(sh.uploads.length
      ? sh.uploads.map((u) =>
          h(
            'li',
            {},
            h('span', { class: `badge ${u.status === 'failed' ? 'error' : u.status}` }, u.status),
            `${u.sessionId.slice(-9)} (${u.uploaded}/${u.files} files, try ${u.attempts})`,
            u.error ? h('div', { class: 'muted' }, u.error) : null,
            u.status === 'failed' ? h('button', { class: 'btn', type: 'button', onclick: () => retryUpload(u.id) }, 'Retry') : null,
          ),
        )
      : [h('li', {}, sh.enabled ? 'Nothing waiting' : '-')]),
  );
}

function renderMail(m) {
  const failed = m.queue.filter((i) => i.status === 'failed').length;
  const waiting = m.queue.length - failed;
  if (!m.enabled) {
    dot($('#mailDot'), '');
    $('#mailText').textContent = 'Email is off';
    $('#mailDetail').textContent = 'Turn it on in config.json (email.enabled) to let guests email themselves their photos.';
  } else {
    dot($('#mailDot'), failed ? 'bad' : waiting ? 'warn' : 'ok');
    $('#mailText').textContent = failed ? `${failed} email(s) failed` : waiting ? `${waiting} email(s) waiting` : 'Email ready';
    $('#mailDetail').textContent = `Sending as ${m.from} through ${m.host}.${m.marketingOptIn ? ' Guests can tick a box to hear about future events; only those addresses are kept (optin-emails.csv in the event folder).' : ' Addresses are not kept after sending.'}`;
  }
  $('#checkMail').hidden = !m.enabled;
  $('#testMailForm').hidden = !m.enabled;
  $('#mails').replaceChildren(
    ...(m.queue.length
      ? m.queue.map((i) =>
          h(
            'li',
            {},
            h('span', { class: `badge ${i.status === 'failed' ? 'error' : i.status === 'sending' ? 'printing' : i.status}` }, i.status),
            `${i.to} (try ${i.attempts})`,
            i.error ? h('div', { class: 'muted' }, i.error) : null,
            i.status === 'failed'
              ? h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => mailAction('POST', `/api/operator/email/${i.id}/retry`) }, 'Retry'), h('button', { class: 'btn', type: 'button', onclick: () => mailAction('DELETE', `/api/operator/email/${i.id}`) }, 'Dismiss'))
              : null,
          ),
        )
      : [h('li', {}, m.enabled ? 'Nothing waiting' : '-')]),
  );
}

// --------------------------------------------------------------------- station

function renderStation(t) {
  if (!t.enabled) {
    dot($('#stDot'), '');
    $('#stText').textContent = 'Station is off';
    $('#stDetail').textContent = 'Turn it on in config.json (station.enabled and station.pin) to get a second screen that shows sessions live, approves prints and shares photos.';
    $('#stUrl').hidden = true;
    $('#stControls').hidden = true;
    return;
  }
  dot($('#stDot'), t.online ? 'ok' : t.approvalRequired ? 'bad' : 'warn');
  $('#stText').textContent = t.online ? 'A station is connected' : 'No station connected';
  $('#stDetail').textContent = t.approvalRequired
    ? `Prints wait for approval (${t.timeoutSeconds} s, then ${t.onTimeout === 'print' ? 'printed anyway' : 'not printed'}).${t.online ? '' : ' With no station connected, prints are settled at once the same way: connect a station or switch approval off.'}${t.waiting ? ` ${t.waiting} waiting now.` : ''}`
    : 'Open this address on the attendant\'s PC or tablet (same network) and enter the station PIN:';
  $('#stUrl').hidden = false;
  $('#stUrl').textContent = t.url;
  $('#stControls').hidden = false;
  if (document.activeElement !== $('#stApproval')) $('#stApproval').checked = t.approvalRequired;
}

$('#stApproval').addEventListener('change', async (e) => {
  const box = e.currentTarget;
  say($('#stMsg'), 'Saving…');
  try {
    await api('POST', '/api/operator/settings', { approvalRequired: box.checked });
    say($('#stMsg'), box.checked ? 'Prints now wait for approval at the station.' : 'Prints go straight to the printer.', 'ok');
    await refreshStatus();
  } catch (err) {
    box.checked = !box.checked;
    say($('#stMsg'), err.message, 'error');
  }
});

// ----------------------------------------------------------------- green screen

const SLIDERS = [
  { key: 'sensitivity', label: 'Sensitivity', min: 1, max: 100, step: 1, help: 'Higher removes more green. Raise it if green shows through in dark corners or shadows; lower it if parts of a person disappear.' },
  { key: 'softness', label: 'Edge softness', min: 5, max: 100, step: 1, help: 'Wider = softer, more natural hair and edges. Narrower = crisper but harsher.' },
  { key: 'despill', label: 'Remove green glow', min: 0, max: 1, step: 0.05, help: 'Takes the green tint off hair and shoulders (green light bouncing off the backdrop).' },
  { key: 'edgeBlur', label: 'Edge smoothing', min: 0, max: 4, step: 0.1, help: 'Smooths jagged outlines. Too much makes a halo.' },
];
const tuner = { running: false, view: 'composite', dirty: false, timer: null, stopAt: 0, url: null, built: false };

function tunerKey() {
  const key = {};
  for (const sl of SLIDERS) key[sl.key] = Number($(`#gs-${sl.key}`).value);
  return key;
}

function showSliderValues() {
  for (const sl of SLIDERS) $(`#gs-${sl.key}-out`).textContent = $(`#gs-${sl.key}`).value;
}

function setSliders(key) {
  for (const sl of SLIDERS) $(`#gs-${sl.key}`).value = key[sl.key];
  showSliderValues();
}

function buildTuner() {
  if (tuner.built) return;
  tuner.built = true;
  $('#gsSliders').replaceChildren(
    ...SLIDERS.map((sl) =>
      h(
        'div',
        { class: 'slider' },
        h('label', { for: `gs-${sl.key}` }, sl.label, h('output', { id: `gs-${sl.key}-out` })),
        h('input', {
          id: `gs-${sl.key}`,
          type: 'range',
          min: String(sl.min),
          max: String(sl.max),
          step: String(sl.step),
          oninput: () => {
            tuner.dirty = true;
            showSliderValues();
          },
        }),
        h('small', {}, sl.help),
      ),
    ),
  );
}

function renderGreenScreen(g) {
  gs = g;
  if (!g.enabled) {
    stopTuner();
    dot($('#gsDot'), '');
    $('#gsText').textContent = 'Green screen is off';
    $('#gsDetail').textContent = 'Turn it on in config.json (greenScreen.enabled) to let guests pick a background. It needs a green sheet or wall, even lighting, and live view on the camera.';
    $('#gsBody').hidden = true;
    return;
  }
  buildTuner();
  dot($('#gsDot'), 'ok');
  $('#gsText').textContent = 'Green screen is on';
  $('#gsDetail').textContent = `${g.backgrounds.length} backgrounds. Changes you save apply to the next guest.`;
  $('#gsBody').hidden = false;
  $('#gsFolder').textContent = `Your own backgrounds: put .jpg or .png pictures (3000 px wide or more looks best on a print) in ${g.folder} and restart the booth.`;

  if (!tuner.dirty && !$('#gsSliders').contains(document.activeElement)) setSliders(g.key);

  const options = g.backgrounds.map((b) => h('option', { value: b.id }, b.name));
  const tryOn = $('#gsBackground');
  const keepTry = tryOn.value;
  tryOn.replaceChildren(...options);
  tryOn.value = g.backgrounds.some((b) => b.id === keepTry) ? keepTry : g.backgrounds[0].id;

  const mode = $('#gsBackdrop');
  if (document.activeElement !== mode) {
    mode.replaceChildren(h('option', { value: 'guest' }, 'Each guest chooses'), ...g.backgrounds.map((b) => h('option', { value: b.id }, `Everyone gets: ${b.name}`)));
    mode.value = g.backdrop;
  }
}

async function tunerTick() {
  if (!tuner.running) return;
  let wait = 250;
  try {
    if (document.hidden || Date.now() > tuner.stopAt) throw Object.assign(new Error(document.hidden ? 'Paused while this tab is hidden.' : 'Stopped after 5 minutes to let the camera rest.'), { stop: true });
    const res = await fetch('/api/operator/greenscreen/frame', {
      method: 'POST',
      headers: { 'x-operator-pin': pin ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({ view: tuner.view, background: $('#gsBackground').value, key: tunerKey() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw Object.assign(new Error(data.message || 'The camera did not answer'), { retry: res.status === 409 || res.status === 503 });
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    $('#gsImg').src = url;
    $('#gsImg').hidden = false;
    $('#gsPlaceholder').hidden = true;
    if (tuner.url) URL.revokeObjectURL(tuner.url);
    tuner.url = url;
    say($('#gsLiveMsg'), '');
  } catch (err) {
    if (err.stop || !err.retry) {
      stopTuner(err.message);
      return;
    }
    say($('#gsLiveMsg'), `${err.message} Trying again…`, 'error');
    wait = 2000;
  }
  if (tuner.running) tuner.timer = setTimeout(tunerTick, wait);
}

function startTuner() {
  tuner.running = true;
  tuner.stopAt = Date.now() + 5 * 60 * 1000;
  $('#gsToggle').textContent = 'Stop live tuner';
  say($('#gsLiveMsg'), 'Starting the camera…');
  tunerTick();
}

function stopTuner(message) {
  clearTimeout(tuner.timer);
  tuner.running = false;
  $('#gsToggle').textContent = 'Start live tuner';
  if (message) say($('#gsLiveMsg'), message, 'error');
  else say($('#gsLiveMsg'), '');
}

$('#gsToggle').addEventListener('click', () => (tuner.running ? stopTuner() : startTuner()));

for (const button of document.querySelectorAll('.seg-btn')) {
  button.addEventListener('click', () => {
    tuner.view = button.dataset.view;
    for (const other of document.querySelectorAll('.seg-btn')) other.setAttribute('aria-pressed', String(other === button));
  });
}

$('#gsCalibrate').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  say($('#gsMsg'), 'Looking at the backdrop - keep everyone out of the picture…');
  try {
    const r = await api('POST', '/api/operator/greenscreen/calibrate');
    if (r.ok) {
      setSliders({ ...tunerKey(), sensitivity: r.sensitivity, softness: r.softness });
      tuner.dirty = true;
      say($('#gsMsg'), `${r.advice} Suggested sensitivity ${r.sensitivity} and softness ${r.softness}: check the picture, then save.`, r.warn ? 'error' : 'ok');
    } else {
      say($('#gsMsg'), r.advice, 'error');
    }
  } catch (err) {
    say($('#gsMsg'), err.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#gsSave').addEventListener('click', async () => {
  say($('#gsMsg'), 'Saving…');
  try {
    await api('POST', '/api/operator/settings', { key: tunerKey() });
    tuner.dirty = false;
    say($('#gsMsg'), 'Saved. The next guest will use these settings.', 'ok');
    await refreshStatus();
  } catch (err) {
    say($('#gsMsg'), err.message, 'error');
  }
});

$('#gsReset').addEventListener('click', () => {
  if (!gs?.enabled) return;
  setSliders(gs.defaults);
  tuner.dirty = true;
  say($('#gsMsg'), 'Back to the standard settings (not saved yet).');
});

$('#gsBackdropSave').addEventListener('click', async () => {
  say($('#gsBackdropMsg'), 'Applying…');
  try {
    await api('POST', '/api/operator/settings', { backdrop: $('#gsBackdrop').value });
    say($('#gsBackdropMsg'), $('#gsBackdrop').value === 'guest' ? 'Guests will choose their own background.' : 'Every guest now gets that background.', 'ok');
    await refreshStatus();
  } catch (err) {
    say($('#gsBackdropMsg'), err.message, 'error');
  }
});

$('#gsTestPhoto').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  say($('#gsPhotoMsg'), 'Taking a photo…');
  $('#gsPhotoImg').hidden = true;
  try {
    const r = await api('POST', '/api/operator/test-capture', { background: $('#gsBackground').value });
    say($('#gsPhotoMsg'), 'This is the photo as a guest would get it, with the SAVED settings (save first if you just changed the sliders).', 'ok');
    $('#gsPhotoImg').src = r.keyedPreviewUrl ?? r.previewUrl;
    $('#gsPhotoImg').hidden = false;
  } catch (err) {
    say($('#gsPhotoMsg'), err.message, 'error');
  } finally {
    button.disabled = false;
  }
});

async function mailAction(method, url) {
  try {
    await api(method, url);
    await refreshStatus();
  } catch (err) {
    say($('#mailMsg'), err.message, 'error');
  }
}

$('#checkMail').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  say($('#mailMsg'), 'Contacting the mail server…');
  try {
    const result = await api('POST', '/api/operator/check-email');
    say($('#mailMsg'), result.detail, result.ok ? 'ok' : 'error');
  } catch (err) {
    say($('#mailMsg'), err.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#testMailForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  say($('#mailMsg'), 'Sending…');
  try {
    const result = await api('POST', '/api/operator/test-email', { to: $('#testMailTo').value });
    say($('#mailMsg'), result.detail, result.ok ? 'ok' : 'error');
  } catch (err) {
    say($('#mailMsg'), err.message, 'error');
  }
});

async function retryUpload(id) {
  try {
    await api('POST', `/api/operator/uploads/${id}/retry`);
    await refreshStatus();
  } catch (err) {
    say($('#uploadMsg'), err.message, 'error');
  }
}

$('#checkUpload').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  say($('#uploadMsg'), 'Contacting the web host…');
  try {
    const result = await api('POST', '/api/operator/check-upload');
    say($('#uploadMsg'), result.detail, result.ok ? 'ok' : 'error');
  } catch (err) {
    say($('#uploadMsg'), err.message, 'error');
  } finally {
    button.disabled = false;
  }
});

function describeTemplate() {
  const t = templates.find((x) => x.id === $('#template').value);
  $('#templateDesc').textContent = t?.description ?? '';
}

async function refreshStatus() {
  try {
    renderStatus(await api('GET', '/api/operator/status'));
  } catch (err) {
    if (err.status === 401) return lock('The PIN was rejected.');
    dot($('#camDot'), 'bad');
    $('#camText').textContent = err.message;
  }
  return undefined;
}

async function refreshSessions() {
  try {
    const { sessions } = await api('GET', '/api/operator/sessions?limit=24');
    say($('#sessMsg'), sessions.length ? '' : 'No sessions yet for this event.');
    $('#sessions').replaceChildren(
      ...sessions.map((s) =>
        h(
          'div',
          { class: 'thumb' },
          h('div', { class: 'img' }, s.previewUrl ? h('img', { src: s.previewUrl, alt: `Session ${s.id}`, loading: 'lazy' }) : 'no photo'),
          h(
            'div',
            { class: 'meta' },
            h('span', {}, `${new Date(s.createdAt).toLocaleTimeString()} - ${s.prints} print${s.prints === 1 ? '' : 's'}`),
            h('button', { class: 'btn', type: 'button', onclick: (e) => reprint(s.id, e.currentTarget) }, 'Reprint'),
          ),
        ),
      ),
    );
  } catch (err) {
    say($('#sessMsg'), err.message, 'error');
  }
}

// ------------------------------------------------------------------ actions

async function reprint(id, button) {
  button.disabled = true;
  try {
    await api('POST', `/api/operator/sessions/${id}/reprint`, { copies: 1 });
    say($('#sessMsg'), 'Reprint queued.', 'ok');
    await refreshStatus();
  } catch (err) {
    say($('#sessMsg'), err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

$('#testCapture').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  say($('#captureMsg'), 'Taking a photo…');
  $('#captureImg').hidden = true;
  try {
    const result = await api('POST', '/api/operator/test-capture');
    say($('#captureMsg'), 'Test photo OK.', 'ok');
    $('#captureImg').src = result.previewUrl;
    $('#captureImg').hidden = false;
  } catch (err) {
    say($('#captureMsg'), err.message, 'error');
  } finally {
    button.disabled = false;
    refreshStatus();
  }
});

$('#testPrint').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  say($('#printMsg'), 'Queuing test page…');
  try {
    await api('POST', '/api/operator/test-print');
    say($('#printMsg'), 'Test page queued.', 'ok');
  } catch (err) {
    say($('#printMsg'), err.message, 'error');
  } finally {
    button.disabled = false;
    refreshStatus();
  }
});

$('#template').addEventListener('change', describeTemplate);

$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  say($('#saveMsg'), 'Saving…');
  try {
    await api('POST', '/api/operator/settings', {
      eventName: $('#eventName').value,
      activeTemplate: $('#template').value,
      copies: Number.parseInt($('#copies').value, 10),
      printEnabled: $('#printEnabled').checked,
    });
    say($('#saveMsg'), 'Saved. New guests will use these settings.', 'ok');
    await Promise.all([refreshStatus(), refreshSessions()]);
  } catch (err) {
    say($('#saveMsg'), err.message, 'error');
  }
});

// -------------------------------------------------------------- lock / unlock

function lock(message) {
  stopTuner();
  sessionStorage.removeItem(PIN_KEY);
  pin = null;
  clearInterval(pollTimer);
  $('#dash').hidden = true;
  $('#gate').hidden = false;
  say($('#pinError'), message, 'error');
  $('#pin').value = '';
  $('#pin').focus();
}

async function unlock(candidate) {
  pin = candidate;
  try {
    renderStatus(await api('GET', '/api/operator/status'));
  } catch (err) {
    return lock(err.status === 401 ? 'Wrong PIN.' : err.message);
  }
  sessionStorage.setItem(PIN_KEY, candidate);
  $('#gate').hidden = true;
  $('#dash').hidden = false;
  say($('#pinError'), '');
  await refreshSessions();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!document.hidden) refreshStatus();
  }, 5000);
  return undefined;
}

$('#pinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  unlock($('#pin').value);
});

const saved = sessionStorage.getItem(PIN_KEY);
if (saved) unlock(saved);
else $('#pin').focus();
