# V2 Architecture Overhaul — Independent Re-Audit & Remaining Work

**Date:** 2026-08-29 · **Branch:** `arch-redesign`
**Plan of record:** [ARCHITECTURE_V2_MASTER_PLAN_FINAL.md](ARCHITECTURE_V2_MASTER_PLAN_FINAL.md) (REV3)
**Supersedes the status claims in:** [V2_IMPLEMENTATION_TRACKER.md](V2_IMPLEMENTATION_TRACKER.md)

---

## Why this document exists

Six independent, adversarial, code-grounded audits were run in parallel — one per
phase group — with a single instruction: *treat every "✅ Complete" in the tracker
as an unverified claim and check it against the source.* Every finding below cites
`file.ts:line`.

**The headline result:** the tracker's own warning about itself was correct but far
too generous. The audits found that the pattern it caught once — marking a phase
complete while it contained dead-on-arrival code — is the rule across Phases 2–6,
not the exception.

| Phase | Tracker says | Audit finds |
|---|---|---|
| 0 · Stop the bleeding | ✅ Complete | (see §7) |
| 1 · Stream spine | ✅ Complete | (see §7) |
| 2 · Provider port | 🟡 Partial | **1 of 12 items DONE**, 9 PARTIAL, 2 FAKE |
| 3 · Process split | 🟡 In progress | 2 of 7 DONE; **W12's four named mechanisms are all dead code** |
| 4 · Native hosts | ✅ **Complete** | **0 of 6 items DONE**; all PARTIAL or MISSING |
| 5 · Client rebuild | 🟡 Partial | **1 of 7 items DONE** (W28); W30-b MISSING, W30-d FAKE |
| 6 · Durability | 🟡 Partial | **2 of ~20 requirements DONE**; `withEffect` has zero production callers |
| 7 · Guardrails | ✅ Complete | (see §7) |

Three recurring failure modes explain most of it:

1. **Built but never wired.** `SessionDemux`, `RuntimeSupervisor.runRecyclePass`,
   `TransportCapabilities`, `withEffect`, `Signal`, `trackWorktree`,
   `BrowserHostClient`, `CuaHostClient`, `usage_ledger`, `pruneWorktrees`,
   `PtyHostClient.ack` — all real code with **zero production callers**.
2. **A test that asserts a copy of the logic, not the logic.**
   `truncation-guard.test.ts` imports only `vitest` and tests re-implementations
   pasted into the test file. Deleting the real fail-closed gate leaves it green.
3. **A protocol invented rather than adopted.** The ACP inbound adapter negotiates
   version `'0.2'` against a spec whose version is the integer `1`, using method
   names that do not exist. A real editor disconnects on the first message.
4. **The assertion reads something *adjacent* to the thing under test** — and
   adjacent things are usually true, so the test is green from birth. This is
   failure mode 2's disease in its general form, and it recurred **three times
   in a single day** while fixing the issues in this very document:
   - a `MultiHarness` test read the last call across create-*or*-resume, so it
     kept picking up the setup `createConversation` (which carries no model)
     instead of the `resumeConversation` under test — green against the
     unfixed code;
   - a TTS unit suite mocked the one call that always threw, so Kokoro was
     **entirely non-functional** behind a fully green suite;
   - a live "did the agent answer?" check matched the word *compiler* — which
     appeared in the prompt the tester had typed — and reported a dead turn as
     a pass.

   A fifth instance, from the same day, with a different shape: a scripted
   string-replace edit to an analyzer printed `added model-rejection
   assertion` while its search string had silently matched **nothing** (an
   escaping slip turned a literal `\n` into a real newline). The analyzer then
   ran *without* the new check and reported 5/5, which very nearly read as
   success. **"The script said it worked" is not evidence the script worked** —
   caught only because an expected PASS line was missing from the output. Use
   an edit that errors when its anchor does not match.

   **The defence, and it is cheap:** run every new test against the *unfixed*
   code and require it to fail **for a reason you predicted in advance**.
   Predicting the reason is the part that works. The `MultiHarness` case was
   caught only because two failures were expected and one arrived — the
   discrepancy was the sole signal that a test was passing for free. A test
   that has never been observed failing is not evidence of anything.

---

## 0-A. ⛔ ADVERSARIAL REVIEW OF THE IMPLEMENTATION — READ BEFORE TRUSTING §0

Six parallel implementation agents closed the items in §0. Six independent
adversarial reviewers were then pointed at the resulting diff (328 tracked
files, +50k/−9k, ~149 new files) with one instruction: *find what is wrong*.

**They found ~16 BLOCKERs and ~60 MAJORs, nearly all with executed reproducers.**
The suites do not catch them: providers 491/491, core 1320, web 347,
client-core 225 were all green while every defect below was present.

This does not mean the work is worthless — large parts were attacked and held
(each review lists them). It means **§0 describes what was built, not what is
correct**, and the gap between those two is exactly what this project keeps
rediscovering. Do not ship on §0 alone.

### ✅ STATUS: all 16 blockers below are now CONFIRMED and FIXED

Five independent agents each verified their assigned blockers against the
source before changing anything, wrote a regression test that **failed against
the pre-fix code**, then fixed it. Every claim in the list below was confirmed —
**none were refuted** — and several turned out to be worse than reported (see
the per-area notes). Repo state after the pass:

| Gate | Result |
|---|---|
| `turbo typecheck` | **49/49 tasks** |
| `turbo test` | **30/30 tasks · 5,257 tests · 0 failures** |
| Live browser E2E (`subsystems-live`) | **22/22** |
| Live streaming turn, Claude harness, real browser | **passing** |

Nothing is committed. HEAD remains `4a6d579`.

**Two flaky-under-load tests are NOT regressions** — they pass in isolation and
fail only under full parallel fan-out, because they drive a real Chromium, a
real PTY or a TUI render against a wall-clock timeout:
`HarnessRegistry — the disk cache is written atomically` (3/3 green isolated),
`apps/browser-host` context tests, `PtyHostAdapter` retry, and the CLI TUI pane
split. Re-run the package alone before treating one as a blocker;
`turbo test --concurrency=3 --continue` avoids them.

### The blockers, by area

**Durability (the effect sandwich)**
- Pause→resume **silently skips the continuation turn** for any mutating stage: the op id does not include the resume discriminator, so `withEffect` writes a synthetic settlement and the stage completes on truncated output. Durable, so every later resume replays the skip.
- The exit-criterion test **fabricates a recovery the code never performs** — `simulateRestart` clears `currentStep`; `StartupRecoveryService` never does. The headline assertion passes trivially in production.
- A **sealed artifact hands successors the output validation just rejected**; the retry's append silently returns `null` and every call site discards it.
- `releaseJournal` runs **before** the terminal status write, so a crash in that window re-runs the final prompt and its tool calls.

