# 08 — Verification, tooling and review evidence (mobile)

How the mobile overhaul is verified: machine setup, the isolated sandbox and pairing, the per-task Done loop, the
per-batch checks, tool conventions, the characterization flows written before any change, the testID policy, and the
evidence each batch leaves for the independent reviewer. It mirrors the web loop (`docs/redesign/09-verification.md`
§6) for native apps. §3.1 is the source of the per-task loop; `apps/mobile/AGENTS.md` mirrors its text block verbatim,
and a change to one is made to both in the same commit.

**Rules that shape everything below.**
- Verification drives the **real app** on an iOS simulator and an Android emulator, like a user. Unit tests alone are
  not enough.
- The app pairs only with the **sandbox** (`scripts/redesign/sandbox.mjs`, port 3197, temp DB, Faux harness), never with
  the developer's server on :3100 or their real database.
- Git and source-control features are tested against a throwaway repo (`node scripts/redesign/make-dummy-repo.mjs`),
  never this checkout.
- Scripts are Node `.mjs`, use `path` and `os.tmpdir()`, and run on macOS, Windows and Linux (Windows and Linux run the
  Android half, §1.4).
- **Owner batching rule.** Per task, keep checks fast (§3.1). The expensive checks (appearance matrix, VRT, full Maestro
  suite, release perf, audits) run **once per batch** in one combined test and review round (§3.2). Never spend time
  testing or repairing legacy code: the web-preview e2e scripts are frozen (§6.3).
- Codex may or may not have MCP servers. Every step below has a CLI path; MCP is optional convenience.

Scripts named here, and the phase that builds them: `scripts/mobile/render-boards.mjs` (exists),
`scripts/mobile/compare.mjs` (exists), `scripts/mobile/doctor.mjs` (M1-02), `scripts/mobile/sandbox-pair.mjs` (M1-02),
`scripts/mobile/fingerprint.mjs` (M1-02), `apps/mobile/e2e/a11y-check.mjs` (M1-03), `scripts/mobile/vrt.mjs` (M4-10).

---

## 1. Machine setup

### 1.1 macOS (the full loop: iOS + Android)

Run once per machine. The Mac is **not** ready today (SE §0): `xcode-select` points at the Command Line Tools, there is
no JDK, only an android-35 image exists, `adb` is not on `PATH`, and Maestro and agent-device are not installed.

```sh
# ── 1. Xcode 27 (OWNER ACTION: needs sudo) ───────────────────────────────
sudo xcode-select -s /Applications/Xcode.app
sudo xcodebuild -license accept
xcodebuild -version                      # expect Xcode 27.x
xcodebuild -downloadPlatform iOS         # only if `xcrun simctl list runtimes` shows no iOS 27 runtime

# ── 2. JDK 17 (Maestro and Gradle need it) ─────────────────────────────
brew install --cask zulu@17
echo 'export JAVA_HOME="$(/usr/libexec/java_home -v 17)"' >> ~/.zprofile
source ~/.zprofile && java -version              # expect 17.x

# ── 3. Android SDK on PATH ────────────────────────────────────────────────
brew install --cask android-commandlinetools        # skip if Android Studio already installed cmdline-tools
cat >> ~/.zprofile <<'EOF'
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
EOF
source ~/.zprofile
sdkmanager --sdk_root="$ANDROID_HOME" --install "platform-tools" "emulator" "platforms;android-36" \
  "build-tools;36.0.0" "system-images;android-36;google_apis;arm64-v8a"
# Android 17 = API 37: install when Google publishes the stable image
#   (skip until available; B12 checks that need API 37 are then reported as pending)
sdkmanager --sdk_root="$ANDROID_HOME" --install "platforms;android-37" "system-images;android-37;google_apis;arm64-v8a" || echo "API 37 image not available yet"
yes | sdkmanager --licenses

# ── 4. AVDs (names are fixed; scripts and flows use them) ─────────────────
avdmanager create avd -n gai-phone  -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_9
avdmanager create avd -n gai-tablet -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_tablet
sdkmanager --list_installed | grep -q "android-37" && avdmanager create avd -n gai-phone-37 -k "system-images;android-37;google_apis;arm64-v8a" -d pixel_9
#   if `pixel_9` is unknown: `avdmanager list device` and pick the newest Pixel phone id
emulator -avd gai-phone -no-snapshot-save -no-boot-anim &     # boot check; `adb devices` lists emulator-5554

# ── 5. Pinned iOS simulators (names are fixed) ────────────────────────────
xcrun simctl list runtimes            # note the iOS 27 runtime identifier
xcrun simctl list devicetypes         # note the newest "iPhone NN Pro" and "iPad Pro 13-inch (…)" names
xcrun simctl create gai-iphone "iPhone 17 Pro" com.apple.CoreSimulator.SimRuntime.iOS-27-0
xcrun simctl create gai-ipad "iPad Pro 13-inch (M5)" com.apple.CoreSimulator.SimRuntime.iOS-27-0
xcrun simctl boot gai-iphone

# ── 6. Maestro CLI 2.10 ───────────────────────────────────────────────────
export MAESTRO_VERSION=2.10.0 && curl -fsSL "https://get.maestro.mobile.dev" | bash
echo 'export PATH="$HOME/.maestro/bin:$PATH"' >> ~/.zprofile
echo 'export MAESTRO_DRIVER_STARTUP_TIMEOUT=180000' >> ~/.zprofile   # Xcode 27 driver cold start is slow
echo 'export MAESTRO_CLI_NO_ANALYTICS=1' >> ~/.zprofile
source ~/.zprofile && maestro --version

# ── 7. Repo tools (M1-03 adds these as pinned devDependencies) ────────────
pnpm install
./node_modules/.bin/agent-device --version        # 0.21.15 (root devDependency, exact pin)
./node_modules/.bin/agent-device doctor
node scripts/mobile/doctor.mjs                    # must end "ready: ios, android"
```

`apps/mobile/vrt/devices.json` (committed in M1-02) pins the device models and OS images. UDIDs and serials are per
machine and are resolved by name at run time, never committed:

```json
{
  "ios": {
    "phone":  { "name": "gai-iphone", "deviceType": "iPhone 17 Pro",          "runtime": "iOS 27.0" },
    "tablet": { "name": "gai-ipad",   "deviceType": "iPad Pro 13-inch (M5)",  "runtime": "iOS 27.0" }
  },
  "android": {
    "phone":   { "avd": "gai-phone",    "device": "pixel_9",      "image": "system-images;android-36;google_apis;arm64-v8a" },
    "tablet":  { "avd": "gai-tablet",   "device": "pixel_tablet", "image": "system-images;android-36;google_apis;arm64-v8a" },
    "phone37": { "avd": "gai-phone-37", "device": "pixel_9",      "image": "system-images;android-37;google_apis;arm64-v8a" }
  }
}
```

If the device-type names differ on the installed Xcode, M1 records the actual names here; they then stay fixed so
baselines stay comparable. `google_apis` images (not Play Store) are used because they allow `adb root` and demo mode.

### 1.2 `scripts/mobile/doctor.mjs` (M1-02) — what it must do

`node scripts/mobile/doctor.mjs [--json] [--create]`. Checks, in order; each failure prints the exact fix command from
§1.1 and the script exits 1 if a required item for the current OS is missing:

| Check | How | Required on |
|---|---|---|
| Node ≥ 22.13 (22.x) or ≥ 24.3, pnpm 10 | `process.version`, `pnpm -v` | all |
| Xcode selected (not CLT), Xcode ≥ 27 | `xcode-select -p` ends with `Xcode.app/Contents/Developer`; `xcodebuild -version` | macOS |
| iOS 27 runtime; sims `gai-iphone`, `gai-ipad` exist | `xcrun simctl list runtimes --json`, `xcrun simctl list devices --json`; `--create` creates missing sims from `devices.json` | macOS |
| JDK 17+ | `JAVA_HOME` set, `"$JAVA_HOME/bin/java" -version` | all |
| Android SDK | `ANDROID_HOME`, `adb`, `emulator`, `sdkmanager` resolvable (with `.exe`/`.bat` on Windows) | all |
| System images and AVDs | `sdkmanager --list_installed`, `emulator -list-avds`; `--create` creates missing AVDs | all |
| Maestro | `maestro --version` = 2.10.x | all |
| agent-device | `./node_modules/.bin/agent-device --version` = pinned; `agent-device doctor --json` | all |
| Expo | `npx expo-doctor` (from `apps/mobile`) — reported, not fatal | all |
| Ports | 3197 (sandbox), 5197 (sandbox web), 8081 (Metro), 7007 (Storybook) free or owned by the expected process | all |

`--json` prints `{ os, ready: ['ios','android'], versions: {…}, devices: {…} }`; the batch copies it to
`reviews/<batch>/environment.json` (§7).

