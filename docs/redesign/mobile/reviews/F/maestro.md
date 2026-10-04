# Batch F — the Maestro suite on device (merge-readiness §4 step 4, M10-02)

Runner: `node scripts/mobile/sandbox-pair.mjs maestro --platform=<p> --udid|--serial=… -- test <flow>`, one flow per
invocation (a crashed iOS driver otherwise hangs the rest), sandbox :3197, dev client + Metro.

## iOS 27 — gai-iphone, 38 flows

First full run: 3 of 38 green. After seven fix rounds (app fixes and flow fixes, commits below): **27 pass**, 11 open.

| Flow | Result | Notes |
|---|---|---|
| agents/create-delete | pass | needs `admin:settings` (DEVICE_SCOPES); instructions field centred above the keyboard |
| approvals/clear | pass | Review buttons read "Review <title>" |
| auth/companion-scopes | pass | scope rows read "<label>, <scope>"; iOS back via header button |
| automations/create-run | pass | fixed: Add-a-workflow sheet over the wizard, Discard after Create |
| changes/keep-undo-commit | pass | fixed: row menu reachable; alert confirm |
| chat/composer-extras | pass | "+" menu before the keyboard |
| chat/model-pick | pass | fixed: Turn sheet Done asked to discard |
| chat/send-stream | pass | transcript scrolled by swipe |
| chat/two-phase-stop | pass | |
| chats/archive-unarchive | pass | Select by label (native toolbar) |
| chats/new-chat | pass | draft-aware; ends editing before Create |
| home/home | pass | |
| navigation/android-back | pass (Android-only steps skipped) | |
| navigation/deep-links | pass | |
| navigation/tour | pass | fixed: header title "settings/index" |
| pairing/pair-via-link | pass | |
| pane/tabs | pass | |
| projects/codebase | pass | |
| projects/create-tabs-delete | pass | fixed: Discard after Create |
| scripts/list-detail | pass | |
| search/palette | pass | |
| settings/device, scope-request, sections, system, theme-switch | pass | |
| workflows/run-pane-graph | pass | fixed: blank graph |
| workflows/run-stage | pass | |
| chat/send-stream-approve | **fail — device limit** | the fixture's shell gate is risky; Allow needs the approval key, whose registration waits on a Face ID / passcode sheet the iOS 27 simulator does not draw (agent-device: Face ID simulation unsupported). MV-29, real phone |
| pane/browser, terminal/open-type | **fail — device limit** | `exec:*` tabs ask for the local step-up (LocalAuthentication); the passcode sheet is not drawn on the simulator, so the tab shows "Confirm it's you" |
| notifications/approval-action | **fail** | MV-03: tapping the notification in Notification Center does not leave the cover sheet on the iOS 27 simulator; tapping the banner does open the gate (surfaces.md) |
| servers/switch | **fail — setup** | needs a second sandbox (`SERVER_B_NAME`, MV-21) |
| workflows/builder, list-detail, run-sheet, settings, stage-editor | **fail — flow** | remaining iOS selector issues after six rounds: content of imperative sheets (RN Modal) by text, one stage-editor tab field, the run sheet's plan layers label, the delete confirmation. The screens themselves were checked by hand (walkthrough.md) |

Runner / tooling fixes: pairing waits and snapshot timeouts (70186846, 5121bc75), dummy-repo timeout, re-pair after a
failed pairing flow (122d3883), driver start 420 s, `_subflows/back.yaml`, `_subflows/pane-closed.yaml`.

App fixes found by the suite: 9a797768 (Turn sheet restored on every launch), 77d0f348 (Turn sheet Done), d27da95e
(save → "Discard changes?"), 3238ac00 (change-row menu unreachable, agent name squeezed), dcdc3f86 (raw JSON in the
sidebar), a86e04f4 (blank graphs), 5691708e (sheets over editors, sticky bar double lift, trigger cards), 1a871bce
(toasts over editors, header "settings/index"), b5c8085d (editor stack restored, wizard Discard after Create),
string subtitle crash (workflow settings).

## Android 16 — gai-phone emulator (API 36, 3 GB), 38 flows

First full run: 17 of 37 green (plus `home/home` alone). After the fixes below and re-runs of the failures: **33 pass**,
5 open. The passes come from the full run plus targeted re-runs, not one clean end-to-end pass; a full green re-run is
still owed (owner). Runner notes: the emulator needs a PIN + enrolled fingerprint for signed approvals and step-up
(a background `adb emu finger touch 1` loop answers the prompts — stop it while `sandbox-pair` runs, it contends for the
emulator console: "adb -s failed (20)"); keep the screen on (`settings put global stay_on_while_plugged_in 7`, `dumpsys
battery set ac 1`) or the PIN lock comes back mid-suite; stylus handwriting off (Gboard's "Try out your stylus" sheet
covered a flow).

| Flow | Result | Notes |
|---|---|---|
| agents, approvals/clear, auth, automations, chat (composer-extras, model-pick, send-stream, send-stream-approve, two-phase-stop), chats/archive-unarchive, home, navigation (android-back, deep-links, tour), pairing, pane (browser, tabs), projects (codebase, create-tabs-delete), scripts, search, settings (device, scope-request, sections, system, theme-switch), workflows (builder, list-detail, run-pane-graph, run-sheet, run-stage, settings, stage-editor) | **pass (33)** | `send-stream-approve`, `approvals/clear`, `pane/browser` pass here (fingerprint) — the iOS simulator cannot do these |
| chats/new-chat | **fail — app crash (pre-existing)** | Create chat from the New chat sheet → Fabric `IllegalStateException: addViewAt: cannot insert view [ReactTextView] into parent …: View already has a parent` (redbox in the dev client, a crash in release). Same at the session's start commit 76ad7776, with an agent or "Just a model". Not reproduced by opening a just-created chat by link, nor by sending the first message from an empty chat. Ruled out: the sheet's replace navigation (back + delayed push still crashes), the floating-label layout transitions, the pending-bubble opacity, the Compose Menu, the list invalidation on create, view recycling (off by default). Owner: needs a Fabric mount trace (debug build with mounting logs) |
| changes/keep-undo-commit | **fail — flow (Android)** | after typing the commit message, Android `hideKeyboard` (a Back press) closes the commit sheet when the keyboard is already down; the following "Push.*" tap lands on the transcript and opens Rewind |
| notifications/approval-action | **fail — fixture** | see surfaces.md: the dev `approval` case is standard, the sandbox gate is risky, the unsigned Allow is refused by design |
| servers/switch | **fail — setup** | second sandbox (`SERVER_B_NAME`, MV-21) |
| terminal/open-type | **fail — real** | step-up passes and the shell opens, but fast Maestro typing drops characters (`gai-characterization-ok` arrives as `ai-caractrizaio-ok`) — xterm's hidden textarea and Gboard composition; a person typing may not see it, paste may. Owner: test on a phone, consider sending composed input on `compositionend` |

App fixes found by the Android suite: 06a04353 ("Reconnecting…" stuck after a quick app switch — Android's 10 s
background grace), 464331ba + 8f0eb45a (pane tabs / TabRow filled the screen: `h-full` inside a horizontal scroller),
5eeec1d3 + baacbaa2 (Cancel → Discard asked twice), baacbaa2 (picker rows lost their testID — on iOS too), 14121764
(Android Back on a screen over a dirty editor asked to discard the editor), 96b6ef22 (Expo UI "updateRootConstraints
called while measuring" crash; `@expo/ui` patch built from source). Flow fixes: 06a04353, 464331ba, 5dd4b37e, d5740738.