**Process model**
- One throwing `process.send()` **parks the pump permanently** — `session_ended` is stranded and the turn never settles.
- `HostSupervisor.restart()` leaves **two live agent-host processes** and detaches the supervisor from the survivor.
- A recycle **silently destroys an in-flight turn and the conversation's entire history** (`CreateConversationParams` carries no resume field), while the gateway still believes the session is live.

**Providers**
- W34's binding is **never persisted**: migration 44's six columns have no writer and no reader, so five of seven fields do not survive a restart.
- That migration also back-fills every legacy row at the **highest** trust level (`'explicit'`), making the promotion rules unreachable for exactly the rows they exist for.

**Browser / WebCodecs**
- VP8 has **no keyframe recovery** and three paths drop chunks (including a new hidden-tab drop *before* decode) → permanently frozen live view, no error, no log. A test cements the drop as intended.
- The X-15 integrity latch is **not one-way**: it lives on `SessionRecord`, and stop / idle-sweep / crash all recreate it — including via the exact "restart the driver" remedy the refusal text recommends.

**Clients**
- Two-phase Stop is **single-phase on web**: the first press settles locally, so `arming`/`stopping`/`force` are unreachable and the 15 s Force-reset — the entire point of W30-b — is dead code. Mobile is correct; the asymmetry is the proof.
- `MuxStreamClient` resets backoff **before the stream attaches** → a ~1/s reconnect storm forever on mobile, never giving up.
- `ENFORCEMENT_PROOFS` is a raw substring grep: three fields already pass on a *describe-title* mention, and `'asserts'.includes('sse')` is true.
- The proof map is per-field while enforcement is per-surface, so **56 of 70 claims are unproven** — and four are contradicted by shipped code (CLI does use WebSockets, does render a terminal pane, does bind keyboard shortcuts).
- `MOBILE_CAPABILITIES.fileAttachment: enforced(true)` while mobile **cannot attach a file at all** — no `onAttach` is ever passed.

### Fixed during review

- **Every guard script was dead in CI.** `globSync` from `node:fs` is Node 22+; CI pins Node 20, so all three checkers threw at import, and because they sit in one `&&` chain, none ever ran. Replaced with a pruning walk (`scripts/lib/globFiles.mjs`) that works on the declared floor. This is the second time these guards were found to be non-executing.

### ⛔ Found only at runtime: the Claude harness was silently replaced by Copilot

**This is the most serious defect of the whole pass, and no suite could have
caught it — it took running the real app in a real browser.** 5,257 unit tests
and 22/22 subsystem E2E tests were green while it was live.

**Symptom.** A chat created on `claude-agent` produced no answer at all, and the
server then shut itself down. From the log:

```
[MultiHarness] conversation chat-63a4… → 'claude-agent' (model=default)
[ChatRoutes]   Prompt submitted for chat 63a4…
[MultiHarness] conversation chat-63a4… moving 'claude-agent' → 'copilot' (model=auto)
[Server]       EVENT LOOP WEDGE DETECTED — main loop has not ticked for ~5431ms
CopilotClient.createSession → Cannot read properties of null (reading 'sendRequest')
[Server]       fatal:wedge-detected received; graceful shutdown initiated
```

**Root cause.** `'auto'` is a provider-agnostic *sentinel* meaning "you pick the
model" — and every vendor spells it differently. Confirmed against the live
catalogs:

| Provider | Sentinel | Lists `auto`? |
|---|---|---|
| copilot | `auto` | **yes** (28 models) |
| claude-agent | `default` | **no** (5 models) |

The web composer's default model is `'auto'`, and the chat model picker never
sets `harnessType` (only the agent editor does). `MultiHarness.resolveTarget`
consulted `params.model` and **never the conversation's existing binding**, so
`resolveProviderForModel('auto')` answered "copilot" — not because the user
chose Copilot, but because Copilot happens to spell its sentinel that way.
`resumeConversation` then took the "user picked another provider's model" branch,
**destroyed the live Claude session**, and started a Copilot one. Copilot was not
connected, so `createSession` dereferenced a null client, blocked the event loop
past the 5 s wedge threshold, and the (correctly working) wedge detector took the
server down.

This fired on **every prompt of every claude-agent chat**, not just during the
registry's 22-second post-boot refresh window — the sentinel mismatch is
permanent. The refresh window is a second, independent trigger: while it runs,
only providers already marked `ready` are considered, so a slow-to-report
provider loses every race it should have won.

**Fix** (`packages/agent-harness-providers/src/MultiHarness.ts`):
1. Sentinels (`auto`, `default`, `inherit`, empty) are excluded from provider
   resolution entirely — they carry no routing information.
2. `resolveTarget` now takes the conversation's current owner. A model-catalog
   lookup may **confirm** an established binding, never override it. Moving a
   live conversation is destructive (the provider session is torn down), so it
   now requires an explicit `harnessType` / `providerInstanceId`.
3. The recovery path (`ChatManagementService.ensureConversation` →
   `createConversation` with the same id) is protected identically — that was
   the path that produced the null-client crash.

Model-driven routing for **new** chats is unchanged, so a deliberate provider
switch still works.

**Regression test:** `MultiHarness.bindingStability.test.ts`, 7 cases —
**5 fail against the pre-fix code** (the 2 that pass are the ones pinning
preserved behaviour, which is the point).

**Verified live, end to end, on the Claude harness:** a real prompt carrying
`model: 'auto'` — the exact value that used to destroy the binding — returned
`alpha bravo charlie`; the log shows **zero** provider moves; the server stayed
up. The browser-level live streaming test passes in 24.1 s.

**The second half, found by the joint live run — also fixed.** Excluding
sentinels from *routing* was necessary but not sufficient: after resolving
correctly to claude-agent, the literal string `'auto'` was still handed to it
as the model name, and it rejected it:

```
[ClaudeAgentAdapter] Background query failed for chat-bddd6514-…:
Claude Code returned an error result: There's an issue with the selected
model (auto). It may not exist or you may not have access to it.
```

Zero `harness.token` events, no answer — **the same user-visible "no output at
all" symptom as the routing bug, one layer further down.** The same hole is
reachable without a sentinel: because an established binding now outranks a
model inference, a claude-agent chat carrying a stale Copilot-only id
(`gpt-5.5`) keeps its binding and would be handed that foreign id, failing
identically. Keeping the binding is right; passing the foreign name with it is
not.

