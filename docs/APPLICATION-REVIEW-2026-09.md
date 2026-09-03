# GeneratorAI — Full Application Review

**Date:** 2 September 2026 · **Branch reviewed:** `arch-redesign` @ `4a6d579`
**Scope:** every module, every client, the architecture, the data layer, security and performance.
**Method:** ten independent deep code reviews run in parallel, each reading the actual source rather than the documentation — then **two independent reviewers**, one re-verifying every critical claim and every load-bearing number directly against the code, one checking the report for bias and judging whether the plan is the right plan. **Their corrections have been applied**, including to several of this document's own earlier claims. Section 11.2 records what was refuted.

---

## How to read this document

This is written to be readable without being shallow. Wherever something technical is unavoidable, it is explained in a sentence before it is used.

Every problem below is written in four parts:

1. **What is wrong** — in plain words.
2. **The evidence** — the exact file and line, so anyone can verify it.
3. **Why it matters** — what a real user actually experiences.
4. **What to do instead, and why that is the right answer** — including the trade-off, not just the instruction.

**A note on tone and on trust.** This document is deliberately blunt, because a review that flatters is useless. But it went through an adversarial fact-check that **refuted or downgraded seven of its own claims**, including one headline measurement and one item originally rated critical. Those corrections are visible in the text, not quietly absorbed. Where a claim could not be verified, it says so.

It is also important to say up front: **this is a competent, ambitious codebase with several pieces of genuinely excellent engineering in it.** Section 9 is not a courtesy — knowing what is good is what tells you where *not* to spend effort. The problems are concentrated, not spread evenly, and almost all are fixable without a rewrite.

---

## If you only do five things

Independently derived, and deliberately different from a simple reading of severity. Each of these is small, and each closes a gap where a half-fix would create a false sense of safety.

| # | Do this | Why this one |
|---|---|---|
| **1** | **Stop registering the extension write-and-install tools on every chat** (`composition-root.ts:1875-1884`, ~2 lines) | This is the finding that turns "the agent did something unexpected" into "the machine is compromised and stays that way across reboots." It is the security review's own number-one blocker |
| **2** | **Fix the desktop navigation check — and in the same commit, the fail-open branch in the helper you reuse and the missing sender validation on all 43 bridge handlers** | The one-line fix alone leaves two of the four expected defences still down. Half-fixing this is the exact failure mode section 8.1 is about |
| **3** | **Fix both upgrade/install data-destruction bugs together** — the fresh-install column ordering, and migration v23's wipe of every saved plan | One stops new users dead; the other **destroys data today** on the upgrade path and had no action item until the review pass caught it |
| **4** | **Add one global error handler for saves** (`QueryProvider.tsx:51-66`) | 84 of 89 data-changing operations currently fail silently. One change fixes all of them |
| **5** | **Lower the concurrency default *and* apply the limit to chats, as a single change** | They do nothing apart: the limit is live by default but only workflows respect it, so lowering 16 to 4 alone does not deliver the memory saving. Decide what the user sees when the limit is hit — a naive wait turns "too busy" into "the prompt hangs with no explanation" |

---

## 1. The sixty-second summary

GeneratorAI is a large, ambitious platform: roughly **213,000 lines of source code** across **30 packages and applications**, with **350 test files** and about **4,400 test cases**. It runs AI agents that can chat, execute multi-step workflows, run on a schedule, drive a browser, control a terminal, and operate the desktop.

The review found approximately **40 critical-severity issues** and well over a hundred significant ones, clustering into five stories:

**Story 1 — The app is slow for one dominant reason, and it is fixable.**
Every message you send starts a brand-new ~218 MB program from scratch. That single fact is roughly **58% of the time you wait for a response**. Everything else on the path is comparatively fast.

**Story 2 — Memory is high for three specific reasons.**
That same program is allowed to run **sixteen at a time** by default, conversation data is never cleaned up, and syntax highlighting is well over half the browser's JavaScript. All three have small, known fixes.

**Story 3 — Several safety controls are described in the code but do not run.**
This is the most important finding here. The chat review counted **twelve places in that module alone** where a comment states a protection is in place and the code does not implement it; the pattern repeats across the repository. Most seriously: **every permission mode except "plan" does nothing.** A user who selects "ask me before each action" is watching an agent that is not asking.

**Story 4 — Features are commonly built, then not connected.**
A subsystem is designed, written, tested against itself, and never wired up. Around 690 verified lines of web components are rendered nowhere. Four of six model providers cannot be selected. Four background processes were built and none run by default. The relay has never once run end to end.

**Story 5 — The foundations are better than the layers above them.**
The durable execution engine, the event pipeline, the crash supervisor, the authentication system and the database configuration are all genuinely well built. The problems are almost entirely in the **coordination layers** written on top of them.

**The one-line verdict:** this codebase does not need rebuilding. It needs **connecting, consolidating, and enforcing** — and where the effort should go is unusually clear.

---

## 2. What the product actually is today

### 2.1 The three things it does

| Capability | What it is | Real status |
|---|---|---|
| **Chat** | A conversation with an agent that can use tools, browse, run commands and edit code | Works well. Streaming, history, stopping, diffs, checkpoints and rewind are solid |
| **Workflows** | A visual multi-step diagram where each step is an agent task | Works for straight-line and parallel shapes. **Hangs forever on the most common branching shape** |
| **Automations** | Workflows that run on a schedule or from an external trigger | Runs manually and on a timer. **Webhook triggers cannot be used by anyone outside the app** |

### 2.2 The surfaces

| Surface | Size | Verdict |
|---|---|---|
| **Web app** | 69,000 lines | The main product. Strong in places, four serious defects, weak accessibility |
| **CLI (terminal)** | 43,000 lines | **The best-engineered surface in the repository**, web included. 219 commands, none stubbed |
| **Desktop (Electron)** | 6,200 lines | Right architecture, **one critical hole to fix before any release** |
| **Mobile** | ~21,000 lines of real code | ~80% code-complete, ~10% shippable. **Never once compiled for a phone** |
| **SDK** | 2,400 lines | Good code, **zero users, cannot be installed** despite three documents saying otherwise |
| **Relay (remote access)** | 2,500 lines | **Has never run end to end** |

### 2.3 Model provider support — the honest version

Six provider adapters exist. **Two can actually be selected**: Claude and GitHub Copilot. The other three — Codex, OpenCode and ACP — are rejected by every configuration check, so no chat, workflow or agent can use them. If they could run, they would **silently discard all tools, skills, permissions and hooks**.

They are nonetheless advertised by the API and shown in the interface **under the GitHub Copilot logo**.

**Evidence:** `composition-root.ts:324-363` builds configuration for only two; five validation schemas cap the list at two (`AppConfig.ts:53` among them); `HarnessRegistry.ts:120` registers all five and reports them as available.

### 2.4 MCP support — the honest version

MCP is the standard way for AI tools to reach external services. **GeneratorAI does not speak the MCP protocol at all.** It does not connect to MCP servers, ask what tools they have, or start them. It **passes a configuration blob to Anthropic's or GitHub's software**, which does the real work.

That forwarding works — under two undocumented conditions:

1. **Only when an agent is attached to the chat.** With no agent bound, zero MCP servers are passed through (`AgentResolver.ts:243`).
2. **Only for servers needing no credentials.** The fields carrying API keys are **stripped before they are sent** (`ArtifactCatalog.ts:132-143`), and the project API never accepts them (`routes/projects.ts:384-406`).

**Six of the eight bundled MCP servers therefore cannot work** — four because credentials are stripped (GitHub, Slack, Brave Search, AWS) and two because their connection strings are hardcoded to example values.

Also: the Settings "Add custom MCP server" form **saves to browser storage and never contacts the server**. The per-step picker can only *remove* servers from a list nothing ever *adds to*, while displaying "N of M enabled". And `packages/mcp-server` — named as though it exposes GeneratorAI to other tools — is a 154-line stub whose start function is one log line, with no MCP dependency and no importer.

**Why this matters more than a normal bug:** a user configuring a GitHub MCP server watches it fail with no explanation, because **no code maps an MCP startup failure to any visible event** — despite `feature-skills-agents-mcp.md:235` claiming it does.

---

## 3. Why the application feels slow — with measurements

### 3.1 The measurement

The AI provider is a separate program on disk. Starting it and asking its version — the cheapest possible operation:

```
claude --version    →  ~1.75 s   (11 interleaved runs: 1.68 – 1.89 s)
node -e "0"         →  ~0.68 s   (9 runs: 0.64 – 0.74 s)
File size:             218,507,936 bytes (218 MB)
```

**Two honest qualifiers.** An earlier measuring session recorded 2.79–2.94 s for the same command; the re-measurement above is the more careful one (interleaved, repeated), so treat **1.75 s as the working figure and 1.75–2.9 s as the real-world range**, depending on file-cache and virus-scanner state. And the 218 MB figure is *this machine's* copy — installations without `claude` on the system path use the bundled binary instead, which is **265 MB**.

The size is not the whole story: bare Node already costs 0.68 s, so at most about **1.1 s is attributable to the larger program**. The rest is ordinary process startup, which Windows makes expensive.

### 3.2 Where your wait actually goes

Warm second message, existing conversation, no MCP servers:

| Step | Time | Share |
|---|---:|---:|
| Web request, validation, 5 database reads | 3 ms | 0.1% |
| **Git snapshot taken before the message is even saved** | **~150 ms** | 5% |
| Saving the message and 3 events | 1 ms | — |
| **Starting a fresh AI program from scratch** | **~1,750 ms** | **58%** |
| That program re-reading the conversation from disk | ~200 ms | 7% |
| Anthropic's servers producing the first token | ~900 ms | 30% |
| Internal batching delay | 8 ms | — |
| Browser rendering | ~20 ms | — |
| **Total** | **~3,030 ms** | |

**With two MCP servers configured this becomes 5–7 seconds**, because every MCP server is also restarted and re-negotiated **on every single message**.

### 3.3 Why it works this way

The code is explicit. From `ClaudeAgentProvider.ts:5-8`:

> *"the Claude Agent SDK uses a per-query subprocess model (not a persistent client). Each query() call spawns a Claude Code process, runs the agent loop autonomously, and returns results via async iterator."*

