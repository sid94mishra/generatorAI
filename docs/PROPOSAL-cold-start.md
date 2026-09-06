# Proposal — killing the 11.5 s first-turn wait

**Status: implemented (2026-09-04) as the `prewarmConversation` capability + `ChatManagementService.prewarmChat`; measured in `PERFORMANCE-AUDIT-2026-09.md` §7. Kept as the design record.**

Revised after a web-research pass. **The headline correction: the SDK has had an official pre-warm
API since 0.2.89 (`startup()` / `WarmQuery`), it is present in the 0.3.220 we already ship, and we
are not using it.** My first draft proposed hand-rolling the same thing. Use the real one.

Every measurement below was taken on this machine against the running app on the `claude-agent`
harness.

---

## 1. Where the time goes

| Path | Time |
|---|---|
| Warm turn (live session reused) | **2.5 s** |
| First turn of a new chat | **11.5–14 s** |
| SDK `query()`, **bare** — no MCP, no tools, no system prompt | first message at **14.2 s**, first token 1.5 s later |
| `claude -p "..."` one-shot, cold | 13.2–14.2 s |

A query with *none* of our configuration still takes 14 s to emit `system/init`, and only ~1.5 s
more to produce text. **~12 s is CLI startup, and essentially none of it is our config, our MCP
servers, our tools, or the model.**

Anthropic's own startup profiler (`CLAUDE_CODE_PROFILE_STARTUP=1`, undocumented — found by grepping
the binary) puts a number on it from the inside: `time_to_system_message_ms: 12540`, with
`system_prompt_ms: 115` and `load_initial_messages_ms: 5`. So it is **not** prompt assembly or
history loading. The dominant single block is a **synchronous event-loop stall of 3.3–5.6 s**,
reproduced across five independent runs, localised to the `~/.claude` file-watcher setup — the CLI's
own `[event-loop-stall]` detector names it. `~/.claude/skills` holds 2 files, so it is not scanning
content.

### This is a known, acknowledged limitation