Fix: `withModelSupportedBy(target, params)` drops a model the target's catalog
does not contain, at all five adapter handoff points, letting the provider use
its own default. Dropping rather than translating is deliberate — omitting the
field is exactly the path a new chat with no model already takes, so it is
known-good, versus a mapping table that must track five vendors' vocabularies.
It only strips when the catalog is actually *known*: an unprobed provider
reports an empty catalog, and treating that as "offers nothing" would strip
every legitimate model during the boot window. Copilot still receives `'auto'`,
which is a real model in its catalog.

Regression tests: 5 more cases in `MultiHarness.bindingStability.test.ts`
(12 total), **2 fail pre-fix**. One of those tests initially passed for the
wrong reason — the helper read the setup `createConversation` call instead of
the `resumeConversation` under test — so it is now split into `modelOnCreate` /
`modelOnResume`, with that trap recorded in the helper's comment.

**Verified live on the peer's exact repro:** a chat created with `model: 'auto'`
on a `HARNESS_TYPE=claude-agent` server answered `delta echo foxtrot`; the log
shows the sentinel dropped with an explicit reason, **zero** provider moves,
**zero** model-rejection errors, and no wedge.

**Then verified on the full default chain, jointly — 8/8 + 7/7.** The two
fixes above had only ever been checked *separately*: the read-along run used an
explicitly-set real model (`sonnet`), so the stripping path never engaged, and
the stripping run stopped at the API and never reached read-along. The
configuration real users actually hit is the one neither had covered — the
composer defaults to `auto`, so the default path is
*sentinel → strip → provider default → token stream → `harness.token`
subscription → Kokoro*. Run end to end on a `claude-agent` server:

- Kokoro spoke on a sentinel chat: **45 PCM frames during the turn**, first at
  +11.3 s, markers `ready` / `sentence` / `sentence`, live `sent:speak_stream`
  frame (not plain speak).
- **No timing regression:** first PCM at +11.3 s on the sentinel path vs
  +10.6 s on `sonnet` — one sample each, well inside first-token noise. The
  strip runs before `createConversation`, and the instrument agrees.
- All 7 log assertions passed, including the two new ones: no
  `issue with the selected model` rejection, and the strip line present.

Both new assertions were themselves replayed against the **pre-fix** log and
both failed there for their predicted reasons — so they are not passing for
free. (See recurring failure mode 4.)

**Blast radius — one surface not yet re-verified.** Anything that subscribes to
a session's live `harness.token` stream was reading from whichever provider the
conversation had been yanked onto. The known consumer is `speakStream(sessionId)`
(`apps/web/src/components/chat/StreamingMessage.tsx:106`), the read-along TTS
path: with the pre-fix binding, a claude-agent chat rebound to Copilot mid-turn
would have had read-along go silent, or speak output from a session the user
never asked for — silently, because the hook simply waits for frames that never
arrive. That path has now been verified in a browser against a real
streaming turn by the session that owns it: read-along passed 8/8 — the control
appeared during streaming, the socket opened, and `sent:speak_stream` was used
(the live frame, not plain speak), with Kokoro streaming 41 PCM frames DURING
the turn and `ready` / `sentence` / `sentence` markers arriving in order.

Worth knowing for any future E2E of that path: **read-along only speaks tokens
that arrive AFTER it subscribes — it cannot replay what already streamed.** A
prompt whose answer finishes before the control is clicked yields `ready` and
then silence, which looks exactly like a TTS failure and is not one. The test
prompt has to be long enough that tokens are still flowing at click time.

### Also found at runtime (lower severity)

- **The UI named the wrong vendor.** The chat empty state read *"Type a message
  below to chat with Copilot"* and the new-chat dialog *"Start a new conversation
  with Copilot"* — hardcoded, regardless of `HARNESS_TYPE`. A self-hosted user on
  claude-agent was told they were talking to a provider they had not configured.
  Both now derive from `useHarnessConfig()` / `providerLabel()`; verified live,
  the page now reads *"chat with Claude Code"*.
- **Composer blocked behind the catalog refresh — FIXED.** For ~22 s after every
  restart the chat showed *"Loading available models…"* and could not be typed
  into at all.

  `ChatInput` holds a skeleton while `useModels()` is pending, and that query is
  backed by `GET /api/harness/providers`, which `await`ed
  `harnessRegistry.refresh(false)`. That reads as "cached", but the freshness
  window is 5 minutes while `loadDiskCache()` restores each provider's
  `checkedAt` from the **previous process** — essentially always older than
  that. So the first request after every boot failed the freshness check and
  blocked on a full cold probe, which spawns each provider's CLI.

  The registry already had everything needed to avoid this — `getStatuses()` is
  a synchronous read, `requestRefresh()` is fire-and-forget, and the disk cache
  exists precisely so "a cold boot returns stale-but-useful data instantly
  rather than blocking". The route simply wasn't using any of it. It now serves
  the cached snapshot immediately, kicks off a background refresh, and returns
  `stale: true` so the client polls at 3 s until the live catalog lands instead
  of sitting on its own 5-minute `staleTime`. `?refresh=1` still forces a real
  blocking re-probe, because the Providers settings tab's refresh button means
  "go and actually look". It blocks in exactly one case: a genuinely first-ever
  boot with nothing cached, where answering instantly would mean answering with
  an empty catalog.

  **Measured on a real cold boot:** first `/api/harness/providers` call
  **0.23 s** (was ~22 s), full catalog served (copilot=28, claude-agent=5);
  composer typeable in **1.35 s**, with the skeleton never rendering at all,
  and typing verified to work. Regression test:
  `apps/server/src/__tests__/harnessProvidersNonBlocking.test.ts`, 5 cases,
  **3 fail against the pre-fix route** (the 2 that pass pin the two behaviours
  that had to be preserved). The blocking case is asserted by measuring the
  response against a deliberately slow stub, not by trusting a spy.
- **The Dashboard's stat cards were mouse-only — FIXED.** `Card` renders a plain
  `<div>`, and `StatCard` / `HealthStatCard` passed `onClick` to it with no
  `role`, no `tabIndex` and no key handler. The Chats / Workflows / Automations /
  Health cards are the primary navigation into those lists, so they were
  unreachable by keyboard and invisible to assistive tech (and to
  `getByRole('button')`, which is how the E2E pass found them). `EntityCard`
  already had the correct pattern; these two simply weren't using it. Both now
  do. Test: `statCardAccessible.test.tsx`, 5 cases, **4 fail pre-fix** — the
  fifth pins that a non-clickable card must NOT claim to be a button.