At `ClaudeAgentProvider.ts:1272` the prompt is passed as a plain text string. That puts the provider's software into **one-shot mode** — start, answer once, exit. Conversation memory is recovered each turn by re-reading the whole transcript from disk (`:1846`).

**Anthropic's own documentation says this is the wrong mode here.** It calls the alternative — streaming input mode — *"the preferred way to use the Claude Agent SDK… It allows the agent to operate as a long lived process."* It scopes one-shot mode to *"a stateless environment, such as a lambda function"*, and lists what one-shot mode **does not support**: image attachments, message queueing, real-time interruption, and natural multi-turn conversation.

**All four costs are being paid, in exactly those places:**

- Attachments to the Claude provider are silently discarded (`ClaudeAgentProvider.ts:1112`, `:1164` — the parameter is named `_attachments` and never used) while the provider *declares* vision support (`:571`).
- Stopping a response kills the program rather than interrupting it, so partial work never reaches the transcript and a resumed conversation can have a hole.
- Background sub-agents die with the process, so a hook **forcibly rewrites every background request into a foreground one** (`:1657-1680`), with the symptom recorded in the comment: *"observed live as 'Async agent launched successfully' followed by a turn that ended with the model promising results that could never come."*
- A separate workaround exists purely because the connection dies too early to ask a question at the normal time (`:2075-2098`).

### 3.4 A second, independent slowness

There is a ceiling on how fast streamed text reaches your screen: **about 125 events per second per conversation** — and this applies specifically to **streamed text**, which is what matters here. (Other event types are flushed immediately at `StreamWriteBatcher.ts:157`; only the "delta" class waits, and streamed tokens are deltas.)

Two mechanisms interact badly. Events for one conversation are processed strictly one at a time (`EventBus.ts:223-226`), and each waits out a full 8-millisecond batching timer (`StreamWriteBatcher.ts:217-229`). Because only one is ever pending, the batch never fills — so every event pays the full delay and gets none of the batching benefit.

**The safety valve that should handle this does not work.** The code claims backpressure "reaches back to the harness's own read loop". At `ClaudeAgentProvider.ts:2383` the handler is called and its result thrown away:

```ts
try { handler(event); } catch (err) { ... }   // ← the promise is dropped
```

So when the model outruns 125 events per second — routine — nothing slows down; the queue grows and **the text on screen falls progressively further behind the model the longer the answer runs**. On this arithmetic, a sustained 400 events per second accumulates roughly 2.2 seconds of lag per second of streaming. That is a projection, not a measurement — but it is the most likely explanation for "long answers feel laggy", and it is separate from startup cost.

### 3.5 A third cost: git snapshots on every message

Before your message is even saved, a full snapshot of your code is taken (`ChatManagementService.ts:2014`), and **waited for**.

That snapshot runs `git add -A` — which must check every file in the project — plus four more git commands per repository, one after another. The codebase's own note records the cost: *"At ~500 ms per spawn on Windows"* (`RepoDiscovery.ts:98`). The comment calls this *"O(changed files)"*; **the comment says the cost depends on how much you changed, when in fact it depends on how big the project is.**

The measured range is wide — from about 150 ms on a small single repository to seconds on a large or multi-repository workspace. That spread is why this appears in Phase 1 rather than Phase 0: **it should be measured on a real workspace before deciding how urgent it is.**

During the response it compounds. A "live" snapshot runs every 2 seconds, each triggering a full change-summary rebuild and a re-anchoring pass over every code-review comment. On this arithmetic a five-minute writing turn produces **roughly 1,350 git process launches** — again a projection — running alongside the agent being snapshotted.

There is also a caching bug: **the snapshot waits 2 seconds between runs, but the saved result is thrown away after 1.5 — so it has always just expired** when the next one asks for it (`WorkspaceCheckpointService.ts:53` versus `ChangeSummaryService.ts:65`).

### 3.6 Wasted work before the first message

A cache exists so the first message in a chat need not rebuild everything. **It can never hit.**

The key is written in one format at creation and computed in a different format at send time (`ChatManagementService.ts:1527-1532` versus `:917-931`) — four parts written, five parts computed. The extra `::cu0` suffix alone guarantees a mismatch every time.

The comment above it says: *"so the first turn doesn't rebind it needlessly."* The opposite happens. Every chat's first message performs a full rebuild: a database read, complete agent resolution, writing skill files to disk, MCP resolution, up to 45 tool definitions, and a round-trip to the provider — all before the first word.

### 3.7 Fixed overhead in every prompt

Measured text sent on **every** message regardless of use: widget instructions are 9,064 characters (~2,270 tokens) and are always included because widgets default to on; computer-use adds 2,541; the orchestrator adds 5,244. **An orchestrator chat with computer use carries roughly 4,700 tokens of platform instructions before the user's own agent instructions begin** — paid every turn, in both latency and money. Trimming the widget instructions to a short pointer, loaded on demand, is the obvious first move.

---

## 4. Why memory is high

### 4.1 Sixteen large programs are allowed at once

```ts
// AgentHostSupervisor.ts:201-202
const maxExec = opts?.maxConcurrentExecutions ??
  Number(process.env['GENERATORAI_MAX_CONCURRENT_AGENT_TURNS'] ?? 16);
```

Sixteen concurrent programs at ~250 MB each is a **worst case around 4 GB**. For a single-user desktop application that default is far too high.

**Important nuance:** this limit *is* live by default — the supervisor is constructed unconditionally at `composition-root.ts:321`, even though the separate agent-host *process* is off (section 7.3). But **chat conversations do not respect it.** The permit is acquired only in the path workflows use (`ClaudeAgentProvider.ts:1263`, inside `sendPromptAndWait`); chat uses `sendPrompt`, which never acquires. So the limit bounds workflow steps and nothing else.

**The authors measured the consequence themselves** (`childRegistry.ts:4-6`):

> *"Measured on a live development machine: 24 orphaned `claude.exe` processes, the oldest 7 days old, ~870 MB resident."*

### 4.2 Conversation data is never cleaned up

Four in-memory stores hold per-conversation data: assembled instructions, tool definitions, resolved MCP configuration, and **the complete text of every message ever exchanged** (`ClaudeAgentProvider.ts:369-416`). There is no size limit, no age limit, and no cleanup schedule. **It never shrinks — the only thing that empties it is restarting the server, or explicitly deleting the chat.**

A bounded eviction policy — one that throws away the conversation used longest ago when it runs out of room — already exists elsewhere in the codebase (`CopilotProvider.ts:542-566`), though it bounds *workspace processes* rather than conversation data. So the pattern is available; it simply was not applied here.

### 4.3 Syntax highlighting is most of the browser's JavaScript

The initial page load is fine: **331 KB compressed**, four files, inside the project's own budget, and the highlighting bundle is **not** part of it.

But that bundle is **1,626 KB compressed** plus a 225 KB companion — together **57% of all the application's JavaScript**, loaded the moment you open a diff. Uncompressed it is 9.4 MB, costing roughly 100–200 MB of browser memory to parse and hold.

Two files also import the *entire* highlighting library — about 190 language grammars — when a curated subset already exists for exactly this purpose (`SyntaxHighlightedCode.tsx:6` and `FileViewerComponents.tsx:23`, versus `lib/highlight/languages.ts`).

### 4.4 The desktop app's own footprint

Worth stating because the product ships as a desktop app: measured at **505–905 MB idle across 7 processes**, rising to 0.9–1.5 GB in use. The server runs as a separate child process deliberately, for crash isolation — a sound trade.

### 4.5 Everything is written to the database twice

Every streamed word is saved **twice** — once under a "session" label and once under a "chat" label — and written to a log file twice. **The session copy is read by nothing on the live path.**

The code anticipates the problem in its own header (`streamScopes.ts:29-33`), warning that fanning tokens out to a widely-subscribed channel *"would multiply the busiest traffic in the system"* — then does it.

**Measured on the live 437.5 MB database:** the streaming table and its indexes are **54%** of the file; the older `events` table and its indexes add another **31%**, for **85% total**. Two-thirds of the streaming rows are event types that nothing reads.

*(A code comment at `EventBus.ts:44` records the streaming table alone at 81%. Measured today it is 54% — the comment is stale, and this document previously repeated it uncorrected.)*

---

## 5. The findings that would hurt a real user most

### 5.1 Permission modes do nothing — CRITICAL

**What is wrong.** A chat can be set to "ask me before each tool" or "accept edits". Neither does anything. Every tool runs without asking.

**The evidence.** The function that installs the permission handler only sets a text label:

```ts
// ChatManagementService.ts:567-571
if (shouldAttachPermissionHandler(chat.permissionMode)) {
  conversationConfig['permissionMode'] = chat.permissionMode;
}
```

`onPermissionRequest` is **never assigned anywhere in the chat path.** The approval callback *is* installed — because the plan and question handlers are set at `:528-529` — and it then falls straight through:

```ts
// ClaudeAgentProvider.ts:2029-2031
if (!domainHandler) {
  return { behavior: 'allow', updatedInput: input };
}
```

Copilot is worse: approve-everything by default (`CopilotProvider.ts:1020`) and hardcoded on every reconnection (`:1306`).

**Why it matters.** The setting is validated, saved, echoed back, and shown as a live control in **three user interfaces** — web, terminal and mobile. A user who selects "Ask me" believes they are supervising an agent that is running completely unsupervised. **That is worse than never building the feature.**

**What to do.** A durable approval system already exists — `AgentInteractionService` — which handles plan approvals and clarifying questions correctly, including surviving restarts. Add a "permission" kind to it and build the handler on that. **Why this rather than the alternatives:** the codebase currently contains *three* separate permission designs (8.1); reviving one of the dead ones creates a second, competing approval mechanism. One is the goal.

**Today, before the full fix:** make the API reject any mode other than the two that work. **A clear error is honest; a silently ignored safety setting is not.**

### 5.2 An everyday permission is equivalent to control of the machine — CRITICAL

**What is wrong.** The permission granted to every newly paired device, including phones, is enough to run code on the host.

