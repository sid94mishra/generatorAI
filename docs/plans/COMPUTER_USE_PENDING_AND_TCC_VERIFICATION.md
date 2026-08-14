# Computer Use — Pending Work & macOS TCC Verification

Status: **Phases 0–6 implemented, TCC unverified** · Date: 2026-08-12
Plan: [COMPUTER_USE_IMPLEMENTATION_PLAN.md](./COMPUTER_USE_IMPLEMENTATION_PLAN.md)

This document exists because the highest-risk part of the feature **cannot be
verified on Windows or Linux**. It lists exactly what is unproven, why, and the
commands to run once you are on a Mac.

---

## 1. Why TCC is the gate

macOS attributes Accessibility (`kTCCServiceAccessibility`) and Screen Recording
(`kTCCServiceScreenCapture`) to a **responsible application identity** — the
signed app at the head of the spawn chain, not the process making the call.

Consequences that drive the whole architecture:

- The driver **must** be spawned by `GeneratorAI.app`. If the server process,
  the harness SDK (as an MCP server), or a terminal spawns it, the grant the
  user gave to GeneratorAI does not apply.
- The failure is **silent**. You do not get an error; you get an accessibility
  tree with zero elements, or clicks that do nothing. That is why
  [desktopState.ts](../../packages/core/src/infrastructure/computer/desktopState.ts)
  throws `UnrecognisedDesktopStateError` instead of returning an empty tree —
  an empty result and a broken grant must not look alike.
- Ad-hoc signed / unsigned dev builds get a **different** TCC identity than the
  notarised build. A grant given to a dev build proves nothing about release.

---

## 2. What is DONE and machine-verified

All of the following passes `tsc --noEmit` across `shared`, `core`, `db`,
`server`, `desktop`, plus 106 unit tests.

| Area | Where |
|---|---|
| Permission kind, shared types, config schema, `computer.*` events | `packages/shared`, `packages/core/src/permissions` |
| Blocklist (NFKC + homoglyph + zero-width resistant) | `packages/shared/src/utils/computerUseBlocklist.ts` |
| `IComputerBridge` port + reusable contract suite | `packages/core/src/domain/ports/IComputerBridge.ts` |
| `NullComputerBridge` (structural off-switch) | `packages/core/src/infrastructure/computer/` |
| `ComputerService` — 14-step gate order, consent scopes, fencing, audit | `packages/core/src/services/ComputerService.ts` |
| `CuaDriverBridge` — refusal mapping, focus gate, bounds clamping | `packages/core/src/infrastructure/computer/CuaDriverBridge.ts` |
| Loopback handshake + consent route (auth tested) | `apps/server/src/routes/internal-computer.ts` |
| Embedded host lifecycle | `apps/desktop/src/main/computer-host.ts` |
| Grants + audit tables, migration 27 | `packages/db` |
| 13 agent tools, gated, registered on chat create | `packages/core/src/tools/computer/` |

---

## 3. What is PENDING — must be verified on macOS

### 3.1 BLOCKER — the driver binary is not yet bundled

`resolveDriverBinary()` looks in two places inside the app bundle. **Neither is
populated by the current electron-builder config.**

Required change in `apps/desktop/scripts/lib/build-config.mjs`:

```js
asarUnpack: [
  '**/node_modules/@trycua/cua-driver/**',
  '**/node_modules/@trycua/cua-driver-*/**',
],
extraResources: [
  { from: 'node_modules/@trycua/cua-driver-darwin-arm64/bin', to: 'cua-driver' },
],
```

The binary **must** be inside the signed bundle and covered by the same
signature. A binary in `~/Library/Application Support` or `/usr/local/bin` is
outside the responsibility chain and TCC will not apply the app's grants.

Also required: the hardened-runtime entitlement to spawn it —

```xml
<key>com.apple.security.cs.disable-library-validation</key><true/>
<key>com.apple.security.cs.allow-jit</key><true/>
```

and the usage descriptions in `Info.plist`:

```xml
<key>NSAppleEventsUsageDescription</key>
<string>GeneratorAI uses accessibility to operate applications you approve.</string>
```

### 3.2 BLOCKER — `get_desktop_state` payload shape is unpinned

`desktopState.ts` parses `ToolResult.structuredJson`. The published `.d.ts`
types the tool *inputs* and *action results* but **not** this payload, so the
accepted key spellings were derived from the contract's naming conventions,
not observed output.

**Highest-consequence unknown: the coordinate space of element `bounds`.**
`CuaDriverBridge` treats them as *desktop* coordinates (`scope: SCOPE_DESKTOP`).
If the driver reports *window-relative* bounds, every element click is offset by
the window origin and lands on arbitrary UI. Verify this before enabling clicks.

