// Matchday Switcher: arranges two stream windows on the TV and routes the sound.
//
// Every command (keyboard shortcut, control-room button, phone remote) ends up
// in handle(), which updates the saved state and then calls arrange() to make
// the windows match it. State lives in chrome.storage so the service worker can
// be stopped and restarted by Chrome without forgetting anything.

const OTHER = { a: 'b', b: 'a' };
const KEYS = ['a', 'b'];
const TITLEBAR = 28;   // height of a popup window's title bar on macOS
const PIP_SCALE = 0.3; // small window width as a fraction of the screen
const PIP_MARGIN = 36;

const DEFAULT_STATE = {
  streams: {
    a: { label: 'F1', url: 'https://tv.apple.com/', tabId: null },
    b: { label: 'El Clásico', url: 'https://tv.youtube.com/', tabId: null },
  },
  displayId: '',  // '' = auto-pick the TV
  layout: 'split', // 'a' | 'b' | 'split' | 'pip'
  big: 'a',        // which stream is big in picture-in-picture
  audio: 'b',      // which stream you hear; null = everything muted
  lastAudio: 'b',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function load() {
  const { state: saved = {} } = await chrome.storage.local.get('state');
  const s = { ...DEFAULT_STATE, ...saved, streams: {} };
  for (const k of KEYS) s.streams[k] = { ...DEFAULT_STATE.streams[k], ...saved.streams?.[k] };
  return s;
}

const save = (state) => chrome.storage.local.set({ state });

async function liveTab(stream) {
  if (stream.tabId == null) return null;
  try {
    return await chrome.tabs.get(stream.tabId);
  } catch {
    return null;
  }
}

// The TV is whichever display isn't the laptop's built-in screen (the largest
// one if there are several), unless the user picked one in the control room.
async function pickDisplay(s) {
  const displays = await chrome.system.display.getInfo();
  const chosen = displays.find((d) => d.id === s.displayId);
  if (chosen) return chosen;
  const area = (d) => d.bounds.width * d.bounds.height;
  const builtIn = (d) => d.isInternal || /built-?in/i.test(d.name);
  const external = displays.filter((d) => !builtIn(d));
  return (external.length ? external : displays).sort((x, y) => area(y) - area(x))[0];
}

// Window positions for the current layout, listed back to front.
function layoutPlan(s, wa) {
  const full = { left: wa.left, top: wa.top, width: wa.width, height: wa.height };
  if (s.layout === 'split') {
    const half = Math.floor(wa.width / 2);
    return [
      { key: 'a', bounds: { ...full, width: half } },
      { key: 'b', bounds: { ...full, left: wa.left + half, width: wa.width - half } },
    ];
  }
  if (s.layout === 'pip') {
    const width = Math.round(wa.width * PIP_SCALE);
    const height = Math.round((width * 9) / 16) + TITLEBAR;
    return [
      { key: s.big, bounds: full },
      {
        key: OTHER[s.big],
        bounds: {
          left: wa.left + wa.width - width - PIP_MARGIN,
          top: wa.top + wa.height - height - PIP_MARGIN,
          width,
          height,
        },
      },
    ];
  }
  // Solo: the hidden stream sits right behind the visible one and keeps
  // playing (muted), so switching back is instant and still live.
  return [
    { key: OTHER[s.layout], bounds: full },
    { key: s.layout, bounds: full },
  ];
}

async function arrange(s) {
  const tabs = {};
  for (const k of KEYS) tabs[k] = await liveTab(s.streams[k]);

  // Tab-level mute: the page never sees a volume change, so the hidden
  // stream isn't paused or throttled by the site or by Chrome.
  for (const k of KEYS) {
    if (tabs[k]) await chrome.tabs.update(tabs[k].id, { muted: s.audio !== k });
  }

  const display = await pickDisplay(s);
  const before = await chrome.windows.getLastFocused().catch(() => null);
  const streamWindows = KEYS.map((k) => tabs[k]?.windowId).filter((id) => id != null);

  // Focusing each window in back-to-front order sets the stacking order.
  for (const { key, bounds } of layoutPlan(s, display.workArea)) {
    const tab = tabs[key];
    if (!tab) continue;
    const win = await chrome.windows.get(tab.windowId);
    if (win.state !== 'normal') {
      await chrome.windows.update(win.id, { state: 'normal' });
      await sleep(win.state === 'fullscreen' ? 900 : 150); // let macOS finish its animation
    }
    await chrome.windows.update(win.id, { ...bounds, focused: true });
  }

  // Hand focus back to the control room (it lives on the laptop screen, so
  // this doesn't disturb the stacking on the TV).
  if (before && !streamWindows.includes(before.id)) {
    await chrome.windows.update(before.id, { focused: true }).catch(() => {});
  }
}

async function openStream(s, k, display) {
  const { left, top, width, height } = display.workArea;
  const win = await chrome.windows.create({
    url: s.streams[k].url,
    type: 'popup', // no tabs or address bar: just the stream
    left, top, width, height,
  });
  s.streams[k].tabId = win.tabs[0].id;
}

async function handle(msg) {
  const s = await load();
  switch (msg.cmd) {
    case 'a':
    case 'b':
      s.layout = s.big = s.audio = msg.cmd;
      break;
    case 'split':
      // Already side by side? Then the button swaps which one you hear.
      if (s.layout === 'split') s.audio = OTHER[s.audio] ?? s.lastAudio;
      s.layout = 'split';
      break;
    case 'pip':
      // Already picture-in-picture? Then swap big and small.
      if (s.layout === 'pip') s.big = OTHER[s.big];
      else s.big = s.audio ?? s.big;
      s.layout = 'pip';
      s.audio = s.big;
      break;
    case 'sound':
      s.audio = OTHER[s.audio] ?? s.lastAudio;
      break;
    case 'mute':
      s.audio = s.audio ? null : s.lastAudio;
      break;
    case 'open': {
      const display = await pickDisplay(s);
      for (const k of KEYS) if (!(await liveTab(s.streams[k]))) await openStream(s, k, display);
      break;
    }
    case 'go': {
      const stream = s.streams[msg.key];
      stream.url = msg.url;
      const tab = await liveTab(stream);
      if (tab) await chrome.tabs.update(tab.id, { url: msg.url });
      else await openStream(s, msg.key, await pickDisplay(s));
      break;
    }
    case 'label':
      s.streams[msg.key].label = msg.label;
      return save(s);
    case 'sync': // control room opened: save defaults without moving windows
      return save(s);
    case 'display':
      s.displayId = msg.displayId;
      break;
    default:
      throw new Error(`Unknown command: ${msg.cmd}`);
  }
  if (s.audio) s.lastAudio = s.audio;
  await save(s); // save first so the control room and phone update right away
  await arrange(s);
}

// One command at a time, so rapid button mashing can't interleave moves.
let queue = Promise.resolve();
function run(msg) {
  const job = queue.then(() => handle(msg));
  queue = job.catch((e) => console.error('Matchday:', e));
  return job;
}

async function openControlRoom() {
  const url = chrome.runtime.getURL('control.html');
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.windows.create({ url, type: 'popup', width: 560, height: 900 });
}

chrome.commands.onCommand.addListener((cmd) => run({ cmd }));
chrome.action.onClicked.addListener(openControlRoom);
chrome.runtime.onInstalled.addListener(openControlRoom);

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  run(msg).then(
    () => reply({ ok: true }),
    (e) => reply({ ok: false, error: String(e?.message ?? e) }),
  );
  return true; // reply asynchronously
});

// Forget a stream when its window is closed, so the UI shows it as closed.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await queue;
  const s = await load();
  const k = KEYS.find((key) => s.streams[key].tabId === tabId);
  if (k) {
    s.streams[k].tabId = null;
    await save(s);
  }
});
