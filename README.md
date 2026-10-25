# Matchday Switcher

Two live streams on one TV, controlled from your phone. One button gives you
F1 full screen, El Clásico full screen, side by side, or picture-in-picture.
The sound follows whichever stream is the focus.

## Setup (about 10 minutes, do it before 3pm ET)

**1. Plug the Mac into the TV and make the TV a *separate* screen.**
System Settings → Displays → click the TV → *Use as: Extended display* (not
mirror). The laptop screen becomes your control room and the TV shows only the
streams. Then System Settings → Sound → Output → pick the LG TV.

**2. Load the extension in Chrome.** (Edge, Brave and Arc work too. Safari doesn't.)
1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick the `extension` folder inside `matchday`

The Matchday control room opens on its own. If you close it, click the puzzle
piece icon in Chrome's toolbar, then **Matchday Switcher**.

**3. Start the phone remote.** Open Terminal and run:

    cd ~/Downloads/matchday
    python3 remote.py

If macOS asks whether Python may accept incoming connections, click **Allow**.
A QR code appears in the control room. Scan it with your phone's camera. The
phone has to be on the same Wi-Fi as the Mac, and not a guest network. While
remote.py runs it also keeps the Mac from going to sleep.

> If `python3` asks to install developer tools, let it (a few minutes). If you're
> short on time, skip the phone: the control room buttons and keyboard
> shortcuts work without it.

**4. Open the streams.** Click **Open both streams on the TV**. Two clean
windows appear on the TV:
- **F1:** tv.apple.com. Sign in with your Apple account and open the US Grand Prix.
- **El Clásico:** tv.youtube.com. Start the free trial, allow location if
  asked (it needs your location for local ABC), then open **ABC**.

To use a different service (say ESPN), paste its web address into the stream's
box in the control room and press **Go**.

**5. Test it during the pregame shows** (ABC starts at 3pm ET). Press every
button once.

## Buttons

| Button | What happens | Press it again |
|---|---|---|
| F1 / El Clásico | That stream fills the TV and gets the sound. The other keeps playing silently behind it, so switching back is instant and still live. | — |
| Side by side | Half the TV each | Moves the sound to the other side |
| Picture in picture | Whichever has the sound goes big, the other goes to a corner | Swaps big and small |
| Swap sound / Mute all | What they say | — |

Keyboard (any Chrome window in front): ⌥⇧1, ⌥⇧2, ⌥⇧3 (side by side), ⌥⇧4 (picture in picture).

## If something's off

- **The streams opened on the laptop screen:** pick the TV in the *TV screen* dropdown.
- **The phone says it can't reach the Mac:** remote.py stopped. Run it again.
- **The phone says the control room isn't open:** click Matchday in Chrome's extensions menu.
- **A stream is behind live after switching:** use that player's "Live" button.
- **The menu bar takes up the top of the TV:** System Settings → Control Center →
  *Automatically hide and show the menu bar* → Always.
