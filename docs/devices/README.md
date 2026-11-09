# Devices: mobile devices in the right pane, for the user and the agent

**Status:** in progress. Started 2026-11-09 on branch `arch-echancement`.

**Owner request.** Add a **Devices** tab to the right pane that works like the Browser tab. It shows a mobile device, the
agent can see and drive it, and the user can select an element on it and send that element to the chat.

**Document map**

| File | What it holds |
|---|---|
| [01-research.md](01-research.md) | How Claude Desktop, Codex, Grok, Hermes, T3 Code, Cursor, Radon, Expo and others do it, the building blocks, and the option catalogue |
| [02-current-architecture.md](02-current-architecture.md) | What the existing Browser and Computer code gives us |
| This file | Decisions, pane design, user journeys, agent tools, architecture, phases, test plan, progress |

---

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| DV-1 | **Platforms.** v1 covers Android emulators and physical Android phones (USB or Wi-Fi debugging) on macOS, Windows and Linux, and iOS simulators on Apple-silicon Macs. Physical iPhones come later. | Android tooling runs on every OS. Apple allows simulators only on Macs, and the simulator helper is arm64-only. A physical iPhone needs a signed on-device runner. Nobody ships that today (01 §2.3) |
| DV-2 | **Android pipe.** The Node server talks to the user's `adb` server through Tango (`@yume-chan/adb`, `adb-server-node-tcp`, `adb-scrcpy`, `scrcpy`; MIT). We bundle **scrcpy-server 3.3.3** (Apache-2.0, sha256 `7e70323b…5354be0`) and push it to the device. That gives H.264 at up to 60 fps plus touch, scroll, keys and text on scrcpy's control socket. `adb` handles lifecycle, apps, URLs, logs, screenshots and the UI tree (`uiautomator dump`) | The de-facto standard. Pure JS on all three OSes, with no Bun and no ffmpeg (01 §6 B) |
| DV-3 | **iOS pipe.** `serve-sim` (Apache-2.0) runs its helper as a supervised child on **loopback only**, with no `--allow-exec`. The server proxies five of its routes: `stream.avcc`, `stream.mjpeg`, `ws` (HID), `ax` and `foreground`. `xcrun simctl` handles lifecycle, apps, URLs, logs and screenshots | Apple has no public tap or streaming API. serve-sim is the maintained helper and works on Xcode 27. Measured here (§10.1): 60 fps capture, touch, Home, keys and the accessibility tree |
| DV-4 | **No agent-device.** The owner approved it, but it brings its own background service and an XCTest runner build. serve-sim's `ax` (iOS) and `uiautomator` (Android) already give the agent an element tree | One fewer dependency and one fewer process. Revisit if Android tree reads prove too slow |
| DV-5 | **Transport.** Frames and input go through the GeneratorAI server on one authenticated WebSocket per open device view: `/api/workspaces/:id/devices/stream?device=<key>`. It uses the Browser's 16-byte frame header with two new codec ids: `2` H.264 AVCC (iOS) and `3` H.264 Annex-B (Android). A codec-config frame carries flag bit 1. JPEG (codec 0) covers seeds and fallback | The web UI can be remote (pairing, relay). One proven framing. WebCodecs decodes H.264 in Electron and Chromium |
| DV-6 | **Coordinates.** Every touch, tap, swipe and element frame is **normalised 0..1** of the screen, in both the pane and the agent tools | iOS points and Android pixels never mix (01 §5.2) |
| DV-7 | **Agent tools.** Eight `device_*` tools, registered only while device control is on: `device_list`, `device_open`, `device_close`, `device_snapshot`, `device_screenshot`, `device_act` (one or more steps: tap, long press, swipe, scroll, type, press a button, wait), `device_app` (launch, terminate, install, list, open URL) and `device_logs`. Elements are referenced as `e1…eN` from the latest snapshot | The ref model of the Browser tool and of every serious mobile toolkit. Batched steps proved essential in the computer-use work |
| DV-8 | **Agent access.** Granted per chat and per device, with a switch in the pane. It is on by default for simulators and emulators and off for physical phones. A tool call on a device without access is refused, and the pane shows "The agent asked to use <device>: Allow". **Take over** revokes access at once. `install` and `open URL` ask in the asking permission modes and are refused while planning | Follows Claude Desktop (per-device grant; URL and install follow the permission mode) and our Browser's share model. A physical phone holds real accounts |
| DV-9 | **Settings › Mobile devices.** A server-side switch, on by default. Turning it off removes the tools and stops every session. It also holds an Android SDK path override and the setup checklist. Named "Mobile devices" because "Devices" in Security already means paired clients | Same model as Computer use (live toggle; the binding key rebinds) |
| DV-10 | **Dock.** A `devices` tab type: addable from "+", up to 4 tabs, each tab its own device, `?dock=devices`. It is offered only when the surface can stream and device control is on. The agent opening a device focuses its tab | Mirrors the Browser tab |
| DV-11 | **Select element → chat.** A Select mode hit-tests the latest element tree under the pointer and highlights the element. A click attaches two files to the composer: `device-element-<ts>.json` (platform, device, OS, app, screen, the element's role, label, id, value, normalised and native bounds, ref, and its ancestor path) and `device-element-<ts>.png` (the element's crop with some context) | No product ships native pick-to-chat (01 §3). This is the differentiator |
| DV-12 | **Agent activity.** While the agent acts, the pane shows a strip ("The agent is using this device · Take over"), plus a ripple at every agent tap and a trail for every swipe, drawn from `devices.action` events | No product draws agent touches (01 §3) |
| DV-13 | **No new install burden.** The user installs Xcode and/or Android Studio (or the SDK command-line tools) as for any mobile work. The app finds `adb` and `emulator` through `ANDROID_HOME`, `ANDROID_SDK_ROOT`, the per-OS default SDK path and `PATH`. It finds `xcrun` on macOS. A setup checklist explains whatever is missing | The owner's answer: "fine for users to install" |

