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
