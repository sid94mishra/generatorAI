# M0 kickoff checkpoint — 2026-09-27

## Status

Paused for owner machine actions under `09-codex-playbook.md` §8. M0-01 is in progress; M0-02 has preflight evidence only; M0-03 and M1 have not started. No native build, launch, pairing, baseline screenshot or batch review is claimed.

The task initially opened `/Users/sidmishra/Desktop/Projects/generatorAI` on `desktop_redesign`. All work was redirected to the existing `/Users/sidmishra/Desktop/Projects/mobile_redesign` worktree on `mobile_redesign`, whose initial status was clean. The desktop checkout was not modified.

## Completed preparation

- Read root/mobile AGENTS, README, decisions, phases and playbook; consulted verification §1 and the repository map. Supporting docs and background research still need their kickoff pass.
- `pnpm install`: passed (pnpm 10.29.2). Warnings: unbuilt workspace CLI/relay bins and ignored dependency build scripts. No dependency files changed.
- Snapshot VERSION: `1790412505-d42b`. The private mobile artifact could not be opened through the web tool. Non-blocking owner question: has the artifact changed? Continue with the committed snapshot unless the owner supplies an updated snapshot.
- Mobile render: **262 PNGs, zero failures**, all 131 boards in both modes, in `docs/redesign/boards/png/mobile/` (ignored). Rendering is complete; visual inspection of every image is **pending**.
- Desktop references rendered in both modes: Home, ChatNarrow, Pairing, Components, Foundations, DockTerminal (**12 PNGs, zero failures**). Inspection and any further parity references remain pending.
- Mobile typecheck: passed.
- Mobile lint: passed with two existing warnings (`scope-request.tsx`: unused SectionHeader; `secureItemStore.web.ts`: console statement).

## Machine evidence and owner actions

| Check | Observed |
|---|---|
| `xcode-select -p` | `/Library/Developer/CommandLineTools` |
| Default `xcrun simctl` | fails: utility unavailable under selected developer directory |
| Per-command Xcode override | `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -version` succeeds: Xcode 27.0, build 27A266a |
| iOS runtime with that override | iOS 27.0 (24A434), `com.apple.CoreSimulator.SimRuntime.iOS-27-0` installed |
| `/usr/libexec/java_home -V` | no Java Runtime found |
| Android SDK | `/Users/sidmishra/Library/Android/sdk`; cmdline-tools/latest exists |
| adb via absolute path | 1.0.41, package 37.0.1-15733141 |
| Emulator AVDs | `gai_pixel` only |
| Installed Android image directories | `android-35` only |
| PATH | adb, emulator, Maestro not resolved |
| Android Studio bundled JDK | expected application path absent |

Owner commands from verification §1.1:

```sh
sudo xcode-select -s /Applications/Xcode.app
sudo xcodebuild -license accept
brew install --cask zulu@17
```

No sudo/password operation was attempted. After these actions, resume with a fresh check; set task-local `JAVA_HOME` and Android SDK paths, install the prescribed SDK images/tools, create and boot the named phone/tablet devices, and verify both platforms. The installed iOS runtime need not be downloaded again. M1 installs repo tools in its prescribed tasks.

## Desktop integration checkpoint

Local `desktop_redesign` is `744f3a02` and now includes Workflow Overhaul and P7-01. No merge has been performed. `07-phases.md` §2 explicitly says M3-05 must finish before P7 is merged; its R-4 explains the legacy token risk. Current desktop `emit/native.ts` has no diff from the branch base, but mobile still imports `themeVars`. Reconcile the phase-start merge with that gate on resume; do not discard either branch's additions or pre-emptively change shared code. No coordination additions were lost because no merge occurred.

## Owner-confirm defaults and designer handoff

Defaults remain as written: MD-04 (workflow list editing, no edge editing), MD-42 (opt-in crash reporting, off by default), MD-96 (no mobile Widget pane tab). None has been implemented or changed here.

The designer handoff is the existing paste-ready `10-design-feedback.md` §3 (135 send items). No external message was sent. Its reading/handoff remains part of M0-04.

## Resume checklist

1. Verify owner machine actions, clean branch and current desktop state.
2. Complete M0-01 reading and visual inspection; resolve the merge gate and run the merge checks if proceeding.
3. Finish M0-02 named simulator/emulator setup and boot evidence.
4. Build and launch both current native apps and start the isolated sandbox (M0-03).
5. Complete designer handoff (M0-04), then M1. Pairing/baseline shots remain M1-04.

This is a documentation checkpoint, not a completed task. No UI/logic changed. Bootstrap tooling skips: design ratchet until M1-05; Jest until M1-06; fingerprint until M1-02; device walkthrough tooling until M1-02/M1-03; Maestro until M1-04. No related TS tests or token tests apply to this documentation-only change.
