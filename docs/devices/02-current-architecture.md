# Devices: what the current code gives us (analysis, 2026-11-09)

Devices sits beside two existing features that already solve most of its problems: the **Browser** tab (an agent
drives a page that the user watches, and the user picks an element and sends it to the chat) and the **Computer** tab
(an agent drives desktop apps through a native driver, with consent and a live view). This note maps the parts Devices
reuses and the parts it must add.

## Web client (`apps/web`)

| Concern | Where | What Devices reuses |
|---|---|---|
| Dock tab types | `packages/shared/src/ui-contract/pane.ts` (`DOCK_TAB_TYPES`, caps, `?dock=` values) | A new `devices` type. Conditional like `computer`: only when device control is on |
| Which tabs a chat has | `apps/web/src/platform/surfaceCapabilities.ts` `dockTabTypes()` / `dockAddableTabTypes()` | One added line each, gated on a surface capability and the server's device switch |
| Dock registry | `apps/web/src/features/chat/ChatPage.tsx` (`tabs` memo) | A `devices` entry with `Component: DevicesDockPanel`; one tab (one device at a time per chat, the picker switches it) |
| Panel wrapper | `apps/web/src/blocks/browser/browserDock.tsx` | Same pattern: context provider, lazy panel, `useActivated`, only the active tab streams (P1-50) |
| Live frames | `blocks/browser/useBrowserLiveStream.ts`, `screencastFrame.ts` | The same 16-byte frame header and WebCodecs/JPEG paint path; a new codec id for H.264 |
| Input | `blocks/browser/useBrowserLiveInput.ts`, `browserInput.ts` | Pointer→device coordinates mapping; device input is tap / swipe / key / button, not mouse events |
| Element pick → chat | `useBrowserAnnotations.ts`, `browserEvents.ts` `selectionAttachment()`, `ChatPage.addCapture()` | The capture path: a `File` handed to `onCapture`, previewed in the composer, attached to the next send |
| Agent activity | `AgentBrowsingStrip.tsx`, Computer panel's Pause / Take over | The strip while a turn streams; tap ripples drawn from the action log |
| Settings | `features/settings/sections/*Section.tsx`, `ComputerUseSection.tsx` | A "Mobile devices" section: on/off, SDK paths, tool status. ("Devices" in Security already means paired phones) |

## Server (`apps/server`) and core (`packages/core`)

| Concern | Where | What Devices reuses |
|---|---|---|
| Service per workspace | `packages/core/src/services/BrowserService.ts`, `ComputerService.ts` | A `DeviceService`: discovery, boot, the chat's attached device, observe, act, stream, element at a point |
| Native back end behind a port | `infrastructure/computer/CuaDriverBridge.ts` behind `IComputerBridge` | An `IDeviceBridge` port with an Android (adb) and an iOS-simulator (simctl) implementation |
| Agent tools | `tools/browser/*` (10 tools), `tools/computer/*` | A `device_*` tool set built the same way (factories over a context, `wrapHandler` envelope) |
| Binding the tools to a session | `services/session/PlatformToolBinder.ts` | A `devices()` step after `computer()`; the binding key gains the device switch so a toggle rebinds |
| Hint and skill | `chatSystemHints.ts`, `templates/system/artifacts/skills/computer-use.md` | A short hint and a staged `mobile-devices` skill loaded on demand |
| REST | `apps/server/src/routes/browser.ts`, `computer.ts` | `routes/devices.ts`: list, boot, attach, input, snapshot, element-at, screenshot, install, logs |
| Live socket | `apps/server/src/browser-ws.ts` (frame header, input bounds, auth) | `device-ws.ts` at `/api/workspaces/:id/devices/stream`, same header and input bounds |
| Auth scopes | `packages/auth/src/scopes.ts`, `routePolicy.ts` | A new `exec:device` scope, granted like `exec:browser` |
| Wiring | `apps/server/src/composition-root.ts` | Construct the service, late-wire into `chatExtensions`, stop on workspace delete |

## Constraints that shape the design

- **Server-side streaming.** The web UI can be remote (pairing, relay), so frames and input go through the server
  socket, as the browser screencast does. A desktop-only Electron view would not reach the web or mobile clients.
- **Never rewrite** `platform/*`, `stores/sseManager.ts`, `stores/streamStore.ts`, `packages/client-*`; Devices adds
  lines to `surfaceCapabilities.ts` only.
- **`apps/mobile` is off limits**, so no new `AgentToolPolicy` group (mobile keys records by it). Devices is gated
  like Computer: a server switch, plus the binding key.
- **All three OSes.** Android tooling (adb, emulator) runs on macOS, Windows and Linux. iOS simulators exist only on
  macOS; elsewhere the iOS rows are simply absent, not an error.
- **No new installs without asking.** The tools found on the owner's machine: Android SDK at `~/Library/Android/sdk`
  (adb 37.0.1, emulator, AVDs `gai-phone`, `gai-tablet`, arm64 images); Xcode 27 with iOS 27 simulators. Not
  installed: scrcpy, idb, AXe, Maestro, Appium, ffmpeg.
