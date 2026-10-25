#!/usr/bin/env python3
"""Phone remote for Matchday Switcher.

Run this on the Mac that's plugged into the TV:

    python3 remote.py

then scan the QR code in the Matchday control room with your phone.

How it works: your phone taps a button -> POST /cmd -> the control room
(which keeps a request open to /next) receives it instantly and tells the
Chrome extension to rearrange the windows. Standard library only, so there's
nothing to install.
"""
import json
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = 8765
COMMANDS = {"a", "b", "split", "pip", "sound", "mute"}

lock = threading.Condition()
seq = 0            # increases with every button press
pending = []       # recent presses as (seq, cmd)
state = {}         # what the control room says is on screen
last_poll = 0.0    # when the control room last checked in


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # sends nothing; just picks the Wi-Fi interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


PHONE_URL = f"http://{lan_ip()}:{PORT}/"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/":
            self.reply(200, PHONE_PAGE.encode(), "text/html; charset=utf-8")
        elif url.path == "/state":
            with lock:
                body = {**state, "connected": time.time() - last_poll < 35}
            self.reply_json(body)
        elif url.path == "/next" and self.is_local():
            after = int(parse_qs(url.query).get("after", ["-1"])[0])
            self.reply_json(self.wait_for_commands(after))
        else:
            self.reply(404, b"not found", "text/plain")

    def do_POST(self):
        global seq
        length = int(self.headers.get("Content-Length") or 0)
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self.reply(400, b"bad json", "text/plain")
        path = urlparse(self.path).path
        if path == "/cmd" and data.get("cmd") in COMMANDS:
            with lock:
                seq += 1
                pending.append((seq, data["cmd"]))
                del pending[:-20]
                lock.notify_all()
            print(f"  phone: {data['cmd']}", flush=True)
            self.reply_json({"ok": True})
        elif path == "/state" and self.is_local():
            with lock:
                state.clear()
                state.update(data)
            self.reply_json({"ok": True})
        else:
            self.reply(400, b"bad request", "text/plain")

    def wait_for_commands(self, after):
        global last_poll
        with lock:
            last_poll = time.time()
            if 0 <= after <= seq:
                lock.wait_for(lambda: seq > after, timeout=25)
            else:
                # Control room just connected (-1) or we were restarted
                # (after > seq): catch up without replaying old presses.
                after = seq
            last_poll = time.time()
            cmds = [c for s, c in pending if s > after]
            return {"seq": seq, "cmds": cmds, "phoneUrl": PHONE_URL}

    def is_local(self):
        return self.client_address[0] in ("127.0.0.1", "::1")

    def reply_json(self, obj):
        self.reply(200, json.dumps(obj).encode(), "application/json")

    def reply(self, code, body, content_type):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # keep the terminal quiet; presses are printed in do_POST


PHONE_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0e1013">
<title>Matchday remote</title>
<style>
  :root { color-scheme: dark; --bg:#0e1013; --card:#171a1f; --line:#2a2f37; --text:#eef0f3;
          --muted:#9097a3; --accent:#36d399; --ink:#062b1d; --danger:#ff6b6b; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
               font: 16px/1.35 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
  body { display: flex; flex-direction: column; min-height: 100dvh;
         padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)); }
  h1 { margin: 0; font-size: 20px; }
  #now { margin: 2px 0 14px; color: var(--muted); min-height: 1.35em; }
  #now b { color: var(--text); }
  main { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr auto; gap: 12px; }
  button { font: inherit; color: inherit; background: var(--card); border: 1px solid var(--line);
           border-radius: 18px; padding: 16px; touch-action: manipulation; text-align: left;
           display: flex; flex-direction: column; justify-content: flex-end; gap: 4px; }
  button b { font-size: 21px; line-height: 1.15; }
  button small { color: var(--muted); }
  button:active { transform: scale(0.97); }
  button.active { background: var(--accent); color: var(--ink); border-color: var(--accent); }
  button.active small { color: var(--ink); opacity: 0.75; }
  .minor { min-height: 64px; justify-content: center; text-align: center; font-weight: 600; }
  .minor.active { background: var(--card); color: var(--danger); border-color: var(--danger); }
  #warn { margin: 14px 0 0; color: var(--danger); }
</style>
</head>
<body>
  <h1>Matchday</h1>
  <p id="now">Connecting…</p>
  <main>
    <button data-cmd="a"><b data-label="a">F1</b><small>full screen</small></button>
    <button data-cmd="b"><b data-label="b">El Clásico</b><small>full screen</small></button>
    <button data-cmd="split"><b>Side by side</b><small>again: swap sound</small></button>
    <button data-cmd="pip"><b>Picture in picture</b><small>again: swap big/small</small></button>
    <button data-cmd="sound" class="minor">Swap sound</button>
    <button data-cmd="mute" class="minor" id="mute">Mute all</button>
  </main>
  <p id="warn" hidden>The control room isn't open on the Mac. Click the Matchday icon in Chrome.</p>
<script>
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  function render(s) {
    $('#warn').hidden = s.connected;
    if (!s.layout) return;
    $('#now').innerHTML = '';
    const b = (t) => Object.assign(document.createElement('b'), { textContent: t });
    $('#now').append(b(s.layout), ' \\u00b7 Sound: ', b(s.sound));
    for (const k of ['a', 'b']) $(`[data-label="${k}"]`).textContent = s.labels[k];
    $$('main button').forEach((el) => el.classList.toggle('active',
      el.dataset.cmd === s.layoutKey || (el.dataset.cmd === 'mute' && !s.audio)));
    $('#mute').textContent = s.audio ? 'Mute all' : 'Unmute';
  }

  async function poll() {
    try {
      render(await (await fetch('/state', { cache: 'no-store' })).json());
    } catch {
      $('#now').textContent = 'Can\\u2019t reach the Mac. Is remote.py still running?';
    }
  }

  $$('main button').forEach((el) => el.addEventListener('click', async () => {
    navigator.vibrate?.(12);
    await fetch('/cmd', { method: 'POST', body: JSON.stringify({ cmd: el.dataset.cmd }) });
    setTimeout(poll, 250);
  }));

  setInterval(poll, 1000);
  poll();
</script>
</body>
</html>
"""


def main():
    try:
        server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    except OSError:
        sys.exit(f"Port {PORT} is busy. Is remote.py already running in another window?")
    server.daemon_threads = True

    if sys.platform == "darwin":
        # Keep the Mac's screen (and so the TV picture) awake while this runs.
        subprocess.Popen(["caffeinate", "-d", "-i", "-w", str(os.getpid())])

    print("Matchday phone remote is running.")
    print(f"  On your phone (same Wi-Fi): {PHONE_URL}")
    print("  Or scan the QR code in the Matchday control room.")
    print("  Keep this window open. Press Ctrl+C to stop.\n", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