### 3.3 BLOCKER — `set_value` / `perform_action` are disabled

`capabilities().supports.setValue` and `.performAction` are hard-coded `false`,
and `act()` refuses both. The driver's typed surface has no such methods; they
would have to go through `callTool()` with tool names and argument shapes that
are currently **guesses**. Shipping a guess whose failure mode might be "silently
targets something else" was not acceptable, so the capability is off.

Unblock by running step 4.4 below and pinning the real names.

### 3.4 Not implemented — Phase 7 vision fallback

Deliberately dropped, not deferred. A separate `VisionFallbackBridge` would have
no way to *deliver* input — cua-driver is the input mechanism. The fallback tier
already exists inside `CuaDriverBridge` as `path: 'synthetic'` via
`clickPoint`/`typeText`, gated by `allowSyntheticFallback`. A separate class
would be an empty shell.

### 3.5 Not implemented — UI surfaces

- No consent dialog in the desktop shell. `PendingConsentStore.prompt()` emits
  `computer.consent_required` and waits; **nothing renders it**, so every prompt
  currently expires into `deny` after `consentTtlSeconds`. The feature is
  therefore safe but unusable until this lands.
- The 8 `computer.*` event kinds are not handled in `sseManager.processEvent`
  or `apps/cli/src/streaming/EventRenderer.ts` (AGENTS.md §8 steps 4–5).
- No Settings pane to review or revoke grants (`listGrants` / `revokeGrant`
  exist on the repository and are unused).

### 3.6 Untested at runtime

`CuaDriverBridge` has **no** unit tests — it is untestable without a live
driver. `desktopState.ts` is tested against synthetic payloads only.

---

## 4. Verification procedure (run on macOS)

### 4.0 Prerequisites

```bash
# Apple silicon or Intel Mac, macOS 14+
sw_vers
pnpm install
pnpm --filter @generatorai/desktop build
```

### 4.1 Confirm the native binary resolves

```bash
ls node_modules/@trycua/cua-driver-darwin-arm64/
node -e "console.log(Object.keys(await import('@trycua/cua-driver')))" --input-type=module
```

**Expected:** the module loads and exports `CuaDriver`.
**If it throws:** the optional dependency did not install for this platform;
`CuaDriverBridge.isAvailable()` will return false and the chain will fall
through to `NullComputerBridge` (safe, but the feature is off).

### 4.2 Pin the desktop-state payload — DO THIS FIRST

```bash
node --input-type=module -e "
import { EmbeddedCuaDriverHost, EmbeddedPermissionMode } from '@trycua/cua-driver/embedded';
import { CuaDriver } from '@trycua/cua-driver';
const host = EmbeddedCuaDriverHost.withOptions({
  binaryPath: process.env.CUA_BIN,
  hostBundleId: 'ai.generatorai.desktop',
  permissionMode: EmbeddedPermissionMode.Bounded,
  approveSessionPolicy: true,
  dangerouslyBypassApprovals: false,
  environment: [],
  inheritStderr: true,
});
const conn = await host.start();
const client = CuaDriver.connect(conn.socketPath);
await client.startSession({ session: 'probe', captureScope: 1 });
const state = await client.getDesktopState({ session: 'probe' });
console.log(JSON.stringify(JSON.parse(state.structuredJson), null, 2).slice(0, 8000));
await host.stop();
"
```

Then check, against
[desktopState.ts](../../packages/core/src/infrastructure/computer/desktopState.ts):

| Question | Where the answer must go |
|---|---|
| Is the app array called `apps`, `applications`, or something else? | `firstArray(root, [...])` |
| Are bounds **desktop-absolute** or **window-relative**? | `CuaDriverBridge` scope handling — **critical** |
| What are the secure-field role names on macOS? | `SECURE_ROLES` |
| What key holds advertised actions? | `firstArray(node, ['actions', ...])` |
| Are `pid` / `windowId` numbers, strings, or bigints? | `asNumber` (already handles all three) |

**Pass criterion:** `normaliseDesktopState()` on the captured payload returns a
non-empty `apps` array with correct pids and at least one window with elements.

### 4.3 Verify the TCC grant lands on the signed app

```bash
# 1. Reset so you observe a real first-grant, not a stale one
tccutil reset Accessibility ai.generatorai.desktop
tccutil reset ScreenCapture ai.generatorai.desktop

# 2. Launch the SIGNED, NOTARISED build — not `pnpm dev`
open /Applications/GeneratorAI.app

# 3. Enable computer use, start a chat, ask the agent to list apps.
#    Expect exactly ONE prompt per grant, naming "GeneratorAI".

# 4. Confirm the grant is attributed to us, not to a helper
sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
  "SELECT service, client, client_type, auth_value FROM access
   WHERE client LIKE '%generatorai%' OR client LIKE '%cua%';"
```