- **A completed run did not replay its answer — FIXED.** Reload a finished
  workflow run and the stage timeline showed the prompt but nothing for the
  assistant's answer. `deriveRunView` built `answer` from
  `deriveAnswer(stream?.blocks)` alone, and `streams` is the live stream store,
  which only holds blocks the *current* browser session received over SSE. After
  a reload it is empty. The text was never lost — it was in the database, but
  only reachable via Details → Inspector → Output. Now falls back to the
  persisted `outputText` once a stage is terminal; deliberately not while it is
  still running, since `outputText` isn't written until the stage settles and
  showing it mid-run would present a stale result as final. Test:
  `completedRunReplaysAnswer.test.ts`, 5 cases, **2 fail pre-fix**.

- **A failed templates fetch was rendered as "No templates found" — FIXED.**
  `TemplatesSection` destructured only `{ data, isLoading }`, so an error fell
  through to the empty state and told the user the catalog was empty rather than
  that loading it had failed — with no way to recover. `useTemplates` sets
  `staleTime: Infinity` and nothing invalidates it, so inside a mounted settings
  modal that wrong answer was also a permanent one. It now renders a distinct
  error state with a Retry button. **The transient cause is still unexplained**
  (observed twice under heavy parallel load while `/api/templates` answered 200
  on 40/40 direct requests) — this fix makes the failure legible and
  recoverable, it does not claim to remove it. The global
  `retryUnlessClientError` policy was left alone: not retrying a 4xx is correct.

- **~5 s event-loop stall at boot**, in the startup-recovery window
  (`[WorktreeCleanup] Running startup recovery` / retention sweep / system-artifact
  load). It trips the wedge detector's warning. Distinct from the fatal wedge
  above, which is fixed. Consistent with the known sync-I/O sites the ratchet
  script tracks. Not fixed.

### The SIGSEGV — root-caused and cleared

**Resolved. It was never `node-pty`, and live browser E2E is no longer blocked.**

The symptom: the server exited 139 during the live E2E run, consistently after
the terminal tests, with no catchable exception and no Windows Error Reporting
event, and it never reproduced in isolation.

Two diagnoses were proposed. The first — mine — was that the disk filling to
100% had truncated the ONNX voice models, and that onnxruntime crashed natively
loading them. **That was wrong**, and it is recorded here because the reasoning
error is worth keeping: an ONNX model on disk is a small `.onnx` graph plus a
large `.onnx_data` weights blob, so a file being *larger* than a size named in
the graph header is the normal external-data layout, not evidence of damage.
Truncation makes files smaller. The models were intact and loaded fine
(Parakeet 3742 ms, Moonshine 2011 ms, Kokoro 6199 ms, Silero — 12/12 live
checks with correct transcripts and real audio out).

The actual cause, proven with an isolated probe by the session that owns the
voice module: **`onnxruntime-node` 1.21.0 supports exactly one ORT thread per
process.** A second ORT session anywhere in the process segfaults it — exit 139,
`FATAL ERROR: v8::HandleScope::CreateHandle()`, no exception, no WER event.
Both main-thread + worker and worker + worker reproduce it.

This explains every observation the truncation theory handled badly: the
silence (a native abort, not a throw), the timing (the voice warm-up window,
which merely *overlapped* the terminal tests), and the non-reproducibility
(a single-ORT-session probe cannot trigger it). The terminal correlation was
coincidence — a mature server past warm-up now passes every terminal
operation, including chat-delete with live PTYs.

**The constraint this leaves on the architecture:** all voice inference must
stay funnelled through the single shared `VoiceWorkerPool` worker (heavy
ASR/TTS queue plus a separate VAD queue). Any design that can put two ORT
sessions live in one process is invalid and will crash exactly this way.

The adjacent terminal findings (no backpressure with zero viewers, a watermark
clamp that can hard-freeze, chars-vs-bytes credit drift) are **still real and
still open** — they were simply not the cause of this crash.

---

## 0. What this pass actually closed

Five parallel implementation agents plus direct work. Every item below is
verified: build, typecheck, lint and the relevant suites are green, and each
fix carries a regression test that fails against the pre-fix code. Nothing is
committed — it is all in the working tree.

**Repo health at the end of this pass:** `pnpm turbo build` 29/29 ·
`pnpm turbo typecheck` 49/49 · `pnpm lint` **0 errors** (now including the two
security guards and the new doc-drift check, none of which had ever run in CI) ·
`pnpm turbo test` 29/29, **~4,513 tests passing** · live browser E2E **21/21**.

### The six confirmed P0s — all closed

| # | Defect | Fix |
|---|---|---|
| P0-a | Approved HITL stage became a permanent zombie after restart | `HitlService.resume()` now branches on whether the in-process stage frame survived: live frame → `running` (unchanged); no frame → `pending` **plus** an awaited re-drive, `pending` being the only status the DAG scheduler accepts. A post-restart verdict is replayed to the relaunched stage instead of re-asking the human. The false claim in the file header is gone. **12 new tests.** |
| P0-b | P0-41 "automations lose work silently" still fully reproducible | New `AutomationService.resumeExecution()` — the post-restart caller the durable-iteration machinery never had. `AutomationRecoveryService` now consults it *before* finalising, passing still-live iterations so they are not run twice. **5 new tests**, the first of which pins the original defect. |
| P0-c | Durable iteration claims had no lease and no completion write | Lease stamped in the same atomic claim `UPDATE`; new `completeIteration` called from a `finally` on every exit path; `reclaimExpiredIterations` also rescues slots claimed by the pre-lease build. **8 new tests.** |
| P0-d | Deleting a chat leaked Chromium, PTYs, the CUA session, rows and the tree | `deleteChat` now runs the real workspace teardown first, guarded by the same shared-workspace ownership check `archiveChat` uses. **7 new tests.** |
| P0-e | P0-36 worktree pruning was fixed into unreachable code | `WorkspaceManager` now reads the table `WorktreeService` actually writes (unioned with the legacy one, de-duplicated by resolved path) and calls `IGitClient.pruneWorktrees`, which had zero callers. Tracking-table paths go through containment resolution before reaching `git worktree remove --force`. **23 new tests** — there was no `WorkspaceManager` test at all. |
| P0-f | Unbounded screenshot file leak | Every rejection gate now runs on the file the driver wrote, *before* transcode replaces and deletes it. New invariant, enforced on every path: returning without an artifact means the capture file is gone and `shot.path` names nothing. A fourth leak (throwing `artifactRepo.create`) was found and closed. **54 new tests.** |

### Also closed