**The evidence.** `write:chats` is in the default grant for both devices and mobile (`scopes.ts:68,76-79,88`), with a comment explaining that terminal, browser and computer control are *"explicitly withheld until a user grants it."* But the `/chats` prefix requires only `write:chats` (`routePolicy.ts:69`).

**An important clarification that the review pass forced.** As long as 5.1 is unfixed, no escalation step is even needed — a `write:chats` holder can simply send a prompt and get an unsupervised agent. The durable finding is therefore simpler and stronger: **`write:chats` is equivalent to host code execution.** Once 5.1 is fixed, the two-step version becomes load-bearing: `PATCH /chats/:id/permission-mode` accepts `bypassPermissions` under that same scope (`chats.ts:645`, whitelist at `:172-179`).

Separately, `PATCH /chats/:id` has **no input validation at all** (`chats.ts:131-214`) and assigns `harnessConfig` raw at `:164`, so tool allow-lists and deny-lists are directly settable.

**What to do.** Require an administrative scope to *raise* a chat's permission mode; allow lowering freely — the routing system already supports a more specific rule for that path. Add input validation to the update route. And reconsider whether `write:chats` belongs in a default phone grant at all.

### 5.3 Writing code into the running server is a normal, ungated tool — CRITICAL

**What is wrong.** The model has a tool that writes a file and loads it **into the server's own process**, with access to everything the server can reach.

**The evidence.** `extensionAuthorTools.ts:196-219` writes an arbitrary file tree and installs it, reaching:

```ts
// ExtensionManager.ts:275-278
const url = pathToFileURL(entryAbs).href + `?v=${Date.now()}`;
mod = (await import(url)) as Record<string, unknown>;
```

It is registered for **every chat** — the wiring comment at `composition-root.ts:1875-1884` says so literally: *"so every chat conversation gets them automatically."* It passes no permission check (5.1), inherits the server's full environment including the vault key and tokens, and survives reboots. The file's own header is candid: *"V1 does NOT execute untrusted server-side code … inside a sandbox."*

**This is not the only such path.** Workflow script files are also loaded directly into the server process, and the opt-in flag meant to guard them **guards the wrong door** — it gates the upload route, while three other routes and a **boot-time scan of the templates directory** reach the same loader with no gate and no HTTP request at all.

**Why it matters.** The chain starts with something entirely ordinary: an agent reads a web page or a repository file containing instructions aimed at it. The only defence on that side is six pattern-matching rules applied to browser snapshots, which the code correctly labels *"not a security boundary."*

This is a **different risk class** from what `SECURITY.md` discloses. It says *"Agents execute code… Sandboxing exists but is opt-in and incomplete"* — true and honest. But writing and loading code **into the server process itself** is not what a reader of that sentence would expect.

**What to do.** Today: stop registering these tools for every chat (about two lines). Then: load extension code in an isolated worker behind a restricted message interface, and move the script gate to the loader rather than the upload route. **Why a worker rather than a stricter allow-list:** the problem is not *which* code runs, it is *where*. Anything that keeps model-authored code inside the server's memory keeps the full blast radius.

### 5.4 The desktop app's only navigation boundary can be bypassed — CRITICAL

**What is wrong.** The check that stops the desktop app navigating away from itself compares the beginning of the address as plain text.

**The evidence.** `apps/desktop/src/main/window-manager.ts:173` uses `url.startsWith(appUrl)`. The address `http://127.0.0.1:3100@evil.com` passes — verified against the URL parser, which resolves its origin to `evil.com` — because everything before the `@` is treated as a username. **The correct origin comparison already exists 57 lines above, at line 116.**

**A correction the fact-check forced.** This was originally written as reachable from an ordinary link in a chat transcript. **That is wrong.** Transcript links are rendered with `target="_blank"` (`MarkdownRenderer.tsx:47`) and are correctly diverted to the operating-system browser. The flawed check guards *same-window* navigation — a script-initiated address change, a form submission, or a meta-refresh in rendered content. It remains a genuine bypass of the app's only navigation boundary, but it is **not a one-click transcript-link attack**, and this document previously overstated it.

**Why it still matters.** Four defences were expected here and three are down: origin-parsed navigation (defective), validated deep-link routing (absent), and sender-checked bridge calls — **zero of the 43 bridge handlers validate who is calling them** (`ipc.ts`), including the one that mints a grant with **every permission** and does so with no rate limit and no user confirmation (`ipc.ts:118-126`). The fourth, a content security policy, exists for the app's own origin (`apps/server/src/app.ts:63`) but the Electron session imposes none of its own, so content from any other origin carries no app-imposed policy.

**A further honest caveat:** the two reviews disagreed on whether a minted grant is actually redeemable, since completing pairing is restricted to loopback origins. That disagreement is unresolved and is recorded here rather than resolved in favour of the scarier reading.

**What to do.** Use the correct origin comparison already in the file — **and fix its fail-open branch in the same commit** (it returns "allowed" for an empty address). Add sender validation to the bridge handlers. Add an Electron-session policy. **Do not tag a release until these are done** — releases currently default to unsigned, which on macOS means **no update path at all**, so a release shipped today could not be patched.

### 5.5 The most common branching workflow shape hangs forever — CRITICAL

**What is wrong.** In a workflow that splits into two branches and rejoins — the most common non-linear shape — if one branch fails, the rejoin step is never run and never skipped. The workflow sits in "running" forever.

**The evidence.** Four pieces of code answer "is this step ready?" and they disagree:

- The router consults only the predecessor that *just* finished (`DAGScheduler.ts:580-584`).
- The skipper consults *any* predecessor (`:771-779`).
- The restart path ignores connection types entirely (`:348-360`).
- A fourth divergence over cancelled steps produces a second hang mode — and can make a cancelled run report **completed**.

Walk it through with A → (B and C) → D, all default success links:

1. B succeeds; D waits for C. Correct.
2. C fails. The router looks only at C's success-only link and starts nothing.
3. The skipper asks "is any incoming link active?" — B's is — so **D is not skipped either**.
4. D stays pending forever. The run never completes and never fails, and a background check re-polls it every 3 seconds until the process dies.

**Restarting "fixes" it incorrectly** — the restart path ignores link types, so D runs even though its required predecessor failed. Existing tests cover only the all-successful version of this shape (`DAGScheduler.test.ts:181-232`).

**What to do.** Replace all four with **one** readiness function, called from **one** place that re-evaluates every pending step after any change.

**Why this is safe, and cheaper than it sounds — the strongest version of the argument.** The scheduler already contains a full-graph scan described in its own comments as *"the authoritative answer, and the fallback whenever the frontier cannot prove it would produce the same set"*, and steps are already claimed with a conditional database update, so two simultaneous evaluations cannot double-launch. The machinery exists; it is simply not the only path. The real cost objection is not processor time over tens of nodes — it is the roughly **28 database queries per step transition** the review measured, on a single writer connection. That is the number to optimise, and consolidating makes it visible in one place instead of three.

Consolidating also removes five other findings and deletes roughly 400 lines. **Patching the router alone leaves the bug class — disagreement between duplicated logic — completely intact.**

### 5.6 A workflow step can hang forever, and a timeout doesn't stop anything — CRITICAL

**What is wrong.** Step timeouts are optional with **no default**, so the normal case is unbounded. And when a timeout fires, it abandons the work rather than stopping it.

**The evidence.** `StageExecutionService.ts:1833-1844` — no `else` branch supplying a default. The timeout is a race between two promises; the loser is not cancelled. The timer is never cleared on success either (`createTimeout` at `:3225-3233`), so **every successful timed step leaves a timer alive for its full duration** — up to 30 minutes in the documentation's own example.

Nothing else reaps a stuck step: startup recovery runs only at boot, and the 3-second background check only looks at already-finished steps.

**Why it matters.** A hung step holds two concurrency permits indefinitely, so a handful can **freeze every other workflow in the process**. And when a timeout does fire, a retry starts a **second agent in the same working directory** while the first is still editing files there.

The documentation states a 300-second default (`feature-stages.md:142`) and says a background loop eventually fails hung steps (`feature-workflow-runs.md:193`). **Neither exists.**

**What to do.** A heartbeat on each step, with a sweeper that fails steps whose heartbeat goes stale; plus a real cancellation signal threaded into the AI call, a cleared timer, and a conservative default. **Why a recorded heartbeat rather than a longer timer:** the heartbeat is the only mechanism that still works when the process running the step is gone. Every mature workflow system does it this way for exactly that reason.

### 5.7 Losing a connection can silently truncate a conversation — CRITICAL

**What is wrong.** When the live connection drops and reconnects past a gap, events are permanently missing — and **you are told nothing.**

**The evidence.** The mechanism was fully built: a store field, a gap-recording function, resume logic that detects the gap, and a warning badge. The comment beside it reads *"This is what makes it sayable."* (`connectionStore.ts:22`). The component that renders the badge is **imported only by its own test file**; `lastGapAt` (`connectionStore.ts:91`) has zero readers in application code.

**A second, worse gap the review pass restored.** There is also a window during reconnection where the buffer is cleared *before* the connection switches to live, so events published in that instant are **lost with no gap marker at all** — meaning the badge, even once rendered, would never fire for them. Both halves need fixing, and this one first.

**Why it matters.** The user sees a green "connected" indicator over a conversation missing content, with no way to know. This is the least forgivable kind of data loss, because detection already works.

**What to do.** Fix the buffer-clearing order, then render the badge. If the feature is genuinely unwanted, delete the field, the action and the badge — and remove the three comments claiming loss is surfaced.

### 5.8 Almost every save that fails, fails silently — CRITICAL

**What is wrong.** Of **89 data-changing operations** in the web app, 3 declare error handling at the hook and 2 more at the call site. **84 have none**, and there is no global fallback on the query client (`QueryProvider.tsx:51-66`).

**Why it matters.** A failed save looks exactly like a successful one. You edit a workflow, the request fails, nothing changes on screen, and you continue believing it saved.

**What to do.** Add a single global error handler, which catches all 84 at once, then add specific messages where they help. **Why global first:** one change removes the whole class, versus 84 individual changes that will drift again. This was verified as workable — there is one query client and no components bypass it with direct API calls.

### 5.9 The workflow builder shows a working editor for a workflow it never loaded — MAJOR *(downgraded from CRITICAL)*

