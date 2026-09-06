# Startup performance — both harnesses, plus browser and terminal

**Status: items 1–3 implemented (pre-warm capability, pty-host at boot / native-module preload, Copilot pool cap) — see `PERFORMANCE-AUDIT-2026-09.md` §7. Item 4 (browser) measured and deliberately not changed. Kept as the design record.**

Measured on this machine against the running server, driving the real UI. Both harnesses were
measured with the **identical script and methodology** so the numbers are comparable.

---

## 1. Is the cold start Claude-specific? No.

Same script, same prompt, same machine. "Chat B" is a *second, brand-new chat* created after A was
already warm — it tests whether a provider reuses anything across conversations.

| | **claude-agent** | **copilot** |
|---|---|---|
| Chat A, turn 1 (cold) | **12,782 ms** | **7,109 ms** |
| Chat A, turn 2 (warm) | **2,246 ms** | **3,912 ms** |
| Chat B, turn 1 (a new conversation) | **11,927 ms** | **6,319 ms** |
| **Cold-start penalty** | **+10.5 s** | **+2.4 s** |

Three conclusions:

1. **Every provider pays a per-conversation cold start.** This is a platform problem, not a Claude
   problem, so the fix belongs above the provider.
2. **Chat B is nearly as slow as chat A on both.** Neither provider reuses a warm process for a new
   conversation in practice. Whatever we build has to work at *conversation* granularity.
3. **The two providers are bad in opposite ways.** Claude's cold start is 4.4× worse; Copilot's
   *warm* turn is **74 % slower** than Claude's (3.9 s vs 2.2 s). Fixing only the cold path would
   leave Copilot users on a permanently slower steady state.

### Flagged: a provider-side bottleneck that is ours, not the vendor's

`WorkspacedCopilotPool` exists specifically so that "conversations in the same workspace share a
process". Its own header says so. But **GeneratorAI creates one workspace per chat**
(`[WorkspaceManager] Created workspace … for chat:<id>`), so the pool key is unique per chat and the
reuse it was written for **never happens**. That is why Copilot's chat B (6,319 ms) is nowhere near
its warm turn (3,912 ms).

This is a design collision inside our code, not a Copilot limitation, and it is worth fixing on its
own: chats that share a project/workspace should share the pooled process. It also means the Copilot
pool is currently paying the complexity of pooling while delivering none of the benefit.

### Flagged: a genuine vendor-side bottleneck (Claude)

Documented in `PROPOSAL-cold-start.md` with citations. Summary: ~12 s of Claude's cold start is CLI
startup that we do not control — a bare `query()` with no MCP, no tools and no system prompt still
takes 14 s to first message, and Anthropic's own profiler attributes the bulk to a reproducible
3.3–5.6 s synchronous event-loop stall. Upstream has closed the two relevant issues with "use
streaming input" (which we already do) and **declined** daemon mode. We can hide this cost; we
cannot remove it.

---

## 2. Proposed: one harness-agnostic warm-up, declared as a capability

The `IAgentHarness` port is already split into capability interfaces
(`IHarnessClientLifecycle`, `IHarnessModelDiscovery`, `IHarnessConversationLifecycle`, …) and already
has **`capabilities(): ProviderCapabilities`**, documented as: *"Every capability is declared, never
discovered by throwing. Callers branch on the returned struct… All fields default closed."*

That is exactly the shape this needs.

### The contract

```ts
// IHarnessConversationLifecycle
/**
 * Optional: bring a conversation's execution context to readiness before a
 * prompt arrives. Best-effort and idempotent. Never sends a message, never
 * bills tokens, and MUST NOT throw — a provider that cannot warm simply
 * returns.
 */
prewarmConversation?(conversationId: string): Promise<void>;

// ProviderCapabilities
prewarm: boolean;   // defaults false, like every other capability
```

### Per provider