- [claude-agent-sdk-typescript#34](https://github.com/anthropics/claude-agent-sdk-typescript/issues/34) —
  "~12s overhead per call, no hot process reuse". Closed 2025-10-20. Maintainer: *"This is expected
  behavior when passing a string prompt. We recommend using streaming input to keep the process alive
  between turns."* **We already do that — it is why our warm turns are 2.5 s.** A later comment asks
  the exact question we are left with — how to warm up without sending a message — and got no reply.
- [#33](https://github.com/anthropics/claude-agent-sdk-typescript/issues/33) — daemon mode for hot
  process reuse: **requested and declined**, same one-line answer.
- [claude-agent-sdk-python#333](https://github.com/anthropics/claude-agent-sdk-python/issues/333) —
  server-side multi-instance deployment, **open, no maintainer reply**: *"initialization is extremely
  slow (20-30+ seconds)... there's no official mechanism to keep SDK processes warm."*
- [claude-code#85050](https://github.com/anthropics/claude-code/issues/85050) — Windows, silent
  unlogged startup phases, **open, zero comments**. Same environment class as ours.

---

## 2. What I tested and rejected

Recording these because each is the obvious next guess, and each is wrong.

| Hypothesis | Test | Result |
|---|---|---|
| The user's `~/.claude` is bloated (476 MB `projects`, 15 MB plugins) | Minimal but **authenticated** isolated `CLAUDE_CONFIG_DIR` | **No difference** — 12.3 s mean either way |
| Our MCP servers / tools / system prompt cost the time | Bare `query()` with none of them | **No difference** — still 14 s to first message |
| The SDK's bundled native binary is faster | Ran both end-to-end | **Bundled is worse**: 16.0–18.0 s vs 13.2–14.2 s |
| It is CPU contention, so warming would starve the server | 3 cold starts concurrently vs 1 alone | **12.6 s for three, 13.3 s for one** — wait-bound, not CPU-bound |
| Working-tree scanning ([#86638](https://github.com/anthropics/claude-code/issues/86638), a real confirmed bug) | Cold start in an **empty** directory | **Still 14 s** — ruled out for us |

Two corrections to my own earlier reporting:

- My first config-dir test appeared to show a 4–6 s win. It was wrong — the isolated run had failed
  fast with `Not logged in`. With credentials added the difference vanished.
- The research suggested our `claude --version` baseline measured the wrong binary. It did not: the
  provider overrides `pathToClaudeCodeExecutable` with the system CLI via `resolveClaudeCliPath()`,
  and that is the binary I timed. Worth knowing that both are large native binaries — ours 218 MB,
  the SDK's bundled one 266 MB — and **ours is the faster of the two**, so the override is earning
  its keep.

---

## 3. The measurement the design rests on

Spawn a session, leave it idle *n* seconds, then send the first prompt:

| Lead time | Prompt → first token |
|---|---|
| 0 s (today) | **10.7 s** |
| 3 s | 9.4 s |
| 6 s | 9.2 s |
| **10 s** | **3.6 s** |
| 20 s | **2.9 s** |

A threshold at roughly ten seconds. The CLI does its expensive work **on spawn**, so buying lead time
is the whole game.

---

## 4. Proposed approach

### 4a. Use the SDK's own pre-warm API, triggered at chat creation

```ts
export declare function startup(_params?: {
  options?: Options;
  initializeTimeoutMs?: number;      // default 60000
}): Promise<WarmQuery>;

export declare interface WarmQuery extends AsyncDisposable {
  /** Send a prompt to the pre-warmed subprocess. Can only be called once. */
  query(prompt: string | AsyncIterable<SDKUserMessage>): Query;
  /** Close the subprocess without sending a prompt. */
  close(): void;
}
```

Documented as: *"Pre-warms the CLI subprocess by spawning it and completing the initialize handshake
before a prompt is available... so the first `query()` call resolves without paying subprocess spawn
and initialization cost inline."* The changelog claims **~20× faster first query** (0.2.89).

**It is a drop-in for our architecture.** `WarmQuery.query()` accepts an `AsyncIterable<SDKUserMessage>`
— exactly the streaming input queue `ensureSession` already builds:

```ts
// today, in ensureSession
const queryHandle = claudeQuery({ prompt: input, options });

// with pre-warm: spawn+handshake at chat creation, attach the queue on first turn
const warm = await startup({ options });   // at createConversation
const queryHandle = warm.query(input);     // at the first prompt
```

**Trigger it at `createConversation`**, not at first prompt. Four properties of this codebase make
that the right hook:

1. **The lead time already exists.** The workspace is created at chat creation; even my *automated*
   script left a 3.8 s gap, and a person naming a chat and writing a first message spends far longer
   than the 10 s threshold.
2. **The lifecycle is already built.** `ClaudeAgentProvider` keeps a `sessions` map, sweeps idle
   conversations (`sessionIdleMs`, default 30 min) and enforces an LRU cap
   (`maxLiveConversations`). A warmed session is an ordinary session — no new leak surface.
3. **The fingerprint tolerates what varies.** `sessionFingerprint()` covers structural options
   (`cwd`, `systemPrompt`, `tools`, `hooks`, `settingSources`) and deliberately **excludes** `model`,
   `permissionMode` and `mcpServers`, which are applied to a live session by `setModel` /
   `setPermissionMode` / `setMcpServers`. Those are exactly the fields likely to differ between
   "chat created" and "first prompt sent", and they cost no respawn. A structural mismatch is not a
   regression: `ensureSession` rebuilds, which is today's behaviour.
4. **It does not compete for CPU** — three concurrent cold starts cost the same wall time as one.

**Why per-chat rather than a generic pool:** `cwd` is fixed at spawn and cannot be changed on a live
session — `Query` exposes `setModel`, `setPermissionMode`, `setMcpServers`, `applyFlagSettings` and
`reinitialize`, none of which re-target the directory (`reinitialize` is documented for reattaching
after a transport gap). A generic pool could only serve chats sharing a workspace. Also note
**one `WarmQuery` serves exactly one conversation** — `query()` may be called once — so a pool is a
pool of single-use handles, which is more machinery for less benefit than warming the chat we know
the user just created.

**Expected effect:** perceived first-turn latency **~11.5 s → ~2.9–3.6 s** whenever the user spends
ten seconds or more between creating a chat and sending. Faster senders get the partial saving from
the curve, and nobody is worse off than today.

**Honest costs:** an abandoned chat holds one idle CLI process (**~345 MB RSS**, measured) until the
idle sweep reaps it. Bounded by `maxLiveConversations`, and warming must *refuse* rather than evict a
live session. The warm path must never push a user message, so it costs no tokens.

### 4b. Three cheaper things worth doing regardless

| Change | Evidence | Status |
|---|---|---|
| **`CLAUDE_CODE_CERT_STORE=bundled`** on the spawned CLI | This machine loads a corporate CA bundle + 170 system certs + an mTLS agent at every startup, and `curl` here fails with `CRYPT_E_NO_REVOCATION_CHECK`. [claude-code#84478](https://github.com/anthropics/claude-code/issues/84478) is the same symptom on macOS: **45 s → ~4 s**. | **Untested on our machine.** Cheap and reversible — I would measure it first |
| **AV exclusions** for `~/.claude`, `%LOCALAPPDATA%\Temp\claude`, the 218 MB `claude.exe`, and Git's `bin` dirs | [Measured 8.5× on Windows](https://gist.github.com/ghbaud/7453053982eda27a939adf406357c535) (64.8 s → 7.6 s). Our `bash.exe -c "exit 0"` costs **825–967 ms**, which is the signature | Machine/policy change, not a code change — your call |
| **Trim the user-level hooks** | `~/.claude/settings.json` registers `bash -c` hooks on `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStart`, `SubagentStop`. At ~900 ms per `bash.exe` spawn these hit **every turn and every subagent**, and `settingSources` defaults to loading all sources | Does **not** fix the 14 s (tested: `settingSources: []` made it *worse*, 15.5 s), but it is real warm-turn cost |

### 4c. Version currency — upgrade for correctness, not speed

We are on **0.3.220**; latest is **0.3.260**. I checked: **nothing between them touches startup
performance.** But two fixes matter to us:

- **0.3.224** — *"Fixed long (>200 char) project paths resolving to another project's session
  directory under a shared sanitized prefix."* Our cwd is `C:\Users\sidmishra\Desktop\New folder (2)\GeneratorAI`
  and workspace paths are longer still. **This is a correctness risk we are currently exposed to.**
- **0.3.222** — resume now carries user `settings.json` into the resumed subprocess.

---

## 5. Alternatives considered and rejected

| Option | Why not |
|---|---|
| **`resume` / `forkSession` to skip init** | The sessions docs describe them purely as conversation-context features; **nothing says resumption skips the handshake.** Evidence points the other way: [#85050](https://github.com/anthropics/claude-code/issues/85050) reports `--resume` of an 8.7 KB session at ~130 s and a 44 MB session at 5.4 minutes — resume cost grows *on top of* startup |
| **Daemon / attach to a running CLI** | Requested in [#33](https://github.com/anthropics/claude-agent-sdk-typescript/issues/33) and **declined**. The v2 session API that looked like this was **removed** in 0.3.142 |
| **Claim a "warm spare" from the CLI's background daemon** | `warm_spare_claimed` exists as a result field and the daemon keeps spares, but there is **no documented way for an SDK `query()` to claim one**. Log the field; do not design on it |
| **Generic idle pool** | `cwd` fixed at spawn; one `WarmQuery` per conversation |
| **Switch to the SDK's bundled binary** | Measured slower (16–18 s vs 13–14 s) |
| **Bypass the SDK, call the Messages API directly** | What [#34](https://github.com/anthropics/claude-agent-sdk-typescript/issues/34)'s reporter shipped (1–3 s), but it forfeits tools, MCP, hooks, permissions and checkpointing — i.e. most of the product |

---

## 6. What is still unknown

- **What blocks the event loop for 3.3–5.6 s.** Localised to the `~/.claude` watcher-setup window and
  proved synchronous and reproducible, but not attributed to a specific call. Would need Process
  Monitor or a Windows profiler.
- **Whether this is Windows-specific.** Every number here is Windows 11. A Linux deployment may see a
  much smaller cold start, in which case warming is still correct but less valuable.
- **`CLAUDE_CODE_CERT_STORE=bundled` is untested here.** Recommended on evidence from a different OS.
- **The profiler env var is undocumented** and may vanish without notice.
- Some measurements were taken on a loaded machine, and the CLI warned *"another Claude instance may
  be running"* — though that contention is also our production condition, since a server starting
  many conversations spawns many CLIs against one user config.

**Worth doing:** our repro is cleaner than the open Windows issue ([#85050](https://github.com/anthropics/claude-code/issues/85050)) —
empty cwd, small config, reproducible stall with the CLI's own detector naming it. A well-instrumented
report got [#86638](https://github.com/anthropics/claude-code/issues/86638) a confirmed root cause in
three days. I can prepare that report with the profiler trace attached if you want it filed.

---

## 7. The other two items you asked about

### Browser start 6.1 s, PTY create 2.4 s cold / 1.3 s warm

Same shape, much weaker case, and I would not act yet:

- **The trigger is an explicit click.** A user pressing "open terminal" is not waiting mid-thought the
  way they are after sending a first message; a spinner on a deliberate action costs far less.
- **There is no equivalent earlier signal.** "Chat created" reliably precedes "first message". Nothing
  reliably precedes "user decides to open a browser", so warming means guessing — and guessing wrong
  holds a Chromium (hundreds of MB) per workspace.

If you want it, the narrow version is: warm the browser only for a workspace whose chat has the
browser tool enabled *and* only once that chat has an active turn. I would want usage data first.

### `extension.installed` — 36,972 rows for 28 distinct payloads

`ExtensionManager.activate()` emits the event, and the boot scan activates every extension, so each
start records the whole inventory. **In production that is 28 rows per boot.** The 36,972 figure comes
from a dev server under `tsx watch`, which restarts on every edit — a month of development is easily a
thousand restarts, so the number is inflated roughly 50×.

Fixing it properly means giving the extension lifecycle a notion of "already announced in a previous
process" — a real semantic change to a subsystem this audit did not otherwise touch. **What I would do
instead:** split the two meanings — keep `extension.installed` for a genuine install, and emit
`extension.activated` (classified as a *delta*, so retention prunes it quickly) for the boot rescan.
Small and honest, but it changes an event contract clients may key off today, so it needs your call.

---

## What I need from you

1. Approve the **`startup()` warm-on-create** approach for chat.
2. Confirm an idle CLI process (~345 MB) per recently-created chat is acceptable, and the cap you want.
3. Say whether to test `CLAUDE_CODE_CERT_STORE=bundled` and whether AV exclusions are possible on your
   machines.
4. Approve the **0.3.220 → 0.3.260** upgrade (correctness: long-path session collisions).
5. Browser/PTY warm-up: do it, or leave as explicit actions?
6. Decide the `extension.installed` / `extension.activated` event-contract question.
7. Want me to file the upstream issue with the profiler trace?