**What is wrong.** If loading a workflow fails, the builder renders an editable blank canvas rather than an error. The query's error state is never read (`WorkflowBuilderPage.tsx:93`, `:488`).

**The correction.** This was originally reported as silently overwriting the real workflow. **The fact-check refuted that.** Saving from a blank canvas does not overwrite: validation blocks an empty canvas (`workflowBuilderStore.ts:607`), and with no loaded identifier the save takes the *create* branch (`WorkflowBuilderPage.tsx:230`), producing a duplicate. **There is no data-loss path**, and the severity drops accordingly.

**What remains real.** The user is handed a working editor for a workflow that was never loaded. And when navigating between two workflows inside the app, a failed load leaves the *previous* workflow's content on screen under the new address, because the reset only runs for new workflows (`:142-148`) — which is genuinely confusing and could lead someone to save the wrong content as a duplicate.

**What to do.** Read the error state, show it, and reset on every identifier change rather than only for new workflows.

### 5.10 On a brand-new installation, creating a workspace always fails — CRITICAL

**What is wrong.** A database column is added before the table holding it exists, and the helper **silently swallows the "no such table" error**.

**The evidence.** `migrations/index.ts:531` runs before `:759`; the swallow is at `:138-150`. **Reproduced twice, independently** — building a fresh database with the real migration code yields schema version 44 with the column absent, and an insert fails with `table execution_workspaces has no column named code_root`.

**Why it matters.** Existing installations are unaffected, which is why this has never been seen. **A new user hits it on first use.** The bundled database template has the same defect and is stale — version 11 against code at version 44.

**What to do.** **Add a new versioned migration — do not reorder the bootstrap block.** The file documents that exact pattern ten lines above the bug, explaining why other columns were moved into a versioned migration for the same reason.

Then add two automated checks: one comparing a freshly migrated database against the declared schema, one comparing fresh against upgraded. **Why the checks matter more than the fix:** the two paths **cannot currently converge** — migration source was edited in place, so upgraded databases carry an index and two columns the code no longer knows about. Without automated comparison this recurs.

### 5.11 A truncated key file destroys every stored secret — CRITICAL

**What is wrong.** If the vault's master key file is the wrong length — truncated by a crash, an interrupted copy, a partial restore — the system **creates a new key and overwrites the old one**.

**The evidence.** `packages/secrets/src/KeyProvider.ts:213-223` falls through to key rotation when the file exists but is the wrong size; rotation writes over it at `:228`.

**Why it matters.** Every stored secret becomes permanently unreadable, with no error. There is no recovery — and the documented backup procedure **does not include the secrets directory**, so the one thing that could recover from this is not backed up.

**What to do.** Refuse to start and report the problem. Add the secrets directory to the backup. **Why refusing to start is right:** a wrong-length key file is always an error. There is no situation where silently discarding it is desired.

### 5.12 A crash during a chat loses the whole response — CRITICAL

**What is wrong.** Chat conversations have **no crash recovery at all.**

**The evidence.** The durable "turn finished" event is emitted at `ChatManagementService.ts:2165`, **before** the transcript row is written at `:2114` via the finalisation step. Startup recovery explicitly skips chat sessions (`StartupRecoveryService.ts:308-312`).

**Why it matters.** A restart mid-response leaves the client showing "generating" forever, and the response you already paid for is gone — **even though the text is sitting in the streaming table on disk.** The platform's own message history is effectively decorative; the provider's session store is the real source of truth, and it is the one thing the platform does not control.

**What to do.** On startup, for any chat with no in-memory turn, emit a terminating event so clients unstick, and **rebuild the partial from the streaming rows that already exist.** Separately, when a provider session is lost, seed the rebuilt conversation from stored messages and tell the user it was rebuilt.

**A sequencing warning the review pass caught, and it is important.** This fix *depends on the streamed text still being in the database. Plan item 17 removes it.* Build this recovery first, then narrow retention — never delete the streaming path outright. Streamed text is superseded within the turn for every purpose **except** mid-turn resume, which is exactly what this fix needs.

**Why telling the user matters:** today, if a provider session disappears, the chat keeps working and keeps displaying the full transcript while the model has **zero memory of any of it**. A silent memory wipe is the worst available outcome.

---

## 6. Module-by-module review

### 6.1 Chat

**The strongest module in the product, with the most severe security gaps.**

| Feature | Status |
|---|---|
| Streaming, history, stop/abort, pagination | Working |
| Diff and changes view, checkpoints, rewind, review threads | Working — genuinely well built |
| Integrated browser (server path), integrated terminal (human use) | Working |
| Widgets, plan mode, background tasks, voice, slash commands, agent selection | Working |
| Session resume after restart | Partial — the Copilot adapter drops half the configuration |
| Skills, MCP wiring, orchestrator mode, attachments | Partial |
| Context and compaction | Display only — no compaction is performed |
| Computer use | Off by default; every tool reports unavailable with stock settings |
| **Permission prompts** | **Broken** (5.1) |
| Desktop native browser | Broken — never fails over, dead-ends after 10 seconds |
| Agent terminal tools | Not implemented |
| Extension MCP / commands / hooks / skills / prompts | Not implemented — staged, then dropped with a log line |
| Permission subsystem (451 lines), hook interceptor (444 lines) | **Dead code — verified zero callers** |

Beyond section 5:

- **Two prompts at once silently discards the first response.** There is no concurrency guard (`ChatManagementService.ts:2049-2050`). The second message replaces the first turn's listener, so the first keeps running with nowhere to send output — its entire response is lost and never saved. The comment above states the hazard and does not defend against it. The web interface disables send while streaming; the API, terminal and SDK do not.

- **Two near-identical 250-line functions build the conversation configuration and have already diverged three ways.** Because of the cache bug (3.6), both run in every chat's life — so MCP servers from an agent are dropped at creation and reappear later, and skill directories are overwritten in opposite directions on the two paths.

- **A background orchestration does not survive a restart**, despite documentation naming that as its headline advantage. Its cleanup function has no production caller, so live event subscriptions leak permanently — one per orchestrator chat, for the life of the process.

- **The widget script tool runs model-written JavaScript in the server with full access and no timeout** (`widgetTools.ts:752-756`). Its own documentation (`:717`) says the script has "no access to require/process/globals" — it uses a construct that compiles in the global scope. Two one-liners are available: one reads every API key into the transcript, the other **freezes the entire server permanently**.

- **A route requiring no credentials can read files outside its intended directory.** The guard meant to refuse symbolic links uses a call that *follows* them, so its check can never be true (`extensions.ts:171,177`). Containment inside the extension folder *is* enforced — so this needs a link already planted under that folder. **That is exactly what the extension-writing tool (5.3) can do**, which is what makes it a real chain rather than a theoretical one.

- **The browser has no address filtering by default**, and `file://` addresses pass every check. A caller can navigate to a local credentials file, or to the special address cloud servers use to hand out their own credentials, and read the result back.

- **Five plan-related routes skip the ownership check their own header says every handler performs.**

- **The event stream is authorised at one coarse permission.** Holding `stream:events` alone reads every chat's content and the desktop screen preview — inverting the stated intent that a paired phone must not see the desktop.

### 6.2 Workflows

**An excellent execution engine underneath a scheduling layer that was written four times.**

The durable execution engine is genuinely good. In plain terms: **before doing anything it writes down what it is about to do, then writes down that it finished — so after a crash it can tell "never started" from "started but unfinished", and it knows which kinds of work are safe to repeat.** Step-level crash recovery was verified point by point and is strong.

Beyond 5.5 and 5.6:

- **Workflow definitions are never validated when created or edited** (`WorkflowDefinitionService.ts:47-66`, `:113-160`, `:186-198`). Only the import path validates, so a workflow containing a loop can be saved and only explodes when run.

- **"Create from template" silently drops most of the template** — 6 of about 20 per-step fields survive, and none of the workflow-level variables, hooks or configuration. Retry policies, timeouts, conditions, validation rules and **approval requirements** all vanish, so an approval-gated template runs unattended. The correct mapper is imported into the same file and used by the *other* import path. The documented URL for the feature returns 404; the terminal command reaches the lossy version; the web app accidentally escapes the bug by using a different endpoint.

- **Retrying a run reuses the failed run's dirty working directory**, carries the previous run's identity, and copies step *statuses* without their *outputs* — so every downstream step runs with no context. Sold as "successful work is not re-run"; in practice it discards the results, which is the part that mattered.

- **Auto-commit and auto-PR are lost on restart and can be missed entirely.** Attached *after* the run starts and held only in memory. A fast run finishes before the listener attaches; a restart loses it. The run reports success and never opens its pull request.

- **Two live routes read files outside the intended directory** — the workspace changes endpoints join a user-supplied path with no containment check (`ChangeSummaryService.ts:706-712`). These sit behind the run page's Changes tab.

- **The class named `SandboxedScriptRunner` does not restrict what it appears to.** Its allow-list has **39 entries** including `sh`, `bash`, `curl`, `wget`, `rm`, `chmod`, `node` and `python`. The command *is* checked against that list — but **the dangerous-pattern scan runs only over the arguments** (`:227-234`), so it never sees the command it is guarding. `rm` with `-rf /`, and `node` with `-e "<anything>"`, are both allow-listed commands whose arguments match none of the seven patterns. There is also a bypass by relative path, since the check compares only the file name against a caller-controlled working directory.

  **A correction to an earlier draft of this document:** it praised script *upload* as "correctly locked behind an explicit opt-in." That misses the source's actual point — **the opt-in guards the wrong door** (5.3). It is not a contrast worth drawing.

  *(For context: `architecture.md:274` documents this allow-list as 9 safe commands, one of which is not even in the real list.)*

- **A "dry run" endpoint executes for real.** It sets a flag **nothing anywhere reads** (`hooks.ts:103-143`), then dispatches genuinely — spawning processes, making outbound requests, calling registered handlers with caller-supplied arguments — and returns "success: dry-run mode" for work that actually ran.

- **Worktree cleanup ignores the retention you configured.** The path that runs deletes directories raw, so a configured 24- or 72-hour retention is in practice about 5–10 minutes, and git metadata accumulates forever. The correct implementation sits unreferenced in the same file.

