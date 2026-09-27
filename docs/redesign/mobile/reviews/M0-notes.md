# M0 kickoff checkpoint — 2026-09-27

## Status

M0-01 and M0-04 complete. M0-02 needs an iOS simulator repair: the earlier `Booted` state was insufficient evidence of completed startup. M0-03: both native builds and both JavaScript bundles pass. Android installs and starts React, but its pairing screen is not verified. iOS cannot complete simulator startup. Work stopped under playbook §8: free disk reached 736 MiB during Android startup, and iOS reset approval is pending. Neither native pairing-screen launch nor M1 acceptance is claimed. The existing designer feedback list was linked to the owner in the task.

All work uses /Users/sidmishra/Desktop/Projects/mobile_redesign on mobile_redesign (initially clean). The initial task directory was the desktop checkout; no edits were made there.

## Plan and design review (M0-01)

- Read root/mobile AGENTS, README, decisions, phases and playbook. Read the supporting document introductions, conventions, relevant setup/architecture sections and feedback handoff; skimmed the approach and all nine research reports. Their older code/version claims are background and are checked against merged code as each task starts.
- pnpm install passed before and after integration. Workspace CLI/relay bin warnings remain; no install failure.
- All 131 mobile boards rendered in both modes: 262 PNGs, zero failures. Inspected every image through 44 contact sheets, both platform halves; inspected MFoundations and MComponents individually. Full-resolution inspection and CSS measurements continue per implementation task.
- Inspected both modes of desktop Home, ChatNarrow, Pairing, Components, Foundations and DockTerminal (12 renders).
- Public mobile artifact opens in the browser. Embedded artifact version 1790412505-d42b matches the committed VERSION. Earlier private-link question is resolved.
- Workflow plan artifact also opens in the browser: v1.2, embedded version 1790247569-0106. Its architecture agrees with the merged definition/invocation/engine contracts.
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
| gai-iphone | iPhone 18 Pro; fresh A7E28FC9-BAC6-4D32-895A-31B06B505DB5 completed migration, installed and launched GeneratorAI; pairing screen still unverified (recovery below) |
| gai-ipad | iPad Pro 13-inch (M5) (16GB), created |
| JDK | Zulu 17.0.20.1 |
| Android SDK | /Users/sidmishra/Library/Android/sdk |
| Android tools | adb package 37.0.1, emulator 37.1.11 |
| Android image | android-36/google_apis/arm64-v8a installed successfully |
| Android API 37 | SDK repository reports platforms;android-37 unavailable; permitted API 36 fallback used; API 37-specific checks pending |
| Android AVDs | gai-phone (pixel_9), gai-tablet (pixel_tablet) created; gai-phone reports sys.boot_completed=1 through adb |
| Maestro | 2.10.0 installed from the official release; version command passed; no shell profiles changed |
| Gradle | 9.3.1 runs with Zulu JDK 17 |
| agent-device | pinned repo dependency lands in M1-03 |

Android's complete boot check passes. iOS initially reported Booted, but its subsequent full boot-status and screenshot checks expose a data migration failure; M0-02 is reopened. On this 8 GB host, Android boots with only one emulator running, 2048 MB RAM, two cores and host graphics. Build and run platforms sequentially. Gradle's worker limit does not cap Ninja's compiler jobs; use two native compile jobs as well. Concurrent native builds drove swap above 11 GB and free disk below 4 GB; stopping Android restored headroom.

Environment paths are task-local; no shell profiles changed. No password or sudo operation performed.

## Native launch and sandbox (M0-03)

Sandbox started and the desktop walkthrough completed with scripts/redesign/sandbox.mjs from this worktree, API 3197 / web 5197, fresh temporary database and Faux provider. No real database/server used. It was stopped after the walkthrough to free RAM for native builds; restart it before device pairing.