## 2. Pane design

The dock is about 480 px wide. The pane stacks top to bottom:

```
┌ Devices ─────────────────────────────────────────────────────────────┐
│ [▣ Pixel 9 · Android 16 ▾]  ● Running            [Agent ◉]  [■ Stop] │  row 1: device, state, agent access, power
│ [◁][○][▢]  [⟳ Rotate] [⌗ Select] [⎙ Screenshot ▾] [⋯]                │  row 2: hardware keys, tools
├──────────────────────────────────────────────────────────────────────┤
│ ✦ The agent is using this device                         [Take over] │  only while the agent acts
├──────────────────────────────────────────────────────────────────────┤
│                         ╭──────────────╮                             │
│                         │              │                             │
│                         │   live       │  ← screen, fit to pane,     │
│                         │   screen     │    rounded corners, sunken  │
│                         │   (canvas)   │    backdrop; ripples and    │
│                         │              │    the selection outline    │
│                         ╰──────────────╯    are drawn over it        │
├──────────────────────────────────────────────────────────────────────┤
│ ● live · 1080×2424 · H.264 · 58 fps          Agent can use this device│  status bar
└──────────────────────────────────────────────────────────────────────┘
```

- **Device picker.** A popover listing iOS simulators (macOS) and Android devices, grouped by platform. Each row shows the
  platform icon, name, OS version, state (Off, Starting, Running) and a kind badge (Simulator, Emulator, USB, Wi-Fi). Picking
  a device that is off starts it. The footer has "Refresh" and "Setup help".
- **Row 2.**
  - Android: Back, Home, Recents.
  - iOS: Home, Lock.
  - Both: Rotate, Select element, Screenshot (to chat or to file), and a ⋯ menu with Volume up and down, Power or Lock,
    Open URL…, Install app…, Appearance (light or dark), Logs and Restart device.