- **Deleting a workflow that has runs destroys its structure.** Three deletes run without a transaction; the second fails on a database constraint after the first has committed, leaving every connection gone and the steps intact. The documented protection — an error saying "delete the runs first" — does not exist anywhere.

- **Result validation checks the wrong text.** In the session mode automatically chosen for every linear workflow, validation reads the concatenation of *every* step's output rather than the step being validated.

- **Operator skip overrides are ignored on failure branches** — a step the operator asked to skip runs anyway, precisely where someone is hand-steering a broken run.

- **Runs are not pinned to a snapshot of the workflow.** Editing a workflow mid-run silently changes the part of that run which has not executed yet.

- **Dead interface elements:** a "Wake now" button whose handler only stops event propagation; the run inspector's Hooks tab, hardcoded to show nothing; a per-step Template picker that saves a field nothing reads (and offers *workflow* templates as *step* templates); a 221-line approval panel rendered nowhere.

- **Not implemented despite appearing in the model:** loop steps (persisted, accepted by the API, zero execution consumers — honestly documented), sub-workflows, and a unified artifact model. "Artifact" currently means **four unrelated things**.

### 6.3 Automations

**A good execution engine with a scheduler that is three incompatible half-designs.**

What works well: manual triggering, idempotency keys, loop and batch inputs, retry policy, cancellation, execution history, and — genuinely — **durable iteration with crash resume**, the best-engineered part of the module.

**The scheduler is simultaneously:** in-process timers (authoritative for *when*), a database lease (a mutex for *who*), and a "next run" column representing the durable design that was started and abandoned — **nobody writes to it**.

Consequences:

- **The lease releases itself milliseconds after acquiring it** — it is scoped to the call that *starts* the work, not the work. Everything claimed about multi-process safety rests on that scoping.
- **Missed runs are invisible.** Downtime over a scheduled time silently skips that run forever.
- **No timezone support, no catch-up policy, no overlap prevention** — the three controls every production scheduler exposes.
- **The schedule validator and executor use different rules.** An invalid expression is accepted by the API and refused by the executor with only a log line, so the automation shows as enabled and never fires. Valid expressions using day names are rejected.

**Webhook triggers cannot be used by anyone outside the application.** The route requires permissions no external sender can hold. The raw request body is captured for signature verification and **the signature is never verified**. The interface tells users the URL is a working public secret. The token sits in the URL path, is logged verbatim on every failed delivery — that is, every real one — is stored in plain text, and is returned by the list API to any read-scoped caller including paired phones.

**Failure reporting inverts** (`AutomationService.ts:878`): if 999 of 1,000 items fail and one succeeds, the run reports **completed**, and the failure alert is suppressed with it. A `partial` status is documented and does not exist in the database. **The same inversion exists a second time in the recovery service.**

**Why this one matters disproportionately:** the entire value of the module is unattended execution. A status that cannot say "mostly failed" makes unattended operation unsafe.

**External request protection is a text pattern match** (`DataSourceResolver.ts:243`). Numeric addresses, redirects, and a trick where a name passes the check and then resolves to an internal address a moment later all reach internal services — and **the response body becomes variables inside an agent's prompt.** File data sources read from the wrong directory, so environment files and the database itself are readable into variables.

**Data-source credentials are stored and returned in plain text** — the interface tells users to paste a token, and the column is echoed to any read-scoped caller, which includes a paired phone.

**The recommended fix, and why.** Replace the in-process timers with a database-backed due-row poller: write the next run time on create, update and fire; one periodic tick claims due rows using the conditional-update pattern **this repository already implements correctly elsewhere**, runs them, and recomputes.

**A point of fairness the review pass insisted on:** polling at this scale is not the problem and should not be apologised for. The source review's own words are that a 3-second loop is *correct* here and "should be leaned into rather than apologised for" — sub-second scheduling is worth nothing when a step takes four minutes. The problem is not polling; it is **three authorities for one decision**. Consolidating gives four properties currently missing: replica-agnostic scheduling, missed-run detection, predictable fire semantics, and a "next run" time the interface can display.

### 6.4 The web application

**Better than expected in code quality; four serious defects and weak accessibility.**

**The core performance defect** is a three-part cascade:

1. The chat page subscribes to one session's streaming record (`ChatPage.tsx:101`) — whose identity is replaced on every frame, so the page re-renders about 60 times a second.
2. It passes the panel definitions as a fresh inline object each render (`:1050`).
3. The right-hand pane calls each panel's render function **directly, as a plain function call with no component boundary** (`RightPane.tsx:811`) — for every mounted panel, visible or not.

The result: the browser panel (2,009 lines), the changes view (1,284) and the terminal panel (903) all rebuild on **every stream frame for the entire turn**, including the ones you cannot see. **The decisive fix is making the panels real components** — that is what collapses the work from "all tabs" to "the active tab". Narrowing the subscription helps but is not the main lever.

A second, distinct cascade: **the workflow builder subscribes to its entire store in two places**, so every node drag and every keystroke re-renders the whole canvas.

A third, now resolved: **the live timeline's row memoisation is defeated** because each derivation creates brand-new step objects (`deriveTimeline.ts:248-262`), so the comparison always fails. *(The settled transcript's memoisation, by contrast, holds correctly — these are different components, and the apparent contradiction between two reviews was resolved as "both true".)*

Beyond 5.7, 5.8 and 5.9:

- **690 verified lines across six components are rendered nowhere** — the connection-status badge, an approval panel, an artifact browser and picker, a codebase picker and a project picker. Every non-test reference to them is a comment, not an import.
- **Six rendered controls cannot work:** the step Template picker, the Hooks tab, "Wake now", the Settings MCP form, the skills toggle, and a dead model field.
- **Accessibility is the weakest area, and it has a costed fix order.** 159 of 169 form controls have no accessible name. The custom dropdown's arrow keys are inaudible to screen readers — **while an accessible library is already installed and unused**, so swapping it in deletes 196 lines and fixes the most-used control in the app. Then: making hidden drawers genuinely inert and closable by keyboard. Then: an automated pass over the unnamed controls. Border and input contrast also fail accessibility guidelines in 32 of 34 themes.
- **The design system is not enforced.** The script meant to stop a bad pattern spreading — it records today's count and fails the build if the count rises — **currently fails** (raw button elements went from 191 to 343) and is not run in CI. Linting is warning-only: 0 errors, 547 warnings. Two theme variables are referenced but never defined, producing a hardcoded white panel in every dark theme.
- **The web app has forked away from the shared client library.** Only 12 of about 400 web files import it, for eight small utilities. Instead the web app ships roughly 4,000 lines reimplementing the same protocol — with almost no method-name overlap, so it is not copied code but a **parallel implementation**, which is worse: the two drift silently and every wire-format change must be made two or three times.

**Genuinely good here:** the stream resume design — **it remembers the last message received in an unbroken run, fetches anything missing in batches, discards duplicates, and gives up cleanly rather than retrying forever**; the deliberate, documented decision to reject list virtualisation in favour of a technique that preserves find-in-page, tab order and screen-reader output; type discipline (zero suppressions and 56 loose types in 68,800 lines); every route wrapped in an error boundary; reduced-motion fully honoured.

### 6.5 The other clients

**Terminal (CLI) — invest. The strongest surface in the repository, web included.**
219 commands across 25 groups, 192 backed by the server, with **zero stub handlers** — and that count comes from a generated snapshot which CI verifies, so it cannot drift. The terminal interface genuinely throttles its rendering. Documentation, command surface and test coverage are all enforced in CI.

Its problems are small: the published package forces native builds and a browser download for a local mode that **does not exist** (zero references in the source, despite the build configuration and architecture documentation both describing it); some documentation links point at a deleted file; two declared options always throw.

**SDK — freeze, then decide.**
It is not a thin wrapper around the API — **it builds and connects the whole application itself, a second time, instead of talking to the running server**, so the two copies will drift apart. It has **zero importers**. And it cannot be installed: marked private in five places while also declaring public publishing settings, with all four runtime dependencies private and pointing at raw source. Three documents promise a working install.

**Desktop — invest, but do not release yet.**
The architecture is right: the server runs as a separate process for crash isolation, renderers are sandboxed, context isolation is on everywhere, the bridge is a named allow-list, and the debugging proxy is properly scoped. Packaging is careful.

But beyond 5.4: **"Restart Server" — the app's own advertised recovery action — permanently bricks the window**, because the server takes a new random port and the app's address is set once and never updated. **The same defect affects switching to a remote server**, which is a second independent path to a broken app. Minimising to tray then closing makes the app unreachable, because no close handler exists. **A settings write validates the key and never the value**, so a value the desktop's own types call legal makes the server exit on every launch until the user hand-edits a file — no attacker required. Agent-navigated pages are **auto-granted camera, microphone, geolocation and screen capture**, because no permission handler is set. Releases default to unsigned. And **every file in the chain behind 5.4 has zero tests.**

**Mobile — invest with a hard tripwire, or freeze.**
The code is good: correct package resolution, **the phone proves it holds a private key rather than sending a password**, one multiplexed socket for the whole app, an enforced token pipeline, honest security-posture reporting, about 2% dead code, 196 real tests — and it uses the shared client library **more faithfully than the web app does**.

**And it has never been compiled for a phone.** No build configuration anywhere, no build script, nothing in CI that bundles for a device, and an empty device list. Every bundle in the development log targets the web.

The three things that would make someone install it — *notify me when the agent needs me*, *reach my machine from outside the house*, *keep my key in secure hardware* — are each one missing piece away. **Every piece is built at both ends for push notifications; it does nothing at all because one setting was never filled in.** Remote access depends on the relay, which cannot run. The hardware-key module was never implemented — though, to be fair, **the code documents both the hardware and software paths and explicitly states the fallback is not silent**, so this is honest documentation of unfinished work rather than a false claim.

Two further blockers: **"Revoke device" — an emergency action — posts to a route the server does not register**, so it returns "not found". And Android has no clear-text networking configuration while the app pairs over a plain local address, so **a release Android build would very likely fail every request after a QR scan that appears to succeed.**