| Provider | Implementation | Expected gain |
|---|---|---|
| **claude-agent** | `startup()` → `WarmQuery`, the SDK's official pre-warm (present in the 0.3.220 we ship). `WarmQuery.query()` accepts the `AsyncIterable` our `ensureSession` already builds, so it is a drop-in | **12.8 s → ~2.9–3.6 s** |
| **copilot** | Ask the pool for the workspace's provider and let it initialise, instead of waiting for the first prompt | **7.1 s → ~3.9 s** |
| **codex / acp / faux** | Declare `prewarm: false` and inherit today's behaviour | none, no regression |

### The trigger, and why it is the right one

Call it from **`ChatManagementService` at chat creation**, not from inside a provider. That places it
in the harness-neutral layer, so a new provider gets the benefit by declaring one boolean.

It works because the lead time already exists: the workspace is created at chat creation, and even an
*automated* script left a 3.8 s gap before the first prompt. A person naming a chat and writing a
first message takes far longer. My measured curve for claude-agent:

| Lead time | Prompt → first token |
|---|---|
| 0 s (today) | 10.7 s |
| 6 s | 9.2 s |
| **10 s** | **3.6 s** |
| 20 s | 2.9 s |

There is a threshold near ten seconds — below it the process has not finished starting and the user
still waits, past it the first turn costs the same as a warm one.

### Why this is safe here

- **The lifecycle already exists.** `ClaudeAgentProvider` keeps a `sessions` map, sweeps idle
  conversations (`sessionIdleMs`, default 30 min) and enforces an LRU cap. A warmed session is an
  ordinary session — no new reaper, no new leak surface.
- **The session fingerprint tolerates what varies.** `sessionFingerprint()` covers structural options
  (`cwd`, `systemPrompt`, `tools`, `hooks`) and deliberately **excludes** `model`, `permissionMode`
  and `mcpServers` — applied live via `setModel` / `setPermissionMode` / `setMcpServers`. Those are
  precisely the fields likely to change between "chat created" and "first send", and they cost no
  respawn. A structural mismatch just rebuilds, which is today's behaviour.
- **It does not compete for CPU.** Three concurrent cold starts cost the same wall time as one
  (12.6 s vs 13.3 s) — the cost is wait-bound.
- **Failure is invisible.** Warming is fire-and-forget; if it fails the first turn takes exactly as
  long as it does today.

**Cost to be honest about:** an abandoned chat holds one idle process (~345 MB RSS for Claude) until
the idle sweep reaps it. Bounded by the existing cap, and warming must *refuse* rather than evict a
live session.

---

## 3. Terminal — **not acceptable**, and the gap is ours

| Measurement | Time |
|---|---|
| **Raw `node-pty` spawn on this machine** | **285 ms** (first byte of shell output at 326 ms) |
| `terminal list` (same transport, auth, CLI overhead) | 950 ms |
| `terminal create`, warm host | 2,070 ms |
| **Create-specific work** (create − list, cancelling shared overhead) | **~1,120 ms** |
| `terminal create`, cold (also spawns the `pty-host` process) | 3,190 ms |

**Verdict: not acceptable.** A terminal is a direct-manipulation surface; VS Code and Windows
Terminal open one in well under 300 ms, and users read anything past ~200 ms as lag. The machine's
own floor is 285 ms, so **we are roughly 4× above what this hardware can do**, and about 800 ms of
that is our own overhead rather than the shell.

Where it goes, and what I would do:

1. **`pty-host` is spawned lazily on first use** (+1.1 s on the first terminal in a server's life).
   `selectHost()` awaits `host.whenReady()`. **Fix:** start `pty-host` during server boot, or on the
   first workspace activation, rather than on the first terminal. It is a small, long-lived process.
2. **The create path is serial**: cap counting → `resolveCwd` → `selectHost` → `whenReady` → spawn →
   event emit. **Fix:** resolve cwd and select the host concurrently; neither depends on the other.
3. **Nothing is pre-warmed per workspace.** Given a shell costs 285 ms and a few MB, keeping **one
   idle PTY per active workspace** would make "open terminal" feel instantaneous. This is a much
   cheaper bet than pre-warming a browser.

Realistic target: **~350–400 ms warm**, i.e. the raw spawn plus transport.

---

## 4. Browser — **borderline**; half of it is ours, half is Chromium on Windows

| Measurement | Time |
|---|---|
| **Raw `chromium.launch()` on this machine** | **1,279–1,554 ms** |
| …plus `newPage()` + `goto()` to a usable page | +~1,700 ms → **~3.0 s achievable** |
| **Our `browser start`** | **6,060 ms** |
| Our overhead above the achievable floor | **~3.0 s** |
| `browser navigate` (warm) | 40 ms |
| `browser status` | 80 ms |

**Verdict: the steady state is good; the start is about 2× what it should be.** Once running,
40 ms navigation is genuinely fast. The problem is only the first launch.

Two separable halves:

- **The ~3.0 s we control**: `browser-host` is a separate process spawned on demand (same pattern as
  `pty-host`), then Chromium is launched inside it, then a context and page are created, each with a
  protocol round trip. **Fix:** overlap them — spawn `browser-host` and launch Chromium as soon as a
  workspace has the browser tool enabled, and create the first page eagerly rather than on demand.
- **The ~1.3–1.6 s raw launch we do not control**: this is high. Typical `chromium.launch()` elsewhere
  is 200–500 ms. The likely cause is Windows loader plus real-time AV scanning, consistent with the
  ~900 ms we measured for a bare `bash.exe` spawn. **Fix is environmental**, not code: AV exclusions
  for the Playwright browser directory (a published Windows write-up measured 8.5× on Claude Code
  with the same technique).

Realistic target: **~3.0–3.5 s cold with code changes alone**, and materially better than that if
the AV exclusions land.

I would **not** pre-warm Chromium speculatively: it is hundreds of MB per workspace, and unlike a
chat there is no reliable earlier signal that a user is about to open a browser. Warm it when the
tool is enabled *and* the chat has an active turn — a much narrower bet.

---

## 5. Where I would spend the effort, in order

| # | Change | Evidence | Payoff |
|---|---|---|---|
| 1 | `prewarmConversation` capability + warm at chat creation | 12.8 s → ~3 s (claude), 7.1 s → ~3.9 s (copilot) | Largest single win, both harnesses |
| 2 | Start `pty-host` at boot; pre-warm one PTY per active workspace | 285 ms floor vs 1.3–3.2 s today | Terminal becomes instant |
| 3 | Fix the Copilot pool key so chats sharing a workspace share a process | Chat B 6.3 s vs warm 3.9 s | Removes cold start for Copilot chats in a shared workspace, and makes existing code do its job |
| 4 | Overlap `browser-host` spawn with Chromium launch and first page | ~3.0 s of our own overhead | Browser start roughly halves |
| 5 | Investigate Copilot's slower warm turn (3.9 s vs 2.2 s) | Measured, cause not yet established | Steady-state win for every Copilot turn |
| 6 | Environmental: AV exclusions; `CLAUDE_CODE_CERT_STORE=bundled` | Third-party measured 8.5×; untested here | Potentially large, zero code |

Items 1–4 are code changes I can make and verify. Item 5 needs investigation before I would promise a
number. Item 6 is yours — it is machine policy, and I would want to measure it before and after
rather than assert it.

---

## 6. What I have not established

- **Why Copilot's warm turn is slower than Claude's.** Measured repeatedly, cause not investigated.
- **Whether any of this reproduces off Windows.** Every number here is Windows 11, where process spawn
  is expensive (bare `bash.exe`: ~900 ms). A Linux deployment may see much smaller cold starts, which
  would lower the value of items 1–4 without making them wrong.
- **The exact split of our browser overhead** between `browser-host` spawn, Chromium launch and page
  creation. I measured the total and the raw floor, and inferred the middle from the code path.
- Terminal and browser timings were taken through the CLI, so they include HTTP, DPoP signing and CLI
  start-up. I cancelled that with a differential (`create` − `list`) for the terminal; the browser
  number is a total and is therefore an upper bound on our own cost.
