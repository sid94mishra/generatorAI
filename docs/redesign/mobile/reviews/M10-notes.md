# M10 notes — lockdown and store readiness

Evidence for M10-02…M10-06 that is not a decision (decisions are MD-192 onward). Device runs are the owner's; each
section ends with the exact commands.

## 1. M10-02 — Maestro covers the screens

The web-preview Playwright scripts are deleted (`apps/mobile/e2e/*.mjs` except the a11y checker). Route families and
the flow that exercises them (smoke = tagged `smoke`; everything else runs in the full suite):

| Route family | Flow(s) |
|---|---|
| `/pair`, `/paired` | `pairing/pair-via-link` (smoke) |
| `/` Home, `/needs-you` | `home/home` (smoke), `approvals/clear`, `navigation/tour`, `navigation/deep-links` |
| drawer, search palette, servers | `navigation/tour`, `navigation/android-back`, `search/palette` (smoke), `servers/switch` |
| `/chats`, `/chats/new` | `chats/archive-unarchive` (smoke), `chats/new-chat` (smoke) |
| `/chats/[id]` + composer, Turn sheet, model picker | `chat/send-stream`, `chat/send-stream-approve`, `chat/two-phase-stop`, `chat/composer-extras`, `chat/model-pick` |
| `/chats/[id]/gate/[interactionId]`, notification actions | `chat/send-stream-approve`, `notifications/approval-action` |
| pane tabs, `/workspaces/[id]/{diff,commit}` | `pane/tabs`, `pane/browser`, `changes/keep-undo-commit`, `terminal/open-type` |
| `/projects/**` | `projects/create-tabs-delete`, `projects/codebase` (new in M10-02) |
| `/agents/**` | `agents/create-delete` |
| `/automations/**` | `automations/create-run` |
| `/scripts/**` | `scripts/list-detail` |
| `/workflows/**` (list, detail, new, builder, stage editor, settings, run sheet, run, stage chat, run pane, graph) | `workflows/*` (7 flows) |
| `/settings/**`, `/scope-request` | `settings/sections`, `settings/system`, `settings/device`, `settings/scope-request`, `settings/theme-switch`, `auth/companion-scopes` |

Not covered by a flow, with the reason:

| Screen | Why | Covered instead by |
|---|---|---|
| `/chats/[id]/steps/[stepId]` | the step row's id is the Faux tool call's id, unknown to the flow | Jest (`TranscriptView.test.tsx` opens a step) + device walkthrough |
| `/agents/import` | needs the system document picker | device walkthrough (MV-30) |
| `/share` | opened by another app's share sheet, not a link (MD-190) | device checklist (§6 of this file, M9 list) |
| `/revoked` | needs the device revoked on the server mid-run | device walkthrough |
| `/projects/[id]/skills/**`, codebase logs, PR detail | no seeded skill / remote / PR in the sandbox | device walkthrough (MV-30); `links.json` smoke |
| dev routes `/live`, `/notify`, `/storybook`, `/theme` | development aids | `/theme` is used by `settings/theme-switch`; `/notify` by `notifications/approval-action` |

New env for flows: `PROJECT_ID`, `CODEBASE_ID` (the seeded project and the Edits fixture's codebase;
`scripts/mobile/lib/sandbox-maestro.mjs`).

**Owner run** (both platforms, after `sandbox-pair.mjs pair`):

```sh
node scripts/mobile/sandbox-pair.mjs maestro --platform=ios --udid=<udid> -- test apps/mobile/.maestro
node scripts/mobile/sandbox-pair.mjs maestro --platform=android --serial=<serial> -- test apps/mobile/.maestro
```

## 2. M10-03 — VRT and performance budgets