**Recommendation:** the fix list is days, not weeks, and one change — initialising the build configuration — unblocks **two** of the three blockers at once. **Tripwire:** if a device build pipeline and one physical phone cannot be committed to this cycle, freeze it and mark it experimental. **Do not delete it** — the shared client packages were shaped by this app's requirements and are now used by web, desktop and terminal. That value is already banked.

**Relay — delete.**
Two independent, verified blockers prove it has never run end to end: the server and relay speak **different URLs**, and the identifier the relay generates **violates the format the host validates against**, so the first client would kill the control channel.

It also has two critical authentication defects. The host identifier is never bound to the host's key despite a comment claiming it — and **cannot be, as designed**, because the two derive from different secrets. And the process **logs at startup that it cannot decrypt application traffic** while the data path is plain HTTP carrying authorization headers; the encryption module has **zero importers**.

**Why delete rather than freeze:** freezing leaves a startup banner asserting a security property the code does not have, a rate limiter that cannot fire, and a 531-line test suite whose passing checks certify none of it.

**Two things must travel with the deletion.** The successor plan already written for this (a tunnel-based replacement) **cites the dead encryption module as evidence that traffic would be protected** — delete the relay without correcting that and the replacement silently inherits a false security premise. And the pairing offer, which is on the keep list, still **advertises an encryption capability that does not exist**; that claim must come out too.

### 6.6 Data and durability

**The right database, used in ways that lose data.**

Measured against the live 437.5 MB database:

| Measure | Value |
|---|---|
| Physical tables | 61 (62 including an internal one) |
| Tables the ORM knows about | 41 — **a third invisible** |
| ID columns with no enforced relationship | **96 of 130 (74%)** |
| Share of the database that is event logs | **85%** (54% streaming + 31% a table that stopped receiving writes) |
| Share of streaming rows that nothing reads | 66% |
| Orphaned sessions / workspaces / streaming rows | 288 / 307 (25%) / 73,237 |
| Runs stranded in a state nothing recovers | 82 |

A database consistency check reports zero violations **precisely because the broken relationships have no constraint behind them.**

Transaction coverage is thin — 17 transaction sites repository-wide against a large number of multi-step write operations — and the specific consequence is measurable in the orphan counts above.

Beyond 5.10, 5.11 and 5.12:

- **Migration v23 drops a table with foreign keys enabled**, so the implicit delete cascades and **wipes every saved plan's text and every comment** on the upgrade path. This is the only one of the data-destruction bugs that is destroying data *today*.
- **Step status updates are unconditional and do not bump the version**, so they clobber concurrent changes *and* let a stale writer succeed. 75% of step records are still at version zero.
- **When stored settings don't match what the code expects, it quietly substitutes defaults — and the next unrelated save writes those defaults back permanently.** The optional callback that would make this observable is passed at **0 of 59 sites**. Eight declared columns are never written at all.
- **Restoring a backup onto another machine is broken** by roughly 15 absolute-path and device-key columns, with no warning.

**The engine verdict — keep SQLite. Do not swap it.** Examined rather than assumed:

- The workload is **one writer process, ~22,000 small appends per day, no cross-machine access, and a hard requirement to ship as a desktop app with no service to install.** SQLite is the correct answer, and the configuration is already right: **changes are written to a side file first so readers are never blocked; the flush setting, cache size and file-access mode are all set correctly.** *(Honest caveat: that flush setting survives a program crash but not a power cut — a deliberate and reasonable trade here.)*
- Migrating would mean **rewriting the most correct code in the repository.** The durable engine's atomicity depends on same-connection synchronous transactions; the streaming append — the best-designed piece of the data layer — becomes a network round-trip per event.
- What it would buy: write concurrency (unused — one writer), network access (unused — loopback by design), richer types (would help about six columns).
- **The real ceiling is not concurrency, it is that every query occupies the single application thread.** That is reached at a few hundred megabytes, which this installation has passed. The fix is to make the database smaller, not different.

**Highest-leverage change, needing no engine swap:** split the event log by class. The code already distinguishes short-lived streamed text from durable items; give them different retention and stop durably storing the two event types that make up two-thirds of the rows. Combined with dropping the dead table, expect **roughly 65–70% smaller overall** — of which about half is the dead table alone. *(An earlier draft of this document double-counted these as 70% plus a further 30%; they are steps one and two of a single recommendation.)*

If a hosted multi-user tier is ever built, the right move is libsql/Turso — identical SQL, an asynchronous driver that removes the thread problem, and embedded replicas that keep the offline desktop path working. **Not Postgres**, which would only be justified by multi-writer concurrency this product does not have.

### 6.7 Security

**The perimeter is genuinely good. The interior is the problem.**

This corrects an assumption carried into the review. Authentication is **not** a shared key. It is a real device-and-scope system: **a stolen credential is useless without the device's private key; the server issues a one-time value that makes a captured request impossible to replay; and live connections use one-shot tickets instead of putting credentials in the address bar.** There are 23 permissions matched against **the most specific rule covering each address, with anything unmatched refused rather than allowed**. Secrets live in an encrypted vault whose master key is held by the operating system keystore, and a startup gate **refuses to boot in an unsafe posture**. The cryptography is careful in the specific places that normally go wrong.

**The real trust boundary is not the perimeter — it is "the agent is trusted with the host."** And there, bypass mode is effectively the default on local installations (`composition-root.ts:345`) while the sandbox defaults to off.

**A default that fails the wrong way:** the shared policy helper defaults to bypass for any consumer that does not go through the server's security setup — the SDK, the terminal, embedded use, tests. **A default should never be the dangerous one.**

Beyond 5.2, 5.3 and 5.4:

- **Widget assets are also served on the main application origin**, unauthenticated, with a policy that permits inline and dynamically evaluated script. This is stronger than it first appears: it is **the origin-isolation escape that makes the widget sandbox decorative** — and it is the same route that carries the symbolic-link flaw, reachable by the extension-writing tool. One-line fix: drop the second mount.
- **There is no outbound request boundary anywhere.** The HTTP client is a bare fetch, hooks validate nothing, and the browser's address allow-list **fails open**.
- **The shipped deployment files are unsafe.** The nginx configuration *appends* a client-controlled forwarding header, turning the loopback check into a value a remote attacker chooses. The observability stack publishes its dashboard with **anonymous administrator access on all network interfaces**. And there is no application container file at all, despite the operations guide giving build instructions for one — so a self-hoster has no working, safe deployment path to copy.
- **11 of 12 sampled environment variables in the operations documentation are read by no file**, and the security checklist still says "no built-in auth yet", which is now false and understates the product. The source review's table of security-relevant defaults — 19 variables, what each does when unset, and whether it fails open or closed — is the single most operator-useful artifact produced by this audit, and the conclusion is blunt: **the three that fail open are the three that matter.**
- **`SECURITY.md` lists `security@example.com`.** It is explicitly self-labelled as a placeholder, so this is not an oversight the project is unaware of — but it remains a hard blocker for publishing, because reports would go nowhere.

**Operationally strong:** graceful shutdown is excellent — idempotent, draining connections, reaping descendants, a hard deadline, and handling the Windows case where the standard signal cannot be delivered. Child cleanup, crash handlers and the backup script are correct. Observability is real, not scaffolding — 27 verified instruments — though off by default.

*Two caveats that belong beside that praise:* the browser service has **no disposal method and is absent from the shutdown path**, so every graceful restart force-kills live Chromium; and three shutdown paths skip the final flush, leaving a window of up to 10,000 unwritten events.

**Operationally weak:** no log rotation anywhere, backups manual with no retention or verification, no dependency or static-analysis scanning, and CI actions pinned to moving tags. One dependency is past end-of-life with published denial-of-service advisories.

---

## 7. Architecture

### 7.1 Documented versus true

**The package-level claims hold, and are well kept** — verified, not assumed:

- The domain layer has **exactly one external import across 44 files.**
- Vendor SDKs are **provably contained** — zero leaks outside their adapter packages.
- The presentation layer has **zero** domain or infrastructure imports.
- **Zero dependency cycles across all 30 packages**, verified algorithmically. That is rare, and it is what keeps a 213,000-line codebase navigable.

**The layer-level claims are prose.** The architecture document says boundaries are enforced by linting; the lint configuration bans four packages and nothing else. **It cannot do more, because the application, infrastructure and domain layers all live inside one package**, so the module system enforces nothing between them.

Three documented claims are false: an in-process terminal mode that does not exist, a runtime topology that never mentions the process split, and a nine-command script allow-list that actually has 39 entries — one of the nine not even being in the real list.

### 7.2 The size problem

| Lines | File | Single responsibility? |
|---:|---|---|
| **3,326** | `StageExecutionService.ts` | **No** — one method inside it is 1,675 lines |
| **2,566** | `ChatManagementService.ts` | **No** |
| **2,419** | `composition-root.ts` | **No** — one 2,062-line function, 116 object constructions, 1 helper |
| **2,191** | `ComputerService.ts` | **No** |
| **2,009** | `BrowserPanel.tsx` | **No** |
| **1,975** | `HttpPlatformClient.ts` | **No** — 198 methods in one class |

**Why this matters concretely:** a configuration bug and an approval bug currently share the same 3,326-line blast radius. The 1,675-line method is also why the human-approval gate cannot become a proper suspend-and-resume boundary — it is buried in a frame that must stay alive.

### 7.3 The process split — built, tested, switched off

Four background processes were built to isolate risky work. **A default startup spawns none of them:** the agent host and terminal host are opt-in and off, the browser host was never wired (its client was deleted), and the computer-use host **must not be wired** because its protocol carries no window identity.

**One clarification that matters:** the agent-host *process* being off does **not** mean the concurrency limit is inert. The supervisor is constructed unconditionally and enforces its limit in-process (4.1).

At full opt-in the split would cost about 200 MB and four communication protocols, **none carrying a version number** — while the host is loaded from a build directory excluded from version control, so a stale build from an old checkout loads silently. That is exactly the drift the documentation claims is impossible.

**The comparison worth making:** VS Code earns its extension-host process because arbitrary third-party code runs there. OpenHands earns its container because arbitrary model-authored code runs there. **Here, only the terminal host has that property.** The agent host isolates the server from an SDK *client library*, while the actual model runtime is **already** a separate process — a third process layer for a second-order benefit.

