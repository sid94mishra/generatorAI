# Computer Use — Driver Overhaul: Analysis and Plan

Status: analysis complete, implementation not started
Driver under test: `@trycua/cua-driver` 0.19.3 (win32-x64-msvc)
Date: 2026-08-13

Companion to `COMPUTER_USE_RESEARCH_AND_INTEGRATION_PLAN.md`, which covers the
original build. This document covers the audit of that build against the
driver's full published surface, and the plan to close the gap.

---

## 1. Evidence log

Everything below was measured against the live driver on this machine, not
inferred from documentation. Where a claim is an inference it is marked as such.

### Snapshot size — the `query` projection

`get_window_state` accepts a server-side `query` that projects the tree to
matching rows plus their ancestor chain, without renumbering `element_index`.

| Call (live Excel window) | Bytes | Elements |
| --- | --- | --- |
| no `query` | 118,557 | 425 |
| `query: "A1"` | **3,992** | 13 |

**30× reduction**, performed by the driver, before the payload is built. Our
client-side `trimFiller` shrinks the response *after* the driver has already
paid to walk 425 elements.

### `element_token` exists and we do not use it

Every element in the structured response carries one:

```json
{"depth":5,"element_index":60,"element_token":"s00000001:60","enabled":true,
 "frame":{...},"label":"A1","parent_index":59,"role":"DataItem",
 "selected":false,"value":"FRESH-RUN-2026"}
```

It carries `(element_index, snapshot_id, window_id)` in one opaque handle and
produces an explicit `stale_element_token` refusal. We hand-manage the same
association in a `snapshotScopes` Map.

### `verify_state` latency

Measured 8.7 s and 11.4 s against Excel. Defaults are `timeout_ms: 5000`,
`stable_samples: 2`; the call inherits the target app's UIA responsiveness. We
expose neither parameter, so a verify that is guaranteed to return
`multi_match` still costs ~9 seconds.

### Excel cell values cannot be verified

Raw `verify_state` response for `role: DataItem, label_contains: "A1",
value_equals: ...`:

```json
{"predicates":[{"index":0,"status":"unknown","unknown_reason":"multi_match",
                "observed_json":"{\"matches\":11}"}],
 "samples":2,"stable":false,"status":"unknown"}
```

11 elements matched — `A1` plus `A10`…`A19`. The selector vocabulary is
**`role` + `label_contains` only**; there is no exact-match and no index. A
spreadsheet address can therefore never be disambiguated once double-digit rows
exist.

Varying one thing at a time:

| Predicate | Outcome |
| --- | --- |
| `role:DataItem, labelContains:"A1", valueEquals:…` | `unknown` / `multi_match` (11 matches) |
| `role:DataItem, labelContains:"A1", exists:true` | **satisfied** |
| `labelContains:"Formula Bar", valueEquals:…` | `unknown` / `unsupported_predicate` |

Existence is decidable with 11 matches; a *value* is not. The formula bar is not
a fallback — it exposes no readable value.

### `include_screenshot` is not a hidden cost

Hypothesis tested and **rejected**: omitting `include_screenshot` does not make
the Windows driver capture a screenshot we discard.

| Call | Time | Whole result |
| --- | --- | --- |
| omit `include_screenshot` | 1130–1361 ms | 349,354 B |
| `include_screenshot: false` | 1146–1537 ms | 348,238 B |

No meaningful difference. This is not a gap.

### The agent cursor cannot work in our current process form

`set_agent_cursor_enabled` returns `{enabled: true}`; `get_agent_cursor_state`
continues to report `enabled: false`. Reproduced across:

- the MCP tool surface **and** the typed SDK (`driver.setAgentCursorEnabled`)
- `capture_scope` = window, desktop, and auto
- brand-new session ids that were never reused
- with and without `~/.cua-driver/config.json`

`set_config` refuses the key: *"`agent_cursor.enabled` is not present in the
concrete tool schema."* `move_cursor` reports `route: synthetic_events`, never
the `agent_cursor_overlay` route.