Built (MD-194): `scripts/mobile/vrt.mjs` (+ `lib/vrt-plan.mjs`, Node tests), `.rnstorybook/vrtMode.ts`,
`scripts/mobile/perf.mjs` (+ `lib/perf-budgets.mjs`, Node tests), `apps/mobile/perf/budgets.json`,
`apps/mobile/.maestro/perf/{streaming,transcript-scroll}.yaml`. `vrt --list`: 99 stories, 485 captures per device
(two verification stories skipped). Nothing was captured or measured here: both need simulators.

**Owner run — VRT baselines (MV-26).** Per platform, phone first (tablet optional):

```sh
# 1. Metro in VRT mode (leave it running)
cd apps/mobile && EXPO_PUBLIC_STORYBOOK=1 EXPO_PUBLIC_VRT=1 pnpm start
# 2. the booted gai-iphone / gai-phone paired with the sandbox
node scripts/mobile/sandbox-pair.mjs pair --platform=ios
node scripts/mobile/sandbox-pair.mjs pair --platform=android
# 3. record (writes apps/mobile/vrt/baselines/<platform>/phone/*.png + META.json), then check it is stable
node scripts/mobile/vrt.mjs --platform=ios --device=phone --update
node scripts/mobile/vrt.mjs --platform=ios --device=phone          # expect 0 diffs; flaky stories → parameters.vrt.skip
node scripts/mobile/vrt.mjs --platform=android --device=phone --update
node scripts/mobile/vrt.mjs --platform=android --device=phone
# 4. commit the baselines: mobile(M10-03): VRT baselines (<platform> phone)
```

Disk: roughly 485 PNGs per device (iOS 1x, Android 0.4 scale); check the size before committing a tablet set.

**Owner run — perf** (release builds; `npx expo run:ios --configuration Release`, `npx expo run:android --variant release`):

```sh
node scripts/mobile/perf.mjs --platform=ios --batch=F
node scripts/mobile/perf.mjs --platform=android --batch=F
# later batches: --previous=F to judge the ≤ 10 % regression
```

Results: `docs/redesign/mobile/reviews/F/perf.json`. Real-phone absolute numbers: the same scenarios by hand on the
owner's phones (08 §4.7).

## 3. M10-04 — Accessibility audit

Static results (MD-195): the Jest story sweep (99 stories × iOS + Android) and the palette contrast test (18 themes ×
2 modes × 7 accents) report **no findings**. Existing tests already pin the MD-28 floors, Dynamic Type caps, hit
frames, custom actions and focus trapping. No `hitSlop` is used, so `e2e/a11y-allow.json` stays empty.

**Owner run** (each platform; app paired, Metro or a release build running):

```sh
# routes at the default text size, then the Dynamic Type sweep (AX5 / font scale 2.0)
node scripts/mobile/a11y-audit.mjs --platform=ios --batch=F
node scripts/mobile/a11y-audit.mjs --platform=ios --batch=F --text-size=ax
node scripts/mobile/a11y-audit.mjs --platform=android --batch=F
node scripts/mobile/a11y-audit.mjs --platform=android --batch=F --text-size=ax
# iOS XCUITest audit (contrast, element detection, hit region, descriptions, Dynamic Type, clipping, traits)
cd apps/mobile && GAI_A11Y_AUDIT=1 npx expo prebuild -p ios --clean
xcodebuild test -workspace ios/GeneratorAI.xcworkspace -scheme GeneratorAIUITests \
  -destination 'platform=iOS Simulator,name=gai-iphone' -resultBundlePath "$TMPDIR/a11y.xcresult"
xcrun xcresulttool get test-results tests --path "$TMPDIR/a11y.xcresult" > "$TMPDIR/a11y.json"
npx expo prebuild -p ios --clean
```

By hand: Android Accessibility Scanner on `gai-phone` over Home, a chat, the pane, Settings (findings →
`reviews/F/a11y-android-scanner.md`); VoiceOver / TalkBack order on the chat screen (header → transcript → composer);
Reduce Motion (Settings › Accessibility) and iOS Reduce Transparency (glass becomes opaque).