**Verdict: half-done is the most expensive state.** All the cost has been paid — code, tests, protocols, build targets, CI time — and none of the isolation is received. Two acceptable resolutions, and the current state is neither: **finish it** (terminal host on by default, agent-host stubs fixed, browser host wired with flow control, protocol versions added, computer-use host deleted), or **retreat** to terminal-host-only and re-enter later from a working baseline.

### 7.4 Testing

350 test files, about 4,400 cases, ~55,600 test lines against ~213,000 source lines. **Better than expected:** only 15 files use mocking, 22 exercise a real database, 16 make real route requests. A specific internal concern — tests that assert a copy of the logic rather than the logic — was tested directly by scanning for test files with no system under test. **Exactly one remains.**

**Where it is genuinely weak:**

1. **The database package has 2 test files and 344 test lines for 12,450 lines and 40 repositories.** The persistence layer is the least-tested code and the hardest to recover from when wrong. **This is why 5.10 shipped.**
2. **The 18 end-to-end tests do not run in CI** — a one-line change.
3. **Every finding in the security review is in code with no test behind it.**
4. CI time is spent proving unreachable code correct — 545 test lines for the browser host, 261 for the computer-use host.

---

## 8. The two patterns behind most of these problems

Ten independent reviews converged on the same two root causes. Fixing the *patterns* is cheaper than fixing the symptoms one at a time.

### 8.1 A control is designed correctly, documented as holding, and then does not hold

Counted independently by four reviewers. The rows below were re-verified against the code during the review pass; where a quotation could not be located verbatim, it is marked.

| The comment or document says | The code does | Verified |
|---|---|---|
| "symlinks refused" | Uses a call that follows symlinks; the check can never fire | ✅ |
| "no access to require/process/globals" | Compiles in the global scope | ✅ |
| "so the first turn doesn't rebind it needlessly" | Rebinds on every first turn (4-part key written, 5-part computed) | ✅ |
| "a resumed conversation without this silently loses hooks" | Chats never had hooks — the bridge is never assigned | ✅ |
| "default if unset: 300s" | There is no default | ✅ |
| "the polling loop will eventually mark the stage failed" | It does no such thing | ✅ |
| "relayHostId is the hash of the public key" | No such comparison is ever made | ✅ |
| "cannot decrypt application traffic" | Banner confirmed; plain HTTP path reported by two reviews | ✅ (banner) |
| "covered by the E2E suite instead" | No such suite exists anywhere | ✅ |
| Script allow-list of 9 safe commands | 39 entries including `bash`, `curl`, `rm` | ✅ |
| "Delete the runs first" guard | Does not exist anywhere | ⚠️ not re-quoted |
| "every handler verifies the plan belongs to this chat" | Five of seven do not | ⚠️ not re-quoted |
| "every sub is authorised individually" | No authorisation call exists in that function | ⚠️ not re-quoted |
| "the driver is disposed before the server" | Disposed after | ⚠️ not re-quoted |
| CI check preventing a bypass default | Does not match either file that sets it | ⚠️ not re-quoted |

**Two rows were removed during the review pass**, and it is worth saying why. The mobile "private key never enters JavaScript" claim was originally listed here; on inspection the code documents *both* the hardware and software paths and explicitly states the fallback is not silent. That is honest documentation of unfinished work, not a false claim — and including it weakened the fifteen rows that are solid.

**Why this pattern is more dangerous than a missing control.** A reviewer — human or AI — reads the comment, concludes the line is handled, and moves on.

**The fix, and why it is the right one.** For each security or capability claim, write the test that fails when the claim stops being true. This is better than deleting the comments — they describe *intent*, which is correct and valuable — and better than a documentation review, which decays. **A test is the only form of a claim that cannot silently become false.** A link-existence check plus a rule that security-property comments must cite the enforcing line would catch most of the table in about a day.

### 8.2 A bug is fixed in one code path and its duplicate is left alone

| Duplicated thing | The consequence |
|---|---|
| Two template importers | One drops most of the template |
| Two conversation-config builders | Diverged three ways; capabilities differ before and after the first message |
| Four path-containment checks | Two are wrong; the correct implementation exists and is unused |
| Two worktree-removal paths | The correct one is dead; the buggy one runs |
| Three materialisation loops | Only one uses a transaction |
| **Four** "is this step ready?" predicates | Four different answers; workflows hang (5.5) |
| Two client stacks | Every protocol change must be made twice or three times |
| Four browser implementations | The default desktop one sits outside the unifying interface |

**The rule these all violate:** *if two code paths do the same thing, the one nobody looks at is already wrong.* This proved to be **the best single predictor of where the next bug is** — which is why the consolidation items rank so highly below. They are not tidiness; each deletes a bug class rather than a bug.

---

## 9. What is genuinely excellent

Stated specifically, because it determines where **not** to spend effort. Where a caveat exists, it is given — an earlier draft of this section was called out for praising two things its own sources partly contradict.

- **The durable execution engine.** See 6.2. Better than most hand-rolled workflow engines, with the one honest compromise correctly identified and documented.
- **The stream write batcher.** Measured rather than assumed (7 microseconds for statements versus 210 for the commit; 16.7 microseconds per event batched — a 44× improvement), with a correctly asymmetric policy for durable versus transient events and a bounded queue with a stated overflow policy.
- **Twelve data structures verified as correctly bounded**, under a heading in the source that reads "verified, do not fix". That list saves more effort than any praise here, because it marks what not to touch.
- **Command injection is closed as a class** — process arguments are passed as arrays, never assembled into shell strings. Checked and clean.
- **The crash supervisor.** A restart cap *plus* a predicate that recognises unrecoverable failures so it does not burn restarts on a missing file; honest lifecycle states; session reattachment; a parent heartbeat so nothing is orphaned; and a child environment built from an allow-list rather than inherited.
- **Terminal flow control.** **When the screen can't keep up, the program stops reading — and the pause goes all the way down, so the shell producing the text is genuinely blocked rather than just buffered somewhere.** Two independent pause sources tracked separately, with a comment explaining why collapsing them into one flag was wrong. *Caveat: a documented environment variable accepts values that permanently freeze every terminal, and a character-versus-byte mismatch means the limit never trips on non-Latin output.*
- **The authentication system.** See 6.7. Above the bar for an alpha, and careful where it usually goes wrong. The single-use credential path is atomic and correct.
- **Graceful shutdown.** Excellent, including the Windows signal case most projects miss. *Caveat: the browser service is absent from it, and three paths skip the final flush.*
- **The database configuration**, and the reclaim script, which the data review examined and returned no findings on.
- **The diff and checkpoint system.** Metadata-first with lazy loading, both caches properly bounded, and a restore that always writes an undo point first.
- **The terminal client.** 219 commands with zero stubs, genuine render throttling, CI-enforced ratchets.
- **The web app's stream resume design**, and the documented decision to reject virtualisation to preserve find-in-page and screen-reader output. A real trade-off, reasoned correctly.
- **The self-critical documentation culture.** `apps.md` states plainly which mechanisms are opt-in, dead, or must never be wired. The decision *not* to connect the computer-use host because its protocol could not carry the approved target is exactly the right instinct, recorded in the right place. Most projects would have shipped a green checkmark.

**The problem is not competence.** There is more and better engineering here than in most shipping products. The problem is that **the care is distributed by author rather than by risk** — so the most privileged surfaces received the least of it.

---

## 10. The action plan

Effort key: **XS** ≈ under an hour · **S** ≈ half a day · **M** ≈ 1–2 days · **L** ≈ 2–4 days · **XL** ≈ a week or more.

### Phase 0 — This week

| # | Action | Where | Effort |
|---|---|---|---|
| 1 | **Stop registering extension write/install tools on every chat** | `composition-root.ts:1875-1884` | XS |
| 2 | **Fix the desktop navigation check, its fail-open branch, and sender validation on all 43 bridge handlers — one commit** | `window-manager.ts:173` (helper at `:116`); `ipc.ts` | M |
| 3 | Reject any permission mode other than the two that work, until 5.1 lands | `routes/chats.ts:645` | XS |
| 4 | **Lower the concurrency default *and* acquire the permit on the chat path — one change**, and decide what the user sees when the limit is hit | `AgentHostSupervisor.ts:202`; `ClaudeAgentProvider.ts:1109-1159` | S |
| 5 | Remove the widget-asset mount from the main application origin | `routes/index.ts:128` | XS |
| 6 | **Add a global save-error handler** (fixes 84 silent failures at once) | `QueryProvider.tsx:51-66` | S |
| 7 | **Fix migration v23's plan-text wipe** — actively destroying data today | `migrations/index.ts:1324` | S |
| 8 | **Fix the fresh-install column as a new versioned migration** (the file documents this pattern ten lines above the bug) | `migrations/index.ts:531,759` | S |
| 9 | Refuse to start on a wrong-length vault key instead of silently re-keying | `KeyProvider.ts:213-223` | XS |
| 10 | Fix the reconnect buffer-clearing order, then render the gap badge | `StreamBroker.ts:253-262`; `ConnectionStatus.tsx` | S |
| 11 | Show an error instead of a blank editable canvas, and reset on every identifier change | `WorkflowBuilderPage.tsx:93,142-148,488` | S |
| 12 | **Make the script guard see the command it is guarding**, close the relative-path bypass, and move the script gate from the upload route to the loader | `SandboxedScriptRunner.ts:218-234`; `WorkflowScriptLoader` | M |
| 13 | Real contact address in `SECURITY.md` | — | XS |
| 14 | Upgrade the end-of-life dependency with published advisories; add the three missing security headers | — | XS |
| 15 | Put the 18 existing end-to-end tests in CI | `.github/workflows/ci.yml` | XS |

*Deliberately **not** in Phase 0:* the automation status fix. It needs a schema change, a domain type change and a notification change — and it should not land a migration ahead of item 8's schema-convergence checks. It moves to Phase 1.

### Phase 1 — Two to four weeks