- **Screen.** A focusable canvas (`data-gai-keys="own"`):
  - Click-drag is a touch, the wheel scrolls, typed keys go to the device, and ⌘V / Ctrl+V pastes the clipboard as text.
  - An Esc press is passed to the device; Select mode ends on Esc.
- **Empty states.**
  - No device selected: a list of device cards.
  - Nothing installed: the setup checklist. It shows for each item whether it was found, with the next step per OS: Android
    SDK, adb, emulator, an AVD; on a Mac also Xcode, an iOS runtime, a simulator and Apple silicon.
  - Device control off in Settings: "Mobile devices are off" with a link to Settings.
- **States** shown in the status bar: connecting, live, reconnecting, stalled, and stopped with an error callout.
- **Design rules.** Built from `ui/` primitives (IconButton, Menu, Popover, Switch, Callout, StatusDot, EmptyState) in
  `blocks/devices`. Design utilities only, icons by concept name, and the data-gai-overlay rule for floating layers.

## 3. User journeys

1. **First use, nothing installed.** The user opens **+ › Devices**. The checklist shows what is missing on this OS, for
   example "Android SDK not found: install Android Studio, then create a virtual device in Device Manager". **Refresh**
   re-checks.
2. **The user tries the app on a device.** The user picks "Pixel 9 · Off". The device starts (about 20–60 s, shown as
   Starting) and the screen streams. The user taps, scrolls and types on it, and the hardware keys work.
3. **The agent tests on a device.** The user writes "Build the app and check login on the iPhone simulator".
   1. The agent calls `device_list`, then `device_open`. The Devices tab opens on that device.
   2. The agent installs and launches the app (`device_app`), reads the screen (`device_snapshot`) and taps and types
      (`device_act`).
   3. The pane shows the strip and a ripple at every tap. The agent checks the result with another snapshot and reports
      back.
4. **Select an element, then ask for a fix.** The user turns on **Select** and hovers: each element is outlined with its
   label. A click adds `device-element-….json` and its `.png` crop to the composer. The user writes "this button is clipped,
   fix it", and the agent reads the element (role, id, bounds, app) and the crop.
5. **Physical Android phone.** The user plugs in a phone with USB debugging on and accepts the RSA prompt on the phone. It
   appears as "USB". Agent access starts **off**; the user turns it on for this chat.
6. **Take over.** The user clicks **Take over**, and the agent's access for this chat is revoked at once. The agent's next
   call is refused with "The user took over this device". The user turns Agent back on when ready.
7. **Failures.**
   - A device that fails to start: an error callout with the last lines of its log, plus **Retry**.
   - A dropped connection: "Reconnecting…" over the last frame, then up to 6 retries.
   - A device unplugged: "Device disconnected".
   - The agent calls a tool with no device open: told to call `device_open`.

## 4. Agent tools

| Tool | Arguments | Returns |
|---|---|---|
| `device_list` | none | Devices with key, name, platform, OS, kind, state and `agentAccess`; the device open in this chat; tooling problems |
| `device_open` | `device` (key or name), `boot?` (default true) | Boots if needed, opens the pane on it. Returns the screen size and the foreground app |
| `device_close` | `device?`, `shutdown?` | Detaches; shuts the device down only when asked and only if this chat started it |
| `device_snapshot` | `device?`, `all?` | The foreground app and lines like `e4 Button "Sign in" @ 0.12,0.80 0.76x0.06`. Interactive and labelled elements only, unless `all` |
| `device_screenshot` | `device?`, `annotate?` | A JPEG file in the workspace (downscaled). `annotate` draws the snapshot refs |
| `device_act` | `device?`, `steps[]`. Each step is `{tap: ref or x,y}`, `{long_press}`, `{swipe: from, to or direction}`, `{scroll: direction, ref?}`, `{type: text, ref?, submit?}`, `{press: home, back, recents, enter, delete, lock, volume_up, volume_down}` or `{wait: ms or text}` | Per-step results, then a short diff of the snapshot: added, removed and changed elements |
| `device_app` | `action`: launch, terminate, install, list, open_url; `app?` (bundle id or package), `path?`, `url?` | The result. `install` and `open_url` ask in the asking modes |
| `device_logs` | `device?`, `app?`, `lines?` (default 200), `level?` | Recent log lines (logcat, or `log show` for the simulator) |

