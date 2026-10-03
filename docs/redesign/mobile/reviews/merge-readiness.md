# Merge readiness — `mobile_redesign` → `desktop_redesign` (M10-07)

State on 2026-10-03, branch `mobile_redesign` after the M10 commits and the final review (`final-review.md`).

## 1. Where the branches stand

- `desktop_redesign` already merged `mobile_redesign` up to **M10-04** (`bc3eeb3d`, merge base `d2a17457`; its
  `pnpm-lock.yaml` conflict was resolved there). `desktop_redesign` also has 5 commits this branch has not merged
  (review-2 test hardening and close-out, P8-01 Vite 8, P8-02 React Compiler for web, sandbox `--clean` fix); none
  touches `apps/mobile`.
- Not yet in `desktop_redesign`: M10-05 (store readiness), M10-06 (crash reporting), the final-review fixes and the plan
  sweep. Outside `apps/mobile/**` and `docs/redesign/mobile/**` they touch `pnpm-lock.yaml` (+209 lines:
  `@sentry/react-native` 7.11.0 and its dependencies) and `packages/client-core` (`auth.unregisterPush` + its test). A trial merge (`git merge-tree`) shows `pnpm-lock.yaml` changed
  on both sides **without conflicting hunks**; after the merge run `pnpm install --frozen-lockfile` to confirm.

## 2. What the mobile branch changed outside the app (all logged in `COORDINATION.md`)

| Area | Changes | Compatibility |
|---|---|---|
| `packages/db` | **v64** `chat_pin_and_read_state` (MG-02: `chats.pinned_at`, `last_read_at` + list indexes), **v65** `device_approval_key` (MG-05: `auth_devices.approval_public_jwk`, `approval_key_created_at`, `approval_key_presence`). There is **no v66**. `migrations.lock.json` holds both hashes. | additive columns / indexes; already in `desktop_redesign` |
| `apps/server` | MG-02 pin / unread, MG-03 model label, MG-04 risk flag, MG-05 approval-key routes + proof verification (chat gates; stage approvals and risky stage permissions from mobile devices, MD-177), MG-06 push payload v2 (+ `'time-sensitive'` bug fix), MG-21 artifact download, MG-22 wrappers, M7-09 gaps (own device, remote refs, import preview, SCM outcomes, dictation language, scope vocabulary), MG-09 `POST /chats/ingest`; openapi appended; route tests | additive; the proof rule binds mobile principals only; push v2 is a contract change whose only consumer is mobile |
| `packages/shared` | `ui-contract/` (deep links, copy keys, chats row fields, pane run tabs, notifications vocabulary), `security/gateRisk.ts`, `security/approvalProof.ts`, `types/Push.ts` part B, `types/ChatIngest.ts` | additive exports |
| `packages/client-core` | `auth.unregisterPush` (plan sweep, not yet in desktop), transcript inputs, step status, SCM API, attention route, chats list fields, `admin.browser.input`, `terminals.create` shell, `runs.approveStage`, `chats.ingest`, `live/` model; `agents.remove` sends `?force=1` (bug fix) | additive (+ one fix) |
| `packages/auth`, `packages/core` | approval-proof verifier; push dispatcher / Expo provider v2 | additive / mobile-only consumers |
| `packages/design-tokens` | mobile vocabulary, `GEOMETRY.ios/android`, motion, haptics, glass, accent-from-seed, Uniwind emitter, native palettes, mobile icon concepts | additive; web untouched (`check:tokens` green) |
| scripts | `scripts/mobile/**` (new), `scripts/redesign/sandbox.mjs` port / Faux options (additive) | mobile tooling |
| root | `AGENTS.md`, `eslint.config.mjs` (mobile config import), `package.json` (`agent-device` pin, `pnpm.patchedDependencies` for `@bacons/apple-targets`), `patches/@bacons__apple-targets@5.0.0.patch`, `pnpm-lock.yaml` | additive |

## 3. Open items (owner, external or deferred)

- **Blocked — external**: SDK 58 (`expo` `latest` is 57.0.26; 58.0.2 is `next`) → M3-01 / M3-02, Android widgets
  (MD-188). `uniwind` `latest` is 1.12.1 (current).
