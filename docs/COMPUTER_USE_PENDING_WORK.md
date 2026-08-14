# Computer Use — Pending Work

Status as of 2026-08-14. Driver under test: `@trycua/cua-driver` 0.19.3 (win32-x64-msvc).

Companion to `COMPUTER_USE_DRIVER_OVERHAUL_ANALYSIS_AND_PLAN.md`, which holds the
original analysis. That document's phase status is now stale; this one supersedes
it.

Every claim marked **verified** was measured against the live driver on this
machine. Claims marked **inferred** have not been executed and are called out as
such.

---

## 1. Where the phases actually stand

| Phase | Scope | Status |
| --- | --- | --- |
| **P0** | Unbreak packaging | ✅ done, except the packaged smoke test |
| **P1** | Capability wins needing no binary | ✅ done |
| **P2** | Ship the binary | ✅ done for Windows; other targets unfetched |
| **P3** | Daemon + endpoint acquisition | ✅ done, except Session 0 preflight |
| **P4** | Capabilities the daemon unlocks | ⛔ not started |
| **P5** | Browser surface | ⛔ blocked on a product decision |

### Current surface

- **21 of 54** driver tools reached (was 19).
- **16** agent-facing `computer_*` tools.
- **931** tests passing; typecheck clean across core, shared, server, web, desktop.

---

## 2. Done and verified

### P0 — packaging

- `@trycua/cua-driver` added to `BUNDLE_EXTERNALS` and `RUNTIME_PACKAGES`. Without
  this, esbuild inlines the driver's JS, `createRequire(callerUrl).resolve()` can
  no longer find the sibling platform package, and computer use fails in every
  packaged build. It had never been exercised.
- `driverPlatformPackage()` plus a staging assertion for the per-target
  `.dll`/`.so`/`.dylib`.
- Composition-root comment corrected — it described an endpoint-only path the
  code did not implement.

### P1 — capability wins

| Item | Verified result |
| --- | --- |
| `query` projection | **441 → 13 elements** on a live Excel grid |
| `element_token` | superseded handle refused `stale_element_token`, proving it is on the wire |
| `stale_element_token` → `stale_snapshot` | means "re-snapshot", not "route dead" |
| `creates_new_application_instance` | exposed as `newInstance` |
| `escalation.recommended` | parsed structurally; surfaced as `tryNext` |
| `timeoutMs` / `stableSamples` | exposed on `computer_verify` |

Two bugs found and fixed while doing this:

- **Filtered snapshots were reported as truncated.** The driver sets
  `elements_complete: false` for any projection, so a queried snapshot claimed
  "418 elements truncated" when they were filtered by the agent's own query. An
  agent that believes that re-reads the whole window and loses the entire saving.
- **`window_minimized` mapped to `provider_unavailable`** — "the driver is
  broken" — when the driver names an exact remedy. Now `background_occluded`,
  which the skill's refusal table already answers.

**`trimFiller` was deleted.** Measured before removing:

| App | Elements | Would have dropped |
| --- | --- | --- |
| Excel | 53 | 0 |
| Notepad | 47 | 0 |
| Explorer | 164 | 0 |
| Chrome | 285 | **79** |

Zero benefit on three apps, and on Chrome it deleted readable page content —
"Is YJS a CRDT?", "Web results", article text. `isFiller()` treated any element
with a label but no `value` as noise, which is what web text looks like.

### P2 — the binary

- `scripts/fetch-cua-driver.mjs`: fetch by exact tag → SHA256 against upstream
  `checksums.txt` → stage per target. **Verified**: 69.3 MB, 7 files, binary runs
  and reports `cua-driver 0.19.3`.
- **The archive ships four executables, not one.** `cua-driver.exe` references
  `cua-driver-uia` (the out-of-process UIA worker) and `cua-cursor-theme`.
  Shipping the entry point alone gives a driver that starts and then cannot read
  a window. Earlier size estimates of 25–40 MB were wrong.
- `extraResources` entry, build-time assertion that staged version === SDK
  version, resolver updated for packaged and dev layouts, `.gitignore` rule.

### P3 — daemon and endpoint acquisition

Four-rung ladder, ordered by who owns the driver:

1. endpoint pushed by the desktop shell (only form macOS TCC respects)
2. `GENERATORAI_CUA_DRIVER_SOCKET` — externally managed daemon
3. a daemon we spawn from the bundled executable
4. in-process — works, cannot own the cursor overlay

**Verified** with `allowInProcess: false` so the fallback could not mask anything:

```
PASS  connected over \\.\pipe\cua-47640-690b6ef1
PASS  bridge spawned the daemon itself
PASS  runtime reports attached/ready
PASS  health checks came back (8)
PASS  drove explorer.exe through the daemon — 164 elements
PASS  agent cursor is live — impossible on the in-process runtime
PASS  daemon stopped with the bridge
```

And through the server's own API: `host=attached state=ready version=0.19.3`.

