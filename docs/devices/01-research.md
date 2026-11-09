# Devices tab research: how agentic apps see and drive mobile devices (as of 2026-11-09)

How sources are marked:
- **[V]** I checked it against a primary source: official docs, the repo, the npm registry or the GitHub API.
- **[S]** It comes from a secondary source (news, blog, aggregator, a third-party mirror of GitHub issues).
- **[I]** It is my inference or prior knowledge and was not checked again this session.

I installed nothing and ran no device tooling. The only things I ran were `curl` reads of the npm registry, the GitHub API and raw files.

---

## 0. Summary

1. **Claude Code Desktop ships the reference pattern for iOS.** It has an "iOS Simulator" pane next to the chat [V]. The pane streams the simulator live, and the user can tap into it while Claude drives the same device. A "Claude is using this device" badge shows while Claude acts. Consent is given once per device, and opening URLs, building and installing still follow the session's permission mode. A managed setting turns the agent tools off. The pane is macOS-only, simulators only, with no physical devices. Under the hood a bundled `claude-ios-sim` helper loads Apple's private SimulatorKit through idb's FBControlCore and injects touches through the simulator's "Legacy HID port". The pane broke when Xcode 27 moved that framework [V, from GitHub issue #79991]. An Android emulator pane has been found in the app's code behind a rollout flag, but it has not been announced [S].
2. **T3 Code is the closest match to GeneratorAI.** It is an Electron app with a React web UI and a Node server, MIT-licensed, and it already ships a **Device panel** for iOS Simulators and Android Emulators [V, from its repo docs]. The split is:
   - **streaming:** `expo-device-hub` (serve-sim for iOS, serve-emu for Android), run as a supervised child process bound to loopback, behind an authenticated allowlist proxy.
   - **driving:** the `agent-device` CLI (Callstack, MIT).
   - **agent surface:** a deliberately small MCP toolkit: `device_list`, `device_open`, `device_screenshot`, `device_close`.

   Setup is a three-step opt-in wizard, and agent access is a separate grant from manual use.
3. **Codex mirrors the simulator into its in-app browser.** It does this with `serve-sim` (Evan Bacon, Apache-2.0) and drives it through XcodeBuildMCP, now renamed MobileBuildMCP, which uses AXe [V/S]. Android support comes through Google's official Android CLI plugin [V]. Codex has no native device pane.
4. **Grok Build, Hermes, Cursor and Windsurf have no device pane.**
   - Cursor and Codex fall back to macOS computer use on the Simulator window.
   - Hermes has community Android bridges only.
   - Grok Build has nothing.
5. **The building blocks have converged:**
   - **Android:** scrcpy H.264, decoded with WebCodecs, with input on scrcpy's control socket.
   - **iOS Simulator:** private SimulatorKit/CoreSimulator frame capture plus HID injection (serve-sim, AXe, idb, Claude's helper). There is no public tap API.
   - **Agent observation:** an accessibility tree with short refs (`@e1`, `e9`), re-snapshotted after each action, with a screenshot as backup. Every major toolkit converged on this: agent-device, MobileBuildMCP `snapshot_ui`, mobile-mcp, Android CLI `layout`, Maestro `inspect_screen`.

**Recommendation in one line:** follow T3's architecture, but own the Android pipe in-process (Tango `@yume-chan/*` plus a vendored scrcpy-server). That works on all three OSes and needs no Bun or ffmpeg. Use serve-sim as a supervised child for iOS on macOS, use `agent-device`'s Node API behind our own `device_*` tools for the agent, and treat physical iOS as "later". Details are in §5.

---

## 1. Products

| Product | Device feature? | Discovery and lifecycle | Screen to user | Agent observation | Agent actions | Element pick / send to chat | Consent | Sources |
|---|---|---|---|---|---|---|---|---|
| **Claude Code Desktop** (macOS) | **Yes**, iOS Simulator pane, public beta [V] | Device menu lists every simulator with its OS version and booted state. Picking one boots it. "Attach" and "Detach simulator" buttons. Shuts down devices it booted after 10 min detached, or on quit or archive. Never shuts down devices the user booted. Uses the Xcode chosen by `xcode-select` [V] | Live stream with a **Display** menu (frame rate, resolution). Up to 4 panes. Can minimize or close and keep running [V] (four-pane limit is [S]) | "Reads the screen", meaning screenshots (sent to Anthropic). The mechanism is undocumented. The helper error mentions an "inspect" feature [S] | Tap, swipe, type, screenshots. Build, install and launch. Open URLs on the device [V] | Not documented. User workaround is to tap to a screen and then ask | One-time consent per device covering control and screenshots. URL open, build, install and launch follow the permission mode. Badge "Claude is using this device". `disableMobileSimulatorTools` managed setting. VM-sandbox policy disables the pane. No macOS Accessibility or Screen Recording permission needed [V] | [docs](https://code.claude.com/docs/en/desktop-ios-simulator), [issue #79991](https://github.com/anthropics/claude-code/issues/79991), [iClarified](https://www.iclarified.com/101541/cla), [9to5mac](https://9to5mac.com/2026/07/21/claude-code-brings-live-ios-app-testing-into-its-mac-app/) |
| Claude Code Desktop, Android | Hidden. "Settings → Claude Code → Mobile simulators → Android Emulator" toggle gated by `android_rollout_disabled` [S] | n/a | n/a | n/a | "ADB controls" [S] | n/a | n/a | [RuntimeWire](https://runtimewire.com/article/claude-desktop-is-ready-to-test-android-apps-whenever-anthropic-flips-the-switch) |
| Claude Code CLI | No pane. Uses computer use on the Simulator window (macOS only). Desktop computer use runs on macOS and Windows [V] | n/a | User watches the real window | Downscaled desktop screenshots | Mouse and keyboard | No | Per-app approval each session. Esc aborts. Single-session lock. Accessibility and Screen Recording TCC prompts [V] | [computer-use docs](https://code.claude.com/docs/en/computer-use) |
| Claude for Chrome | Web only | | | | | | | |
| **OpenAI Codex app / CLI** | Partly, through plugins. **Build iOS Apps** plugin, open source [V/S] | Simulator UDID from `simctl` and XcodeBuildMCP | `ios-simulator-browser` skill starts `npx serve-sim <UDID>` and opens its URL in Codex's in-app browser. The skill must confirm a real frame is rendering. Never run an unscoped `--kill` [V] | XcodeBuildMCP / MobileBuildMCP `snapshot_ui` (accessibility tree with refs) plus screenshots [V/S] | Build, launch, tap, swipe, type, logs, debugger (through MobileBuildMCP). Android through the official **Android CLI** plugin [V] | serve-sim has an accessibility bridge. No pick-to-chat found | Plugin install. Computer use plugin needs Screen Recording and Accessibility [S] | [plugin](https://github.com/openai/plugins/tree/main/plugins/build-ios-apps), [SKILL.md](https://raw.githubusercontent.com/openai/plugins/main/plugins/build-ios-apps/skills/ios-simulator-browser/SKILL.md), [aicatchup](https://aicatchup.com/news/codex-build-ios-apps-plugin), [Android agents](https://developer.android.com/tools/agents) |
| **xAI Grok Build** | **No device feature found.** Terminal coding agent (beta from May 2026) with plan mode, subagents, headless mode and ACP [S] | | | | | | | [alternativeto](https://alternativeto.net/news/2026/5/xai-launches-grok-build-in-beta-a-powerful-coding-agent-and-cli-for-advanced-engineering/), [codersera](https://codersera.com/blog/xai-grok-build-skills-connectors-guide-2026/) |
| **Nous Hermes Agent / Hermes Desktop** | **No first-party device pane.** Runs on Android itself through Termux (browser tooling experimental there) [S]. Community **hermes-android**: phone-side app using an AccessibilityService, connecting out over a WebSocket relay, with 42 `android_*` tools (screenshot, open apps, list apps) [S]. Hermes-Relay and FlipsiBridge are similar [S] | | | Accessibility service tree plus screenshots | Tap, type, swipe, open apps | No | Install the phone app and enable the accessibility service | [termux doc](https://hermes-agent.nousresearch.com/docs/getting-started/termux), [hermes-android](https://github.com/raulvidis/hermes-android) |
| **T3 Code** (Electron, MIT) | **Yes**, Device panel for iOS Simulators and Android Emulators. Merged as PR #10677 on 2026-09-10 [V] | Lists running simulators (including never-booted ones) and stopped AVDs. **Start** boots with progress. Power off. Device hosts: local, **SSH machine** (macOS or Linux), **EAS Simulator** (billed cloud sessions), **Simlock pool** (alpha) [V] | iOS: AVCC/H.264 over HTTP decoded with WebCodecs, falling back to MJPEG or WebRTC. Android: SEMU-framed H.264 plus JSON gestures on one WebSocket. Only the visible tab streams. Tabs per device. "Float device over chat". 3D device-frame view (glb models). Foldable and Duo controls [V] | Agent uses the `agent-device` CLI (accessibility snapshot with refs) plus a `device_screenshot` PNG [V] | Through `agent-device`: tap, type, swipe, install, launch. The MCP toolkit has only `device_list`, `device_open`, `device_screenshot` and `device_close`. `device_open` returns a pinned CLI launcher [V] | Not found. A Tools drawer can overlay accessibility element frames on the screen [V] | Three-step opt-in wizard: enable hub, check tools, then optionally grant agent control. Agent access is a separate toggle. Helpers bind loopback. Authenticated allowlist proxy. Shell-exec routes never proxied. Typed `device.action` RPC instead [V] | [internals](https://github.com/pingdotgg/t3code/blob/main/docs/internals/devices.md), [user doc](https://github.com/pingdotgg/t3code/blob/main/docs/user/devices.md), [PR #10677](https://github.com/pingdotgg/t3code/pull/10677) |
| **Cursor** | No embedded simulator. A forum request from Sep 2026 asks for "Claude's in-window version". Agents got **computer use** for desktop apps including the iOS Simulator (reported 2026-10-23) [S]. The Cursor iOS app is a remote control for agents | | | Screenshots | Mouse and keyboard | No | OS permissions on self-hosted Macs [S] | [forum](https://forum.cursor.com/t/ios-simulator-support/172452), [RuntimeWire](https://runtimewire.com/article/cursor-agents-computer-use-desktop-apps) |
| **Windsurf / Devin Desktop** | Web preview only, with element selection sent to Cascade. No mobile feature [S] | | | | | Web only | | [previews](https://docs.windsurf.com/windsurf/previews) |
| **Xcode 26.3 / 27** | 26.3 brings Claude Agent and Codex in-IDE, and `xcrun mcpbridge` exposes Xcode over MCP: build, test, `RenderPreview`, docs. No simulator UI tools in the reported list [S]. Xcode 27 replaces Simulator.app with **Device Hub**: one list of simulators and physical devices, screenshots, rotate, accessibility and appearance toggles, multitouch. Reports say agents "validate their work" [S]. Device Hub broke tools that relied on Simulator.app or SimulatorKit paths (Claude, Expo, Tuist) [S/V] | | | Previews rendered through `RenderPreview` | | | | [TechCrunch](https://techcrunch.com/2026/02/03/agentic-coding-comes-to-apples-xcode-26-3-with-agents-from-anthropic-and-openai/), [macbox](https://macbox.build/guides/xcode-mcp-servers/), [InfoQ](https://infoq.com/news/2026/06/xcode-27-agents-device-hub), [Expo blog](https://expo.dev/blog/xcode-27-device-hub-expo-device-hub) |
| **Android Studio / Android CLI** | **Journeys**: natural-language end-to-end tests that Gemini executes on a device (experimental, I/O 2025) [V]. **Android CLI**, an official plugin for Claude Code, Codex and Antigravity, has `emulator create/start/stop`, `layout` (JSON tree), `screen capture --annotate` (numbered boxes), `screen resolve "#3"`, `input tap/swipe/text/key/scroll`, `install`, `run` and `device remote` (cloud physical devices over ADB-over-SSL) [V]. Android Studio's embedded emulator and Running Devices are known IDE patterns [I] | | Studio: embedded emulator. CLI: none | `layout`: interactive-only by default, `--full` for everything. Fields: text, resource-id, content-desc, interactions, state, bounds, center, off-screen, hidden. Annotated screenshot is the fallback [V] | Coordinate taps through `adb input` or `android input` [V] | Studio has the Layout Inspector [I] | | [android-cli skill](https://github.com/android/skills/blob/main/devtools/android-cli/SKILL.md), [blog Oct 2026](https://android-developers.googleblog.com/2026/10/android-cli-device-streaming-and-skills.html), [I/O 2025](https://android-developers.googleblog.com/2025/05/google-io-2025-whats-new-in-android-development-tools.html) |
| **Radon IDE** (Software Mansion; VS Code, Cursor, Windsurf; commercial, closed core) | Yes, iOS Simulator and Android emulator embedded in the editor. A closed-source "simulator-server" binary talks to the extension over stdio [S]. Windows and Linux are beta [S] | Manage devices (create, delete, select). Device settings: appearance, location, permissions, text size [V] | Zoom presets. Screenshot. Recording. **Replay** of the last few seconds. Logs. URL bar for deep links and routes. Reload menu (JS reload, restart process, reinstall, rebuild, clean, reboot device) [V] | Radon AI MCP tools: `view_screenshot`, `view_component_tree`, `view_application_logs`, `view_network_logs`, `view_network_request_details`, `reload_application`, `query_documentation`, `get_library_description` [V] | Reload and rebuild only. No tap tools [V] | **Element inspector**: click the preview to jump to the React component's source line, right-click to choose from the React tree. Native View Hierarchy tab with hover-highlight and an element picker [V/S] | Licence-based | [features](https://radon.swmansion.com/features), [panel](https://radon.swmansion.com/docs/getting-started/panel-interface), [Radon AI](https://radon.swmansion.com/docs/features/radon-ai) |
| **Expo** | `expo-device-hub` (MIT on npm, pre-1.0): a browser dashboard with live video of iOS simulators and Android emulators, tap, swipe and type, boot and shutdown, CPU, memory and network graphs, appearance, Liquid Glass, text size and accessibility toggles [V]. **EAS Simulator**: remote iOS and Android in the cloud, also for Linux and Windows users, driven through agent-device, Argent or Appium, limited preview [V] | | H.264 locally, WebRTC remotely. MJPEG, VP8 or VP9 where available [V] | Accessibility tree (EAS) [V] | | | | [Expo blog](https://expo.dev/blog/xcode-27-device-hub-expo-device-hub), [EAS Simulator](https://docs.expo.dev/preview/eas-simulator/introduction.md) |
| **Replit** | Cloud iOS Simulator or Android Emulator streamed into the Preview panel. Mouse and keyboard input. Hot reload from the Agent. Agent control not documented [V] | | Cloud stream | ? | ? | No | | [docs](https://docs.replit.com/replitai/building-mobile-apps) |
| Rork / Bolt / v0 | Rork: cloud simulator next to the chat [S, vendor comparison]. Bolt: Expo Go on the phone [S]. v0: no mobile preview found [S] | | | | | | | [vp0](https://vp0.com/blogs/rork-vs-bolt) |
| Maestro Studio (desktop, macOS, Windows, Linux) | Device mirror with a visual element inspector. Right-clicking an element generates YAML commands [S] | | | | | **Point-and-click inspector that produces selectors**, a good model for pick-to-chat | | [docs](https://docs.maestro.dev/getting-started/maestro-studio-1) |

---

## 2. Building blocks

### 2.1 Android

| Block | What it gives | Latency / fidelity | Licence | Host OS | Physical device? | Notes |
|---|---|---|---|---|---|---|
| `adb` (platform-tools): `exec-out screencap -p`, `input tap/swipe/text/keyevent`, `uiautomator dump`, `am start -d <url>`, `pm`, `logcat`, `cmd uimode night`, `settings put system font_scale`, `pm grant` | Everything, simply | screencap about 150–500 ms. `uiautomator dump` about 1–3 s and fails while animating. `input` adds ~100 ms per call [I] | Apache-2.0 (AOSP) | All 3 | Yes, over USB or Wi-Fi (RSA authorize prompt) | Baseline for lifecycle, logs and settings. Too slow as the stream or for fast input |
| **scrcpy** 4.0 (May 2026), 5.0.1 (Oct 2026) | `scrcpy-server` jar pushed to `/data/local/tmp`, started through `app_process`. Separate video, audio and control sockets over `adb reverse` (port 27183) or `forward`. 12-byte frame header with PTS and config/key flags. Codecs H.264, H.265, AV1. Binary control messages for keys, text, touch, scroll, clipboard and screen power. Server and client versions **must match exactly** [V] | About 35–70 ms, 60 fps, native resolution [I] | Apache-2.0 [V] | All 3 | **Yes, without root** | The de-facto standard. 4.0 added flex display (virtual display resizes with the window), `--keep-active` and SDL3 [S] |
| **Tango / ya-webadb** `@yume-chan/adb` 2.6.4, `adb-server-node-tcp`, `adb-scrcpy` 2.3.2, `scrcpy` 2.3.0, `scrcpy-decoder-webcodecs` 2.5.3 (a 3.0.0-beta adds scrcpy 4.x and 5.x support) | ADB protocol in TypeScript. Talks to the local adb server from Node through `net`. Pushes and starts scrcpy. Parses the video stream. Serializes control messages. WebCodecs renderer in the browser [V] | Same as scrcpy | **MIT** [V] | All 3 (pure JS) | Yes | Best fit for an in-process Node and Electron Android pipe. Pin the scrcpy-server version to the library version |
| ws-scrcpy (NetrisTV) | Node server plus a browser player for scrcpy | Good | MIT [V] | All 3 | Yes | Older reference design [I] |
| `serve-emu` 0.1.0 (Oct 2026) | Vendored scrcpy-server v4.0, an adb forward, H.264 over WebSocket to a WebCodecs canvas. Input on scrcpy's control socket. REST API: `/api/tap`, `swipe`, `text`, `key` (normalized 0..1 coordinates), `/api/accessibility`, `/api/accessibility/tap {selector}`, `/api/screenshot`, `/api/logcat` (SSE), orientation, night mode, font scale, network, GPS route playback, APK install, session record and replay. Loopback by default. Token required for LAN binds. Origin checks [V] | 60 fps. The emulator's *software* H.264 encoder holds 60 fps only below about 1 MP, hence `--max-size 1280` by default [V] | Apache-2.0 [V] | All 3, but **the CLI runs on Bun 1.3.13+**. No JS import surface (CLI-only) [V] | Yes | T3 says emulator video in its hub build **needs `ffmpeg` with libx264**, while physical devices use scrcpy [V] |
| Emulator **gRPC** (`emulator -grpc <port>`, `EmulatorController.proto`: `getScreenshot`, `streamScreenshot`, `sendTouch`, `sendKey`, `sendMouse`, plus a WebRTC module) | Direct frame stream and input to the emulator, also headless. `android-emulator-webrtc` 2.0.1 is a React component (Apache-2.0) [V/S] | Raw frames are very low latency on loopback. WebRTC needs UDP or TURN [S] | Apache-2.0 | All 3 | **Emulator only** | Android Studio's embedded emulator uses gRPC with token auth, and running emulators publish their port and token in discovery `.ini` files [I, re-verify before relying on it]. Avoids the software-encoder limit |
| UIAutomator2 / Appium | Accessibility tree XML, selectors, gestures | Tree takes hundreds of ms; Appium session start is slow | Apache-2.0 | All 3 | Yes | Heavy (Java plus a server). Fits tests better than an interactive pane |
| On-device accessibility helpers: mobilecli `DeviceServer` (holds the UiAutomation connection), agent-device's Android snapshot helper, droidrun/mobilerun Portal APK (AccessibilityService, TCP or ContentProvider) [V/S] | A fast accessibility tree without `uiautomator dump` | Fast (tens of ms) [I] | mobilecli FSL-1.1-ALv2 (see licence warning below). agent-device MIT. mobilerun MIT [V] | All 3 | Yes | Portal-style apps need the user to enable an accessibility service |

**Recommendation for Android:**
- **Streaming:** scrcpy H.264, driven from Node with Tango (`@yume-chan/adb-server-node-tcp` + `@yume-chan/adb-scrcpy`, vendored `scrcpy-server`), decoded in the renderer with WebCodecs.
  - Fallback 1: MJPEG or PNG frames.
  - Fallback 2, emulator-only: gRPC `streamScreenshot` when the encoder is too slow.
- **Input:** the scrcpy control socket for touch, scroll, key and text, plus `adb shell` for anything scrcpy lacks (`am start -d`, `pm`, `settings`).
- **Observation:** the agent-device Android snapshot, or our own UiAutomation helper, giving an accessibility tree with refs. Fallback: `uiautomator dump`, then a screenshot annotated with numbered boxes (the Android CLI pattern).

### 2.2 iOS Simulator (macOS host only; an Apple constraint)

| Block | What it gives | Latency / fidelity | Licence | Notes |
|---|---|---|---|---|
| `xcrun simctl` (public) | `list --json`, `boot/shutdown/erase`, `io <udid> screenshot`, `io recordVideo` (to a file, not a live stream), `openurl`, `install`, `launch` (with console), `terminate`, `privacy grant/revoke`, `ui appearance`, `location set`, `push`, `status_bar override`, `addmedia`, `spawn log stream` [I] | Screenshot about 100–300 ms [I]. No live stream. **No tap or type API** | Apple tooling | Lifecycle, settings and logs. Xcode 27 moved the GUI to Device Hub, but simctl remains [S] |
| **idb** (now `meta/idb`, active as of Nov 2026, MIT) | `idb_companion` (FBSimulatorControl, using SimulatorKit and CoreSimulator private frameworks): HID tap, swipe, text, buttons, accessibility (`ui describe-all`), video stream [V/S] | Good | MIT [V] | Brew prebuilt needs **arm64, macOS 15+, Xcode 26+** [S]. Python client `fb-idb`. Claude's helper uses FBControlCore [V] |
| **AXe** (Cameron Cooke, MIT, brew) | One binary on a pinned idb fork. `describe-ui [--point x,y]` (accessibility JSON). `tap` by x/y, `--id`, `--label` or `--value` (with `--wait-timeout`). `swipe`, `drag`, `touch --down/--up`, `gesture` presets, `button home/lock/side-button/siri/apple-pay`, `type` (US keyboard), `key`, `key-combo`, `screenshot`, `record-video`, **`stream-video --format mjpeg/raw/ffmpeg/bgra --fps 1–30`** to stdout, and `batch` (one HID session) [V] | Stream capped at 30 fps MJPEG | MIT [V] | Supports Xcode 26 and 27 (Device Hub, no Simulator.app needed) [V]. MobileBuildMCP runs its UI automation through AXe (`.axe-version` 1.8.0, `ui-automation/shared/axe-command.ts`) [V] |
| **serve-sim** 0.1.49 (Evan Bacon, Expo) | Swift helper per device: framebuffer to **60 fps H.264 (AVCC)** or MJPEG, plus a WebSocket for touch, gestures, buttons, keyboard and rotate. Native MP4 recorder. Accessibility bridge. WebKit DevTools. Log forwarding. Camera injection. Connect-style `simMiddleware()`. CLI `gesture/button/type/rotate/record` [V] | Best available for simulators | **Apache-2.0** [V] | **Apple Silicon only, Node 20+**. Xcode 27 keyboard input needs Device Hub frontmost **plus an Accessibility TCC grant** [V]. It has an `/exec` shell route, off unless `--allow-exec`. T3 says its token is readable from the unauthenticated `/api`, so **never expose the helper; proxy an allowlist** [V] |
| WebDriverAgent / XCUITest (Appium driver) | XCTest runner app: accessibility tree, taps, typing, works on simulator and device | Slower, about 0.3–1 s per action [I] | BSD-3 [I] | Needs xcodebuild to build the runner. agent-device builds an XCTest runner on first use, which takes "a couple of minutes once per server" [V] |
| Screen capture of the Simulator.app window | Works with no private APIs | OK | n/a | Needs Screen Recording TCC, ties up the user's screen and breaks on Xcode 27 (no Simulator.app). Claude explicitly avoids it in Desktop [V] |

**Recommendation for the iOS Simulator:**
- **Streaming:** serve-sim's H.264 helper, run as a supervised child on loopback and proxied by our server. This is the T3 pattern. Fallback: AXe `stream-video --format mjpeg`, or `simctl io screenshot` polling.
- **Input:** serve-sim's WebSocket for the user, so latency is minimal. For the agent, AXe or agent-device, both working by selector or ref.
- **Observation:** an accessibility tree (agent-device snapshot, or AXe `describe-ui`) with refs, plus a downscaled screenshot.
- **Plan for Xcode-version breakage:** every tool on private SimulatorKit broke on Xcode 27 betas. Pin versions, run a "doctor" check, and degrade to screenshots.

### 2.3 Physical devices

| | Android | iOS |
|---|---|---|
| Possible? | **Yes, and cheap**: scrcpy plus adb need only USB debugging and an RSA authorize prompt. On Windows the OEM or Google USB driver may be needed [I] | **Hard.** Streaming needs an on-device XCTest/WDA agent (mobilecli/DeviceKit, WDA MJPEG) or QuickTime-style capture. Input needs a signed XCTest runner (development team; a free Apple ID gives short-lived profiles [I]) and Developer Mode. iOS 17+ needs a RemoteXPC tunnel (go-ios `sudo ios tunnel start`) [S] |
| Tooling | adb, scrcpy, Tango | `devicectl` (install, launch, info; Xcode), **go-ios** (MIT [V]), **pymobiledevice3** (**GPL-3.0** [V]: keep it out of the bundle), WDA, mobilecli (FSL) |
| Who ships it | Android CLI `device remote` (cloud), mobile-mcp, agent-device, serve-emu, T3 (physical Android through scrcpy) [V] | Claude: **no** [V]. T3: open feature request [S]. Expo: "physical iOS streaming not in this release" [V]. Xcode 27 Device Hub views paired devices, but third-party streaming is not available [S] |

**Recommendation for physical devices:** Android is a "should-have", because it comes almost free with the scrcpy pipe. Physical iOS is "later".

### 2.4 Cross-platform agent toolkits / MCP servers

| Toolkit | Tools | Observation | Element refs | Host OS | Licence |
|---|---|---|---|---|---|
| **agent-device** (Callstack) 0.21.36, Node ≥ 22.12 | CLI, `agent-device mcp` (stdio) and a typed Node API (`createAgentDeviceClient`). `open`, `snapshot -i`, `press @e2 --settle`, `fill @e7 "Ada"`, `screenshot`, `close`, `doctor`, `capabilities` … [V] | Accessibility text lines `@e2 [button] "Add"`. After `--settle` it returns a **diff** (+, −, =) [V] | `@eN`, valid only for the latest snapshot [V] | macOS (iOS, Android), Linux (Android); Windows not stated [V] | MIT [V] |
| **MobileBuildMCP** (formerly XcodeBuildMCP, Sentry) 2.7.1 | 67+ tools: build, run, test, logs, debug. UI: `snapshot_ui`, `tap`, `swipe`, `drag`, `type_text`, `key_press`, `button`, `gesture`, `long_press`, `touch`, `screenshot`, `wait_for_ui`, `batch` [V] | Accessibility tree with refs (v2.6+) [S] | `e9`-style refs [S] | macOS 14.5+ | MIT [V] |
| **mobile-mcp** (mobile-next) 1.0.16 | `mobile_list_available_devices`, `mobile_take_screenshot`, `mobile_list_elements_on_screen`, `mobile_click_on_screen_at_coordinates`, `mobile_double_tap_on_screen`, `mobile_long_press_on_screen_at_coordinates`, `mobile_swipe_on_screen`, `mobile_type_keys`, `mobile_press_button`, `mobile_open_url`, `mobile_launch_app`, `mobile_install_app`, `mobile_terminate_app`, `mobile_clear_app_data`, `mobile_set_orientation`, `mobile_set_location`, `mobile_clipboard`, `mobile_get_device_logs`, `mobile_list_crashes`, `mobile_start_screen_recording`, `mobile_batch_commands`, cloud allocation … [V] | "Accessibility-first", with screenshot fallback [V] | Coordinates or element ref [V] | iOS on macOS. Android on all 3 [V] | Apache-2.0, **but built on mobilecli (FSL-1.1-ALv2)** [V] |
| mobilecli | `devices`, `screenshot`, `dump ui`, `screencapture --format mjpeg/h264`, `io tap/longpress/button/text`, `device boot/shutdown/logs`, `apps`. JSON-RPC server on :12000 (`/rpc`, `/ws`) [V] | | | | **FSL-1.1-ALv2**: a source-available licence that forbids competing commercial use for 2 years before turning Apache-2.0 [I on the clause; V on the licence] |
| **ios-simulator-mcp** | `ui_describe_all`, `ui_describe_point`, `ui_find_element`, `ui_tap(x,y)`, `ui_type`, `ui_swipe`, `ui_view` (compressed screenshot), `screenshot`, `record_video`, `install_app`, `launch_app`, `terminate_app`, `open_url`, `list_apps` [V] | Accessibility tree plus image | Coordinates | macOS. **Needs idb (`idb_companion` + `fb-idb`)** [V] | MIT. Use ≥ 1.3.3 (command-injection fixes) [V] |
| **Maestro MCP** (`maestro mcp`) | `list_devices`, `inspect_screen` (compact JSON hierarchy), `take_screenshot`, `run` (YAML flows), `cheat_sheet`, cloud tools, `open_maestro_viewer` [V] | Hierarchy JSON | Selectors in YAML (text, id) [I] | All 3 (JVM) | Apache-2.0 [V] |
| **appium-mcp** 1.99.3 | Session tools, `appium_find_element` (locators or AI), `generate_locators`, `appium_screenshot`, `appium_get_page_source` (XML), gestures [S] | XML page source plus screenshot | Locators | All 3 (iOS needs macOS) | Apache-2.0 [V] |
| **Android CLI** (Google) | `layout`, `screen capture --annotate`, `screen resolve`, `input …`, `emulator …`, `install`, `run`, Journeys [V] | JSON (interactive-only by default) plus annotated PNG | Numbered labels mapped to centres [V] | Not stated | Google terms (not OSS) [V] |
| droidrun / mobilerun | Portal APK tools: `get_a11y_tree`, `start_app`, `input_text`, back, home, recents [S] | Accessibility tree with overlay indices | Index | All 3 (Python) | MIT [V] |
| Midscene.js (`@midscene/android`, `@midscene/ios`) 1.17.7 | `aiTap`, `aiInput`, `agent.ai(...)`. Android playground with a scrcpy preview (through yume-chan). iOS through WDA [S] | **Pure vision** (screenshots only), using a VLM such as Qwen3-VL or UI-TARS [S] | Natural language | All 3 (iOS needs macOS) | MIT [V] |

---

## 3. UX patterns worth copying

- **Bare screen versus device frame.** Claude shows the bare screen [I from docs]. T3 shows the screen in a rounded viewport, with an optional **3D device model** view [V]. Radon shows a device frame with zoom presets [V]. Default to the bare screen with a correct corner radius and keep the frame optional.
- **Device picker.** List each device with its OS version, booted state and host. Picking a stopped device boots it (Claude, T3). Offer an "Attach / Detach" split, where detach stops the stream but keeps the device running (Claude) [V].
- **Hardware controls.** Mirror Simulator shortcuts: ⌘⇧H Home, ⌘L lock, ⌘↑ and ⌘↓ volume, ⌘→ rotate, ⌘S screenshot, ⌘R record. On Android add Back, Home and Recents buttons (T3, serve-emu) [V].
- **Input.**
  - Click-drag means touch, the wheel means scroll, and Option-drag means pinch (serve-sim).
  - Keyboard passthrough applies only while the screen is focused, and must not leak into the composer (T3 PR #14534 fixed exactly that) [V/S]. In GeneratorAI this maps to `data-gai-keys="own"` on the stream surface.
  - Support IME composition for CJK (serve-emu) [V].
- **Quality and performance.**
  - Offer a Display menu for fps and resolution (Claude) [V].
  - Stream only the visible tab (T3) [V].
  - Re-send the last MJPEG part after a quiet period, because browsers paint a part only when the next one begins (T3 `mjpegStillFrame`) [V].
  - Show explicit stream states: "waiting for video" and "stream stalled" (serve-emu) [V].
- **Multiple devices.** One tab per device, with rename (T3). Cap at 4 panes (Claude) [V/S].
- **Float over chat.** When the agent opens a device, show it as a small floating window over the chat, the same way the agent-driven browser appears (T3) [V].
- **Tools drawer** (T3, Expo, Radon). Foreground app, light and dark mode, text size, accessibility toggles, an accessibility-frame overlay, fake location, app permissions. iOS adds push and VoiceOver; Android adds orientation and network. Every control shows the value read back from the device [V].
- **Capture.** Screenshot and recording saved to Desktop (Claude). Radon adds a **replay** buffer of the last N seconds and automatic recording [V].
- **Reload and rebuild menu** (Radon). JS reload, restart process, reinstall, rebuild, clean rebuild, reboot device [V].
- **URL bar** for deep links and routes (Radon) [V].
- **Setup checklist.** Show missing Xcode, iOS runtime, adb, emulator or AVD as steps that tick off as each is fixed (Claude, T3). Explain how to pick the active Xcode [V].
- **Agent activity on the device.**
  - Badge: "Claude is using this device; hold off tapping" (Claude) [V].
  - List device tool activity in the thread timeline (T3) [V].
  - Claude CLI's macOS notification "press Esc to stop" [V].
  - **Not found anywhere:** a tap-ripple or cursor overlay for agent touches. This is an opportunity: draw ripples and swipe trails from the agent's actions on top of the stream.
- **Element inspectors.**
  - Radon: click the preview to jump to the React component's source, or right-click to choose from the component tree. Native view-hierarchy hover-highlight [V].
  - Maestro Studio: right-click an element to get a YAML command with selectors [S].
  - Appium Inspector: shows the XML tree, locators and element bounds [I].
  - Android Studio Layout Inspector and the Xcode view debugger: tree plus properties plus a 3D explode view [I].
  - T3's browser picker serializes `<element_context>` into the chat. Its device panel has only an accessibility-frame overlay [V].
  - **No product ships "pick a native element → send to chat" yet.** It is buildable from `describe-ui --point` or a hit-test of the accessibility tree.

---

## 4. Security and consent patterns

| Pattern | Seen in |
|---|---|
| One-time consent **per device**, separate from manual use. If the user declines, they can still use the device themselves, and a "Let Claude use it" button grants access later | Claude [V] |
| Opt-in wizard: enable support, check tools, then a separate "Agents can use devices" grant. Agent tools are hidden from sessions started after access is revoked | T3 [V] |
| Actions with off-device effects keep following the permission mode: **open URL** (data exfiltration through the query string), **build** (runs project scripts), **install and launch** (can run any app) | Claude [V] |
| Admin kill-switches: `disableMobileSimulatorTools`. A full-VM sandbox policy disables the pane entirely | Claude [V] |
| Disclosure that screenshots go to the model provider and are kept under the retention policy, plus "don't sign in to real accounts on a device the agent uses" | Claude [V] |
| Helpers bound to **loopback only**. The app server proxies an **allowlist** of read, stream and screenshot routes and authenticates every request. `<img>` and WebSocket requests use a cookie or a short-lived ticket. **Never proxy shell-exec routes.** Settings changes go through typed RPCs that run `simctl` or `adb` server-side | T3 [V] |
| A token is required for any non-loopback bind. Origin checks reject cross-site requests. HttpOnly cookie exchange. `--allow-exec` off by default | serve-emu, serve-sim [V] |
| Per-app approval, a global Esc abort, a single-session lock, and the terminal excluded from screenshots (prompt-injection hygiene) | Claude computer use [V] |
| Remote and cloud devices: ADB over SSL. Billed sessions with idle and run limits, stopped on host removal | Android CLI device remote, T3 EAS host [V] |

Threats to design for [I]:
- prompt injection from on-screen text (notifications, web content in the device browser).
- exfiltration through deep links, the clipboard or app installs.
- destructive actions such as clear data, erase device, uninstall.
- physical devices, which hold real accounts, SMS and calls: require a stronger per-device warning, and default-deny actions such as phone and SMS intents.
- recording files that leak secrets.
- a local port that any process can reach: use a token even on loopback.

---

## 5. Catalogue: what a best-in-class Devices pane and agent toolset should offer

### 5.1 Pane (user)

| Capability | Priority |
|---|---|
| Device picker: platform icon, name, OS version, state, host. Boot, shutdown, attach, detach | Must |
| Setup checklist or doctor: Xcode, iOS runtime, `xcode-select`, adb, emulator, AVD, tool versions; Windows needs WHPX or AEHD, Linux needs KVM | Must |
| Live stream (H.264 + WebCodecs). MJPEG or still-frame fallback. Explicit states: connecting, waiting for video, stalled, disconnected | Must |
| Touch by click-drag. Scroll wheel. Keyboard passthrough with focus capture (`data-gai-keys="own"`). Paste text | Must |
| Hardware buttons: iOS Home, Lock, volume, rotate; Android Back, Home, Recents, Power, volume, rotate | Must |
| Fit-to-pane scaling. Correct orientation handling, with coordinates rotated | Must |
| Screenshot to file and "attach to chat" | Must |
| "Agent is using this device" badge. User can take over or pause the agent | Must |
| Consent flow: per-device agent grant, and revoke in Settings | Must |
| **Pick element → send to chat**: hover highlight from the accessibility tree, then a chip with platform, role, label, id/resource-id, bounds, ref, screen name and a cropped screenshot | Must, the differentiator |
| Agent tap ripples and swipe trails drawn over the stream | Should (no product has it) |
| Recording (MP4) | Should |
| Display menu (fps, resolution, bitrate) | Should |
| Multiple devices as tabs; only the visible tab streams | Should |
| Float over chat when the agent opens a device | Should |
| Tools drawer: appearance, text size, locale, location, permissions (privacy grant), network, accessibility overlay, push (iOS) | Should |
| Logs panel (logcat / `simctl spawn log stream`), filtered to the app | Should |
| URL or deep-link bar. Drag-and-drop install of APK or `.app` | Should |
| Physical Android over USB or Wi-Fi | Should |
| Clipboard sync | Should |
| Device frame / 3D model, foldables, Duo | Later |
| Replay buffer of the last N seconds | Later |
| Network inspector, CPU and memory graphs | Later |
| React Native component inspector (source jump, like Radon) | Later |
| Physical iOS (WDA / go-ios / devicectl) | Later |
| Remote hosts (SSH Mac for Windows and Linux users, EAS Simulator, cloud devices) | Later |
| Camera injection, multi-touch pinch, GPS route playback | Later |

### 5.2 Agent toolset (MCP), mirroring the existing Browser tools

| Tool | Priority |
|---|---|
| `device_list` (hosts, capabilities, what is open in the thread), `device_open` (boot if needed, show in pane), `device_close` (`shutdown?`) | Must |
| `device_snapshot`: accessibility tree with `@eN` refs, interactive-only by default, `full?`. After an action, return a **diff** (agent-device style) | Must |
| `device_screenshot`: downscaled, optional `annotate` with numbered boxes (Android CLI style) | Must |
| `device_tap` (ref, or normalized x/y), `device_long_press`, `device_swipe` / `device_scroll` (direction or ref), `device_type` (text, optional ref, replace?), `device_press` (home, back, recents, enter, lock, volume…) | Must |
| `device_app` (install, launch, terminate, list, clear_data, foreground), `device_open_url` (gated by permission mode) | Must |
| `device_wait_for` (text, ref, idle, timeout) | Should |
| `device_logs` (app filter, since, level), `device_crashes` | Should |
| `device_set` (appearance, font_scale, locale, location, orientation, permission grant, network) | Should |
| `device_record` (start, stop) | Should |
| `device_batch` (several steps in one call) | Later |

Use normalized coordinates (0..1) as in serve-emu. This avoids mixing up iOS points with Android pixels.

---

## 6. The three most efficient end-to-end approaches for a Node/Electron app

### Approach A: adopt the "hub + agent CLI" stack wholesale (T3 Code's architecture)

**What it is:**
- `expo-device-hub` (MIT) runs as a supervised child process. It contains serve-sim for iOS and serve-emu for Android.
- The GeneratorAI server proxies its stream, screenshot and accessibility routes through an authenticated allowlist.
- `@expo/hub-client` decodes both wire formats in the web UI.
- `agent-device` (MIT) drives the device for the agent: through `agent-device mcp`, or behind our own `device_*` tools.

**Costs and risks:**
- `expo-device-hub` is pre-1.0. GitHub reports its licence as NOASSERTION while npm says MIT [V].
- serve-emu runs on **Bun**, so we would ship or require Bun [V]. T3 says emulator video in the hub **needs ffmpeg with libx264** [V].
- serve-sim is **Apple Silicon only** [V].
- The hub's exec routes are a security liability, so it must be proxied [V].
- Two vendored wire protocols mean extra moving parts, and the Xcode-version churn is inherited.

**Effort:** lowest. T3 proved the approach end to end in an Electron, React and Node app.

**Install burden:**

| OS | What the user needs |
|---|---|
| macOS | Xcode 26/27 with an iOS runtime; Android SDK (platform-tools, emulator, cmdline-tools, an AVD); ffmpeg for emulator video; Node ≥ 22.12 for agent-device (Electron's bundled Node can host it); Bun (bundled or installed) |
| Windows / Linux | Android only, with the same Android SDK, ffmpeg and Bun. iOS only through a remote Mac host or EAS |

### Approach B (recommended): own the Android pipe, reuse serve-sim for iOS, use agent-device for the agent

**Android (all 3 OSes): in-process Node, no Bun, no ffmpeg.**
- Packages: `@yume-chan/adb` + `@yume-chan/adb-server-node-tcp` (talks to the user's `adb` server) + `@yume-chan/adb-scrcpy` + `@yume-chan/scrcpy`, all MIT.
- We bundle the `scrcpy-server` jar (Apache-2.0) at the exact version the library supports. Stable 2.x targets scrcpy 3.x; the 3.0.0-beta adds 4.x and 5.x [V].
- H.264 packets go over our existing authenticated WebSocket to the renderer, where `@yume-chan/scrcpy-decoder-webcodecs` (MIT) decodes them.
- Input travels on the scrcpy control socket.
- Lifecycle, settings and logs use `adb` and `emulator -avd` through child processes.
- If the emulator's software encoder struggles, offer emulator gRPC `streamScreenshot` as an emulator-only fallback [I].
- Physical Android works with the same code.

**iOS (macOS): serve-sim's helper as a supervised child.**
- `serve-sim` (Apache-2.0) runs per device on loopback. We proxy only the AVCC stream, the input WebSocket and the screenshot route.
- Our server runs `simctl` itself for lifecycle and settings.
- Fallback for Intel Macs or a broken helper: AXe (`brew install cameroncooke/axe/axe`, MIT) `stream-video --format mjpeg` plus AXe input.

**Agent:**
- Use `agent-device` (MIT) through its Node API (`createAgentDeviceClient`), wrapped in GeneratorAI's own `device_*` MCP tools so the agent gets one consistent ref model alongside the Browser tool.
- The alternative is to put the pinned CLI on PATH, as T3 does.
- Pick-to-chat reuses the same accessibility snapshot: hit-test the tree at the clicked point.

**Costs:**
- About two to three weeks more engineering than A for Android (stream, input, reconnect and rotation edge cases), which Tango and scrcpy largely solve [I].
- iOS still carries the private-framework churn risk through serve-sim.
- Two decoders in the UI: Tango WebCodecs for Android, AVCC WebCodecs for iOS. Both are plain H.264 into WebCodecs, so they can share one canvas sink.
- WebCodecs needs a secure context. Electron's `file://` or a privileged custom scheme, and localhost, are fine. Remote web clients over plain HTTP need HTTPS or an MJPEG fallback [V for the T3 note; I for Electron].

**Install burden:**

| OS | What the user needs |
|---|---|
| macOS | Xcode with an iOS runtime (iOS); Android SDK platform-tools + emulator + an AVD (Android). We bundle the scrcpy-server jar, the serve-sim npm package (arm64) and agent-device. The agent-device iOS XCTest runner builds once on first use (a few minutes) [V] |
| Windows | Android SDK platform-tools + emulator (WHPX or AEHD) + an AVD; the OEM USB driver for physical phones. Nothing else. iOS appears as "needs a Mac" with a remote-host option later |
| Linux | Android SDK + KVM; udev rules for physical phones [I]. Nothing else |

**Why I recommend B:**
- It satisfies GeneratorAI's "Windows, Linux, macOS first-class" rule for everything Apple doesn't forbid.
- Every runtime dependency is permissively licensed: MIT or Apache-2.0, with no FSL or GPL.
- It avoids Bun and ffmpeg.
- It keeps the security-sensitive helper surface to a single macOS child that we proxy.
- It reuses the agent model (refs plus diffs) that every serious toolkit has converged on.

### Approach C: MCP-only, screenshot-driven (fastest prototype, weakest UX)

**What it is:**
- Wire `@mobilenext/mobile-mcp` (Apache-2.0) or `mobilebuildmcp` for iOS (MIT).
- The pane polls screenshots at 2–5 fps, or uses `mobilecli screencapture --format mjpeg`.
- User input goes through the same tool calls.

**Costs:**
- High latency and poor feel for the user.
- mobile-mcp sits on **mobilecli (FSL-1.1-ALv2)**. That is a licence risk for a product that competes with mobile-next [V/I].
- mobilecli needs an on-device agent for iOS streaming [V].
- Little control over consent and overlays.

**Install burden:** adb, plus Xcode and Node.

**Use:** only as a stop-gap, or as an optional "bring your own MCP" path.

### Not recommended as the core

| Option | Why not |
|---|---|
| Appium / WDA | Heavy and slow; better for tests |
| Midscene | Vision-only, needs a VLM |
| Computer use on Simulator.app | Needs TCC permissions, takes over the screen, breaks on Xcode 27 |
| Radon | Closed and commercial |
| pymobiledevice3 | GPL-3.0 |

---

## 7. Open questions to confirm before building

1. Pin a Tango version to a scrcpy-server version. Stable `@yume-chan/adb-scrcpy` 2.3.x supports scrcpy 3.x; 4.x and 5.x need the 3.0.0-beta [V, release notes]. Decide whether to vendor scrcpy-server 3.3.4 or take the beta.
2. Check that serve-sim runs on Electron's bundled Node (`ELECTRON_RUN_AS_NODE`) and that its native addon loads there. T3 runs it with the server's Node [V], and serve-sim needs Node ≥ 20 [V].
3. Check that agent-device runs on Windows hosts for Android. Its README is silent [V].
4. Check that agent-device's Android snapshot needs no user-enabled accessibility service. Its README says it uses "ADB and a snapshot helper" [V].
5. Re-verify the emulator gRPC discovery and token details before using them [I].
6. Under Xcode 27, serve-sim keyboard input needs an Accessibility TCC grant for the launching app [V]. Check how that interacts with our ad-hoc-signed macOS build (see the repo's TCC notes).