The first expo run:ios --device gai-iphone generated the CNG project and installed 121 pods, but Expo CLI 57.0.11 treated the simulator as a physical device and requested signing. xcodebuild -showdestinations correctly identifies it as an iOS simulator. Direct xcodebuild with iphonesimulator SDK, the named simulator destination, CODE_SIGNING_ALLOWED=NO, two jobs and index-store generation disabled completed with BUILD SUCCEEDED (exit 0). Local log: apps/mobile/.expo/m0-ios-build.log; app: .expo/native-build/ios/Build/Products/Debug-iphonesimulator/GeneratorAI.app (156 MB). An ExpoModulesJSI nested-build diagnostic matched [Expo issue 50311](https://github.com/expo/expo/issues/50311), but its framework and final app build succeeded; no dependency patch was needed.

Both Metro bundles pass: iOS 2,960 modules; Android 3,053 modules. Android CNG, Gradle compilation and APK packaging pass (BUILD SUCCESSFUL; 487 tasks, 76 executed / 411 up-to-date on the final invocation). The first Gradle build was stopped deliberately during app CMake compilation to relieve memory pressure, preserving its cache. Completed the remaining app targets with Ninja -j2, then reran Gradle. APK: android/app/build/outputs/apk/debug/app-debug.apk (108 MB). Local logs are .expo/m0-android-build.log, .expo/m0-android-native.log, .expo/m0-android-package.log and .expo/m0-metro.log.

Android boot again returned sys.boot_completed=1; adb install returned Success. The first launch could not load JS because Expo --localhost bound only to IPv6 ::1, whereas Android connected to 10.0.2.2:8081. Restarting Metro with NODE_OPTIONS=--dns-result-order=ipv4first binds 127.0.0.1 and fixes the status request. No app code or OS configuration change was needed (an attempted nonpersistent metro.host property was rejected and did not change it). On retry, Metro served 3,051 modules, ReactHost reported isMetroRunning=true and ReactNativeJS logged Running main. The last screenshot was still blank during startup; do not count this as a successful pairing-screen launch. Logs: .expo/m0-metro-ipv4.log, .expo/m0-android-runtime.log; screenshot: .expo/m0-android-startup.png.

Free disk dropped to 736 MiB (701 MiB shortly after stopping). Stopped the task's Android emulator and Metro to prevent further pressure; iOS and the sandbox are also stopped. Owner action: free at least 20 GB before the next native run. No files outside the worktree were deleted. Memory pressure may have contributed to slow startup, but the Android blank screen's cause is not established; recheck after restoring headroom rather than declaring a pass.

iOS launch is blocked before GeneratorAI starts. The phone remained on the Apple logo during initial data migration, and installation waited without completing. After a data-preserving shutdown/reboot, simctl bootstatus reported Status=3, Data Migration Failed. A second screenshot still shows the Apple logo; installation again waits. CoreSimulator is 1171.7 and xcodebuild -checkFirstLaunchStatus passes. Xcode 27 uses Device Hub at /Applications/Xcode.app/Contents/Applications/DeviceHub.app, replacing the old Simulator app ([Apple documentation](https://developer.apple.com/documentation/xcode/device-hub)); its absence at the old path is not an incomplete Xcode installation. Local evidence: .expo/m0-ios-screen.png, .expo/m0-ios-reboot.png, .expo/m0-migration.log and .expo/m0-simulator-errors.log.

Requested approval to erase and recreate only the task-created gai-iphone (6C70CB8C-B744-4E07-AEFF-26D2F805D1C2), because its data lives outside the worktree and playbook §8 requires confirmation. No erase performed. Other simulators and compiled artifacts are preserved. Android verification can proceed independently. Pairing and baseline screenshots remain M1-04.

## Disk recovery (owner-authorized, 2026-09-27)

The owner asked to inspect storage and clean temporary files. Removed 287,113 stale regular cache files (7,888,448,954 bytes, about 7.35 GiB): Chrome HTTP/code caches, Homebrew download cache, Node compile cache and four abandoned Playwright download archives. Each file was older than 24 hours and rechecked for unchanged size/mtime before removal; symlinks were not followed. Browser profiles, downloads, personal media, SDKs, simulator data, current dependencies and active updater caches were preserved. Local report: apps/mobile/.expo/cleanup-report.json.

The broad read-only scan found large personal media/download folders and many older agent worktrees. Dependency cleanup is limited to unlocked, inactive worktrees with clean source state, unchanged HEAD, ignored/untracked node_modules, no patch directory and no active process or open file under the worktree. Only their root node_modules directories are removed; source, branches and worktree registrations remain. pnpm install can restore the dependencies. Current mobile and desktop dependencies and active/locked agent worktrees are excluded. Local manifests and verification results are in apps/mobile/.expo/worktree-cleanup-*.json. Completed all 16 eligible worktrees and rechecked every one afterward: source status clean, HEAD unchanged, root node_modules absent. Free space was 12.5 GiB at cleanup completion while iOS and Metro were running, versus roughly 2.6 GiB at this session start. The growing system swap means this is a net free-space reading, not a precise total of bytes reclaimed from dependencies.

Rebooting the original gai-iphone after cleanup still returned Data Migration Failed. Preserved it as gai-iphone-migration-failed (6C70CB8C-B744-4E07-AEFF-26D2F805D1C2); created a fresh gai-iphone (A7E28FC9-BAC6-4D32-895A-31B06B505DB5). No simulator was erased. The fresh phone completed first-boot migration in 5m50s (bootstatus Finished), installed the already-built app successfully, launched GeneratorAI and loaded its 2,958-module JS bundle. Preferences initialized, but the last inspected screen still shows the app splash. No fatal app error was logged; the blank/splash startup cause is not established. Local evidence: .expo/m0-fresh-ios-boot.log, m0-ios-install.log, m0-ios-launch.log, m0-final-metro.log and m0-ios-pairing.png (despite that filename, it shows the splash, not a passing pairing screen). Android's retry reached the app splash and downloaded its Metro bundle, but did not complete the pairing-screen check before it was stopped. Host swap reached about 9 GB on an 8 GB Mac, and Device Hub UI inspection timed out. Native process sampling took minutes; after interruption it produced .expo/m0-ios-sample.txt. Its limited sample shows UIKit keyboard preloading on the main thread and React runtime scheduling on the JS thread; it does not establish a deadlock or identify a code fix. Both phones, Metro and the sandbox are stopped at handoff (simctl Shutdown, adb has no devices, port 8081 has no listener). Final df reading after shutdown: about 12 GiB available; macOS swap reclamation is asynchronous. Neither pairing-screen launch is counted as passing. This recovery record supersedes the earlier request to erase gai-iphone: no erase is needed to repeat the next check on the fresh phone.

## Owner-confirm defaults and designer handoff (M0-04)

Use the written defaults: MD-04 workflow list editing without edge editing; MD-42 opt-in crash reporting off by default; MD-96 no mobile Widget pane tab. No alternative is adopted.

Designer handoff: [10-design-feedback.md §3](../10-design-feedback.md#3-send-to-designer-paste-ready), 135 paste-ready send items. Build follows the recorded resolutions without waiting; no external message was sent.

## Next

Owner action: save work and restart the Mac to clear the persistent host memory pressure; leave unused apps and other builds closed for the native checks. Then restart Metro with IPv4-first DNS, boot one phone at a time, and reuse the built APK/.app to verify both pairing screens. Use the fresh gai-iphone above, preserving the failed original. If the splash remains after the host recovers, debug the app startup with native logs/inspector before M1. M0 remains blocked under playbook §8 (exit criterion fails after reasonable effort); the cleanup is complete, but no M1 source change is claimed. Keep the API 37 limitation explicit. Native baseline screenshots and characterization belong to M1-04.

Documentation-only Done-loop: typecheck/lint already passed; related TS/token tests do not apply. Bootstrap skips: design ratchet until M1-05, Jest until M1-06, fingerprint until M1-02, device walkthrough tooling until M1-02/M1-03, Maestro until M1-04.