A `devices` system hint explains the ref model and the batching rule ("use `device_act` with several steps, then read its
diff"). No separate skill: the hint and the tool descriptions carry the whole manual (a staged skill can follow if flows
prove to need one).

## 5. Architecture

```
web (apps/web)                         server (apps/server)                    core (packages/core)
blocks/devices/DevicesPanel ──HTTP──▶ routes/devices.ts ─────────────────▶ services/DeviceService
  toolbar, picker, setup                                                     ├─ sessions per workspace+device
  DeviceScreen (canvas,     ◀─WS──── device-ws.ts (frames ▶, input ◀) ──▶  │   (stream fan-out, refs, access)
   WebCodecs H.264/JPEG)                                                     ├─ infrastructure/devices/
  select overlay, ripples   ◀─SSE─── stream broker `devices.*` events       │    AndroidBridge (Tango + adb)
features/chat: dock entry                                                    │    IosSimulatorBridge (simctl +
features/settings: Mobile devices                                            │      serve-sim helper on loopback)
                                                                             └─ tools/devices/* (8 tools)
                                                      PlatformToolBinder.devices() binds tools + hint
```

- **Port.** `domain/ports/IDeviceBridge.ts` defines one interface per platform:
  - `status()`, `list()`, `boot()`, `shutdown()`, `screenshot()`, `snapshot()`;
  - `openStream(device, sink)`, which returns a handle with `input()` and `close()`;
  - `input(device, event)` and `app(device, action)`;
  - `logs(device, options)`.
- **DeviceService.** Owns:
  - discovery, merged across bridges and cached for 2 s;
  - the per-chat open device and its access grants;
  - one producer per device stream, fanned out to every watcher (the Computer preview pattern);
  - the latest snapshot's refs;
  - the action log, published as `devices.action` events for ripples;
  - stopping everything on workspace delete and on Settings off.
- **Process safety.**
  - The serve-sim helper runs as its own process: a native crash cannot take the server down (in-process loading hung
    the Node main thread during the probe, §9.1).
  - It binds `127.0.0.1` only, is killed on dispose, and runs without `--allow-exec`.
- **Auth.** A new `exec:device` scope, granted where `exec:browser` is. It applies to the routes and the WebSocket.
- **Packaging.**
  - `serve-sim` is a runtime package of the server (external to the bundle, staged into `resources/server/node_modules`).
  - scrcpy-server ships in `apps/desktop/resources/scrcpy/`.
  - The Tango packages are plain JS and are bundled.

## 6. Phases

| Phase | Scope | Done when |
|---|---|---|
| DV-P1 Core | Port, bridges, service, tools, hint, skill, settings, routes, WS, scope, wiring, packaging | Unit tests pass. A tsx harness against a live emulator and simulator lists, boots, streams, taps, snapshots and screenshots |
| DV-P2 Pane | Dock type, panel, picker, setup checklist, screen with decode and input, hardware keys, rotate, screenshot, agent strip, ripples, Select → chat, Settings section | typecheck, lint and check:design pass. Walkthrough in the dev app on both platforms |
| DV-P3 Agent end to end | A chat drives the device through the tools; the pane follows | One Android and one iOS task run through a chat in the installed app |
| DV-P4 Release | Clean release, package, install, test in the installed app | Owner rule: every fix ends in a fresh release that is installed and tested |

## 7. Test plan