| # | Action | Effect | Effort |
|---|---|---|---|
| 16 | **Bound live provider sessions — idle timeout, a least-recently-used limit, and a hard process cap.** Note: bounding the in-memory *maps* alone is not sufficient; the thing that must be bounded is **live sessions and processes** | Prerequisite for 17 | M |
| 17 | **Move the Claude provider to streaming input mode** — one process per conversation, not per message | **−1.5 to −2.0 s per message (~55–60% of the wait)** | L |
| 18 | **Fix the render cascade — make the right-pane panels real components** (the decisive change), memoise the panel definitions, narrow the subscription; and memoise timeline steps by identity | Removes the largest per-frame cost | M |
| 19 | **Then** make the event handlers awaited so backpressure applies | Removes progressive lag on long answers | M |
| 20 | **Build chat crash recovery from the streaming rows** | Stops losing paid-for responses | M |
| 21 | **Then** split event retention by class and drop the dead table | **~65–70% smaller database** | M |
| 22 | Fix the conversation-binding cache key in one function | Removes a full rebuild from every chat's first message | S |
| 23 | Replace the whole-library highlighting imports with the curated subset | Large reduction in the biggest bundle | S |
| 24 | Cache the model list instead of starting a large process to fetch it | −1.75 s and −150 MB per refresh | S |
| 25 | **Measure the pre-message git snapshot on a real workspace**, then make it non-blocking and stop live snapshots triggering full rebuilds | 150 ms to seconds per message | M |
| 26 | Fix the workflow builder's two whole-store subscriptions | Removes a second render cascade | S |
| 27 | **Accessibility, in dependency order:** swap in the already-installed accessible dropdown (deletes 196 lines, fixes the most-used control); make hidden drawers inert and keyboard-closable; automated pass over 159 unnamed controls; fix border/input contrast | The named weakest area | M–L |
| 28 | Fix the automation status calculation, add `partial`, and fix the same inversion in the recovery service | Unattended runs stop reporting success on mass failure | M |
| 29 | Fix the desktop "Restart Server" and remote-switch address staleness; add a close handler; validate settings *values*; add permission handlers to agent-navigated sessions | Four reproducible ways to break the app | M |

**Two open questions on item 17, stated rather than assumed.** First, per-turn options include MCP servers, tool definitions, skill directories, working directory and system prompt — and of these only permission mode, model and flag settings can be changed mid-session in the installed SDK. So a persistent session must be torn down whenever any of the others changes, which is harder to guarantee while two divergent configuration builders exist (6.1) — **item 17 is easier after the builders are merged**. Second, **workflow steps are single-message conversations in per-run directories and would gain nothing** from a persistent session while adding idle processes; they should probably keep the current model. Treat both as open, not settled.

**What item 17 also unlocks, and is worth naming:** real interruption (the vendor documents it as streaming-mode-only), plan-mode transitions without rebuilding options, attachments, and the deletion of three existing workarounds. A settle-then-interrupt-then-kill ladder **already exists in the codebase, unused** — wire it rather than writing a new one.

### Phase 2 — One to two months (each item deletes a bug class)

| # | Action | Removes | Effort |
|---|---|---|---|
| 30 | **The boundary lint rule plus a ratchet** — ~10 lines, plus fixing the 11 violations it will surface | The root cause of every layering violation. **The highest-leverage structural fix in this review, and it is deliberately first in this phase** | S–M |
| 31 | **One readiness predicate, one snapshot, one reconcile function** | The hanging workflow, the cancelled-step divergence, and four other findings; deletes ~400 lines | L |
| 32 | **A heartbeat lease on steps and a real cancellation signal** | Hung steps freezing other workflows; duplicate agents in one directory | M |
| 33 | **Collapse the two conversation-config builders into one** | Three known divergences and the mechanism generating more; also unblocks item 17 | M |
| 34 | **Pick one permission architecture; delete the other two** | Two dead subsystems (895 lines) and the ambiguity between three designs | L |
| 35 | **Route all workspace file access through the existing path resolver** | Two live file-read routes and two weak checks | M |
| 36 | **One template importer, one materialisation builder** | Silent template degradation; non-transactional partial writes | M |
| 37 | **Persist orchestration state instead of holding it in memory** | Auto-commit and auto-PR silently not happening | M |
| 38 | **Replace in-process scheduling with a database-backed due-row poller** | Duplicate runs, missed runs, no timezone, no overlap control | L |
| 39 | **Make the webhook trigger real** — public route, signature verification, hashed token | A headline feature no external sender can use | M |
| 40 | **Extract per-turn state into a turn object** | Four findings caused by state spread across five maps cleaned by hand | M |
| 41 | **Split the 3,326-line step executor** along the ten phases the source names | Prerequisite for making approval a proper suspend point | L |
| 42 | **Database integration tests** — migration paths, validation symmetry, the version ledger, plus fresh-versus-upgraded comparison | The gap that let 5.10 ship | L |
| 43 | **Protocol version handshakes** | Turns silent wrong behaviour into a loud startup failure | XS |
| 44 | **Split the composition root into subsystem builders**, following the pattern the repo already uses | A 2,062-line function | M |
| 45 | Fix the un-awaited global event emissions (unhandled rejections can terminate the process); reduce the retention sweep batch from 50,000 to ~2,000 | A crash path and a measured hourly freeze | S |
| 46 | Move data-source credentials into the secret store; stop returning them from the API | Tokens in plain text, readable by a paired phone | M |
| 47 | Fix result validation to read the step's own output; honour operator skip overrides on failure branches | Validation checking the wrong text; hand-steering ignored | S |

### Phase 3 — Decisions, not code

Leaving these undecided is itself the expensive option.

| Decision | Recommendation |
|---|---|
| **The process split** | Finish it or retreat to terminal-host-only |
| **The relay** | **Delete** — and in the same change, correct the successor plan that cites the dead encryption module as evidence of protection, and remove the encryption claim from the pairing offer |
| **The SDK** | Freeze this week (one commit), then publish properly or delete and keep one wiring root |
| **Mobile** | Commit to a device build pipeline and one physical phone this cycle, or freeze and mark experimental. Initialising the build configuration unblocks two of the three blockers at once |
| **Codex / OpenCode / ACP** | Widen the schemas and implement the dropped fields, or remove them from the API and interface. **Shipping unselectable providers is worse than not shipping them** |
| **MCP** | Decide what is being claimed. If it stays a config forwarder, finish it: accept and store credentials end to end, fix the merge bug, make the picker additive, fix the two hardcoded connection strings, delete the stub package |
| **Extension code loading** | Out-of-process with human approval, or removed. There is no safe middle |

### Phase 4 — Before anyone else runs this

Log rotation. Automated backups **including the secrets directory**. Dependency and static-analysis scanning. A working container file. Fix the nginx forwarding header and the anonymous-administrator dashboard. Rewrite the operations documentation against the code, and extend the drift checker so every documented environment variable must appear in an actual read.

---

## 11. Appendix

### 11.1 Method

Ten independent reviews ran in parallel with an adversarial brief: read the source first, treat documentation as a hypothesis, verify before claiming, quantify where possible, and report what is genuinely good so effort is not misdirected.

**Two independent reviewers then audited the consolidated report** — one re-verifying claims against the code, one judging fairness, clarity and the plan. **Their corrections are applied throughout**, including several that contradicted this document.

Several findings are **measured, not inferred**: process timings were re-measured across 11 interleaved runs; the fresh-install migration failure was reproduced twice independently; database proportions come from the live 437.5 MB file; bundle sizes were computed per file.

**No file in the repository was modified during this review.**

### 11.2 What the review pass changed — recorded, not hidden

**Refuted or corrected:**

1. **The headline timing was wrong.** 2.85 s became **~1.75 s** on careful re-measurement, and the wait it explains dropped from 67% to **58%**. The expected saving from the main performance fix fell from "−2.8 to −3.3 s" to **"−1.5 to −2.0 s"**. The architectural conclusion is unchanged; the number was overstated.
2. **A critical was downgraded.** The workflow builder does *not* overwrite your work on a failed load — validation and the create-branch both block it. Now MAJOR.
3. **The desktop attack was overstated.** It is not reachable from an ordinary transcript link; those are correctly diverted to the system browser.
4. **"All four defences absent" was inaccurate** — a content security policy does exist for the app's own origin; what is missing is one set by Electron itself.
5. **The 81% database figure was a stale code comment**, repeated uncritically. Measured today: 54% for that table, 85% for both event logs.
6. **Counts corrected:** 89 mutations not 96 (84 unhandled, not 93); 39 allow-list entries not 41; 43 bridge handlers not 40; 17 transaction sites not 4; ~55,600 test lines not ~40,000; the highlighting pair is 57% of app JavaScript, not 51%.
7. **A row was removed from the "comment lies" table** — the mobile hardware-key claim is honestly documented as conditional, and including it was unfair.
8. **The database savings were double-counted** — 70% plus 30% are steps one and two of one recommendation, not two wins.
9. **A plan item was destroying the input of another** — deleting streamed text removes exactly the data chat crash recovery needs. Resequenced.
10. **Three criticals had no action item at all** and now do.
11. **An earlier draft praised script upload as correctly gated.** The point is that the gate guards the wrong door.

**One conflict resolved:** two reviews appeared to disagree about a defeated component optimisation. **Both were right** — they were different components. The live timeline's is defeated; the settled transcript's holds.

**One disagreement left open:** whether the desktop pairing grant is actually redeemable by an attacker page, given that completing pairing is restricted to loopback origins. Two reviews disagreed and it has not been settled.

**Five rows in the 8.1 table could not be re-quoted verbatim** and are marked as such rather than dropped.

### 11.3 What this review did not cover

- No fixes were applied. This is analysis only.
- The application was not driven in a browser during this pass; findings come from code reading, targeted measurement, and analysis of the live database.
- Timings are from this machine and Windows. Process creation is substantially cheaper on Linux, so the 58% figure is a Windows-weighted case — though the architectural conclusion holds anywhere.
- The individual reviews contain roughly 5,600 lines of further detail, including about 130 findings below critical severity not reproduced here.

### 11.4 Source reports

`01-chat.md` · `02-workflows.md` · `03-automations.md` · `04-harness-mcp.md` · `05-performance.md` · `06-data-durability.md` · `07-architecture.md` · `08-web-frontend.md` · `09-clients.md` · `10-security-ops.md`
