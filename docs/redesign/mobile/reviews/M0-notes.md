# M0 kickoff checkpoint — 2026-09-27

## Status

M0-01 complete. M0-02 and M0-03 in progress: the named iOS simulator is booted; Android API 36 is installed and the named emulator is starting; the simulator-only iOS baseline build is compiling. Neither native launch nor M1 acceptance is claimed yet. M0-04 designer handoff is the existing paste-ready list linked below.

All work uses /Users/sidmishra/Desktop/Projects/mobile_redesign on mobile_redesign (initially clean). The initial task directory was the desktop checkout; no edits were made there.

## Plan and design review (M0-01)

- Read root/mobile AGENTS, README, decisions, phases and playbook. Read the supporting document introductions, conventions, relevant setup/architecture sections and feedback handoff; skimmed the approach and all nine research reports. Their older code/version claims are background and are checked against merged code as each task starts.
- pnpm install passed before and after integration. Workspace CLI/relay bin warnings remain; no install failure.
- All 131 mobile boards rendered in both modes: 262 PNGs, zero failures. Inspected every image through 44 contact sheets, both platform halves; inspected MFoundations and MComponents individually. Full-resolution inspection and CSS measurements continue per implementation task.
- Inspected both modes of desktop Home, ChatNarrow, Pairing, Components, Foundations and DockTerminal (12 renders).
- Public mobile artifact opens in the browser. Embedded artifact version 1790412505-d42b matches the committed VERSION. Earlier private-link question is resolved.
- Public desktop artifact version 1790435159-f2ec differs from committed desktop snapshot 1790308891-7d99. Non-blocking owner follow-up: refresh that parity snapshot if desired. Mobile snapshot remains authoritative; no snapshot was rewritten.
- Mobile typecheck passed. Lint passed with two existing warnings: scope-request.tsx unused SectionHeader; secureItemStore.web.ts console statement.

## Desktop foundation review and integration

Merged desktop_redesign at 744f3a02 in d68687de; no conflicts and no mobile additions lost. MD-97 narrows the P7 gate to removal of native token compatibility: P7-01 removed web legacy components, while native emit/themeVars are unchanged. Actual token removal still waits for M3-05.

Verified the mobile-facing chain in source:

- design-tokens has 18 themes, 7 accents, appearance resolution, vocabulary generation and the unchanged native emitter. Mobile geometry and SF/Material concept slots still need M3 additions; Uniwind emission is not implemented yet.
- shared status, commands/navigation, pane caps, gate/tool/copy/composer contracts and settings navigation exist. Settings now includes Workflow engine. D-81/D-82 describe Workflow Overhaul integration and P7 legacy removal.
- client-core exports transcript derivation/grouping/turns, composer state machine/slash commands, attention store, chat list paging, diff, model picker and computer consent models. Mobile currently duplicates several and adopts them in M2.
- Web attention hooks wrap the shared store with useSyncExternalStore and multiplexed-stream reconnect handling; chat separates stream selectors from transcript history. Mobile keeps its auth/transport/stream services while adopting the React-free models.
- Server mounts attention/stats/activity/search and the Workflow Overhaul definition/run/invocation/callback/tool routes. Workflow-spec types and the desktop client integration are present. M8 must still verify every required endpoint against its task acceptance.

Integration validation: mobile typecheck passed; 105 test files / 1,097 tests passed; pnpm check:tokens passed all generated targets.

Desktop sandbox walkthrough: Home attention/stats/composer, Chats list, seeded pending permission chat, pinned workspace tabs and empty Changes state, General settings and Appearance controls. Switched the isolated browser to light and inspected its rendering. Status uses neutral surfaces with colored glyphs/gate headers. This is a focused foundation and behavior review, not certification of every desktop feature or Electron packaging. Source-control mutations were not exercised.

## Machine setup (M0-02)

Owner resolved the previous Xcode-selection and JDK blockers:

| Check | Current evidence |
|---|---|
| Xcode selection | /Applications/Xcode.app/Contents/Developer |
| Xcode | 27.0, build 27A266a |
| iOS runtime | 27.0 (24A434) |
| gai-iphone | iPhone 18 Pro; simctl boot succeeds; Xcode lists it as an iOS Simulator destination |
| gai-ipad | iPad Pro 13-inch (M5) (16GB), created |
| JDK | Zulu 17.0.20.1 |
| Android SDK | /Users/sidmishra/Library/Android/sdk |
| Android tools | adb package 37.0.1, emulator 37.1.11 |
| Android image | android-36/google_apis/arm64-v8a installed successfully |
| Android API 37 | SDK repository reports platforms;android-37 unavailable; permitted API 36 fallback used; API 37-specific checks pending |
| Android AVDs | gai-phone (pixel_9), gai-tablet (pixel_tablet) created |
| Maestro / agent-device | verification tooling still pending M1 |

Environment paths are task-local; no shell profiles changed. No password or sudo operation performed.

## Native launch and sandbox (M0-03)

Sandbox started with scripts/redesign/sandbox.mjs from this worktree, API 3197 / web 5197, fresh temporary database and Faux provider. No real database/server used.

The first expo run:ios --device gai-iphone generated the CNG project and installed 121 pods, but Expo CLI 57.0.11 treated the simulator as a physical device and requested signing. xcodebuild -showdestinations correctly identifies it as an iOS simulator. A direct xcodebuild with iphonesimulator SDK, named simulator destination and CODE_SIGNING_ALLOWED=NO is compiling; its local log is apps/mobile/.expo/m0-ios-build.log. No signing-account action is needed for this workaround. Pairing and baseline screenshots remain M1-04.

## Owner-confirm defaults and designer handoff (M0-04)

Use the written defaults: MD-04 workflow list editing without edge editing; MD-42 opt-in crash reporting off by default; MD-96 no mobile Widget pane tab. No alternative is adopted.

Designer handoff: [10-design-feedback.md §3](../10-design-feedback.md#3-send-to-designer-paste-ready), 135 paste-ready send items. Build follows the recorded resolutions without waiting; no external message was sent.

## Next

Finish both phone boot checks, native builds and pairing-screen launches. Record results and close M0, then start M1-01. Keep the API 37 limitation explicit. Native baseline screenshots and characterization belong to M1-04.

Documentation-only Done-loop: typecheck/lint already passed; related TS/token tests do not apply. Bootstrap skips: design ratchet until M1-05, Jest until M1-06, fingerprint until M1-02, device walkthrough tooling until M1-02/M1-03, Maestro until M1-04.
