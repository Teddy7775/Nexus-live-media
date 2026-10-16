// Operator panel. All dynamic text goes through textContent / text nodes - event names and camera error
// messages are free-form, so nothing from the server is ever inserted as HTML.

const $ = (selector) => document.querySelector(selector);
const PIN_KEY = 'booth-operator-pin';

let pin = null;
let pollTimer = null;
let templates = [];

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