The native library **does** contain the implementation — `Cua.AgentCursorOverlay`
window class, `spawn overlay thread`, `Win32 overlay: CreateWindowExW failed`,
`overlay fps=`, and an `agent_cursor_overlay` action route.

The cause is documented in the in-process SDK guide:

> Direct macOS runtimes also return `facility_unavailable` for agent-cursor
> overlay operations unless the host installs a suitable AppKit main-thread
> adapter. **Use a private worker or explicit service when the overlay is
> required.**

The overlay is not owned by the same-process runtime. Both overlay-capable
forms — `EmbeddedCuaDriverHost` and `PrivateWorkerOptions` — require
`binaryPath`. We ship no binary. That is the whole cause.

Related upstream issues:

- [#3011](https://github.com/trycua/cua/issues/3011) (open) — first keyboard/text
  action leaves the cursor at `position: null`.
- [#2976](https://github.com/trycua/cua/issues/2976) (fixed by #3013, not in
  0.19.3) — reusing a session ID permanently tombstones the overlay. **We reuse
  `generatorai-<workspaceId>` forever**, so this will bite us once the overlay
  works.
- [#2879](https://github.com/trycua/cua/issues/2879) — no cross-platform oracle
  requiring a visible pointer and badge. Upstream has no test proving this
  renders on Windows.

### `browser_*` cannot bind to an ordinary browser

Binding to the running Chrome (pid 38464) refuses:

```json
{"refusal":{"code":"browser_requires_setup",
            "message":"no owned DevTools endpoint for pid 38464 — run browser_prepare explicitly to set one up"},
 "status":"refused"}
```

Using that surface means launching a separate driver-owned isolated Chromium.
That is a product decision, not an implementation detail.

### `move_cursor` defaults to moving the real pointer

`scope` defaults to `desktop`. The driver replies *"Moved the OS pointer to
(x, y) (scope:desktop)"*. Only `scope: "window"` addresses the overlay. We never
call this tool; noted so nobody adds it casually.

### Fresh Excel run after the first round of fixes

9 computer steps in ~5 minutes, versus a 32-step ~30-minute baseline on the same
model (claude-sonnet-4.6). No refusals, no repeated call above 2, no dead-end
loop. The agent used the keystroke path rather than `set_value`.

---

## 2. Driver capability inventory

56 MCP tools published; 54 reported by 0.19.3 on Windows.

### Perception (10)
`get_window_state` (AX tree **and** screenshot in one call; `query`,
`max_elements`, `max_depth`, `include_screenshot`, `screenshot_out_file`;
returns `snapshot_id`, per-element `element_token`, `elements_complete`,
`total_element_count`, `degraded_reason`, `off_space`) · `list_apps` (running
**and** installed, `launch_path`, `last_used`) · `list_windows` (bounds,
`z_index`, minimised, Spaces) · `get_accessibility_tree` (cheap desktop
discovery, no TCC) · `get_desktop_state` (full-display native-pixel PNG) ·
`get_screen_size` · `get_cursor_position` · `zoom` (crop plus `from_zoom`
coordinate translation) · `get_config` · `get_recording_state`

### Action (15)
`click` (`element_token` | `element_index`+`snapshot_id` | `x,y`; `button`,
`count`, `action: press/show_menu/pick/confirm/cancel/open`, `modifier`,
`from_zoom`, `debug_image_out` — writes a PNG with a red crosshair at the click
point) · `double_click` · `right_click` · `drag` (`duration_ms`, `steps`,
modifiers held) · `type_text` (AX insert then synthetic fallback; px form
focuses and types in one call) · `press_key` · `hotkey` · `set_value` ·
`scroll` (targeted wheel vs keystroke path) · `move_cursor` ·
`launch_app` (`urls`, `creates_new_application_instance`,
`additional_arguments`; returns `windows[]`, `launch_state`,
`self_activation_suppressed`) · `kill_app` · `bring_to_front` ·
`set_window_frame` (verified readback) · `invoke_menu` (menu path, fails closed,
never falls back to pixels)

### Verification (1)
`verify_state` — up to 8 ANDed predicates, `stable_samples`, `timeout_ms`,
`include_screenshot`; `satisfied | unsatisfied | unknown`.

### Browser (9 + legacy)
`get_browser_state` (bind mode; `semantic_v2` outline with typed action refs,
scoped reads, `query`, continuation) · `browser_prepare` · `browser_navigate` ·
`browser_click` · `browser_type` (`replace`) · `browser_pointer` ·
`browser_dialog` · `browser_set_input_files` · `browser_download` · legacy `page`

### Recording (5)
`start_recording` — per-turn folders with `before.png`/`after.png`,
`before_state.json`/`after_state.json`, `action.json`, `click.png` with a red
marker, `evidence.json`; optional H.264 video · `stop_recording` ·
`get_recording_state` · `replay_trajectory` · `install_ffmpeg`

### Lifecycle and config (9)
`start_session` (`cursor_theme`) · `end_session` · `get_session` ·
`list_sessions` · `get_session_state` (deprecated) · `escalate_session`
(deprecated) · `set_config` (per-session override vs global disk) ·
`clipboard_read` · `clipboard_write`

### Cursor (4)
`set_agent_cursor_enabled` · `set_agent_cursor_motion` ·
`set_agent_cursor_theme` · `get_agent_cursor_state` — session-coloured pointer,
name badge, delivery chip (background/foreground), target chip
(ax/pixel/browser/desktop), custom dotLottie themes.

### Maintenance (4)
`check_permissions` · `health_report` (stable `schema_version: "1"`) ·
`check_for_update` · `install_ffmpeg`

### Cross-cutting contracts

- **Four axes**: perception (always both tree and screenshot) → action rung
  (`ax` vs `px`, selected by *how you address the target*) → delivery
  (`background`/`foreground`) → target (`window`/`desktop`).
- **Action response**: `effect`
  (`confirmed|partial|unverifiable|suspected_noop|refused`), `route`,
  `delivery`, `evidence`, `escalation: {recommended, reason}`.
- **Refusal variant** carries `code`. `stale_element_token` means *re-snapshot*,
  not *route dead* — agents that treat it as a dead route fall back to blind
  pixel clicking.
- **Permission modes**: standard / bounded / unrestricted; YAML and Rego
  policies; capability manifests.

---

## 3. Our architecture today

```
Agent (chat turn)
  └─ 16 computer_* tools ......... packages/core/src/tools/computer/index.ts
       payload shaping ........... computerToolTypes.ts (trimFiller, injection scan, warnings)
  └─ ComputerService ............. 14-step ordered gate pipeline
       1 feature gate  2 bridge resolve  3 app resolve  4 blocklist
       5 tier gate     6 consent        7 permit
       ── inside permit ──
       8 re-resolve   9 snapshot fence  10 dispatch  11 invalidate
       12 artifact    13 audit          14 event emit (FIFO per workspace)
  └─ IComputerBridge (port, 11 methods)
       ├─ CuaDriverBridge ........ 19 of 54 driver tools
       └─ NullComputerBridge ..... typed refusals, always last
  └─ Driver: CuaDriver.create(undefined) — same-process, no daemon

Side surfaces
  exec:computer scope ............ packages/auth (excluded from all defaults)
  /workspaces/:id/computer ....... consent, grants, activity, frames
  ComputerPanel.tsx .............. consent card, grants, live frame, timeline
  generatorai-computer-use ....... skill, staged per chat
```

### What is genuinely good

- The 14-step ordering in `ComputerService` is the strongest part. Putting
  re-resolve, snapshot fence, dispatch and invalidate *inside* the permit is a
  correctness argument, not a style choice, and the comment states the
  concurrency bug it prevents.
- Consent scoping (`read < mutate < synthetic`) with grant ranking, replay
  rejection and revocation — verified 6/6 end to end.
- `NullComputerBridge` terminating the chain so absence is a typed refusal.
- Refusing to trust echo-prone reads, and shipping `verified: false` honestly.
- `exec:computer` excluded from every default scope set.

---

## 4. Unbiased review — where we are weak

### A. We rebuilt things the driver already does

| We built | Driver already has | Verdict |
| --- | --- | --- |
| `trimFiller` / `EMPTY_ROLE_CAP` | `query` projection (30× measured) | Ours is strictly worse |
| `snapshotScopes` map | `element_token` | Ours is redundant |
| `SCAN_LADDER` retry | no driver equivalent | Keep |
| screenshot artifact pipeline | `screenshot_out_file` (already used) | Fine |

### B. We infer from prose what the contract gives structurally

`CuaDriverBridge` decides foreground escalation with
`/delivery_mode\s*[:=]\s*"?foreground/i` against `result.text`. The contract
defines `escalation: {recommended, reason}` and `evidence`. We read neither.

Honest caveat: a live unverifiable Excel `set_value` returned **no**
`escalation` field, so this is latent fragility rather than a bug biting today.

### C. We collapse a 4-axis contract into 2

We expose `computer_click` (ax) and `computer_click_point` (px) and hide
delivery entirely. Consequences: no `zoom` + `from_zoom`, no `debug_image_out`,
no desktop target, no `button`/`count`/`action` variants.

### D. We have an audit trail but no evidence trail

We store screenshots and audit rows. `start_recording` produces before/after
state JSON, before/after PNGs, and `click.png` with a marker on the exact point,
per action, from the driver.

### E. Session identity is single-tenant by accident

`generatorai-${workspaceId}` is one session per workspace forever, and
`launch_app` never passes `creates_new_application_instance`. Two chats in one
workspace driving Excel will fight over one window.

### F. Packaging cannot work today (P0)

`@trycua/cua-driver` is in neither `BUNDLE_EXTERNALS` nor `RUNTIME_PACKAGES` in
`apps/server/bundle-externals.mjs`. The server is built with `bundle: true`, so
esbuild will inline the driver's JS. The driver resolves its native library
through `@ubjs/node`:

```js
const require_ = createRequire(callerUrl);
pkgJsonPath = require_.resolve(`${pkgName}/package.json`);  // @trycua/cua-driver-win32-x64-msvc
```

Once inlined, `callerUrl` is the bundle itself and that resolve fails. This is
the exact failure mode the file's own comment describes for Playwright:
*"Resolves its driver through package-relative paths … which break when
inlined."*

**Computer use cannot work in a packaged build today, in any process form.** The
current `win-unpacked` bundle is 6 MB and contains no `CuaDriverBridge`, so this
path has never been exercised.

### G. The composition-root comment is stale

It says *"CuaDriverBridge stays unavailable until Electron main pushes an
endpoint"*. On Windows `inProcessAllowed()` is true, so dev silently uses the
in-process runtime. The comment describes an intent the code does not implement.

---

## 5. TCC, and why Playwright does not hit it

TCC (Transparency, Consent and Control) is macOS's privacy gate. Two grants
matter:

| Grant | Needed for |
| --- | --- |
| Accessibility | every AX read, every element click, every keyboard primitive |
| Screen Recording | screenshots |

Grants attach to a **code identity**, not a file path. macOS resolves the
*responsible process* and the grant belongs to that. Change the identity and the
grant is void.

The distinction that matters for packaging is **not signing** — it is which
grants the child needs:

| What | Form | Needs TCC? |
| --- | --- | --- |
| `better-sqlite3`, `node-pty` | `.node` addon, `dlopen`'d into our process | No. It *is* our process. |
| Playwright's Chromium | spawned executable | **No.** It renders pages; it never reads another app's AX tree or captures the screen. |
| Claude Code / Copilot CLI | spawned executable | **No.** Filesystem and network. |
| **cua-driver** | spawned executable | **Yes — both grants.** |

Playwright "just works" not because it is special, but because nothing it does
is TCC-gated. cua-driver is the first thing we ship that needs Accessibility and
Screen Recording.

### What is genuinely restricted on macOS

- Shipping and spawning the binary is fine. cua publishes macOS installers and a
  `CuaDriver.app`; the standalone daemon is a supported form.
- What is not possible is grants following an arbitrary path. From the process
  model: *"A raw daemon launched outside `CuaDriver.app` without embedded mode
  has no stable TCC identity and is unsupported."* And: *"If an IDE terminal
  starts `cua-driver` directly, macOS attributes that subprocess to the terminal
  app's bundle."*
- The user must grant once, interactively. No packaging avoids the System
  Settings toggle. Embedded mode makes the prompt say *GeneratorAI* rather than
  *CuaDriver*, which is the outcome we want.
- Grant changes require a daemon restart; TCC is cached per process.
- Linux has no TCC. It has display-server constraints instead.

### Our identity chain is probably already correct

`apps/desktop/src/main/server-manager.ts`, packaged branch:

```ts
command: explicitNode || process.execPath,   // our own signed Electron binary
args: [this.paths.serverEntry],
// env['ELECTRON_RUN_AS_NODE'] = '1'
```

The packaged server is **not** a foreign `node`. It is our own app executable in
Node mode. So the chain is:

```
GeneratorAI.app
  └─ GeneratorAI (ELECTRON_RUN_AS_NODE)   ← same signed binary, inside the bundle
       └─ cua-driver                       ← our Resources, our signature
```

The cua warning — *"if a separate gateway or Node process spawns the daemon, the
daemon inherits the gateway's identity"* — describes a differently-signed
gateway. Every hop of ours is our own bundle.

**This is an inference and has not been verified.** It is provable in one call:
`check_permissions` returns `source.attribution`, which should be `"host"` when
embedded mode is live. If it is not, the fallback is
`apps/desktop/src/main/computer-host.ts`, which already spawns from Electron
main. Attempting server-spawn first costs nothing.

---

## 6. Process form: in-process vs private worker vs daemon

| | In-process (today) | Private worker | Embedded daemon |
| --- | --- | --- | --- |
| Needs binary | no | **yes** | **yes** |
| Agent cursor | ✗ | ✓ | ✓ |
| Transport | none | inherited pipes | local socket / named pipe |
| Reconnect | n/a | ✗ by design | ✓ |
| Crash isolation | ✗ | ✓ | ✓ |
| Restart | n/a | respawn | `restart()` with generation |
| macOS | ✗ no TCC identity | ✓ | ✓ |
| Runtime handle lives in | caller | **the spawning process** | any process with the socket |

The last row decides it. `createPrivateWorker()` returns a driver object *in the
spawning process*; choosing it would mean proxying all 11 port methods,
screenshots and abort signals over IPC if the spawner is not the server. The
embedded daemon hands back a socket path, which any process can connect to.

**Recommendation: embedded daemon**, spawned by the server, with Electron-main
spawning retained as the macOS fallback if attribution testing demands it.

Lifetime is already handled: *"The host holds a parent-liveness pipe. EOF shuts
down the daemon if the host exits; Rust destruction also requests a kill as a
fallback."*

---

## 7. Deployment modes — the session is the real constraint

Computer use **can** follow a server-only deployment (VPS), provided the host has
an interactive desktop session.

- **Windows**: the daemon must live in Session 1+ (RDP or console). A
  disconnected RDP session (`Disc`) still counts; the daemon survives
  disconnect and stops only on logoff or reboot.
- **Linux headless / CI**: systemd user unit with `WantedBy=default.target` plus
  `loginctl enable-linger $USER`.

The failure mode is nasty because it looks like success. From the SSH guide:

```powershell
# Over SSH (Session 0), with no daemon helper:
cua-driver call list_windows
# []    ← empty, even though the user's RDP session has 12 windows open
```

### Three endpoint-acquisition modes

| Mode | Who spawns | When it applies | Lifetime |
| --- | --- | --- | --- |
| **A — server-spawned** | the server itself | dev on Win/Linux; VPS where the server starts from the RDP/graphical session | parent-liveness pipe |
| **B — app-spawned** | Electron main | desktop app; macOS if attribution requires it | pushed over the existing internal route |
| **C — attach** | Scheduled Task / systemd unit / admin | server in Session 0 or behind SSH; shared automation box | independent |

We already have the seam for C (`setEndpoint` plus
`POST /internal/computer/endpoint`); today only B feeds it.

Resolution order: explicit socket/env (C) → app-pushed (B) → self-spawn (A) →
in-process (dev only, logged as degraded).

### Open product question

On a VPS, computer use means any user holding `exec:computer` can drive that
host's desktop, and the person approving the consent card is not physically
present. The scope is already excluded from every default, which is the right
start, but the consent UX currently assumes a local operator.

---

## 8. Shipping the binary — costs

None of these are reasons not to do it. They are packaging work to schedule.

- **Version lockstep (the one that bites silently).** The client verifies
  contract, tool-schema, capability and MCP protocol versions against the daemon
  and *refuses before dispatch*. A dependency bump of `@trycua/cua-driver`
  without re-fetching the binary produces an app where every computer-use call
  refuses. Needs a build-time assertion.
- **Signing.** electron-builder's macOS pass signs nested executables in the
  bundle; it must be *verified* (`codesign -dv --deep`), because an unsigned
  nested binary breaks notarization of the whole app — discovered at release
  time, not build time.
- **AV/EDR on Windows.** A binary performing UIA plus input injection plus
  screen capture is the textbook heuristic profile.
- **Size.** ~25–40 MB per installer. The Windows `.dll` alone is 21.9 MB. We
  already prune node-pty's foreign prebuilds for the same reason.
- **Provenance.** Fetch at build time in CI, never at install or first run.
  Install-time download breaks offline and proxied installs and puts a network
  fetch inside an elevated installer; runtime download means an unsigned binary
  appears after our signature was verified. Upstream publishes `checksums.txt`
  per release — fetch by tag, verify SHA256, fail the build on mismatch.

### How our packaging handles native payloads today

Three mechanisms, all already in use:

- **`.node` addons** — kept out of the esbuild bundle by `BUNDLE_EXTERNALS`;
  reinstalled by `stage-server-runtime.mjs` with `npm_config_runtime=electron`
  so the ABI matches; unpacked by `asarUnpack: ['**/*.node']`.
- **Package-relative resolvers** — Playwright is external for exactly this
  reason. **`@trycua/cua-driver` belongs in this category and is in neither
  list.**
- **Standalone executables** — `extraResources` blocks in
  `apps/desktop/scripts/lib/build-config.mjs`, alongside `server`, `web`,
  `templates`. `cua-driver` is one more entry.

`stage-server-runtime.mjs` also demonstrates the verification discipline to
copy: no symlinks, ABI binary present, fail while it is cheap.

### Orca as a data point

Orca ships computer use inside its own signed `orca` binary — the capability
lives in the product executable rather than a spawned third-party daemon. That
is the "same-process SDK in the signed app" identity from the cua process model,
and it is the pattern that works.

### Note on the CLI-as-binary idea

`apps/cli` is an esbuild ESM bundle with a `bin` entry that depends on
`better-sqlite3` and `node-pty` — native addons that do not go into a Node SEA
cleanly. Compiling the CLI to a binary is its own project with its own
native-module story. `cua-driver` is *already* a native binary; we fetch and
stage it. **Keep these separate** so driver work is not blocked on an unrelated
packaging problem.

---

## 9. Performance summary

| Operation | Measured | Note |
| --- | --- | --- |
| `get_window_state` Excel, no query | 1.1–1.5 s, 118,557 B, 425 elements | ~30k tokens |
| same with `query: "A1"` | 3,992 B, 13 elements | 30× smaller, server-side |
| `verify_state` | 8.7 s / 11.4 s | inherits the app's UIA timeout |
| `SCAN_LADDER` worst case | 3 × ~1.2 s ≈ 3.6 s | before any action |
| `set_value` | fast | `effect: unverifiable` on Excel |

1. `query` is the single biggest lever and we do not use it.
2. `verify_state` at 6–11 s is expensive; we expose neither `timeout_ms` nor
   `stable_samples`.
3. Daemon IPC overhead is noise against a 1.2 s UIA walk.

---

## 10. Capability triage

### Using (19 of 54)

`list_apps` · `list_windows` · `get_window_state` · `verify_state` ·
`launch_app` · `bring_to_front` · `invoke_menu` · `click` · `double_click` ·
`right_click` · `drag` · `type_text` · `press_key` · `hotkey` · `set_value` ·
`scroll` · `clipboard_read` · `clipboard_write` ·
`set_agent_cursor_enabled` (currently inert)

### Should adopt — ranked by value over effort

| # | Capability | Why | Effort |
| --- | --- | --- | --- |
| 1 | `query` on snapshot | 118 KB → 4 KB measured. Deletes `trimFiller`. Fixes token cost at the source. | S |
| 2 | `element_token` | Deletes `snapshotScopes`. Explicit `stale_element_token` instead of silent mis-indexing. | S |
| 3 | `creates_new_application_instance` | Two chats currently fight over one window. Correctness. | S |
| 4 | `escalation` + `evidence` | Replaces regex-over-prose. Lets the agent climb the documented ladder from data. | S |
| 5 | `start_recording` / `stop_recording` | Real per-action evidence including `click.png`. | M |
| 6 | Daemon or private worker | Unblocks cursor, macOS, crash isolation. | M–L |
| 7 | `health_report` + `check_permissions` | A real preflight instead of a first-call failure. | S |
| 8 | `get_screen_size` / `get_cursor_position` | Makes our oracles deterministic. | S |
| 9 | `zoom` + `from_zoom` | Honest fallback when the tree cannot disambiguate. | M |
| 10 | `debug_image_out` | Crosshair PNG per click, into the preview panel. | S |
| 11 | `browser_*` + `semantic_v2` | Requires accepting a driver-owned isolated Chromium. | L |
| 12 | `set_window_frame` | Verified geometry; deterministic screenshots. | S |
| 13 | `check_for_update` | Version drift is how the cursor confusion started. | S |

### Not adopting now — with reasoning

| Capability | Why not |
| --- | --- |
| `kill_app` | Force-kill loses unsaved user work. Revisit only with its own consent tier. |
| `get_desktop_state` | Desktop scope puts every unrelated window into model context. Window-scope-only is a privacy decision. |
| `escalate_session` | Deprecated upstream, and irreversible per session. |
| `move_cursor` | Defaults to `scope: "desktop"` — moves the user's real pointer. |
| `set_config` | Global disk write affecting other driver consumers. Per-session override only, if ever. |
| `page` (legacy) | Superseded; mutations need a daemon env var. Go straight to `browser_*`. |
| `replay_trajectory` | Element indices do not survive sessions. Useful for our regression tests, not for users. |
| `install_ffmpeg` | Installs software on the user's machine. Not without an explicit prompt. |
| `get_accessibility_tree` | Enumerates every window on the desktop. Same privacy argument as `get_desktop_state`. |
| Cursor themes / motion | Cosmetic, and the base overlay does not render for us yet. |
| `browser_download` | Writes web files to disk. Needs its own consent tier first. |

---

## 11. Plan

### Phase 0 — Unbreak packaging (P0, small)

1. Add `@trycua/cua-driver` to `BUNDLE_EXTERNALS` **and** `RUNTIME_PACKAGES`.
2. Add the platform package to `NATIVE_PACKAGES` and assert the
   `.dll`/`.so`/`.dylib` exists in the staged tree — same shape as the existing
   `ABI_SENSITIVE_PACKAGES` check.
3. Add a packaged smoke test: launch Notepad, snapshot, write, verify — run
   against `win-unpacked`, not dev.

*Exit: computer use provably works in a packaged build, still in-process.*

### Phase 1 — Cheap capability wins (independent of process form)

4. `query` passthrough on `computer_snapshot`; delete `trimFiller`. Keep
   `elements_complete` honest so absence stays "unknown".
5. `element_token` replaces `snapshotScopes`; map `stale_element_token` to a
   refusal that says *re-snapshot*, not *route dead*.
6. `creates_new_application_instance` when a second chat targets a live app.
7. Parse `escalation` / `evidence` structurally; retire
   `wantsForegroundDelivery`'s regex over `result.text`.
8. Expose `timeoutMs` / `stableSamples` on `computer_verify`.

*Exit: fewer steps, ~30× smaller snapshots, no index churn.*

### Phase 2 — Ship the binary

9. `scripts/fetch-cua-driver.mjs`: fetch by exact tag → verify SHA256 against
   `checksums.txt` → unpack to
   `apps/desktop/resources/cua-driver/<platform>-<arch>/`.
10. Build-time assertion: staged binary version === installed npm version.
11. `extraResources` entry, exec bit, `asarUnpack`.
12. macOS: verify the nested binary is signed by the mac pass; extend
    entitlements/notarization if not.
13. Extend `verify-release-manifest.mjs` to assert the driver is present and
    matches.

*Exit: `resolveDriverBinary()` finds a binary in a packaged build.*

### Phase 3 — Daemon and endpoint acquisition

14. Server spawns the daemon by default on all three platforms, using
    `EmbeddedCuaDriverHost` and the binary from Resources.
15. Verify `source.attribution: "host"` on a real Mac. If it fails, fall back to
    Electron-main spawning through the existing `computer-host.ts` plumbing.
16. Attach mode (`GENERATORAI_CUA_DRIVER_SOCKET`) for the Session 0 / VPS
    service case.
17. Interactive-session preflight so Session 0 fails loudly instead of returning
    empty window lists.
18. Honour the lifecycle contract: `waitForExit(generation)`, discard clients on
    `restart()`, defer `before-quit` until `stop()` resolves.
19. Settings toggle (off by default), daemon status including session number and
    whether an interactive desktop is attached, and a restart action that
    replaces both the daemon and every SDK client handle.
20. Delete or correct the stale composition-root comment; make the in-process
    dev fallback explicit and logged.

*Exit: crash isolation, macOS viable, agent cursor works.*

### Phase 4 — Capabilities the daemon unlocks

21. Agent cursor: session label as the badge, motion tuned. Mint a fresh session
    id per start until past 0.19.3, because of #2976.
22. `start_recording` scoped to a turn; per-action `before.png` / `after.png` /
    `click.png` into ComputerPanel.
23. `health_report` / `check_permissions` as a real preflight.
24. `zoom` + `from_zoom`, `debug_image_out` for the pixel rung.

### Phase 5 — Browser (separate decision)

25. `browser_*` needs a driver-owned isolated Chromium. Do not start until that
    product decision is made.

### Recommended order

Phase 0 → Phase 1 → Phase 2/3. Phase 1 is small, needs no binary, and attacks
the observed failure directly: bloated snapshots, index churn, and an agent
guessing its next rung.

---

## 12. Corrections made during this analysis

Recorded because each was asserted before being checked.

- **"The Windows agent-cursor backend is stubbed."** Wrong. The overlay is
  implemented; it is not available to the same-process runtime. Documented in
  the in-process SDK guide, which should have been read first.
- **"Computer use cannot follow a remote server."** Wrong. A VPS works given an
  interactive desktop session; there is a dedicated guide for it.
- **"Electron main must spawn the daemon."** macOS-only, and probably not even
  then — the packaged server runs as `process.execPath`, our own signed binary.
- **"Omitting `include_screenshot` costs a wasted screen grab."** Measured and
  rejected.
- **"Nested-binary signing is separate work."** Overstated; electron-builder's
  mac pass covers it. What is real is that it must be verified.