### 1.3 Xcode 27 Device Hub caveat

Xcode 27 replaced Simulator.app with **Device Hub** (`Xcode.app/Contents/Developer/Applications` is gone). Tools that
look for Simulator.app or old SimulatorKit paths break.

| Broken on Xcode 27 | Works |
|---|---|
| Claude Code's iOS simulator panel (claude-code#95085) | `xcrun simctl` (boot, install, launch, `openurl`, `io screenshot`, `status_bar`, `ui appearance`, `ui content_size`, `push`, `privacy`) |
| XcodeBuildMCP / MobileBuildMCP UI automation (AXe looks for SimulatorKit at the old path, #453) | agent-device ≥ 0.21.14 (the Xcode 27 profiling fix) |
| Maestro Studio and Maestro Viewer live view (#3606) | Maestro CLI (raise `MAESTRO_DRIVER_STARTUP_TIMEOUT`) |
| Anything that runs `open -a Simulator` (today's `apps/mobile/scripts/ios-sim-*.sh`, which are replaced by `.mjs` in M1-02) | `npx expo run:ios`, `xcodebuild test` (XCUITest) |

To watch a simulator, open Device Hub from Xcode (Window menu). The loop never needs a window: everything is headless.

### 1.4 Windows and Linux (Android-only loop)

- **JDK 17:** Windows `winget install EclipseAdoptium.Temurin.17.JDK`; Linux `sudo apt install openjdk-17-jdk`. Set
  `JAVA_HOME`.
- **Android SDK:** install the command-line tools, then the same `sdkmanager` packages as §1.1 with the **x86_64** ABI
  (`system-images;android-36;google_apis;x86_64`). Linux needs KVM (`/dev/kvm` readable); Windows needs the Windows
  Hypervisor Platform feature. `devices.json` names stay the same; `doctor.mjs --create` picks the host ABI.
- **Maestro:** Windows: download the 2.10.0 zip from the Maestro GitHub releases and add its `bin` to `PATH`; Linux: the
  same `curl` installer as macOS.
- **agent-device:** from `pnpm install`; if `agent-device doctor` reports the host unsupported, run it under WSL2 with
  `ADB` pointing at the Windows `adb.exe`.
- **iOS verification** on these hosts comes from either an EAS build + Maestro job (`eas build --profile e2e --platform
  ios`, then the EAS Workflows `maestro` job) or the next macOS batch. The batch summary says "iOS pending" for every
  task not yet verified on iOS (`apps/mobile/AGENTS.md`).

---

## 2. Sandbox, pairing and the dummy repo

### 2.1 Start and pair

```sh
node scripts/mobile/sandbox-pair.mjs                    # starts the sandbox if needed, seeds, pairs every booted target
node scripts/mobile/sandbox-pair.mjs --platform=ios     # only the booted gai-iphone / gai-ipad
node scripts/mobile/sandbox-pair.mjs status             # prints state.json: server, dbPath, paired devices, chat ids
```

When it starts the sandbox it stays attached (logs prefixed `[sandbox]`) until Ctrl-C, which stops the server and web
children cleanly on every OS (sandbox.mjs handles the signal). An agent runs it as a background process and waits for
the line `sandbox-pair: ready`.

### 2.2 `scripts/mobile/sandbox-pair.mjs` (M1-02) — what it must do

State file: `path.join(os.tmpdir(), 'generatorai-mobile-sandbox', 'state.json')` (never in the repo; it holds ids, not
secrets).

1. **Find or start the sandbox.** Probe `GET http://127.0.0.1:3197/api/auth/server-info` (2 s).
   - Not running: spawn `node scripts/redesign/sandbox.mjs` with an `'ipc'` stdio slot and these extra env vars
     (sandbox.mjs spreads `process.env` into the server env):
     `GENERATORAI_ADVERTISED_URLS=http://10.0.2.2:3197` (so the server can mint a mobile offer the Android emulator can
     reach) and `GENERATORAI_SANDBOX_FAUX_SCRIPT=<merged fixture>` (§2.4). Parse the child's stdout for the startup
     `dbPath` and **refuse to continue unless it is under `os.tmpdir()` and contains `generatorai-sandbox-`**. Wait up
     to 90 s for server-info. Record `{ pid, dbPath, startedAt }` in state.json.
   - Running: continue only if state.json records a verified `dbPath` for this server start (same `startedAt` as
     server-info reports, or the same pid alive). Otherwise stop with "a server on :3197 was not started by
     sandbox-pair; stop it and rerun". `--trust-running` overrides after a manual dbPath check.
2. **Check endpoints.** server-info must list `http://10.0.2.2:3197` when Android is targeted; if not, stop with
   "restart the sandbox through sandbox-pair".
3. **Seed (idempotent; `--no-seed` skips).**
   - Dummy repo: run `node scripts/redesign/make-dummy-repo.mjs`, capture the printed `work/` path (reuse the one in
     state.json if it still exists).
   - Through the server API (plain `fetch` to `http://127.0.0.1:3197`; the sandbox allows unauthenticated loopback —
     confirm each path against `apps/server/src/routes/openapi.ts` before coding): a project "Mobile sandbox repo" with
     the dummy repo as its codebase; one chat per mobile fixture key (§2.4), bound to that project.
   - `--fresh=<key>[,<key>]` creates a **new** chat with that fixture name (the Faux script is consumed per
     conversation, so a flow that sends a turn needs a fresh chat per run). The Maestro passthrough (§2.3) does this
     automatically for flows that declare `env: FRESH_CHAT: <key>`.
4. **For each target platform** (booted targets only; `--udid` / `--serial` pick one):
   - Find it: iOS `xcrun simctl list devices booted --json` → `gai-iphone` / `gai-ipad`; Android `adb devices`, then
     `adb -s <serial> emu avd name` → `gai-phone` / `gai-tablet`.
   - Check the app is installed: `xcrun simctl get_app_container <udid> dev.generatorai.app`, or
     `adb -s <serial> shell pm path dev.generatorai.app`. If not, stop with the build command
     (`npx expo run:ios --device gai-iphone` / `npx expo run:android --device gai-phone`).
   - Skip if already paired (state.json has this udid/serial and `GET /api/auth/devices` still lists its device id),
     unless `--repair`.
   - Grant notifications so no permission prompt interrupts flows:
     `./node_modules/.bin/agent-device settings permission grant notifications --platform <p>` (with the target
     selector).
   - Mint a grant: `POST http://127.0.0.1:3197/api/auth/pair` with
     `{ "deviceName": "<gai-iphone|gai-phone|…>", "platform": "mobile", "ttlMs": 600000 }`. The response has
     `pairingUrl` = `generatorai://pair?code=<base64url JSON offer>`.
   - **Point the offer at the host this target can reach.** Decode the `code` (base64url → JSON), set `endpoint` to
     `http://127.0.0.1:3197` for iOS simulators (they share the Mac's loopback) or `http://10.0.2.2:3197` for Android
     emulators (the emulator's alias for the host loopback), move that origin to the front of `endpoints` with
     `priority: 0`, re-encode. The offer carries no signature; the grant token and server key are unchanged, and the
     app still shows the fingerprint consent. (Physical Android devices use `adb reverse tcp:3197 tcp:3197` and the
     `127.0.0.1` form.)
   - Open the link: iOS `xcrun simctl openurl <udid> <url>`; Android
     `adb -s <serial> shell am start -a android.intent.action.VIEW -d <url> dev.generatorai.app` — spawned with an
     argument array (`execFile`), never through a shell string, so the URL is not re-parsed.
   - The app pre-fills the 12-character code and the address and shows "Server found" (`pairing-scanned`); it never
     submits by itself (MD-34). The automation (M7-08 screen, fixed in M10 for MV-33) drives it by testID only:
     `agent-device wait 'id="pairing-scanned"'` → `scroll down --until 'id="pairing-connect"'` → `press` it (consent
     step, unless `--no-confirm`) → `wait 'id="pairing-fingerprint"'` → `scroll`/`press 'id="pairing-confirm"'` (Pair)
     → `/paired` → `press 'id="paired-continue"'` (skips the optional approval-key setup) → Home (`home-new-chat` or
     `menu-button`). The device keeps its default name ("My iPhone", "My phone"): the Name field auto-capitalises, so a
     typed name never verifies on iOS (`fill` → `COMMAND_FAILED`, MD-192).
   - Verify: `GET /api/auth/devices` lists exactly one device that was not there before, not revoked, created in the
     last minute (`findNewPairing`; the target name only breaks ties, case-insensitively). Record
     `{ platform, udid|serial, deviceId, host }`.
5. Print `sandbox-pair: ready` and a summary (server, dbPath, dummy repo path, chat ids per key, paired targets).

Subcommands: `status`, `mint --platform=<p>` (prints a fresh rewritten pair URL for the pairing flow; nothing opened),
`seed [--fresh=<key>]`, `maestro --platform=<p> -- <maestro args>` (§2.3), `stop` (stops a sandbox it started).

### 2.3 Running Maestro against the sandbox

```sh
node scripts/mobile/sandbox-pair.mjs maestro --platform=ios -- test --include-tags=smoke apps/mobile/.maestro
node scripts/mobile/sandbox-pair.mjs maestro --platform=android -- test apps/mobile/.maestro/chat/send-stream-approve.yaml
```

The passthrough resolves the device id, creates fresh chats for flows that declare `FRESH_CHAT`, mints `PAIR_URL` for
flows tagged `pairing`, and spawns `maestro --device <udid|serial> <args> -e KEY=VALUE …` with:

| Env | Value |
|---|---|
| `APP_ID` | `dev.generatorai.app` |
| `PLATFORM` | `ios` / `android` |
| `BUILD` | `dev` (dev client) or `release` (detected from the installed app; release builds have no dev launcher) |
| `METRO_URL` | `http://127.0.0.1:8081` (iOS) / `http://10.0.2.2:8081` (Android), URL-encoded for the dev-client link |
| `SERVER_URL` | `http://127.0.0.1:3197` / `http://10.0.2.2:3197` |
| `PAIR_URL` | fresh rewritten pair link (pairing flows only) |
| `CHAT_<KEY>_ID` | ids of the seeded or fresh chats (`CHAT_STREAM_ID`, `CHAT_GATE_ID`, `CHAT_STOP_ID`, `CHAT_EDITS_ID`, `CHAT_LONG_ID`) |
| `DUMMY_REPO` | the dummy repo `work/` path |
| `INTERACTION_ID` | pending gate id, for flows that declare `env: PENDING_GATE: true` (the passthrough sends one prompt on a fresh `Mobile — Gate` chat and waits until `GET /api/attention` lists the gate) |

### 2.4 The mobile Faux fixture

- `apps/mobile/e2e/fixtures/mobile.faux.json`: turn scripts keyed by chat name, all names prefixed `Mobile — `
  (the Faux provider applies a script to a conversation by its name, per turn). Event types used: `text`, `tool_call`,
  `file_edit`, `permission_request`, `complete`.

| Key | Turns | Used by |
|---|---|---|
| `Mobile — Stream` | 1: ~40 lines of markdown (heading, list, fenced code) → `complete` | send + stream |
| `Mobile — Gate` | 1: text → `permission_request` (`type: 'shell'`, description "Run pnpm test") → text "Thanks — running it now." → `complete` | approve gate |
| `Mobile — Stop` | 1: text → `tool_call` `Bash` `{ "command": "sleep 600" }` (no result is ever provided, so the turn stays running) | two-phase stop |
| `Mobile — Edits` | 1 and 2 (identical): `file_edit` update `src/app.ts`, create `src/mobile-new.ts`, delete `src/util.ts` → text → `complete` | Changes keep / undo / commit |
| `Mobile — Long stream` | 1: 2,000 generated lines (built by sandbox-pair at merge time, not committed) → `complete` | perf streaming budget |

- sandbox-pair merges the web fixture (`agent-tests/vrt/fixtures/sandbox.faux.json`) with the mobile one into
  `os.tmpdir()/generatorai-mobile-sandbox/faux.json` and passes it as `GENERATORAI_SANDBOX_FAUX_SCRIPT`.
- **Required additive change (M1-02, its own commit, logged in `docs/redesign/mobile/COORDINATION.md`):** `scripts/redesign/sandbox.mjs`
  uses `process.env.GENERATORAI_SANDBOX_FAUX_SCRIPT ?? FAUX_SCRIPT_FIXTURE` for `GENERATORAI_TEST_FAUX_SCRIPT`. Today
  the fixture path is set after `...process.env`, so it cannot be overridden. The default behaviour is unchanged. List
  it as an owner-confirm item in the batch summary.

### 2.5 Dummy repo for SCM

- `node scripts/redesign/make-dummy-repo.mjs` prints the `work/` path under `os.tmpdir()`; `--clean` removes all of them.
  sandbox-pair seeds it as the codebase of "Mobile sandbox repo".
- Every Changes, commit, push, PR or file-tree check runs against it. A walkthrough that finds a path inside this
  checkout stops and restarts on a dummy repo.

---

## 3. The Done loop

### 3.1 Per task (fast; stop and fix at the first failure)

**Bootstrap rule (M0–M1).** A step whose tool is not built yet is skipped, and the commit body says `Done-loop: skipped step N (tool lands in <task>)`: step 3 until M1-05, step 4 (jest) until M1-06, step 6 until M1-02, step 7 until M1-02/M1-03, step 8 until M1-04. From M2 on, no step is skipped.

Default appearance for per-task shots: theme Instrument, accent ink, **dark**, default text size, phone.

```text
0. ui/ or blocks/ task: discover before creating.
     EXPO_PUBLIC_STORYBOOK=1 pnpm --filter @generatorai/mobile start          (Metro + on-device Storybook)
     storybook-mobile MCP (if the session has it): list/search components
     otherwise: rg --files -g '*.stories.tsx' apps/mobile/src  and  docs/redesign/mobile/03-components.md
     Use it; if it almost fits, add a variant + story in ui/. Never fork a component in a feature.
1. pnpm --filter @generatorai/mobile typecheck
   + pnpm --filter <package> typecheck     for every touched package
2. pnpm --filter @generatorai/mobile lint
3. pnpm --filter @generatorai/mobile check:design                            (ratchet; --strict in the batch)
4. pnpm --filter @generatorai/mobile exec vitest related --run <changed .ts files>
   pnpm --filter @generatorai/mobile exec jest --findRelatedTests <changed ui/ and blocks/ files> --passWithNoTests
5. tokens or shared packages changed:
   pnpm check:tokens && pnpm --filter @generatorai/design-tokens test
   pnpm --filter <package> test            for every touched package
6. Native rebuild only if needed:
   node scripts/mobile/fingerprint.mjs --platform=ios        exit 2 → npx expo run:ios --device gai-iphone
   node scripts/mobile/fingerprint.mjs --platform=android    exit 2 → npx expo run:android --device gai-phone
   after a rebuild: node scripts/mobile/fingerprint.mjs --platform=<p> --record
   exit 0 → ./node_modules/.bin/agent-device metro reload
7. Walkthrough on iOS AND Android, sandbox-paired (§2): the new or changed screen only.
   A=./node_modules/.bin/agent-device
   $A open dev.generatorai.app --platform ios --session ios --foreground
   $A logs clear --restart --session ios && $A logs mark "task <id>" --session ios
   $A open "generatorai:///<route>?server=<id>" --platform ios --session ios
   $A snapshot -i --json --session ios > "$TMP/<route>-ios.json"
   interact with refs/selectors: $A press @e3 --settle · $A fill 'id="composer-input"' "hi" --settle · $A wait text "…" 10000
   $A settings appearance dark --session ios
   $A screenshot --out docs/redesign/shots/mobile/<route>/ios-phone-instrument-dark-default.png --normalize-status-bar --session ios
   node apps/mobile/e2e/a11y-check.mjs "$TMP/<route>-ios.json" --platform ios --logs "$($A logs path --session ios)"
   repeat with --platform android --session android (shot android-phone-instrument-dark-default.png)
   tablet-affecting screens: repeat on gai-ipad / gai-tablet in landscape ($A orientation landscape-left)
8. Maestro: write or port the screen's flow in the same task (§4.2), run it on both platforms:
   node scripts/mobile/sandbox-pair.mjs maestro --platform=ios -- test apps/mobile/.maestro/<area>/<flow>.yaml
   node scripts/mobile/sandbox-pair.mjs maestro --platform=android -- test apps/mobile/.maestro/<area>/<flow>.yaml
Then: delete the legacy files this task replaced (and the web-preview e2e script its flow replaces, §6.3),
      update the README progress table, commit `mobile(<task-id>): <summary>`.
```

- Steps 1–5 take seconds to a couple of minutes. Step 6 avoids 5–10 minute native builds when only JS changed.
- `$TMP` is `os.tmpdir()` (on Windows `%TEMP%`); snapshots are not committed.
- Git/SCM screens: step 7 runs against the dummy repo's project.
- On Windows/Linux: steps 7–8 run for Android only; the commit body says `iOS verification pending`.

### 3.2 Per batch (once, at the end of each batch of phases)

Run in this order, on a clean `git status`, with fresh release builds where marked. Record every command, exit code and
duration in `reviews/<batch>/checks.md` (§7).

| # | Check | Commands | Pass criteria |
|---|---|---|---|
| B1 | Static, all tests | `pnpm --filter @generatorai/mobile typecheck`, `lint`, `check:design --strict`, `exec vitest run`, `exec jest`, `bundle:check` | all green |
| B2 | Release builds | `npx expo run:ios --configuration Release --device gai-iphone`; `npx expo run:android --variant release --device gai-phone` (R8 on from SDK 58) | both launch, pair and open a chat |
| B3 | Full Maestro suite | `node scripts/mobile/sandbox-pair.mjs maestro --platform=<p> -- test --format junit --output docs/redesign/mobile/reviews/<batch>/maestro-<p>.xml apps/mobile/.maestro` on the release builds; failures re-run once on the dev build to debug | 0 failures |
| B4 | Appearance matrix | §3.3 for every screen changed in the batch | shots exist; no clipped or overlapping text |
| B5 | Board side-by-side | `node scripts/mobile/compare.mjs --board=<Board> --mode=<dark\|light> --ios=… --android=… --out=docs/redesign/shots/mobile/<route>/compare-<mode>.png`; open every compare PNG; write `DIFF.md` (§3.4) | every Defect is fixed or has a task |
| B6 | VRT (from M4) | `node scripts/mobile/vrt.mjs --platform=both`; intended changes `--update`, listed in the commit | 0 unexpected diffs |
| B7 | Release perf | §4.7 scenarios on release builds, both platforms | within budgets; ≤ 10 % regression vs the previous batch |
| B8 | Accessibility audit | iOS XCUITest audit (§4.8); Android `a11y-check` over every main route + Accessibility Scanner on new screens | no unallowed issues |
| B9 | Dynamic Type sweep | iOS AX5, Android font scale 2.0 on changed screens (§4.8) | content scales, rows grow, nothing clipped |
| B10 | System-surface smoke | §4.9 (once surfaces exist) | each surface opens the right screen on both platforms |
| B11 | SCM repeat | step 7 of §3.1 on the dummy repo for Changes / commit / PR / files screens | as step 7 |
| B12 | Predictive back guard | `apps/mobile/.maestro/navigation/android-back.yaml` on `gai-phone` (36) and `gai-phone-37` (37) | back order of 06 §3.2 |

**Not mobile's job:** the web and desktop suites (Playwright e2e, web VRT, desktop smokes). When a mobile task changed a
shared package, the batch runs that package's own `typecheck` and `test` (B1/step 5); the desktop run's own loop
catches anything else after each merge.

### 3.3 Appearance matrix

For each screen changed in the batch, on **both** platforms:

| Device | Combos |
|---|---|
| phone (gai-iphone, gai-phone) | Instrument dark default · Instrument light default · Instrument dark AX · Instrument light AX · Solarized light default · Solarized light AX |
| tablet (gai-ipad, gai-tablet), screens with tablet layouts | Instrument dark default landscape · Instrument light default landscape · Instrument dark default portrait |

- Mode: `agent-device settings appearance dark|light`. Text size: iOS `settings text-size accessibility-extra-extra-extra-large`
  (AX5) or `large` (default); Android `adb -s <serial> shell settings put system font_scale 2.0` (AX) or `1.0`, then
  relaunch the app (`agent-device open dev.generatorai.app --relaunch`) because Android applies font scale at the next
  configuration change.
- Theme: dev-only link `generatorai:///theme?theme=solarized&mode=light` (route `app/(dev)/theme.tsx`, added in M1-04, which sets the
  preference and returns; it redirects to `/` in release builds). Reset with `?theme=instrument&mode=system`.
- File names: `docs/redesign/shots/mobile/<route>/<platform>-<device>-<theme>-<mode>-<text>[-<orientation>].png`, for
  example `android-phone-solarized-light-ax.png`.
- PNGs are git-ignored and reproducible (the web rule); the committed record is `DIFF.md` plus `reviews/<batch>/`.

### 3.4 `DIFF.md` format (one per route folder)

```md
# <route> — board <Board> (snapshot 1790412505-d42b)

Checked <YYYY-MM-DD> · commit <sha> · iOS gai-iphone (iOS 27.0) · Android gai-phone (API 36)
Compare: compare-dark.png, compare-light.png · Shots: <list or glob>

## Matches
- Header: back + breadcrumb "Chats › payments-service" + 16/600 title (iOS centred, Android start-aligned).
- …

## Intentional deviations
- Chat header shows Back, not the sidebar toggle — MD-18 / MDF-01.
- …   (each line cites an MD-xx, a 01-decisions entry or a 10-design-feedback id)

## Defects
- [ ] android: composer mic 40 dp hit area (< 48) — major — task M6-04
- [x] ios: status line missing under the header in dark mode — fixed in <sha>
```

Severity words: `blocker` (wrong behaviour, data or security), `major` (a11y minimum, wrong component, wrong token),
`minor` (spacing or visual polish). A batch cannot close with an open blocker or major.

---

## 4. Tools setup and conventions

### 4.1 agent-device (per-task driver)

- **Install:** root devDependency, exact pin `agent-device@0.21.15` (M1-03); always call `./node_modules/.bin/agent-device`
  (Windows `.\node_modules\.bin\agent-device.cmd`). Upgrades are their own task.
- **Sessions:** one per platform, `--session ios` / `--session android`, bound with `--platform` and the device
  selector (`--udid` / `--serial` from `sandbox-pair status`). Sessions are scoped to the worktree.

| Need | Command |
|---|---|
| start / attach | `agent-device open dev.generatorai.app --platform ios --foreground` |
| deep link | `agent-device open "generatorai:///chats/<id>?server=<sid>" --platform ios` |
| interactive tree | `agent-device snapshot -i` (refs `@e12`); `--json` for scripts; on iOS use `snapshot --raw --json` for the pinned driver’s toolbar presentation defect (MD-100); `snapshot --diff` after an action |
| act | `press`, `fill`, `type`, `longpress`, `scroll`, `back`, `gesture pinch …`, all with `--settle` where allowed |
| assert | `wait text "…" <ms>`, `wait 'id="…"' <ms>`, `wait absent '…'`, `is visible 'id="…"'`, `get text 'id="…"'` |
| appearance / text / motion | `settings appearance dark\|light`, `settings text-size <category>`, `settings animations off` |
| biometrics | `settings faceid enroll\|match\|nonmatch` (iOS sim), `settings fingerprint match` (Android emu) |
| permissions | `settings permission grant notifications` |
| screenshots | `screenshot --out <path> --normalize-status-bar [--crop-on '<selector>']` |
| logs | `logs clear --restart`, `logs mark "<label>"`, `logs path` |
| Metro | `metro reload` |
| orientation | `orientation portrait\|landscape-left` |
| push (iOS sim) | `agent-device push dev.generatorai.app <payload.json>` (or `xcrun simctl push <udid> dev.generatorai.app <payload.json>`) |
| perf | `perf frames --json`, `perf memory sample --json` |

- **Selectors:** prefer refs from the latest snapshot, then `id="<testID>"`, then `label="…"`/`role=…`. Coordinates only
  when the snapshot has no semantic target.
- **A screenshot is not verification.** Assertions come from the snapshot (`wait`/`is`/`get`); screenshots are for the
  design comparison.

**`apps/mobile/e2e/a11y-check.mjs` (M1-03)** — `node apps/mobile/e2e/a11y-check.mjs <snapshot.json> --platform ios|android
[--density <n>] [--logs <path>] [--allow apps/mobile/e2e/a11y-allow.json]`:

| Rule | Level |
|---|---|
| Every interactive node (button, link, switch, checkbox, radio, tab, menu item, text field, slider/adjustable) has a non-empty accessible label | error |
| Interactive node frame ≥ 44×44 pt (MD-91: the `Pressable` frame, not `hitSlop`; iOS snapshot frames are points) or ≥ 48×48 dp (Android; frames are px → divide by `--density`, default read from `adb shell wm density` ÷ 160) | error |
| Two interactive siblings with the same role and label | warning |
| Image or icon node that is neither labelled nor hidden from accessibility | warning |
| A node whose label is a bare status word with no glyph sibling, or a status glyph with no word (status = glyph + word, MD-28) | warning |
| While a drawer, pane or modal is open: nodes outside it are present in the tree (focus not trapped) — enabled with `--modal-open` | error |
| `--logs`: lines after the last `logs mark` matching `ERROR`, `Error:`, `Warning: `, `Unhandled promise rejection`, `RedBox` | error |

`a11y-allow.json` lists exceptions as `{ rule, selector, reason, decision }` (for example a widget-constrained button, or
a `hitSlop` use under MD-91). Output: a table on stdout; exit 1 on any error. It has its own vitest over fixture
snapshots. Native XCUITest exceptions use `rule: "native-audit"` plus one explicit `auditType`
(`contrast`, `elementDetection`, `hitRegion`, `sufficientElementDescription`, `dynamicType`, `textClipped`, `trait`);
the exact selector, reason and MD decision are still mandatory. The initial allowlist is empty.

### 4.2 Maestro (committed flows)

**Layout:**

```text
apps/mobile/.maestro/
  config.yaml                      # flows: ["*/**.yaml"] minus _subflows; executionOrder for characterization first
  _subflows/launch.yaml            # dev client vs release launch
  _subflows/open-chat.yaml         # openLink to /chats/${CHAT_ID}, wait for transcript
  _subflows/open-pane-tab.yaml     # workbench/pane toggle → tab
  pairing/  chat/  changes/  terminal/  settings/  notifications/  navigation/  pane/  perf/
```

**Header conventions** (every flow):

```yaml
appId: ${APP_ID}
name: chat · send, stream, approve gate
tags: [characterization, smoke]          # smoke = fast subset (< 5 min per platform); full = everything else
env:
  FRESH_CHAT: gate                       # sandbox-pair creates a fresh "Mobile — Gate" chat → CHAT_GATE_ID
---
- runFlow: ../_subflows/launch.yaml
```

`_subflows/launch.yaml`:

```yaml
appId: ${APP_ID}
---
- runFlow:
    when: { true: "${BUILD == 'dev'}" }
    commands:
      - launchApp: { stopApp: true }
      - openLink: "exp+generatorai://expo-development-client/?url=${METRO_URL}"
- runFlow:
    when: { true: "${BUILD == 'release'}" }
    commands:
      - launchApp: { stopApp: true }
- extendedWaitUntil: { visible: { id: "menu-button" }, timeout: 60000 }
```

**Rules:**
- Interactive elements are addressed by `id:` (testID). `text:` is used for assertions of copy and for system UI
  (notification shade, alerts). Maestro has no role selector, so the web rule "role + name first" becomes "testID for
  actions, visible text for assertions".
- Waits are explicit (`extendedWaitUntil` with a timeout), never `waitForAnimationToEnd` alone.
- Flows never reach a server other than `${SERVER_URL}`; they get ids from env, never from hard-coded values.
- iOS keychain survives `clearState`; pairing flows use `launchApp: { clearState: true, clearKeychain: true }`.
- One flow = one user journey. Tags: `characterization`, `smoke`, `full`, `pairing`, `ios-only`, `android-only`,
  `biometric` (needs enrolled biometrics, §4.9), `perf`.
- Authoring help: `maestro studio` is broken on Xcode 27; use `agent-device replay export <file.ad> --out <flow.yaml>`
  after recording a session, or the Maestro MCP (`maestro mcp`) if the session has it.

### 4.3 On-device Storybook (RN 10.6)

- **Packages (M1-06):** `@storybook/react-native@10.6.0`, `@storybook/addon-ondevice-controls@10.6.0`,
  `@storybook/addon-ondevice-actions@10.6.0` (dev dependencies of `@generatorai/mobile`).
- **Config:** `apps/mobile/.rnstorybook/main.ts` with stories `../src/ui/**/*.stories.tsx` and
  `../src/blocks/**/*.stories.tsx`; `preview.tsx` with the `ThemeDecorator` (args: theme, mode, accent, text scale) and
  the fonts loaded before render. `metro.config.js` wraps the config with `withStorybook(…)` enabled only when
  `EXPO_PUBLIC_STORYBOOK=1`, with `liteMode`, `websockets: 'auto'` and `experimental_mcp: true` (option names checked
  against the installed package README).
- **Route:** `app/(dev)/storybook.tsx` renders the Storybook UI in dev builds and redirects to `/` otherwise. It also
  accepts `?story=<id>&theme=&mode=&accent=` for VRT (§4.6), wraps the story in `View testID="vrt-root"`, and renders
  `testID="vrt-ready"` two frames after fonts load.
- **MCP (optional):** `http://localhost:7007/mcp`. Register it as `storybook-mobile` where the agent supports HTTP MCP
  servers (Codex: `[mcp_servers.storybook-mobile]` with `url = "http://localhost:7007/mcp"` in `~/.codex/config.toml`
  if the Codex build supports URL servers). Without it, use the `rg` fallback of §3.1 step 0.
- **Story rules:** one `<Name>.stories.tsx` beside each `ui/` and `blocks/` component; title `ui/<group>/<Name>`; one
  story per variant × state; platform-specific components are captured on both platforms from the same story; fixtures
  only in stories (never shipped, MD-27); `parameters.vrt = { variants?: string[], accents?: boolean, skip?: '<reason>' }`.
- `src/components/ui/gallery.tsx` is deleted when Storybook lands.

### 4.4 Jest + jest-expo + RNTL 14 (for `ui/` and `blocks/` only)

- **Packages (M1-06):** `jest@30`, `jest-expo` (SDK-matched), `@testing-library/react-native@14`, `test-renderer`
  (RNTL 14's renderer), `@types/jest`.
- **`apps/mobile/jest.config.js`:**

```js
module.exports = {
  projects: ['ios', 'android'].map((platform) => ({
    displayName: platform,
    preset: `jest-expo/${platform}`,                     // resolves *.ios.tsx / *.android.tsx per project
    testMatch: ['<rootDir>/src/{ui,blocks}/**/*.test.tsx'],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    transformIgnorePatterns: [
      'node_modules/(?!(\\.pnpm|((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@generatorai/.*|uniwind|@lodev09/.*|@legendapp/.*|lucide-react-native))',
    ],
  })),
};
```

- **`jest.setup.ts`:** Reanimated test setup, `react-native-gesture-handler/jestSetup`, the keyboard-controller Jest
  mock, an in-memory MMKV mock, the Uniwind test setup from its docs (if class resolution is unavailable in Jest, tests
  assert roles, labels, states and props, never computed styles).
- **Scripts in `apps/mobile/package.json`:** `"test": "vitest run && jest"`, `"test:unit": "vitest run"`,
  `"test:kit": "jest"`.
- **Every `ui/` component test covers:** role; accessible name (required for icon-only variants — also a type error);
  states (`disabled`, `selected`, `checked`, `expanded`, `busy`); `onPress` not fired when disabled; accessibility
  actions for every swipe or long-press action; controlled and uncontrolled behaviour. RNTL 14 API: `await render(…)`,
  `screen.getByRole('button', { name })`, `const user = userEvent.setup(); await user.press(…)`.
- **Vitest stays** for every pure model, reducer and view-model (`src/**/*.test.ts`, node environment) and for
  `packages/*`. The two runners never overlap: Vitest excludes `*.test.tsx`; Jest only runs `ui/` and `blocks/`
  `*.test.tsx`.

### 4.5 Test data

Stories use fixtures from `src/ui/**/__fixtures__/` and `src/blocks/**/__fixtures__/`. Flows and walkthroughs use the
sandbox seed and the Faux fixture (§2.4). Nothing else creates data.

### 4.6 VRT — `scripts/mobile/vrt.mjs` (M4-10)

**Built in M10-03 (MD-194).** Prerequisites: the target booted and sandbox-paired (the dev routes sit behind the auth
gate), Metro started with `EXPO_PUBLIC_STORYBOOK=1 EXPO_PUBLIC_VRT=1` (`.rnstorybook/vrtMode.ts` freezes the clock at
2026-10-01 09:41 UTC, seeds `Math.random`, forces Reduce Motion). A capture is the first screen of the story (galleries
taller than the screen are cropped to `vrt-root`'s visible frame). Android screenshots are scaled 0.4 (≈ 1 px per dp,
like the iOS simulator's 1x). The device check compares `deviceType` + `runtime` (iOS) / `image` = `android-<sdk>;<abi>`
(Android) with `META.json`. `pnpm --filter @generatorai/mobile vrt -- --list` prints the plan without a device.

`node scripts/mobile/vrt.mjs [--platform=ios|android|both] [--device=phone|tablet] [--grep=<regex>] [--variants=<list>]
[--update] [--list]`

1. **Story index** in Node: parse every `*.stories.tsx` with `@storybook/csf-tools` (`loadCsf`) and compute story ids
   (`toId(title, exportName)`); read `parameters.vrt`. `--list` prints ids × variants and exits.
2. **Device prep (determinism):**
   - iOS: `xcrun simctl status_bar <udid> override --time 9:41 --batteryState charged --batteryLevel 100
     --cellularBars 4 --wifiBars 3`; `agent-device settings animations off`.
   - Android: `adb shell settings put global window_animation_scale 0`, same for `transition_animation_scale` and
     `animator_duration_scale`; demo mode: `adb shell settings put global sysui_demo_allowed 1`, then
     `adb shell am broadcast -a com.android.systemui.demo -e command enter`,
     `… -e command clock -e hhmm 0941`, `… -e command battery -e level 100 -e plugged false`,
     `… -e command network -e wifi show -e level 4`, `… -e command notifications -e visible false`.
   - App: a dev build with `EXPO_PUBLIC_STORYBOOK=1 EXPO_PUBLIC_VRT=1`: Reduce Motion forced, spinners and blinking
     cursors static, clock frozen (`src/ui/lib/clock.ts` returns a fixed instant), seeded random, bundled fonts only, no
     network (stories use fixtures).
3. **Capture**, grouped by text size to minimise setting changes (Android relaunches on a font-scale change):
   `agent-device open "generatorai:///storybook?story=<id>&theme=<t>&mode=<m>&accent=<a>"` →
   `agent-device wait 'id="vrt-ready"' 10000` → `agent-device screenshot --out <tmp>.png --crop-on 'id="vrt-root"'
   --normalize-status-bar`.
4. **Diff** with `odiff-bin` (4.5.0, devDependency): `odiff <baseline> <current> <diff> --threshold=0.05 --antialiasing`.
   Baselines: `apps/mobile/vrt/baselines/<platform>/<device>/<storyId>--<variant>.png` (committed). Each baseline folder
   has `META.json` `{ deviceType, runtime|image, fontScaleMap, recordedAt, commit }`; the script refuses to compare when
   the current device differs and prints the re-baseline command.
5. **Output:** `apps/mobile/vrt/report/` (git-ignored) with diff PNGs, `report.json` and an `index.html` side-by-side
   page; exit 1 on unexpected diffs. `--update` copies current → baseline and prints the changed list for the commit.

**Variants** (default per story): `instrument-light-default`, `instrument-dark-default`, `instrument-dark-ax`,
`solarized-light-default`, `solarized-light-ax`. Stories with `vrt.accents: true` add the 6 non-ink accents in
Instrument dark. Token correctness for all 18 themes × 2 modes × 7 accents is a unit test in `packages/design-tokens`
plus one `ThemeMatrix` story, not screenshots (SE §5).

### 4.7 Performance

**Built in M10-03 (MD-194):** `node scripts/mobile/perf.mjs --platform=<p> [--udid|--serial] --batch=<batch>
[--previous=<batch>]` runs cold start, `perf/streaming.yaml` (frames + memory) and `perf/transcript-scroll.yaml` (frames;
flings over the 2,000-line reply, as the sandbox has no 300-message chat) and judges them with
`scripts/mobile/lib/perf-budgets.mjs` against `apps/mobile/perf/budgets.json`. A metric agent-device does not report
(p95 frame time on some runtimes) is *unmeasured*, never a pass. Cold start: Android `am start -W` TotalTime; iOS
relaunch → `home-new-chat` through the driver (relative). The perf flows are excluded from the functional suite
(`config.yaml` `!perf/**`).

- **Where:** release builds only (§3.2 B2), both platforms, pinned devices. Emulator and simulator numbers are
  **relative** (batch-to-batch); absolute device budgets are checked on the owner's phones at M10.
- **Scenarios** (`apps/mobile/.maestro/perf/`, driven by Maestro, measured by agent-device on the same device):
  - `transcript-scroll.yaml`: open the seeded 300-message chat, fling to the top and back three times.
  - `streaming.yaml`: send on a fresh `Mobile — Long stream` chat and wait for completion.
- **Measure:** `agent-device perf frames --json` immediately after each scenario and `agent-device perf memory sample
  --json` after `streaming.yaml`. Android may add Flashlight: `flashlight measure --bundleId dev.generatorai.app
  --testCommand "maestro --device <serial> test apps/mobile/.maestro/perf/transcript-scroll.yaml" --iterationCount 3`.
- **Budgets** — `apps/mobile/perf/budgets.json`:

| Scenario | Metric | Budget |
|---|---|---|
| transcript scroll | janky frames (> 16.7 ms) | ≤ 5 % |
| transcript scroll | p95 frame time | ≤ 20 ms |
| streaming 2,000 lines | janky frames | ≤ 8 % |
| streaming 2,000 lines | longest frame | ≤ 100 ms |
| streaming 2,000 lines | memory after completion | ≤ 400 MB |
| any | regression vs previous batch | ≤ 10 % on each metric |

- The markdown spike (MD-40) uses the same `streaming.yaml` on `gai-phone` (a mid-range Android profile) as its
  60 fps gate.
- Results: `reviews/<batch>/perf.json` with the previous batch's numbers alongside.

### 4.8 Accessibility

| Check | When | How |
|---|---|---|
| Labels, roles, targets 44 pt / 48 dp | every walkthrough | `a11y-check.mjs` (§4.1) |
| Focus trapping (drawer, pane, sheets, modals) | per task that touches them; batch | open the panel, `snapshot -i --json`, `a11y-check --modal-open` |
| Kit contracts | per component | Jest/RNTL (§4.4) |
| XCUITest audit (contrast, element detection, hit region, descriptions, Dynamic Type, clipped text, traits) | batch | below |
| Android scanner | batch, new screens | Accessibility Scanner by hand on `gai-phone`; findings into `a11y-android.md` |
| Dynamic Type / font scale | batch (changed screens) | iOS `settings text-size accessibility-extra-extra-extra-large` (AX5); Android `font_scale 2.0` (Android 14+ scales non-linearly); screenshots + `a11y-check`; content scales, dense chrome caps at 1.4–1.6×, rows grow, nothing clips |
| Reduce Motion | batch | app preference Settings › Accessibility › Reduce motion (plus iOS system setting where scriptable); panels jump, spinners freeze |
| Reduce Transparency (iOS) | batch | `xcrun simctl spawn <udid> defaults write com.apple.Accessibility ReduceTransparencyEnabled -bool true` then relaunch (if the flag does not take effect on the runtime, verify with `GlassSurface` stories' forced-opaque variant); glass becomes opaque |
| Screen reader order | batch, chat screen | snapshot order: header → transcript → composer; drawer and pane reachable from header buttons |

**XCUITest audit (iOS, built in M1-03).** `plugins/withA11yAuditTarget.js` (added to plugins only when `GAI_A11Y_AUDIT=1`) adds a UI
test target `GeneratorAIUITests` with `A11yAuditTests.swift`: for each route in `apps/mobile/e2e/a11y-routes.json` it
opens `generatorai:///<route>`, waits for `vrt-ready` or the route's main testID, then
`try app.performAccessibilityAudit(for: .all) { issue in AllowList.matches(issue) }`.
Debug audits activate the app and select Metro through `XCUIDevice.shared.system.open`, then use the same API to preserve the loaded development
client; Release audits use `app.open(routeURL)` (MD-101). Metro defaults to 127.0.0.1:8081.

```sh
cd apps/mobile
GAI_A11Y_AUDIT=1 npx expo prebuild -p ios --clean
xcodebuild test -workspace ios/GeneratorAI.xcworkspace -scheme GeneratorAIUITests \
  -destination 'platform=iOS Simulator,name=gai-iphone' -resultBundlePath "$TMPDIR/a11y.xcresult"
xcrun xcresulttool get test-results tests --path "$TMPDIR/a11y.xcresult" > "$TMPDIR/a11y.json"
npx expo prebuild -p ios --clean      # back to the normal project
```

The app on the simulator must already be sandbox-paired (the simulator keychain survives reinstalls). Summary →
`reviews/<batch>/a11y-ios.md`.

### 4.9 System surfaces smoke (batch, once they exist)

| Surface | iOS | Android |
|---|---|---|
| Notification categories + routing | `agent-device push dev.generatorai.app apps/mobile/e2e/push/<case>.json` (M9-02; APNs-shaped payloads for `approval`, `approval.risky`, `question`, `run.approval`, `done`, `failed`); tap the banner → correct screen; long-press → actions present (agent-device `help ios-system-ui`) | dev link `generatorai:///notify?case=<case>` (route `app/(dev)/notify.tsx` schedules a local notification with the same content, data, category and channel); open the shade (`agent-device` swipe from top), tap an action; the gate state is checked through `GET` on the sandbox |
| Inline Allow / Deny | action from the lock-screen-style banner (device unlocked in the simulator) → gate resolved | action button → gate resolved |
| Risky gate | `review` opens the approval sheet; with `settings faceid enroll` + `match`, the signature is accepted by the sandbox; with `nonmatch`, nothing is sent (`biometric` tag) | `adb shell locksettings set-pin 1111`, enrol a fingerprint once, then `adb -e emu finger touch 1` at the prompt |
| Deep links | every row of `apps/mobile/e2e/links.json` (M5-08) through `agent-device open "<url>"`: allowed → screen; disallowed → Home; unknown `server=` → toast | same |
| Live Activity / Live Update | dev link `generatorai:///live?script=run-needs-you` (route `app/(dev)/live.tsx`, M9-01, feeds fixture events into the live reducer): start, update, needs-you, succeed, end; the activity and its "Review" link | same link: the promoted notification, chip text, Review action, final state and timeout |
| Widgets | after a snapshot write, add the widgets on the home screen once (manual in the first batch), then check content updates after `live` script events | same (SDK 58) |
| Control / tile | trigger the control's link directly (`generatorai://command/chat.new`) and confirm the New chat sheet; adding the control to Control Center is checked by hand once | tile: `adb shell cmd statusbar click-tile dev.generatorai.app/<TileService class>` → New chat sheet |
| Quick actions | long-press the app icon via agent-device on the home screen → 4 items → each opens its screen | same |
| Share | share a text file from Files via agent-device → `/share` sheet pre-filled, nothing sent until Send | `adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "hello" -n dev.generatorai.app/.MainActivity` → `/share` sheet |
| Privacy screen | `agent-device app-switcher` + screenshot: content blurred when the preference is on | same: recents thumbnail blank |

Results → `reviews/<batch>/surfaces.md`, one row per surface × platform with pass/fail and the evidence file.

---

## 5. Characterization flows (M1-04, before any change)

Written and green on **both** platforms against today's app (SDK 57) before M2 changes anything. They pin behaviour,
not looks: the redesign must keep them green (updating selectors only through §6.2). M1-04 may add missing testIDs to
legacy components — **testIDs only, no behaviour change** — so the flows have stable handles. The ids added are
exactly: `pairing-confirm`, `pairing-fingerprint`, `composer-input`, `composer-send`, `composer-stop`,
`composer-force-reset`, `transcript-list`, `gate-card`, `gate-allow`, `gate-deny`, `changes-file-row`,
`changes-commit`, `commit-message`, `commit-submit`, `terminal-view`, `terminal-key-esc`, `settings-appearance`,
`theme-option-<id>`, `mode-option-<light|dark|system>`. Existing ids used: `menu-button`, `drawer-*`,
`workbench-button`, `workbench-tool-<id>`, `keep-file`, `unkeep-file`, `changes-tray-keep-all`,
`changes-tray-undo-all`, `changes-tray-review`, `chat-back`.

Before recording, check each existing selector against a live snapshot (`agent-device snapshot -i`); the labels quoted
below come from today's code and may need the snapshot's exact wording.

### 5.1 `pairing/pair-via-link.yaml` — tags `characterization, smoke, pairing`

```yaml
appId: ${APP_ID}
name: pairing · link pre-fills, consent, pair
tags: [characterization, smoke, pairing]
---
- launchApp: { clearState: true, clearKeychain: true }
- openLink: ${PAIR_URL}
- extendedWaitUntil: { visible: "Pair with this server?", timeout: 30000 }
- assertVisible: { id: "pairing-fingerprint" }
- assertNotVisible: { id: "menu-button" }          # pre-filled, not submitted (MD-34)
- tapOn: { id: "pairing-confirm" }
- extendedWaitUntil: { visible: { id: "menu-button" }, timeout: 30000 }
- tapOn: { id: "menu-button" }
- assertVisible: { id: "drawer-chats" }
```

Runs last in the suite (it re-pairs the device); sandbox-pair's state is refreshed afterwards (`sandbox-pair status`).

### 5.2 `chat/send-stream-approve.yaml` — `FRESH_CHAT: gate`, tags `characterization, smoke`

```yaml
- runFlow: ../_subflows/launch.yaml
- openLink: "generatorai:///chats/${CHAT_GATE_ID}"
- extendedWaitUntil: { visible: { id: "composer-input" }, timeout: 30000 }
- tapOn: { id: "composer-input" }
- inputText: "Please run the tests"
- tapOn: { id: "composer-send" }
- extendedWaitUntil: { visible: { id: "gate-card" }, timeout: 30000 }
- assertVisible: "Run pnpm test"
- assertVisible: { id: "composer-input" }          # typing is never blocked while a gate is pending (D-29);
                                                    # if today's app fails this, keep the assertion and log a legacy defect
- tapOn: { id: "gate-allow" }
- extendedWaitUntil: { visible: "Thanks — running it now.", timeout: 30000 }
- extendedWaitUntil: { visible: { id: "composer-send" }, timeout: 30000 }   # idle again
- assertNotVisible: { id: "gate-card" }
```

A companion `chat/send-stream.yaml` (`FRESH_CHAT: stream`) sends one prompt on `Mobile — Stream`, waits for the heading
and the fenced code block text, and asserts the composer returns to idle.

### 5.3 `chat/two-phase-stop.yaml` — `FRESH_CHAT: stop`, tags `characterization, full`

```yaml
- runFlow: ../_subflows/launch.yaml
- openLink: "generatorai:///chats/${CHAT_STOP_ID}"
- extendedWaitUntil: { visible: { id: "composer-input" }, timeout: 30000 }
- tapOn: { id: "composer-input" }
- inputText: "Start the long job"
- tapOn: { id: "composer-send" }
- extendedWaitUntil: { visible: { id: "composer-stop" }, timeout: 30000 }
- tapOn: { id: "composer-stop" }
# phase 1: the stop is sent; the button is inert for 400 ms, then shows the stopping state
- extendedWaitUntil: { visible: { id: "composer-send" }, timeout: 20000 }
- runFlow:                                          # phase 2 only if the harness ignored the stop for 15 s
    when: { visible: { id: "composer-force-reset" } }
    commands:
      - tapOn: { id: "composer-force-reset" }
      - extendedWaitUntil: { visible: { id: "composer-send" }, timeout: 10000 }
```

Record which branch today's app takes on each platform in the flow's header comment; the redesign must take the same
one.

### 5.4 `changes/keep-undo-commit.yaml` — `FRESH_CHAT: edits`, tags `characterization, full` (dummy repo)

```yaml
- runFlow: ../_subflows/launch.yaml
- openLink: "generatorai:///chats/${CHAT_EDITS_ID}"
- extendedWaitUntil: { visible: { id: "composer-input" }, timeout: 30000 }
- tapOn: { id: "composer-input" }
- inputText: "Make the edits"
- tapOn: { id: "composer-send" }
- extendedWaitUntil: { visible: { id: "composer-send" }, timeout: 60000 }
- tapOn: { id: "workbench-button" }
- tapOn: { id: "workbench-tool-changes" }
- extendedWaitUntil: { visible: "src/app.ts", timeout: 15000 }
- assertVisible: "src/mobile-new.ts"
- assertVisible: "src/util.ts"
- tapOn: { id: "keep-file", index: 0 }             # keep one file
- assertVisible: { id: "unkeep-file" }
- tapOn: { id: "changes-tray-undo-all" }
- tapOn: "Undo all"                                  # confirmation dialog (MD-07)
- extendedWaitUntil: { notVisible: "src/mobile-new.ts", timeout: 15000 }
# second turn re-applies the same edits (fixture turn 2)
- back
- tapOn: { id: "composer-input" }
- inputText: "Again"
- tapOn: { id: "composer-send" }
- extendedWaitUntil: { visible: { id: "composer-send" }, timeout: 60000 }
- tapOn: { id: "workbench-button" }
- tapOn: { id: "workbench-tool-changes" }
- tapOn: { id: "changes-tray-keep-all" }
- tapOn: { id: "changes-commit" }
- tapOn: { id: "commit-message" }
- inputText: "mobile characterization commit"
- tapOn: { id: "commit-submit" }
- extendedWaitUntil: { visible: "mobile characterization commit", timeout: 30000 }
```

After the flow, the passthrough runs `git -C ${DUMMY_REPO} log -1 --format=%s` and fails the run unless it prints
`mobile characterization commit` (host-side check; `sandbox-pair maestro … --verify=commit`).

### 5.5 `terminal/open-type.yaml` — tags `characterization, full`

```yaml
- runFlow: ../_subflows/launch.yaml
- openLink: "generatorai:///chats/${CHAT_STREAM_ID}"
- tapOn: { id: "workbench-button" }
- tapOn: { id: "workbench-tool-terminal" }
- extendedWaitUntil: { visible: { id: "terminal-view" }, timeout: 30000 }
- tapOn: { id: "terminal-view" }
- inputText: "echo gai-characterization-ok"
- pressKey: Enter
- extendedWaitUntil: { visible: "gai-characterization-ok", timeout: 15000 }
- tapOn: { id: "terminal-key-esc" }
```

- Step-up: on unenrolled simulators and emulators with no passcode, today's `requireStepUp` resolves true, so no prompt
  appears. The flow asserts that; a biometric variant (`biometric` tag) comes with the redesign.
- If xterm's text is not exposed to the accessibility tree on a platform, the assertion falls back to
  `takeScreenshot: terminal-echo` plus an agent-device `screenshot` compared by eye, and the flow header records it.

### 5.6 `settings/theme-switch.yaml` — tags `characterization, full`

```yaml
- runFlow: ../_subflows/launch.yaml
- tapOn: { id: "menu-button" }
- tapOn: { id: "drawer-settings" }
- tapOn: { id: "settings-appearance" }
- tapOn: { id: "theme-option-solarized" }
- tapOn: { id: "mode-option-light" }
- assertVisible: { id: "theme-option-solarized", selected: true }
- stopApp
- runFlow: ../_subflows/launch.yaml
- tapOn: { id: "menu-button" }
- tapOn: { id: "drawer-settings" }
- tapOn: { id: "settings-appearance" }
- assertVisible: { id: "theme-option-solarized", selected: true }   # persisted across relaunch
- assertVisible: { id: "mode-option-light", selected: true }
- tapOn: { id: "theme-option-instrument" }
- tapOn: { id: "mode-option-system" }
```

### 5.7 `notifications/approval-action.yaml` — tags `characterization, full`, Android primary

- The flow declares `env: { FRESH_CHAT: gate, PENDING_GATE: true }`, so the passthrough (§2.3) creates the pending
  permission gate first and passes `CHAT_GATE_ID` and `INTERACTION_ID`.
- **Android:** the dev link `generatorai:///notify?case=approval&chat=${CHAT_GATE_ID}&interaction=<id>` (M1-04 adds the
  dev-only route `app/(dev)/notify.tsx`) posts a local notification with the exact server `data`, category and
  channel. Then:

```yaml
- runFlow: ../_subflows/launch.yaml
- openLink: "generatorai:///notify?case=approval&chat=${CHAT_GATE_ID}&interaction=${INTERACTION_ID}"
- pressKey: Home
- swipe: { start: "50%, 1%", end: "50%, 60%" }     # open the shade
- extendedWaitUntil: { visible: "Allow", timeout: 15000 }
- tapOn: "Allow"
```

  The runner then asserts through the sandbox API that the gate is resolved with `allow`.
- **iOS:** `xcrun simctl push <udid> dev.generatorai.app apps/mobile/e2e/push/approval.json` (APNs-shaped; the file's
  `body` object carries the same `data` the server sends through Expo); the flow taps the banner text and asserts the
  app opens the chat with the gate card. The Allow action from the long-pressed notification is checked in the batch
  surface smoke (§4.9).

---

## 6. testID policy and the legacy e2e freeze

### 6.1 testIDs

1. **A ported element keeps its testID and accessible name verbatim** (MD-95): the 34 existing ids listed in
   `03-components.md` §1.5, including `menu-button` (the sidebar toggle), `drawer-<section>`, `drawer-inbox`,
   `composer-model`, `composer-mode`, `composer-options`, `changes-tray-*`, `keep-file`, `unkeep-file`,
   `fork-provenance`, `chat-back`, `home-new-chat`, `chats-new`, `chats-select`, `chats-bulk-delete`, and the
   characterization ids of §5. The only deliberate renames are `workbench-button` → `pane-toggle` (M5-04) and
   `workbench-tool-<id>` → `pane-tab-<DockTabType>` (M5-03); `header-inbox` is removed (M5-04).
2. Where a **new** element's concept is shared with web, use the web id: `composer-attachment`, `chat-agent-chip`,
   `context-usage-*`, `terminal-*`, `find-bar`. The web `sidebar-toggle` and `right-pane*` ids are **not** used on
   mobile: the sidebar toggle keeps `menu-button` and the pane uses `pane-toggle` / `pane-tab-*` (MD-95).
3. **New ids** are kebab-case `<part>-<element>` (`pane-tab-changes`, `pane-instance-<id>`, `approval-sign`), set on the
   interactive element (not a wrapper), and only where role + label are ambiguous or a flow needs a stable handle.
4. Every interactive element also has an accessible role and label; flows use testIDs for actions, but a11y-check
   fails an unlabelled control regardless.
5. **A deliberate rename or removal updates every Maestro flow, story and test in the same commit.** After it,
   `rg -n "<old-id>" apps/mobile` returns nothing.

### 6.2 Changing a characterization flow

A characterization flow changes only (a) its selectors through rule 5, or (b) with an MD that changes the behaviour
it pins, cited in the flow's header comment. Weakening an assertion to make a redesign pass is not allowed.

### 6.3 The legacy web-preview e2e (MD-43)

- `apps/mobile/e2e/*.mjs` (Playwright against the Expo web preview) is **frozen**: not run in any loop, never repaired.
- Each script is **deleted in the same commit** as the Maestro flow that replaces it lands. `native-audit.mjs` is
  deleted in M1-03 (agent-device does its job). `lib.mjs`, the web-preview parts of `e2e/README.md` and the
  `playwright-core` devDependency go with the last script.
- **Done in M10-02 (2026-10-03):** the last scripts (`net2.mjs`, `lib.mjs`) are deleted; `e2e/README.md` now lists only
  the native helpers (fixtures, push payloads, links, the a11y checker and audit target). No mobile package depended on
  Playwright. Route coverage by Maestro: `reviews/M10-notes.md` §1.

| Legacy script | Replaced by | When |
|---|---|---|
| `pair.mjs` | `pairing/pair-via-link.yaml` | M1 |
| `chat.mjs`, `gatelive.mjs` | `chat/send-stream.yaml`, `chat/send-stream-approve.yaml` | M1 |
| `stop.mjs` | `chat/two-phase-stop.yaml` | M1 |
| `light.mjs` | `settings/theme-switch.yaml` | M1 |
| `native-audit.mjs`, `net2.mjs` | agent-device (`snapshot`, `network`) | M1 |
| `panes.mjs` | `changes/keep-undo-commit.yaml` (M1) + `pane/tabs.yaml` | M6 |
| `modelterm.mjs` | `terminal/open-type.yaml` (M1) + `chat/model-pick.yaml` | M6 |
| `tour2.mjs` | `navigation/tour.yaml` | M5 |
| `flow3.mjs`, `unarchive.mjs`, `browser.mjs` | `chat/composer-extras.yaml`, `chats/archive-unarchive.yaml`, `pane/browser.yaml` | M6 |
| `clear.mjs`, `companion.mjs`, `legacy.mjs`, `request.mjs`, `approveadmin.mjs`, `unlocked.mjs` | `approvals/clear.yaml`, `auth/companion-scopes.yaml`, `settings/scope-request.yaml` | M7 |
| `audit-scenarios.mjs` | `workflows/*.yaml`, `automations/*.yaml` | M8, M7 |

Phase ids refer to `07-phases.md`; M10-02 deletes whatever is left.

---

## 7. Review evidence per batch

The independent reviewer (a fresh Codex session running `REVIEW_PROMPT` from `CODEX_PROMPT.md`, MD-13) checks the
batch from these files alone. Everything is under `docs/redesign/mobile/reviews/<batch-id>/` unless stated.

| File | Contents | Produced by |
|---|---|---|
| `SUMMARY.md` | tasks and commits in the batch; MDs added; **owner-confirm items** (MD status and new ones, e.g. the sandbox.mjs change); intentional deviations; open defects with severity; "iOS pending" list if any task was verified on Android only | implementer |
| `environment.json` | git sha; Node, pnpm, Xcode, iOS runtime, AVD images, agent-device, Maestro, Expo SDK, RN versions | `node scripts/mobile/doctor.mjs --json` |
| `checks.md` | every §3.2 check: command, exit code, duration, notes | implementer |
| `maestro-ios.xml`, `maestro-android.xml` | JUnit of the full suite on release builds | B3 |
| `vrt-ios.json`, `vrt-android.json`, `vrt-updates.md` | VRT results; the list of re-baselined stories with reasons | B6 |
| `perf.json` | §4.7 metrics with the previous batch's values | B7 |
| `a11y-ios.md`, `a11y-android.md` | XCUITest audit summary; a11y-check and Scanner findings; allowlist changes with reasons | B8 |
| `dynamic-type.md` | screens × sizes × platform, with defects | B9 |
| `surfaces.md` | §4.9 table with pass/fail per platform | B10 |
| `docs/redesign/shots/mobile/<route>/DIFF.md` | per changed route (§3.4), committed; PNGs are regenerated from the commands in its header | B4/B5 |
| `docs/redesign/mobile/COORDINATION.md` | every shared-package and server change in the batch, additive only | implementer |
| `docs/redesign/mobile/README.md` | progress table and resume point updated | implementer |

**Reviewer checks, at minimum:** every task commit has its Maestro flow and ran the per-task loop (commit body lists
the platforms verified); no legacy file survives its replacement; no web-preview e2e script survives its flow; every
DIFF.md Defect is fixed or has a task; no blocker/major is open; `rg -n "Platform\.(OS|select)" apps/mobile/src`
matches only the MD-15 folders; VRT updates are explained; perf regressions are explained or fixed; COORDINATION.md
lists every change under `packages/` and `apps/server/`.