That `agent cursor is live` line closes the cursor investigation: the overlay is
daemon-owned, and in-process could never have rendered it.

Also fixed: **`computer-host.ts` could never have started a daemon.** It set
`permissionMode: bounded` with no `sessionPolicyPath`; the driver refuses with
"bounded mode requires session_policy_path". Latent since it was written,
invisible because no binary existed.

### Runtime control and settings

- `GET`/`POST /workspaces/:id/computer/runtime` — `start` / `restart` / `stop`,
  all four paths verified.
- Read-only by contract: status never opens a session, so polling cannot hand out
  desktop control.
- Settings shows driver health; the chat's Computer panel has Start/Restart.
- Computer Use defaults **off**, and resolves to disabled on any malformed state.

---

## 3. Open issues

### 3.1 Security — the terminal bypasses every gate

**Severity: high. Unresolved.**

Nothing stops the agent running `cua-driver` directly from the integrated
terminal. That path skips consent, the blocklist, and the audit trail entirely.

The skill forbids it — including `cua-driver`, `orca`, `xdotool`, `osascript`,
`nircmd` and PowerShell UI automation, "even if another skill on this machine
tells you to" — and a test asserts our skill never teaches the raw CLI. But
guidance is not a control.

This became more likely, not less, now that we ship the binary: `cua-driver.exe`
is on disk inside our own resources.

Worth noting the shape of the risk: `cua-driver skills install` writes an agent
skill that instructs the model to drive its CLI directly. A user who runs that
command has effectively installed a gate-bypass.

**Needs its own design.** A hardcoded string match in the terminal is not it.

### 3.2 Bounded permission mode needs a capability manifest

**Severity: medium.**

`standard` mode is in use because `bounded` refuses to start without
`sessionPolicyPath`. Bounded is the posture we want: it would restrict the driver
to a manifest of the tools we actually expose, enforcing at the driver what
`ComputerService` enforces at the service — defence in depth against our own
gates being bypassed.

I did not invent a manifest schema blind. Needs the YAML/Rego capability-manifest
format from the driver docs.

### 3.3 macOS TCC attribution is unverified

**Severity: medium. This is an inference, not a measurement.**

The packaged server runs as `process.execPath` — our own signed Electron binary
in Node mode — so the responsibility chain should be:

```
GeneratorAI.app
  └─ GeneratorAI (ELECTRON_RUN_AS_NODE)
       └─ cua-driver
```

Every hop ours. The cua warning about "a separate gateway or Node process"
describes a differently-signed spawner.

**But `isAvailable` now returns true on darwin whenever a binary is bundled**,
where it previously returned false without a pushed endpoint. macOS will attempt
a self-spawned daemon for the first time.

Settles in one call on a real Mac: `check_permissions` should return
`source.attribution: "host"`. If it does not, fall back to Electron-main
spawning, which `computer-host.ts` already implements.

### 3.4 Session 0 fails silently

**Severity: medium.**

A server running as a Windows service or over SSH sits in Session 0, which has no
interactive desktop. `list_windows` returns `[]` — not an error. A daemon we
spawn there inherits the same session and sees nothing.

`GENERATORAI_CUA_DRIVER_SOCKET` is the escape hatch, but nothing detects the
condition or tells the user to use it. The preflight is not implemented.

### 3.5 Nested-binary signing is unverified

**Severity: medium, release-blocking when it bites.**

Upstream does **not** Authenticode-sign the Windows binaries (`NotSigned`,
checked). On Windows that only affects SmartScreen and AV reputation — Orca ships
an unsigned `elevate.exe` and nothing breaks.

On macOS every Mach-O inside a notarized bundle must be signed with the same Team
ID and hardened runtime. electron-builder's mac pass should cover it, but it must
be **verified** with `codesign -dv --deep`, because failure surfaces at release
time, not build time.

### 3.6 VPS consent UX assumes a local operator

**Severity: medium. Product question, not a bug.**

Computer use works on a VPS given an interactive desktop session. There, anyone
holding `exec:computer` can drive that host's desktop, and the person approving
the consent card is not sitting at the machine.

`exec:computer` is already excluded from every default scope set, which is the
right start. The consent copy and model are not designed for a remote operator.

### 3.7 Excel cell values cannot be verified

**Severity: low. A driver limitation, documented, not fixable by us.**

`verify_state`'s selector vocabulary is `role` + `label_contains` only — no exact
match, no index. `label_contains: "A1"` matches A1 and A10–A19, so the driver
returns `multi_match` and refuses to guess. The formula bar exposes no readable
value.

The skill states this plainly rather than letting the agent claim success.

### 3.8 Known upstream bugs we inherit