- **Unit.**
  - The uiautomator XML parser and the iOS accessibility normaliser.
  - Ref assignment and snapshot diff.
  - Normalised coordinate mapping, including rotation.
  - Envelope and header parsing, and the US key map for iOS typing.
  - The tool argument validation.
  - The binding key including devices.
- **Live, using the tsx harness against the running server code.**
  - Discovery on this Mac.
  - Boot `gai-phone` and the "GAI Devices Test" simulator.
  - Stream frames (fps and first-frame time).
  - A tap that changes the screen, typing into a field, Home and Back.
  - Snapshot refs, screenshot and logs.
- **In the app.** The pane in the dev server via playwright-cli (1440×900, three themes, keyboard pass), then the
  installed release. An agent chat with GPT-5.6-Terra or Sonnet runs the journeys in §3. Test devices only: never the
  owner's own simulators' data, and only the `gai-*` AVDs and the "GAI Devices Test" simulator.
- **Cross-OS.** Android code paths are shared and use `path` and `os` APIs. Windows and Linux runs are listed in the
  backlog, since this machine is a Mac.

## 8. Progress

| Step | State |
|---|---|
| Research (01) and code analysis (02) | done |
| Decisions, design, journeys, tools, architecture (this file) | done |
| Feasibility probes (§10.1) | done |
| DV-P1 Core | done (d3514d70) |
| DV-P2 Pane | done (e6f2efb5); walkthrough in progress |
| DV-P3 Agent end to end | — |
| DV-P4 Release and install | — |

## 9. Build notes

- **Dock type is web-only.** `devices` is a `ChatDockTabType` like side chats, not a shared `DockTabType`: the mobile app
  keys its pane registry exhaustively by `DockTabType` and is out of scope.
- **The simulator helper detaches.** `serve-sim --no-preview` starts its helper as a separate daemon; a second request for
  a simulator already served reuses that helper (our child prints its address and exits 0). The bridge keeps the address
  and restarts only when it stops answering; dispose runs `serve-sim --kill`.
- **iOS 27 on a loaded machine.** The first boot of a simulator can sit on the Apple logo or a black screen for minutes
  after `bootstatus` reports done, and its accessibility service answers "no frontmost application" until an app is
  launched. The pane shows the stream as soon as frames arrive; the agent's snapshot retries once on an empty tree.
- **Android emulators boot headless with SwiftShader** and cold-boot when their snapshot was saved with another renderer.

## 10. Evidence

### 10.1 Feasibility probes (2026-11-09, this Mac: macOS 27, Xcode 27.0, iOS 27 runtime, Android emulator 37)

- `simctl io screenshot`: 1.8–3.6 s per frame under load. Too slow for a live view.
- `simctl io recordVideo` to stdout: "rendering to standard out is no longer supported".
- serve-sim native capture:
  - starts in about 0.3–0.9 s;
  - JPEG snapshot in 24–180 ms;
  - H.264 AVCC frames on change, with a 5 fps idle floor.
- serve-sim helper on loopback answered `config`, `health`, `ax`, `foreground`, `stream.mjpeg` and `stream.avcc` (seed
  envelope tag `0x04`).
  - The accessibility tree of Settings came back with roles, labels and frames in points (402×874).
  - Home took 2–11 ms.
  - A normalised tap opened Settings and focused its search field, and a HID key typed into it on iOS 27 with Xcode 27.
- Loading the serve-sim addon in-process: a HID call hung Node's main thread → it runs as a separate process (DV-3).
- Android on the freshly booted `gai-phone` under load:
  - `screencap` 0.9–1.7 s and `input tap` 0.4–0.6 s;
  - `uiautomator dump` 12–17 s, while the first boot was still optimising (to be re-measured settled);
  - `screenrecord` H.264 to stdout works.
- Claude Desktop on this Mac carries feature flags `iosSimulator`, `androidEmulator`, `iosSimulatorH264` and
  `iosSimulatorAccessibilityReader`, all rolled out off: the same feature, in development.
