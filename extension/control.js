// Control room: buttons for the layouts, stream settings, and the bridge to
// the phone remote (remote.py). All the real work happens in background.js;
// this page only sends it commands and draws whatever state it saved.
import qrcode from './vendor/qrcode.mjs';

const REMOTE = 'http://127.0.0.1:8765';
const KEYS = ['a', 'b'];
const LAYOUT_NAMES = { split: 'Side by side', pip: 'Picture in picture' };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let state = null;

async function send(msg) {
  const res = await chrome.runtime.sendMessage(msg);
  const error = $('#error');
  error.hidden = res?.ok !== false;
  error.textContent = res?.ok === false ? `Something went wrong: ${res.error}` : '';
}

function describe(s) {
  const name = (k) => s.streams[k].label;
  const layout = LAYOUT_NAMES[s.layout] ?? `${name(s.layout)} full screen`;
  const sound = s.audio ? name(s.audio) : 'muted';
  return { layout, sound };
}

async function render() {
  ({ state } = await chrome.storage.local.get('state'));
  if (!state) return;
  const { layout, sound } = describe(state);
  $('#now').innerHTML = '';
  $('#now').append('Now: ', bold(layout), ' · Sound: ', bold(sound));

  for (const k of KEYS) {
    const stream = state.streams[k];
    $$(`[data-label="${k}"]`).forEach((el) => (el.textContent = stream.label));
    setUnlessEditing($(`.label-input[data-key="${k}"]`), stream.label);
    setUnlessEditing($(`.url-input[data-key="${k}"]`), stream.url);
    const status = $(`[data-status="${k}"]`);
    const open = stream.tabId != null;
    status.textContent = open ? 'On the TV' : 'Not open';
    status.classList.toggle('on', open);
  }

  $$('.layout').forEach((b) => b.classList.toggle('active', b.dataset.cmd === state.layout));
  $('#mute').classList.toggle('active', !state.audio);
  $('#mute').textContent = state.audio ? 'Mute all' : 'Unmute';

  const allOpen = KEYS.every((k) => state.streams[k].tabId != null);
  $('#open').disabled = allOpen;
  $('#open').textContent = allOpen ? 'Both streams are on the TV' : 'Open both streams on the TV';
}

function bold(text) {
  const b = document.createElement('b');
  b.textContent = text;
  return b;
}

function setUnlessEditing(input, value) {
  if (document.activeElement !== input) input.value = value;
}

async function renderDisplays() {
  const displays = await chrome.system.display.getInfo();
  const select = $('#display');
  select.innerHTML = '';
  select.append(new Option('Auto (the screen that isn’t the laptop)', ''));
  for (const d of displays) {
    select.append(new Option(`${d.name || 'Display'} — ${d.bounds.width}×${d.bounds.height}`, d.id));
  }
  select.value = state?.displayId ?? '';
}

// --- Phone remote bridge ---------------------------------------------------

function pushState() {
  if (!state) return;
  const body = {
    ...describe(state),
    layoutKey: state.layout,
    audio: state.audio,
    labels: { a: state.streams.a.label, b: state.streams.b.label },
  };
  fetch(`${REMOTE}/state`, { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
}

let shownUrl = null;
function showRemote(phoneUrl) {
  $('#remote-on').hidden = !phoneUrl;
  $('#remote-off').hidden = !!phoneUrl;
  if (!phoneUrl || phoneUrl === shownUrl) return;
  shownUrl = phoneUrl;
  const qr = qrcode(0, 'M');
  qr.addData(phoneUrl);
  qr.make();
  $('#qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  $('#phone-url').textContent = phoneUrl;
  $('#phone-url').href = phoneUrl;
}

// Long-poll remote.py for button presses. Waiting on the network instead of a
// timer means Chrome can't slow this down when the window is in the background.
async function remoteLoop() {
  let after = -1;
  for (;;) {
    try {
      const res = await fetch(`${REMOTE}/next?after=${after}`, { cache: 'no-store' });
      const { seq, cmds, phoneUrl } = await res.json();
      showRemote(phoneUrl);
      if (after === -1) pushState(); // just connected: tell the phone what's on
      after = seq;
      for (const cmd of cmds) await send({ cmd });
    } catch {
      showRemote(null);
      shownUrl = null;
      after = -1;
      await sleep(2000);
    }
  }
}

// --- Wiring ----------------------------------------------------------------

$$('[data-cmd]').forEach((button) =>
  button.addEventListener('click', () => send({ cmd: button.dataset.cmd })),
);

$$('form.go').forEach((form) =>
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const key = form.dataset.key;
    send({ cmd: 'go', key, url: $(`.url-input[data-key="${key}"]`).value.trim() });
  }),
);

$$('.label-input').forEach((input) =>
  input.addEventListener('change', () => send({ cmd: 'label', key: input.dataset.key, label: input.value.trim() || '?' })),
);

$('#display').addEventListener('change', (e) => send({ cmd: 'display', displayId: e.target.value }));

const isMac = /mac/i.test(navigator.userAgentData?.platform ?? navigator.platform);
$$('kbd.mod').forEach((k) => (k.textContent = isMac ? '⌥⇧' : 'Alt+Shift'));

chrome.storage.onChanged.addListener(async () => {
  await render();
  pushState();
});
chrome.system.display.onDisplayChanged.addListener(renderDisplays);

await send({ cmd: 'sync' }); // makes sure defaults are saved on first run
await render();
await renderDisplays();
remoteLoop();