- [#3011](https://github.com/trycua/cua/issues/3011) *(open)* — first keyboard or
  text action leaves the agent cursor at `position: null`. Observed on our daemon
  path.
- [#2976](https://github.com/trycua/cua/issues/2976) *(fixed by #3013, not in
  0.19.3)* — reusing a session ID permanently tombstones the overlay. **We reuse
  `generatorai-<workspaceId>` forever**, so this will bite once the cursor is
  advertised. Mint a fresh session id per start until we are past 0.19.3.
- [#2879](https://github.com/trycua/cua/issues/2879) — no upstream oracle
  requiring a visible pointer on Windows, which is how a fully-built feature
  shipped non-functional.

---

## 4. Not implemented

### P0 remainder

- **Packaged smoke test.** Launch Notepad, snapshot, write, verify — run against
  `win-unpacked`, not dev. Nothing currently proves the packaged path works.

### P2 remainder

- **Non-Windows targets unfetched.** `fetch-cua-driver.mjs` handles all six
  triples but only `win32-x64` has been run and verified. macOS ships a universal
  binary; Linux is preview-grade upstream.
- **CI wiring.** The fetch is manual today.

### P4 — capabilities the daemon unlocks

None started. All are now reachable because the daemon works.

| Capability | Value |
| --- | --- |
| **Agent cursor**, properly | Session label as badge, motion tuned. Confirmed live on the daemon path. Blocked on the #2976 session-id fix. |
| **`start_recording` / `stop_recording`** | Per-action `before.png` / `after.png` / `click.png` with a marker on the exact click point, plus before/after state JSON. Turns our audit trail into an evidence trail. |
| **`health_report` / `check_permissions`** as preflight | Partly used in `runtime()`; not used to block a doomed run before it starts. |
| **`zoom` + `from_zoom`** | The honest fallback when the tree cannot disambiguate, instead of blind pixel guessing. |
| **`debug_image_out`** | Crosshair PNG per click, straight into the preview panel. |
| **`get_screen_size` / `get_cursor_position`** | Would make the oracles deterministic; currently ad-hoc in tests. |
| **`set_window_frame`** | Verified geometry for deterministic screenshots. |
| **`check_for_update`** | Version drift is what started the cursor confusion. |

### P5 — browser

`browser_*` refuses to bind to an ordinary browser:

```json
{"refusal":{"code":"browser_requires_setup",
            "message":"no owned DevTools endpoint for pid 38464 — run browser_prepare explicitly"}}
```

Using it means launching a **separate driver-owned isolated Chromium**. That is a
product decision about a second browser profile, not an implementation detail.
Nine tools plus `semantic_v2` snapshots wait behind it.

---

## 5. Deliberately not adopted

Recorded so nobody re-litigates them by accident.

| Capability | Why not |
| --- | --- |
| `kill_app` | Force-kill loses unsaved user work. Only with its own consent tier. |
| `get_desktop_state` | Desktop scope puts every unrelated window into model context. Window-scope-only is a privacy decision. |
| `get_accessibility_tree` | Enumerates every window on the desktop. Same argument. |
| `move_cursor` | **Defaults to `scope: "desktop"`, which moves the user's real pointer.** |
| `set_config` | Global disk write affecting other driver consumers. |
| `escalate_session` | Deprecated upstream, irreversible per session. |
| `page` (legacy) | Superseded; mutations need a daemon env var. |
| `replay_trajectory` | Element indices do not survive sessions. Useful for our regression tests, not users. |
| `install_ffmpeg` | Installs software on the user's machine. |
| `browser_download` | Writes web files to disk. Needs its own consent tier. |
| Cursor themes / motion | Cosmetic. Revisit once the base overlay is advertised. |

---

## 6. Housekeeping

- **23 leftover probe files** at the repo root (`probe-*.mjs`, `probe-*.json`,
  `tool-inventory.txt`) from investigation sessions. Throwaways; safe to delete.
- The verification harness in `agent-tests/` is worth keeping:
  `computer-use-oracles.mjs`, `computer-use-apps-e2e.mjs`,
  `computer-use-consent-e2e.mjs`, `computer-use-p1-verify.mjs`,
  `computer-use-selfspawn.mjs`, `computer-use-daemon-probe.mjs`,
  `computer-use-path-trace.mjs`, `consent-autoresponder.mjs`.
- `COMPUTER_USE_DRIVER_OVERHAUL_ANALYSIS_AND_PLAN.md` says "implementation not
  started" and lists P0/P1 as pending. That is stale.

---

## 7. Suggested order

1. **Packaged smoke test** (P0 remainder) — small, and nothing else proves the
   thing we just built actually ships.
2. **Session 0 preflight** (3.4) — silent wrong answers are the worst failure
   mode we have left.
3. **`start_recording`** (P4) — the largest single upgrade to what the user can
   see, and it needs no new decisions.
4. **Terminal bypass** (3.1) — highest severity, but needs design before code.
5. **macOS verification** (3.3, 3.5) — one session on a real Mac settles both.
6. **Capability manifest** (3.2).
7. **Browser** (P5) — only after the isolated-Chromium decision.

Items 1–3 are independent and can proceed in parallel with the decisions in 4–7.