- **Owner — devices**: everything in §4.
- **Owner — accounts / consoles**: App IDs with App Groups + Time Sensitive Notifications for the app and its four
  extensions, `APPLE_TEAM_ID`; EAS secrets `EAS_PROJECT_ID`, `SENTRY_*` (optional); App Store Connect / Play Console
  entries from `M10-store.md` (metadata, privacy, export compliance, Data Safety, FGS declaration, reviewer demo
  server); a test Sentry / GlitchTip DSN.
- **Deferred decisions**: Read aloud / push-to-talk wiring or deletion (final review F-6); Icon Composer `.icon`
  (F-7).

## 4. Device checklist before the overhaul can be called complete (in order)

```sh
# 0. sandbox server with the mobile routes (push v2, ingest, approval enforcement)
pnpm --filter @generatorai/server bundle
node scripts/mobile/sandbox-pair.mjs stop            # then let sandbox-pair start a fresh one below

# 1. native rebuild (new: @sentry/react-native, icons, privacy manifests, M9 targets; App IDs ready, APPLE_TEAM_ID set)
cd apps/mobile && npx expo prebuild --clean
npx expo run:ios --device gai-iphone && node ../../scripts/mobile/fingerprint.mjs --platform=ios --record
npx expo run:android --device gai-phone && node ../../scripts/mobile/fingerprint.mjs --platform=android --record
cd ../..

# 2. pairing automation (MV-33, MD-192) — Metro running for dev clients
node scripts/mobile/sandbox-pair.mjs pair --platform=ios --udid=<gai-iphone udid> --port=3197
node scripts/mobile/sandbox-pair.mjs pair --platform=android --serial=<emulator serial> --port=3197

# 3. M9 system surfaces (08 §4.9) on both platforms; results → reviews/F/surfaces.md
#    Live Activity / Live Update: generatorai:///live?script=run-needs-you (start, update, needs-you, succeed, end, Review)
#    notifications: iOS `xcrun simctl push <udid> dev.generatorai.app apps/mobile/e2e/push/<case>.json`,
#                   Android `generatorai:///notify?case=<case>`; inline Allow / Deny resolves the gate; risky → opens app
#    widgets (iOS): add Needs you / Running / Summary once, watch them follow the live script
#    Control Center control (iOS) / Quick Settings tile (Android): New chat sheet opens
#    quick actions: long-press the icon → 4 items → each screen
#    share: iOS Files → Share → GeneratorAI; Android
#           adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "hello" -n dev.generatorai.app/.MainActivity
#    app-switcher privacy: content hidden with the preference on
#    risky approval signing on a REAL phone (MV-29): register → Allow once → 202 + approval.signed audit

# 4. the Maestro suite (smoke + full) on both platforms (M10-02)
node scripts/mobile/sandbox-pair.mjs maestro --platform=ios --udid=<udid> -- test apps/mobile/.maestro
node scripts/mobile/sandbox-pair.mjs maestro --platform=android --serial=<serial> -- test apps/mobile/.maestro

# 5. walkthrough of every screen family, phone + tablet, iOS + Android (MV-28…MV-32): agent-device + a11y-check

# 6. VRT baselines (MV-26) — Metro with EXPO_PUBLIC_STORYBOOK=1 EXPO_PUBLIC_VRT=1
node scripts/mobile/vrt.mjs --platform=ios --device=phone --update && node scripts/mobile/vrt.mjs --platform=ios --device=phone
node scripts/mobile/vrt.mjs --platform=android --device=phone --update && node scripts/mobile/vrt.mjs --platform=android --device=phone

# 7. perf on release builds (M10-03)
node scripts/mobile/perf.mjs --platform=ios --batch=F
node scripts/mobile/perf.mjs --platform=android --batch=F

# 8. accessibility (M10-04): routes + Dynamic Type sweep, XCUITest audit, Accessibility Scanner by hand
node scripts/mobile/a11y-audit.mjs --platform=ios --batch=F && node scripts/mobile/a11y-audit.mjs --platform=ios --batch=F --text-size=ax
node scripts/mobile/a11y-audit.mjs --platform=android --batch=F && node scripts/mobile/a11y-audit.mjs --platform=android --batch=F --text-size=ax
#    XCUITest: reviews/M10-notes.md §3

# 9. crash reporting against a test DSN (M10-06): reviews/M10-notes.md §4

# 10. release-mode smoke (MV-24): expo run:ios --configuration Release, Android assembleRelease + 16 KB zipalign check
```

When 1–10 pass, close the MV items in `PENDING.md`, mark M1–M10 device-complete in the README and merge.
