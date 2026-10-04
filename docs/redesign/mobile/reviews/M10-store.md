# M10-05 — store readiness checklist (iOS App Store, Google Play)

Source: `06-platform-and-shell.md` §8.8, MD-196. **Done** = in the repo and checked statically here. **Owner** = needs
App Store Connect / Play Console / a device build; the exact step is given. Nothing here was uploaded or built.

## iOS / App Store

| Item | State | Evidence / owner step |
|---|---|---|
| Xcode 27 / iOS 27 SDK, scene lifecycle | done (SDK 57 + `withSceneLifecycle`; SDK 58 generates it, M3-01) | owner archives with Xcode 27 |
| App icon per appearance | done: `ios.icon = { light, dark, tinted }` (`assets/icon-ios*.png`, `scripts/gen-app-icons.mjs`) | "clear" is system-derived from these PNGs; an Icon Composer `.icon` is a designer follow-up (needs the Icon Composer app) |
| Splash per appearance | done: dark on both appearances, written explicitly (MD-124) | — |
| `PrivacyInfo.xcprivacy` (app) | done: `ios.privacyManifests` — UserDefaults `CA92.1` + `1C8F.1`, FileTimestamp `C617.1` + `3B52.1`, SystemBootTime `35F9.1`, DiskSpace `E174.1`; tracking off; collected: Crash Data (not linked, app functionality) for MD-42 | owner: Archive → *Generate Privacy Report*; reconcile with each pod's own manifest |
| `PrivacyInfo.xcprivacy` (extensions) | done for `targets/notification-service` (UserDefaults `1C8F.1`) and `targets/controls` (nothing) | owner: check the generated `ExpoWidgetsTarget` and `ShareExtension` in the privacy report (plugin-generated; both read the App Group) and add a manifest through their plugins if the report flags them |
| Entitlements | done: `aps-environment` (production for preview / production profiles), App Groups `group.dev.generatorai.app` (app + extensions), time-sensitive notifications; `NSSupportsLiveActivities` (expo-widgets) | owner: enable App Groups + Time Sensitive Notifications on the App IDs `dev.generatorai.app`, `.widgets`, `.share-extension`, `.notification-service`, `.controls`; set `APPLE_TEAM_ID` |
| Info.plist strings | done (reviewed): camera, microphone, Face ID, local network, photo library | — |
| Export compliance | `ITSAppUsesNonExemptEncryption: true` | owner: answer the App Store Connect export questions (DPoP signing, TLS, key wrapping; self-classification) |
| Background modes | `remote-notification` only | — |
| App Review access | owner | see "App Review notes" below |
| Screenshots | owner | 6.9" + 13" iPad from the VRT / walkthrough shots (Instrument dark), light set optional |

## Android / Google Play

| Item | State | Evidence / owner step |
|---|---|---|
| `targetSdk` 36 (37 required by Aug 2027) | done (SDK 57 default) | re-check at SDK 58 |
| Edge-to-edge, large screens | done (SDK 57 edge-to-edge; `orientation: default`; AdaptiveLayout M5-05) | tablet shots (batch) |
| 16 KB page alignment | owner | `"$ANDROID_HOME/build-tools/36.0.0/zipalign" -c -P 16 -v 4 app-release.apk` — every `.so` passes (quick-crypto, MMKV, nitro, Hermes) |
| Adaptive icon + themed (monochrome) | done: `adaptiveIcon.monochromeImage` (`assets/icon-android-monochrome.png`) | — |
| Splash | done (dark, MD-124) | — |
| Permissions | declared: `CAMERA`, `RECORD_AUDIO`, `USE_BIOMETRIC`, `POST_NOTIFICATIONS`; merged from `generatorai-live`: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `POST_PROMOTED_NOTIFICATIONS`, `DETECT_SCREEN_CAPTURE` (expo-screen-capture, normal permission; required on 14+, MD-198); blocked: `READ_MEDIA_IMAGES` | owner: `aapt2 dump permissions app-release.apk` shows nothing else (INTERNET and Expo's defaults aside) |
| Foreground-service declaration | owner | text below + a 30 s screen recording of a run's Live Update |
| Data Safety | owner | notes below |
| R8 mapping retained per release | done with M10-06 (Sentry Gradle upload when the env is set) | `android/app/build/outputs/mapping/release/mapping.txt` archived per release otherwise |

## Store metadata (draft for the owner)

- **Name:** GeneratorAI · **Subtitle (iOS, 30):** "Your agents, on your own server" · **Category:** Developer Tools
  (secondary: Productivity).
- **Short description (Play, 80):** "Run and approve your self-hosted AI coding agents from your phone."
- **Description:** GeneratorAI is the companion app for a GeneratorAI server you run yourself. Pair it once by QR
  code, then follow your agents' chats and workflow runs, answer the questions they ask, approve risky actions with
  Face ID / your fingerprint, review changes and commit, and get notified when something needs you — with Live
  Activities, widgets and quick actions. The app talks only to your server; there is no GeneratorAI cloud account.
- **Keywords (iOS):** agents, AI, coding, self-hosted, approvals, workflows, git, terminal, developer.
- **Support URL / privacy policy URL:** owner (the project site); the policy states that the app sends data only to
  the server the user pairs, and optional crash reports to a DSN the user enters.
- **Age rating:** 4+ / Everyone (no user-generated public content; the server is the user's own).

## App Review notes (iOS) and Play access instructions

> GeneratorAI is a client for a self-hosted server and cannot be used without one. We run a review server for you:
> open `https://<demo-host>` (credentials below) in a browser, go to Settings › Security & devices › Pair a new device,
> and scan the QR code with the app (or tap "or enter the code" and type the 12-character code and the address shown).
> Codes expire after 10 minutes — create a new one if needed. The demo server runs a scripted agent: open the
> "Demo — approval" chat to see an approval card; Allow once asks for Face ID because the action is marked risky.
> Demo account: `<user>` / `<password>`. A screen recording of the whole flow is attached.

Owner: host the demo server (a seeded server with the Faux harness, like the sandbox) on a reachable HTTPS address, and
record the walkthrough.

## Play Data Safety notes

- Data collected **by the developer**: none. All app data (chats, prompts, files, device key, push token) is sent only
  to the server the user pairs, which the user operates. Declare per Play's definitions as the owner decides; the
  conservative reading declares "App activity / App interactions" and "Files and docs" as *shared with the user's own
  server, not collected*.
- Crash logs: **optional**, off by default, sent only to the Sentry-compatible DSN the user enters (MD-42) — declare
  "Crash logs" as optional collection for app functionality if the policy counts a user-supplied endpoint.
- Encryption in transit: HTTPS / relay when the server provides it; plain HTTP is allowed only on loopback, private
  LAN ranges and `.local` (the pairing offer decides) — answer "not all data is encrypted in transit".
- Data deletion: unpairing removes everything on the device; server data is deleted on the user's server.

## Foreground-service declaration (Android 14+, `specialUse`)

> **Type:** specialUse — "Live progress of an agent run the user started". While a workflow run or chat the user
> started from this device is active, the app shows a promoted ongoing notification with the run's stage progress and
> whether it needs the user's decision (Android 16 Live Update). The service runs only while the app started it from
> the foreground and stops when the run ends or the app is swiped away; it does no work in the background besides
> updating that notification from local state. No other foreground-service type fits: it is not media, location,
> data sync or a phone call.

Attach a 30 s recording: start a run from the app, leave the app, show the status-bar chip and the notification.
