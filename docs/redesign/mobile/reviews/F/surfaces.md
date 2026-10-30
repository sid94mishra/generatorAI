# Batch F — M9 system surfaces on device (merge-readiness §4 step 3, 08 §4.9)

Screenshots: `docs/redesign/shots/mobile/F/surfaces/` (git-ignored PNGs, reproducible with the commands below).

Driver notes for every iOS row: Xcode 27 has no Simulator.app (08 §1.3), so the simulator cannot be locked and the
Simulator menu (Face ID, lock) is unavailable; XCTest drivers (agent-device, Maestro) set
`SBSuppressDynamicIslandCompletely` while they act, so the island is captured with `xcrun simctl io screenshot` only,
between driver commands; agent-device reports Face ID simulation as unsupported on the iOS 27 runtime.

## iOS 27 — gai-iphone (dev client with all four extensions, sandbox :3197)

| Surface | Result | Evidence |
|---|---|---|
| Live Activity — start / update / end | **pass** after two fixes (332555d4). `generatorai:///live?script=run-needs-you&step=14`: `liveactivitiesd` logs Starting → Updating ×3 → Ending → zombie (dismissal after 15 min) for `dev.generatorai.app` | device log |
| — re-running a script | **fixed** (332555d4): re-opening the same `/live` link while the screen was on top did nothing (same params); every `/live` link now restarts it; `&step=<s>` slows it for drivers |
| — start while backgrounding | **fixed** (332555d4): the background flush called `ActivityKit.start` while leaving the foreground; ActivityKit refused it and the 60 s refusal guard then blocked the start on return. Start only while active |
| Dynamic Island compact | **pass**: "⟳ Running 1/4", "⟳ Running 2/4", "✋ Needs you 3/4" (glyph + word + progress) | `ios-island-compact-running.png` |
| Lock Screen / cover-sheet banner | **pass**: running and needs-you states; final state with "Succeeded" word + glyph, step, four segments, "Stage 3 of 4" | `ios-lockscreen-ended-succeeded.png` |
| Expanded island with **Review** | **not captured**: the expanded island needs a long-press, which runs through XCTest and suppresses the island. Same SwiftUI tree as the banner (RunActivity.tsx) | — |
| Notification (APNs payload `e2e/push/approval.json`) | **pass**: Time Sensitive, title/body; menu offers **Allow once / Deny / Open** | `ios-notification-approval-actions.png` |
| Inline Allow (standard gate) | **pass**: Allow once from Notification Center on the seeded `file_write` gate → `chat.permission.resolved` `behavior: allow` in the sandbox replay, app stayed in the background | sandbox stream replay |
| Inline Allow on a risky gate | **pass (refused as designed, MD-31)**: the fixture's shell gate is server-stamped `risky` while the APNs template says `standard`; the unsigned answer is refused, the gate stays pending, the app opens the gate (Risky · Shell, Register approval key) | `ios-notification-open-risky-gate.png` |
| Inline Deny | **not completed**: revealing the notification's **View** button needs a partial swipe that XCTest does not perform reliably on iOS 27 (1 of 5); Deny runs the same `submitDecision` path as Allow | — |
| Banner tap → screen | **pass by hand** (agent-device tap on the banner opens the gate). From Notification Center the tap does not leave the cover sheet on the iOS 27 simulator (MV-03 stays open; see maestro.md) | |
| Widgets | **pass**: Needs you and Running added from the widget gallery (agent-device on SpringBoard); Needs you shows the sandbox gate with **Review** and "Updated hh:mm", Running "Nothing running". Summary not added. Widgets follow the active server's attention snapshot, not the `/live` fixture server, so the live script does not drive them | `ios-widget-needs-you.png`, `ios-widgets-running-needs-you.png` |
| App icon badge | **observation**: badge 1 while Home counts 4 needing you — the badge kept the last push's `badge: 1`; BadgeSync only writes while the app runs | — |
| Control Center control | **partial**: the control's link `generatorai://command/chat.new` opens the New chat sheet; adding the control to Control Center needs the Simulator UI (absent on Xcode 27) | `ios-control-link-new-chat.png` |
| Quick actions | **pass**: long-press shows Search, Run workflow…, Home ("4 need you"), New chat; New chat → New chat sheet, Run workflow… → palette scoped to workflows, Home → Home. Search tapped ambiguously (App Library's search field shares the label) | `ios-quick-actions.png`, `ios-quick-actions-results.png` |
| Share | **pass**: Photos → Share → GeneratorAI → app opens the **Send to agent** sheet pre-filled with the image (name, type, size), nothing sent | `ios-share-from-photos.png` |
| App-switcher privacy | **pass**: with "Hide content in app switcher" on, the app's card is blank; off, content shows | `ios-app-switcher-privacy-on.png` |
| Risky approval signing (MV-29) | **not possible on a simulator** (owner, real iPhone) | — |

## Android 16 (API 36) — gai-phone emulator (dev client, sandbox :3197 at 10.0.2.2)

Setup fixes first: the dev client died at launch until `DETECT_SCREEN_CAPTURE` was unblocked (4214be1e); pairing waited
on an off-screen Continue (a54f7a2d); the emulator needs 3 GB (`-memory 3072`; at 2 GB System UI and the Maestro driver
stalled). A PIN (1111) and an enrolled emulator fingerprint (`adb emu finger touch 1`) make the approval key usable.

| Surface | Result | Evidence (`docs/redesign/shots/mobile/F/android/`) |
|---|---|---|
| Live Update | **pass**: `generatorai:///live?script=run-needs-you&step=5` posts the ongoing notification with the status-bar chip, title "Typecheck", "Nightly dependency audit · Running", elapsed time and the four-segment bar; it ends as "Succeeded" | `live-shade-1.png`, `live-shade-3.png` |
| — segments on success | **finding (owner, client-core)**: the ended state keeps 2 of 4 segments filled — `liveState` turns only current / needs-you segments into done, pending stages stay grey on "Succeeded" (the script never sent stage 3–4 progress; a real run sends it) | `live-shade-4.png` |
| Notifications | **pass**: `notify?case=question` → "Your agent has a question" with **Reply / Open**; `approval` + `approval.risky` group under the app; `done` posts silently ("Workflow run finished") | `notify-shade.png`, `notify-approval.png` |
| Inline Allow (`notifications/approval-action`) | **flow/fixture mismatch**: the dev `approval` case marks the sandbox gate `standard`, but the fixture gate is risky (MG-04) — the unsigned answer is refused by design, the flow expects it accepted (owner: give the flow a standard gate) | maestro.md |
| Quick Settings tile | **pass**: `cmd statusbar add-tile …/NewChatTileService` → "New chat" tile → New chat sheet | `qs-tile.png`, `qs-tile-open.png` |
| Share intent | **pass**: `am start -a SEND -t text/plain` → **Send to agent** sheet with the text and chat picker | `share.png` |
| Quick actions | **partial**: the four dynamic shortcuts are registered (`dumpsys shortcut`: New chat, Run workflow…, Home, Search); the launcher long-press was not drivable by `adb input` | — |
| Recents privacy | **fail**: with *Hide content in Recents* on (`Activity.setRecentsScreenshotEnabled(false)` via the device-key module) the Recents card still shows the screen on the API 36 emulator, twice, with a fresh snapshot (owner: check on a phone; if it reproduces, fall back to FLAG_SECURE while the choice is on) | `recents-private.png` |
| Risky approval signing (MV-29, Android half) | **pass on the emulator**: Register approval key → fingerprint → **Allow once** / **Deny** signed and accepted (`chat/send-stream-approve`, `approvals/clear`); terminal and browser step-up the same way | maestro.md |
| Dev log noise | **finding**: every local notification logs `expo-notifications: Custom sound 'default' not found` (LogBox banner over the UI); `ReactNativeJNI: Unsupported FontVariant value: ""` on most screens | logcat |