- **A silent, unbounded hang on the default path.** `new Semaphore(NaN)` — from a typo'd numeric env var — passed the `<= 0` guard and then never granted a permit, so **every workflow stage waited forever with no error and no log**. Independently present for every computer-use action. `Semaphore` now rejects a non-finite count at construction; new `readBoundedInt` parses, clamps and audits, and cannot return one. Applied to admission, computer-use, terminal, voice and browser config. **20 new tests.**
- **W18's headline acceptance criterion, which its own wiring defeated.** The admission permit was held across HITL waits, so 8 stages on approval consumed the whole `ordinary` lane — verbatim what the criterion forbids. `admit()` now hands the task a ticket that yields both permits across the wait. Plus dynamic lane sizing with the active bound logged, config clamps, a queue-wait timeout, INFO-on-queue, and `{cap, running, queued, parked}` published on `/api/health`. **23 new tests.**
- **Two security holes.** Widget assets served `.svg` with **no CSP at all** — a model-authored scripted SVG executed unrestricted on the widget origin; and the route injects a `<base href>` that widget script could override. Now every response carries a policy, plus `base-uri`/`object-src`/`form-action`. Three comments that asserted the opposite of the adjacent code were corrected.
- **Five of six shell/PTY spawn sites cloned the full parent environment** into processes that run model-authored commands, leaking the vault key, the desktop admin token, `DATABASE_URL` and every provider credential. The correct allowlist builder existed but lived where the terminal hosts could not import it; promoted to `@generatorai/shared` and wired into all of them. **42 new tests**, and the 32 existing ones still pass against the shared implementation.
- **Both CI security guards had never executed.** CI ran `pnpm turbo lint`, which skips the composite script that holds them. Fixed, and the guard that would have caught the env-cloning was widened past the one package it could never have fired in.
- **Provider adapters.** 8 Codex defects (abort wedged a conversation permanently; `rpc()` never timed out or rejected; JSON-RPC errors resolved as success; `-32001` backoff unreachable; stderr uncaptured) and 7 OpenCode defects (a leaked socket per turn; model selection silently dropped; no HTTP timeouts) — both had **zero tests**; now 45. ACP's Tier-B gate was a substring denylist over model-controlled strings that **auto-approved `edit`/`delete`/`move`/`fetch`**; replaced with a fail-closed opt-in set. All five conformance suites now run against Codex, OpenCode and ACP.
- **`truncation-guard.test.ts` now tests the real code.** It previously imported only `vitest` and asserted against re-implementations pasted into itself; breaking the real fail-closed gate left it green. Mutation-verified: the same break now turns 8 of 24 red.
- **Web client.** Bounded stream store (nothing was ever evicted); visibility gating on the right-pane WebSocket paths (every hidden tab decoded frames); the terminal instance cap every other tab type already had; a genuinely sticky cache-miss ledger; `detect: true` removed from the synchronous markdown highlight path; append-only incremental parsing; per-tick invalidation de-dup; gap-fill loss surfaced instead of silent.
- **W24 arbiter.** Under the shipped default `convergenceThreshold: 1.0` a second wave was structurally unreachable, making `maxWaves` and `timeBudgetMs` dead config; convergence counted every worker ever spawned rather than the current wave; a **cancelled** worker counted as converged; wave counting was coupled to a prompt-cache flag. All four fixed.
- **Three guardrail mechanisms that were specified but absent:** the §1.P doc-drift check (caught a real drift on its first run), the fallback-counter registry with readable values (the plan's "tests assert deltas" was unimplementable against the write-only OTel API), and config clamping with an audit trail.

### A finding this pass added: the E2E suite has drifted from the UI

`agent-tests/e2e` is excluded from CI (it needs a live stack), and without a
gate it has rotted. A full live run is **60 passed / 17 failed**, and the
failures are not regressions — they are specs written against UI that has since
been redesigned:

| Spec | Expects | Reality |
|---|---|---|
| `chats.spec.ts` ×3 | `role="button"` status filters | `FilterTabs` has used `role="tab"` since the baseline commit |
| `automations.spec.ts` | a `<select>` of workflows, driven with `selectOption({label: RegExp})` — a shape Playwright does not accept | an "+ Add a workflow…" button opening a `role="listbox"`; both failures were swallowed by a `.catch()`, so the form submitted empty and failed its own validation |
| `settings-dashboard-templates.spec.ts` ×9 | Settings tabs "General/Provider/Copilot/Advanced"; a Templates nav item | Settings is a modal with "General/Appearance/Model Providers/…"; Templates is not in the nav |
| `navigation.spec.ts` ×2, `projects.spec.ts` ×2 | old nav items and tab labels | redesigned |
| `workflow-run.spec.ts` ×2 | a `Start` button on the run page | `WorkflowRunPageV2` contains no "Start" string at all |

The four in `chats.spec.ts`/`automations.spec.ts` are **fixed here** (13/13 now
pass, including the previously-failing create-automation flow). The rest are
left, deliberately: rewriting nine Settings assertions against a redesigned
modal is UI work, not architecture work, and doing it blind would just move the
drift rather than remove it.

**Every remaining failure was checked against this session's diff** — the
components they exercise are either untouched (`Sidebar`, `AppLayout`,
`ProjectDetailPage`, `SettingsRoute`, `ChatsListPage`) or received only
additive lines (`WorkflowRunPageV2`, +4). None is a regression.

The real lesson is the same one §1.P is about: **an ungated check decays into a
false claim.** A suite that nothing runs is indistinguishable from a suite that
passes, right up until someone runs it.

### Environment notes for whoever runs this next

Two things cost real time to diagnose here and will cost the next person the
same unless they are written down.

**The pinned Playwright Chromium download fails on this machine and leaves a
half-extracted directory.** Playwright refuses to start unless the exact pinned
revision is present, and a partial extraction (the executable present,
`icudtl.dat` missing) produces:

```
ERROR:base\i18n\icu_util.cc:232: Invalid file descriptor to ICU data received.
browserType.launch: Target page, context or browser has been closed
```

That reads as "Chromium does not work on this host" and was diagnosed that way
once during this work. It is not: the download is incomplete. Check
`~/AppData/Local/ms-playwright/chromium_headless_shell-<rev>/` — a complete
build is ~270 MB and contains `icudtl.dat`; a broken one is ~184 MB with only
the `.exe`. `agent-tests/playwright.config.ts` honours
`PLAYWRIGHT_CHROMIUM_PATH`, and `ServerPlaywrightHost` honours
`GENERATORAI_BROWSER_EXECUTABLE_PATH`, so either can be pointed at a known-good
build rather than blocking on a re-download.

**`@playwright/cli` cannot drive a browser under this machine's group policy.**
Installed Chrome and Edge both refuse:

```
DevTools remote debugging is disallowed by the system admin.
Headless mode is disallowed by the system admin.
```

The CLI only offers installed channels (`chrome`, `msedge`, `firefox`,
`webkit`), and its `install-browser` requires an already-open session — a
bootstrap loop with no exit when every channel is blocked. Playwright's own
*bundled* Chromium is not subject to the policy, so `@playwright/test` works
fine and is the route to use for real-browser runtime testing here.

### Not closed — and honestly so

The large items in §4 below remain: the effect sandwich (`withEffect` still has
no production caller on the turn path), WebCodecs, the ACP inbound rewrite,
W12's dead demux, W17's CUA fusion, and mobile's transport migration. Sizes
there are unchanged. Two of the six phases still have items nobody has started.

---

## 1. Detail — the admission and config fixes

| # | Sev | Defect | Fix |
|---|---|---|---|
| F1 | **P0** | **`new Semaphore(NaN)` hangs forever, silently.** A typo'd numeric env var (`GENERATORAI_ORDINARY_CONCURRENCY=eight`) parsed to `NaN`; `NaN <= 0` is false so the semaphore considered itself bounded, and `NaN > 0` is also false so `acquire()` awaited a promise nobody resolved. **Every workflow stage hung forever with no error and no log.** Same bug independently present at `ComputerService.ts:396` for every computer-use action. | `Semaphore` now throws a `TypeError` naming the cause at construction instead of deadlocking at first use (`packages/core/src/utils/Semaphore.ts:23`). New `readBoundedInt` (`packages/shared/src/config/numericEnv.ts`) parses strictly, clamps to a declared range, and records an audit trail — it cannot return a non-finite value. Both call sites migrated. **20 new tests.** |
| F2 | **MAJOR** | **W18's headline acceptance criterion was defeated by W18's own wiring.** The stage semaphore was correctly released across HITL approval waits (the P1-16 fix), but the whole `runFn` was wrapped in `admissionController.admit('ordinary', …)`, which holds its permit for the entire call. With the default `ordinaryConcurrency: 8`, **8 stages parked on human approval consumed the whole lane and unrelated runs stopped** — verbatim the failure the criterion forbids ("with 8 stages on approval, unrelated runs still progress"). Tracker marked this ✅. | `admit()` now hands the task an `AdmissionTicket` with `pause()`/`resume()`; `WorkflowRunService.launchStage` yields **both** permits across the wait, re-acquiring in a fixed order so two resuming stages cannot deadlock. Parked work is counted separately from running work. **23 new tests, including the acceptance criterion itself.** |
| F3 | MINOR | W18 required "configuration clamps with audit"; there were none. An operator could set `ordinaryConcurrency: 10000` and remove the bound entirely. | `sizeLane()` clamps every configured value into a per-lane envelope, and clamps an explicit `0` up to `1` rather than passing it to `Semaphore`, which reads `0` as *unlimited* — the opposite of what typing 0 into a cap means. |
| F4 | MINOR | W18 required dynamic sizing "from measured cost with the **active bound logged**"; lanes used hardcoded numbers. | `sizeLane()` sizes from `min(cpus, totalmem/perTaskEstimate)` clamped into `[floor, hardCap]` and reports which of the four bounds was active, logged once per lane at boot. |
| F5 | MINOR | W18 required "published depth" and a queue-wait timeout; `snapshot()` had zero callers and there was no timeout. | `/api/health` now publishes `{cap, running, queued, parked}` per lane plus any config values that had to be clamped. Queue waits time out (default 1800 s per §3.9) with `AdmissionTimeoutError`, and a permit granted to an abandoned waiter is handed back rather than leaked. INFO logged on queue, per §3.9. |

---

## 2. The confirmed P0s — as originally found

> **All six are fixed** (see §0). This section is kept as the evidence record:
> each row is what the audit found, with the `file.ts:line` it was found at, so
> the fix can be checked against the defect rather than against a summary.

These all reproduced on the **default** configuration, with no opt-in flag.

| # | Defect | Evidence |
|---|---|---|
| **P0-a** | **An approved HITL stage becomes a permanent zombie after any restart.** `resumeFromInterrupt` sets `status='running'`; `DAGScheduler.getReadyStages` skips anything not `pending`; `StartupRecoveryService` deliberately skips `awaiting_input` stages; the `/approve` route depends entirely on an in-process promise that died with the process. Nothing re-launches the stage — the run sits in `running` forever. `HitlService.ts:19-25` claims "the DAG scheduler re-picks the stage via its normal ready-stage sweep"; **that is factually false.** | `StageRunRepository.ts:190-201`, `DAGScheduler.ts:174-188`, `HitlService.ts:19-25` |
| **P0-b** | **P0-41 "automations lose work silently" is still fully reproducible** — the defect the whole durable-iteration mechanism was built to fix. `AutomationRecoveryService.recoverOne()` only *finalises*: a 1000-row batch dying at row 40 is marked **`completed`** with `completedIterations: 40`. The remaining 960 claimed slots are never re-driven, because **no recovery path calls `claimNextIteration` after boot at all.** | `AutomationRecoveryService.ts:86-161`, `AutomationService.ts:680,706` |
| **P0-c** | **Durable iteration claims have no lease and no completion write.** `claimNextIteration` marks a slot `resolved=1` = "claimed"; nothing ever writes completion back, and nothing un-claims on crash. A process dying mid-iteration loses that row permanently and indistinguishably from a completed one — so even once P0-b is fixed, the in-flight row is still skipped. | `DurableExecutionEngine.ts:664-702` |
| **P0-d** | **Deleting a chat leaks everything attached to it.** `deleteChat` never calls `deleteWorkspace`, so no `beforeDelete` listener fires: the Chromium instance, every PTY, the CUA session, the workspace row and the on-disk tree all survive. The W25 teardown path that *does* work (`routes/workspaces.ts:572`) is not the one users hit. | `ChatManagementService.ts:2440-2470` |
| **P0-e** | **P0-36 "worktrees never pruned" was fixed into unreachable code.** `trackWorktree` has exactly one occurrence in the repo — its own definition — so `workspaceWorktrees` is permanently empty and the entire removal path is dead. Real worktrees are written by `WorktreeService` into a *different* table that `deleteWorkspace` never consults. `IGitClient.pruneWorktrees` also has zero callers. | `WorkspaceManager.ts:232,323-390`, `WorktreeService.ts:70-93`, `GitClient.ts:479` |
| **P0-f** | **Unbounded screenshot file leak.** The X-15/X-16 integrity and dedup early-returns fire *after* `transcodeScreenshot` has written the new file and deleted the source, and before any artifact row is created. `pruneScreenshots` is row-driven, so it can never reclaim them; `shot.path` is left dangling at a deleted file. | `ComputerService.ts:1687,1702`, `screenshotCodec.ts:188-190` |

---

## 3. Confirmed FAKE — code whose name does not describe what it does

| Item | Claim | Reality |
|---|---|---|
| **W10** ACP inbound | "Any ACP-compatible editor can drive GeneratorAI today" | Negotiates `['0.2','0.1']`; real ACP's version is the integer `1`. Methods (`turn`, `cancel`, `shutdown`) are invented. A real client gets `-32001` and disconnects. It also **cannot stream**: it subscribes to a channel nothing publishes to. 12 tests pass only because the mock bus echoes whatever id it is handed. |
| **W45** schema generation | "Generated from pinned upstream artifacts, diffed in CI" | The generator is `content.replace(/\/\/ Schema version: .../)` — it patches a comment. The parsed schema is assigned and never used; the 70-line converter is never called. No CI diff exists. `pnpm generate:schemas`, cited by the tracker and by every "generated" file header, **is not a script in any package.json.** |
| **W22** effect sandwich | Phase 6 ✅ | `withEffect` has **zero production callers.** So do `awaitSignal`, `resolveSignal` and `recoverAwakeables`. The documented `POST /api/awakeables/:token/resolve` route does not exist. LINT-HAZ-1..4 are prose comments in the file they describe; `eslint.config.mjs` has no such rules. |
| **W29** capability ledger | "Enforced = a test asserts the runtime honours it" | Zero production importers. The test asserts object shape only — so a passing test certifies a capability the runtime does not honour, the exact inversion of the stated criterion. |
| **W30-d** high-latency block delivery | ✅ | One unread boolean field. No renderer branches on it. |
| **`truncation-guard.test.ts`** | Regression evidence for two BLOCKER findings | Imports only `vitest`. Tests local re-implementations pasted into the test file. Deleting the real fail-closed gate from `ClaudeAgentProvider` leaves the suite green. The copies have already drifted from the originals. |
| **`usage_ledger`** (migration v38) | W24 ✅ | Zero writers, zero readers. |

---

## 4. Remaining work by phase

Sizes: **S** hours · **M** days · **L** week+ · **XL** multi-week.

### Phase 2 — Providers
- Rewrite `AcpInboundAdapter` on the real SDK (integer version, real `session/*`), wire the event path, add outbound `session/request_permission`, session cleanup, one real SDK-client integration test — **L**
- L16 out-of-band host gate in pty/browser/cua hosts + per-session capability grant + audit record; replace ACP's substring denylist with an opt-in allowlist that fails closed — **L**
- Install the `PreToolUse` gate unconditionally, or make `fullToolGating` per-conversation and honest (today `acp-entry.ts` and every workflow stage bypass it while the ledger claims otherwise) — **M**
- Real generators + real pinned artifacts + CI `git diff --exit-code` + a `generate:schemas` script — **L**
- Run all 5 conformance suites against Codex/OpenCode/ACP; add the `computerUse` field three declarations omit (all three would throw today); reconcile the cancellation suite with `ClaudeAgentProvider`'s throw-on-abort, which fails its own suite — **M**
- First tests for `CodexProvider`/`OpenCodeProvider` (965 LOC, zero tests) — **M**
- 8 Codex defects (abort wedges the conversation permanently; `rpc()` never times out or rejects; JSON-RPC errors resolved as success; `-32001` backoff unreachable; stderr not captured) — **M**
- 8 OpenCode defects (a leaked socket per turn; abort listener never removed; model selection silently dropped; no timeout on any HTTP call) — **M**
- W13 never started: poison-pill downgrade, order-preserving results, late-update guard, settle-approvals-before-cancel, per-item + overall fan-out timeouts, byte cap, append-only context — **L**
- W34 full `ProviderRuntimeBinding` shape; `provider`/`api` split; a production write path for `harness_instances` (nothing writes it today, so multi-account is unreachable outside a unit test) — **L**
- W41: watcher-gated refresh, generation counter, re-keyed cache, real lazy loading (all five SDKs are statically imported at boot today) — **L**

### Phase 3 — Process split
- Put `SessionDemux`/`SessionQueue` on the live event path with real IPC backpressure — without it W12's acceptance test cannot pass — **L**
- Implement `runRecyclePass` (age 6 h, RSS 500 MB, probe gated >5 min) **and give it a timer** — **M**
- Bounded spawn concurrency inside the host (turning the host on today *removes* the cap you had) — **S**
- Session re-attach across host restart; today every session returns `SESSION_NOT_FOUND` forever after one restart — **M**
- `AgentHostClient` defects: `resumeConversation` orphans the conversation; `session_ended` is a fully dead path; restart-cap exhaustion is silent, unrecoverable, and misreported as healthy — **M**
- Decide multi-provider routing under the host (enabling it bypasses `MultiHarness`, the instance registry and the ownership store entirely) — **L**
- W19: pools split by blocking class, payload size cap + streaming fallback, memoised route policy — **M**
- W20: port-acquisition fallback ladder; conditional restart predicate — **S**
- W21: diagnostic report on trip + boot replay; an actual prober for `/api/health/loop-turn`; restart the detector worker on crash (today it disables itself silently and permanently) — **M**
- Zero tests exist for `AgentHostServer`, `HostSupervisor`, `SessionDemux`, `SessionQueue`, `RuntimeSupervisor`, `WedgeDetector` — **M**

### Phase 4 — Native hosts
- **P0-e**, **P0-d**, **P0-f** above — **S–M**
- pty-host: wire the credit acks end-to-end (`ack()` has zero callers, so any command emitting >100 KB freezes that terminal forever — P0-23 rebuilt); replace the `+=` coalesce buffer; make `tsx` a prod dependency or ship compiled entrypoints; synthesise exits on host restart; call `.stop()` on shutdown (every restart currently leaks a host process) — **M**
- Terminal: move the watermark from the connection to the session (P1-28 verbatim); exclude corpses from the global cap; headless VT model; revive path — **L**
- W15 as specified: one Chromium N contexts, declared `supportsScreencast`, single clamp, single pending slot, **WebCodecs** — D5 chose it and there are zero occurrences of it in the repo; everything is still JPEG, and transport is still selected by catching an exception (P1-33 verbatim) — **L**
- browser-host: idle auto-close never removes the context from the map, so after 10 idle contexts `create_context` refuses forever; the frame path does not reset the idle timer, so an actively-screencast context closes after 5 min (P0-25 reintroduced) — **S**
- W16: `[box=…]` hybrid snapshots (zero hits repo-wide); stop inlining the full tree in `open_browser_page`, which is the first call of every browser loop — **M**
- W17 CUA: fused single-driver-round-trip path (today a click with capture is 6 round trips through a temp-file PNG), policy ladder relocation, integrity latch, per-model pixel budgets, official computer tool type — **XL**
- **cua-host must not be wired as-is:** its protocol carries no app/window addressing, so it resolves "whatever is frontmost" per action — the exact hazard `IComputerBridge` was designed to prevent ("the user approves Safari and the click lands in 1Password"). This is a protocol design defect, not a scope decision — **L**

### Phase 5 — Clients
- Wire `TransportCapabilities` into ≥1 real runtime decision per surface; add the missing `MOBILE_CAPABILITIES`; replace the shape-only test — **M**
- Move markdown highlighting to a worker and drop `detect: true` from the chat path (still synchronous on the main thread) — **M**
- Make `IncrementalMarkdown` genuinely append-only (it re-scans the whole buffer every token) — **M**
- CSS containment per D8, or restore find-in-page/tab-order/a11y that the pure JS windowing currently breaks above 80 messages — **M**
- Bound `streamStore.streams` — nothing is ever evicted; every session's full block array is retained for the tab's lifetime — **S**
- Visibility gating on the RightPane WS paths: every tab keeps a live socket and decodes frames while invisible (P1-50 verbatim) — **S–M**
- `maxInstances` on the terminal tab — every other tab type got one; terminals, the one uncapped WebGL consumer, did not (P2-54 verbatim) — **S**
- Sticky `reportedCache`; correct token field; price from the message's own breakdown; port to CLI + mobile — **M**
- W30-b two-phase Stop + activity channel — never started — **L**
- Mobile → mux transport, plus the missing `global`-scope subscription (mobile list screens have no live events at all today) — **M**
- Unify the three event-routing implementations (W26's acceptance criterion) — **L**

### Phase 6 — Durability
- **P0-a**, **P0-b**, **P0-c** above — **M**
- Wire `withEffect()` into `executeStage` (prompts, tool calls, hooks) + per-tool `ReplayPolicy` — this is the whole of W22's value and the only thing that makes the exit criteria testable — **L**
- Suspension: a parked gate must release the stage frame and the agent session, not hold them — **L**
- Fix the W24 arbiter: **under the shipped default `convergenceThreshold: 1.0`, a second wave is structurally unreachable**, so `maxWaves` and `timeBudgetMs` are dead config. Also: convergence is computed over every worker ever spawned rather than the current wave; a **cancelled** worker counts as converged; wave counting is coupled to a prompt-cache flag — **M**
- `entries`-backed artifacts with `append`/`lastChunk`; move stage results out of messages (X-25) — **M**
- Incremental DAG frontier — `hashDefinition()` SHA-1s every stage and edge on every completion (P1-19) — **M**
- X-13 lineage, X-21 fresh scheduled sessions, G15 capability inheritance — untouched — **M**
- `usage_ledger` writer/reader, or drop the table — **S**
- Real `scripts/check-durability-invariants.mjs` for LINT-HAZ-1..4 (two working examples of this exact pattern already exist in `scripts/`) — **S**
- `withEffect` settlement is two un-transacted writes; `entries` has no unique index for safe replay; `registers`/`entries` have no retention — **S**

---

## 5. Guardrails (PART 11) and benchmarks

**PART 11.1 — 12 rules, each with a required enforcement mechanism.** Before this
work, **2 of 12** were actually enforced. Now **9 of 12**:

| Rule | Mechanism | State |
|---|---|---|
| Shared code cannot import the web framework, Electron or the DB driver | layering lint | pre-existing, real |
| A new capability field must be classified enforced or aspirational | capability-ledger test | pre-existing, narrower than the rule reads |
| Documentation matches code | `scripts/check-doc-drift.mjs` | **added** — caught a real drift on its first run |
| Every expensive fallback increments a counter | `telemetry/fallbackCounters.ts` + tests asserting deltas | **added** — the OTel API is write-only, so this keeps a readable tally beside it |
| Every tuning constant carries its measurement | config clamping with an audit trail (`readBoundedInt`) | **added** |
| No `stream.on('data', d => other.write(d))` | ESLint `no-restricted-syntax`, `error` | **added** — current violations: 0, so it can be a hard error |
| No new synchronous FS/process call on the event loop | ESLint `warn` + `scripts/check-sync-io-budget.mjs` | **added** — a genuine shrink-only allowance (see below) |
| Protocol schemas are generated and diffed | CI "delete, regenerate, diff" with an artifact-hash assertion | **added** |
| Every risky optimisation has an env kill switch | naming convention + registry test | partial |

Still unwritten: the bare-numeric-constant lint for hot-path files,
disposables-registered-at-creation, and the no-granting-by-negation membership
lint.

**On the shrink-only allowance.** §11.1 asks for the sync-IO rule to be a
"tripwire with a shrink-only allowance", not a hard failure — and that wording
matters: there are ~30 existing synchronous call sites, most of them defensible
boot-time reads. Failing the build on all of them would realistically get the
rule deleted rather than the calls fixed. So the ESLint rule is a `warn` and
`check-sync-io-budget.mjs` supplies the teeth: it counts the warnings and fails
when the count goes **up**, naming the files that grew. New synchronous IO is
rejected; the existing sites ratchet down as people pass through them.

**PART 11.2 — 7 benchmarks.** One exists (`packages/db/__benchmarks__`), and it
runs *in* CI, which the plan explicitly said not to do: its own comment records
that the per-event budget had to be inflated 50× to survive shared runners, so
the measurement it was built to make is no longer meaningful.

---

## 6. Honest summary

The V2 overhaul contains a large amount of real, well-reasoned, working code — the
audits confirm that repeatedly and item by item. Phase 0, Phase 1 and Phase 7's
security items hold up. `FauxProvider`, the ACP *outbound* client, the child-process
reaper, `AgentStagingService`, the G1–G13 plumbing, W28's bundle budget, run
identity (X-24) and the migration ledger are all genuinely delivered.

This pass closed all six P0s, roughly forty catalogued defects below P0, two
security holes, and three of the missing guardrail mechanisms — each with a
regression test, with the full suite and a live-browser E2E run green.

But **the overhaul is still not complete.** What remains is roughly thirty
unstarted or partially-started plan requirements, several sized in weeks: the
effect sandwich (`withEffect` still has no caller on the turn path, so a stage
interrupted by a restart still re-runs from the top), WebCodecs (everything is
still JPEG, and transport is still selected by catching an exception), the ACP
inbound rewrite (it speaks a protocol no real editor does), W12's dead demux,
W17's CUA round-trip fusion, and mobile's transport migration.

Marking the overhaul done today would repeat, at smaller but still real scale, exactly the failure
this document was commissioned to find.