**PASS:** rows exist with `client = ai.generatorai.desktop`, `client_type = 0`
(bundle id), `auth_value = 2` (allowed). **No** row naming `cua-driver`.

**FAIL — `client_type = 1`** (an absolute path): the binary is being spawned
from outside the bundle. Fix §3.1 — this is the exact bug this design prevents.

**FAIL — a row for `cua-driver` itself:** the driver is its own responsible
process; `hostBundleId` is not being honoured, or the binary is not inside the
signed bundle.

**FAIL — the prompt reappears on every launch:** the grant is attaching to a
changing identity. Check the code signature is stable across launches:
`codesign -dv --verbose=4 /Applications/GeneratorAI.app`.

### 4.4 Discover the real element-action tool names

```bash
# With the probe from 4.2 still connected:
console.log(await client.listToolsJson());
```

Find the tools that set a value and invoke an accessibility action, then update
`CuaDriverBridge.act()` and flip `supports.setValue` / `supports.performAction`
back to `true` in `capabilities()`.

### 4.5 The two oracles that actually prove "background"

These are the tests that distinguish this feature from a screen-scraping bot.

**Cursor preservation** — a Tier 1/2 action must not move the pointer:

```bash
node --input-type=module -e "
import { CuaDriver } from '@trycua/cua-driver';
const c = CuaDriver.connect(process.env.SOCK);
await c.startSession({ session: 'oracle', captureScope: 1 });
const before = await c.getCursorPosition({ session: 'oracle' });
// …perform a computer_click through the app against a background window…
const after = await c.getCursorPosition({ session: 'oracle' });
console.log({ before: before.text, after: after.text });
"
```

**PASS:** identical positions, and `ToolResult.action.route === 0`
(`Accessibility`).
**FAIL:** the pointer moved → the driver escalated to synthetic input. Our
`mapRoute()` will report `path: 'synthetic'` and `verification.state:
'unverified'`, which is correct behaviour — but it means background operation is
not available for that app and the user will notice their cursor jumping.

**Input leak** — keystrokes must not reach a decoy:

1. Open TextEdit (target) and a second TextEdit window (decoy), decoy focused.
2. Ask the agent to type into the target.
3. **PASS:** refusal `target_not_focused` — the focus gate in
   `CuaDriverBridge.resolveTarget()` fired.
4. **FAIL:** text appears in the decoy. The focus gate is not working; disable
   `allowSyntheticFallback` and investigate before shipping.

### 4.6 Blocklist behaviour against real apps

```
1. Install 1Password. Ask the agent to list apps.
   PASS: 1Password absent from the list.
2. Ask it to click something in 1Password by name.
   PASS: refusal `target_lost` (deliberately indistinguishable from "not
   running" so the agent cannot probe), AND a `computer_use_audit` row with
   refusal_code='app_blocked', blocked_on='bundleId:com.1password.1password'.
3. Repeat with Terminal.app and with GeneratorAI itself.
   PASS: all refused; GeneratorAI refused with matchedOn='self'.
```

```sql
SELECT action, refusal_code, blocked_on, created_at
FROM computer_use_audit WHERE refusal_code IS NOT NULL
ORDER BY created_at DESC LIMIT 20;
```

### 4.7 Kill switch

```bash
GENERATORAI_COMPUTER_USE=0 open -a GeneratorAI
```
**PASS:** `computer_capabilities` reports `provider: 'disabled'`; every other
tool refuses `provider_unavailable`; no driver process spawns
(`pgrep -fl cua-driver` is empty).

---

## 5. Ship gate

Do not enable for users until **all** of these are true:

- [ ] §4.1 native module loads on both `darwin-arm64` and `darwin-x64`
- [ ] §4.2 payload pinned; **bounds coordinate space confirmed**
- [ ] §4.3 TCC rows show `client = ai.generatorai.desktop`, `client_type = 0`
- [ ] §4.5 cursor-preservation oracle passes
- [ ] §4.5 input-leak oracle passes (refusal, not leakage)
- [ ] §4.6 all three blocklist cases refuse and audit
- [ ] §4.7 kill switch spawns no driver
- [ ] Consent dialog implemented (§3.5) — without it every prompt expires to deny
- [ ] `notarytool` submission passes with the driver bundled

Windows and Linux follow the same procedure minus §4.3. Linux: verify
`detectDisplayServer()` against X11, Sway, and GNOME. **KDE is unsupported at
launch** — `capabilities()` reports the limitation and element targeting is off.
