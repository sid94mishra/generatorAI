# Mobile end-to-end harness (Expo web preview at phone size)

These Playwright scripts drive the mobile app the way a person does — tap, type, wait — in the
Expo **web preview** at an iPhone-sized viewport (393×852 @3x, touch), against an **isolated**
GeneratorAI server. They exist because this repo's mobile logic tests are node-only and cannot
catch "the card rendered but under a key nobody reads" class of bugs; every defect listed in
`docs/MOBILE_STANDALONE_CLIENT_PLAN_2026-09.md` §12 was found by one of them.

They are **not** a substitute for a device build: the WebView surfaces (terminal renderer),
biometrics, push actions, haptics and native gestures need `eas build` on a phone. The scripts say
so where it matters ("Terminal needs the device build").

## One-time setup

```powershell
# 1. Isolated server (fresh data dir → prints a bootstrap pairing URL once, valid 10 min)
$env:E2E_HOME = "C:/gaimob"            # short path; deep paths break git checkpoints
mkdir $env:E2E_HOME/data, $env:E2E_HOME/ws, $env:E2E_HOME/art -Force
cd apps/server
$env:GENERATORAI_SECRET_KEY = (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
$env:HARNESS_TYPE="claude-agent"; $env:GENERATORAI_BIND_HOST="127.0.0.1"; $env:PORT="3111"; $env:WIDGET_PORT="3121"
$env:DB_PATH="$env:E2E_HOME/data/data.db"; $env:WORKSPACES_DIR="$env:E2E_HOME/ws"; $env:ARTIFACTS_DIR="$env:E2E_HOME/art"
npx tsx --import ./src/instrumentation.ts src/index.ts

# 2. Expo web preview — MUST be port 8081 or 8082 (the server's dev CORS allow-list); CI=1 = no file watching
cd apps/mobile
$env:CI="1"; npx expo start --web --port 8081

# 3. Pair the "phone" (fresh browser profile) with the bootstrap URL in $E2E_HOME/data/bootstrap-pairing.json
cd apps/mobile/e2e
node pair.mjs --fresh
```

Environment knobs: `APP_URL` (default `http://localhost:8081`), `SERVER_URL`, `E2E_HOME`,
`E2E_PROFILE` (one persistent Chromium profile per paired device — **never copy a profile**: the
copy rotates the resume credential and the original is logged out), `E2E_OUT` (screenshots),
`E2E_CHROME`, `PAIR_URL` / `PAIR_FILE` (pairing link for `pair.mjs`).

## Scripts

| Script | What it proves |
|---|---|
| `pair.mjs [--fresh]` | manual-code pairing → consent → tab shell |
| `tour2.mjs` | every top-level route renders with no console errors (screenshots) |
| `chat.mjs` | New chat sheet → send → live streaming → Stop appears |
| `gatelive.mjs` | Turn options → Ask me → tool prompt → in-chat permission card → Allow → Changes pane → diff → Stop |
| `panes.mjs <chat>` | Changes / Terminal / Browser panes, More sheet tabs, Stop, long-press menu |
| `stop.mjs <chat>` | Stop while a permission is pending clears the gate (two-phase stop wire) |
| `clear.mjs` | Deny every stale gate from the Approvals sheet |
| `companion.mjs <chat>` | a companion-scope device streams (read:activity), panes lock honestly, request-access sheet |
| `legacy.mjs <chat>` | a device WITHOUT read:activity gets the explanatory strip and its chat stream still connects |
| `request.mjs` / `approveadmin.mjs` / `unlocked.mjs <chat>` | scope request → admin approve (confirm sheet + step-up) → phone unlock |
| `flow3.mjs <chat>` | rename, slash strip, @ mentions, attach menu, agents, accessibility, chat swipe |
| `modelterm.mjs <chat>` | model pick, turn options, terminal tab create, browser start |
| `unarchive.mjs` | Archived tab → row menu → Move to active |
| `light.mjs <chat>` | light mode + alternate theme screenshots |
| `net2.mjs <chat>` | network timeline of a streaming turn |

Pass chat routes as `/chats/<id>`; on Git Bash set `MSYS_NO_PATHCONV=1` so the leading slash is
not rewritten into a Windows path.

### Second devices

Mint invites through a paired CLI (`apps/cli`): `device invite --data-dir $E2E_HOME/data --platform cli`
pairs the CLI (bootstrap channel, full access), then `device invite --platform web --scopes <list>`
mints scoped invites. `--platform mobile` is refused while the server only advertises loopback —
use `web` with the companion scope list for preview tests. Do not pass `--server` after pairing;
it bypasses the connection catalog.

### Harness gotchas

- Hidden navigator screens stay in the DOM on web: filter locators with `locator('visible=true')`.
- Items inside spring-animated sheets fail Playwright's stability check even though a tap works:
  tap by `boundingBox()` + `page.mouse.click` (see `tap` helpers).
- The claude-agent harness takes 10–20 s to reach a tool call and holds one agent slot per
  running chat; stale pending gates ("Waiting for a free agent slot") block new turns — run
  `clear.mjs` first.

## September 2026 audit additions

`E2E_HOME` now defaults to a temporary `generatorai-mobile-e2e` directory on the host OS.
`E2E_CHROME` is optional; set it to an installed Chrome executable or install Playwright's browser.
Run only one script at a time against a persistent profile. Cold Metro navigation has a 90-second budget.

- `audit-scenarios.mjs workflow|panes|automation` uses `AUDIT_FIXTURES`, a JSON file containing
  `workflow.id`, `automation.id`, and `chatId` from an isolated server. It inspects dependencies/prompts,
  starts a workflow, visits chat tools, or triggers a manual automation and checks the response/history.
  Workflow definitions and any associated test project must be created separately.
- `native-audit.mjs inspect NAME` captures the installed Android application's screenshot and
  accessibility hierarchy. `tap LABEL`, `route /path`, `text VALUE`, and `back` perform native actions.
  Set `ANDROID_HOME` or `ADB` and `E2E_OUT`. It never installs an APK or pairs implicitly.
  A screenshot must be inspected for the expected destination; absence of an error is not proof of navigation.

The audit report and selected native/web evidence are in `docs/mobile-audit/`. Pairing files and browser
profiles contain credentials and must stay outside the repository. Native iOS execution needs Xcode;
web phone viewports and an iOS bundle export are not an iOS simulator pass.
