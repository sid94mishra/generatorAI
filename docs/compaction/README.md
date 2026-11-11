# Conversation compaction, and the provider upgrades that go with it (2026-11-09)

Branch: `arch-echancement`. Two owner requests, done together because the second changes the APIs the first is built on:

1. **Compaction.** Compact a chat from the composer, and make every provider's own automatic compaction visible and
   correct (gauge, transcript, handoff to another provider).
2. **Provider upgrades.** Every agent SDK and CLI we ship, at its latest version, with the changes researched first.

Order: research → upgrade the providers (one commit each, tests green) → compaction on the upgraded SDKs → release,
install, end-to-end in the installed app.

## 1. What compaction is, per provider (researched 2026-11-09, pinned versions)

Every provider summarises the conversation so far and continues the same session with the summary in place of the
history. None changes the session id. All bill a model call.

| Provider | Manual trigger | Instructions | Auto compaction | Events | Before/after tokens |
|---|---|---|---|---|---|
| Claude Agent SDK | prompt `/compact [instructions]` (a turn) | yes | on by default; threshold from `getContextUsage().autoCompactThreshold` | `system/status compacting`, `status compact_result success\|failed`, `system/compact_boundary {trigger, pre_tokens, post_tokens?}`; hook `PostCompact.compact_summary` | pre, post (when present) |
| Codex app-server | `thread/compact/start {threadId}` → `{}`, runs as a turn of kind `compact` | no (config `compact_prompt` only) | `model_auto_compact_token_limit` | `turn/*`, item `contextCompaction` started/completed (`thread/compacted` deprecated) | none — next `thread/tokenUsage/updated` |
| Copilot SDK | `session.rpc.history.compact({customInstructions?})`, resolves when done (experimental) | yes | `infiniteSessions` (background at 80 %, blocking at 95 %) | `session.compaction_start`, `session.compaction_complete {success, error?, preCompactionTokens, postCompactionTokens, summaryContent?}` | pre, post |
| OpenCode | `POST /session/{id}/summarize {providerID, modelID}` (v1, sync) | no | config `compaction.auto` | `session.compacted`; v2 `session.next.compaction.started/ended` | none |
| ACP agents | a `/compact` prompt, only when the agent advertises the `compact` command | yes (as text) | agent's own | `compaction_update` (unstable, needs client capability `session.compaction`), else a synthetic tool call | from `usage_update` |

## 2. What the app does today (gaps)

- No manual compaction anywhere (no button, route, port method).
- Claude and Codex already emit `harness.session_info {infoType: 'compact_boundary'}`, but the timeline **drops** it:
  it is filed under the `system` category, which `deriveTimeline` discards. A compaction is visible only as the gauge
  dropping, and not at all after a reload.
- Codex labels every compaction "(auto)".
- Copilot's `compaction_complete` is mapped to a gauge update from fields that event does not carry (`currentTokens`,
  `tokenLimit`): the gauge reads 0 with no limit after a Copilot compaction.
- No start / failure state for any provider: the user cannot tell a compaction is running.
- OpenCode and ACP compaction events are ignored.
- Handoff (E-4): a chat moved to another provider seeds the new session with a transcript digest of the WHOLE chat
  (capped at 100k chars). After a compaction it should start from the summary.

## 3. Design

### 3.1 One shared contract (packages/shared, client-core)

- `harness.session_info` info types, in one constant shared by server and clients:
  `compaction_start {trigger}`, `compact_boundary {trigger, preTokens?, postTokens?, summary?}`,
  `compaction_failed {trigger, error}`. `trigger` is `manual | auto`.
- Every adapter maps its native events onto these three. The gauge keeps flowing through `harness.context_usage`.

### 3.2 One port method, native where the provider has it

- `IAgentHarness.compactConversation?(conversationId, { instructions? }): Promise<void>` — resolves when the
  compaction has finished (or failed: rejects), after the adapter emitted the events above on the conversation's stream.
- Capability `conversationCompact?: boolean` (per conversation through `capabilitiesFor`, because an ACP agent has it
  only when it advertises `/compact`).
- Routed like fork / rewind: `HarnessProxy` → `MultiHarness` → adapter.

### 3.3 One service method for every provider (core)

`ChatManagementService.compactChat(chatId, { instructions? })`, a turn of its own:

- the same guards as a prompt (archived, open gate, `CHAT_BUSY`, the synchronous claim), and the same binding step
  (factored out of `sendPrompt`), so a chat that just moved provider compacts on the provider it now runs on;
- `harness.turn_start {turnId, kind: 'compaction'}`, events forwarded, Stop works, `harness.idle` at the end;
- **native** when the conversation's provider declares `conversationCompact`;
- **common fallback** otherwise (and when a handoff seed is still pending, i.e. the new provider has no history yet):
  summarise the transcript with the chat-reference summariser, end the provider session, and make the summary the
  chat's conversation seed — the next prompt opens a fresh session that starts from it;
- the result is persisted as a `system` row: `metadata.compaction {trigger, preTokens?, postTokens?, summary?,
  provider, model}` — so the transcript shows it after a reload and the handoff can use it.

Automatic compactions inside a normal turn are persisted the same way, from the `compact_boundary` the turn sees.

### 3.4 Handoff

`buildConversationSeed` starts from the latest compaction row that carries a summary: the summary, then the turns after
it in full. Without a summary (Codex, OpenCode v1) it stays as today.

### 3.5 UI (composer + transcript)

- Composer: a **Compact** icon button beside the context gauge (shown when the chat has history), opening a small
  popover: optional "Focus on…" instructions (when the provider takes them) and **Compact conversation**. Disabled while
  a turn runs. The gauge popover gets the same action.
- Transcript: a divider row "Conversation compacted · 152K → 21K tokens" (manual / auto), live and after a reload;
  "Compacting conversation…" while it runs; a failure as a warning step. When the provider exposed the summary,
  **Summary** on the divider opens it in a dialog (it runs to pages; unfolded in the transcript it pushed the turns
  after it out of view).

## 5. Tests

- Unit: each adapter's mapping (start / boundary / failed, Copilot gauge fix, Codex trigger), seed from a summary,
  `compactChat` native / fallback / busy / gate.
- Installed app, against a throwaway repo: manual compaction on Claude, Codex (GPT-5.6-Terra or Luna) and Copilot; auto
  compaction on Claude (lowered window) and Codex (lowered token limit); handoff Claude → Codex → Claude after a
  compaction; reload shows the dividers.

## 6. Provider upgrades (researched and done 2026-11-09)

Each provider was researched before it was touched: the published type declarations or protocol schema of the old and
new version diffed, the release notes between them read, and every change mapped to what our adapter uses.

| Provider | From → to | Breaking for us | What changed in the code | Commit |
|---|---|---|---|---|
| Codex app-server | 0.162.1 → 0.167.0 | none in the protocol | schema re-captured from the 0.167.0 binary (18 new types); release notes: failed compactions leave no partial summary, auto-compaction accounting fixed | f74fe0fb |
| Schema generator | — | a schema with properties beside `oneOf` lost the shared fields (Codex 0.167's ThreadItem; ACP's elicitation modes already did) | emit `{ shared } & (A \| B)` | f17fcf6c |
| Copilot SDK / CLI | 1.0.8 / 1.0.75 → 1.0.29 / 1.0.107 | two new permission kinds | mapped to `other`; CLI pinned to the build the SDK was made against (protocol 3 on both); `history.compact` gains `customInstructions` | c3446f5f |
| Claude Agent SDK | 0.3.220 → ~0.3.319 | none at compile time | three new assistant errors → auth; patch range only (the SDK changes behaviour almost daily) | d08d833f |
| OpenCode | protocol 1.18.25 → 1.19.5 | none | an OpenCode 2 server is refused by name (it serves a different API under `/api/*`) | 6fdd9e5b |
| ACP SDK | 1.4.0 → 2.5.0 (major) | default import is stable-only; schema path moved | both sides import `/unstable` (we use `usage`, plan updates); wire protocol stays v1, so every agent still interoperates | be0346c6 |

Behaviour notes carried into the compaction work:

- Claude CLI 2.1.299+ compacts **idle** sessions (≥ 200K tokens) between turns, so a `compact_boundary` can arrive
  outside a turn; it has to be recorded without a turn waiting for it.
- Copilot's `compaction_complete` is flat (`preCompactionTokens`, `postCompactionTokens`, `tokenLimit`): the existing
  mapper read fields it does not carry (§2).

Not done, for the owner to decide: **OpenCode 2** (`@opencode/cli`, 2.2.6) is a separate release line with a new HTTP
API; supporting it is a port of the OpenCode adapter (or a switch to its `opencode acp` command through the ACP
provider). The `opencode-ai` 1.x line we support is frozen at 1.19.5.

## 7. Evidence — the installed app (2026-11-09, macOS; Claude Agent and Codex GPT-5.6-Terra)

Copilot is not signed in on this machine; Copilot, OpenCode and ACP are covered by their unit suites (stand-in
servers that speak each protocol). Every run drove the installed app like a user: the composer's Compact button,
Settings › Context compaction, the model picker's move between providers.

| Run | What | Result |
|---|---|---|
| C1 | Claude (Sonnet): two turns with facts, Compact with focus instructions, move to Codex, back to Claude, reload | 37K → 3K tokens with the summary; Codex and Claude both still knew the facts; the divider after a reload. Found: the chat did not show the compaction as running, so a message sent meanwhile was refused (fixed 2321afd4) |
| C2 | Codex: the same through `thread/compact/start` | facts kept, divider after reload. Found: the gauge read 0 after it (fixed b603e4e4) |
| S1 | the common fallback: a Claude chat moved to Codex and compacted before Codex's first turn | the app summarised it (Codex's model), Codex started a fresh session from the summary, every fact kept |
| A1 | Claude auto-compaction at 20 % | never compacted: the CLI ignored `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` in an SDK session ("auto-compacts at 167K"). Probed the CLI directly: `autoCompactWindow` works (111K → 1.3K, trigger auto); the adapter uses it (c14b5714), headroom measured 33K (bb10f0d0) |
| A1b | Claude auto-compaction at 20 %, after the fix | compacted on its own (92K → 26K, later 70K → 3K); the vault code survived |
| A2 / A2b | Codex auto-compaction at 20 % (limit 52K of 258K) | compacted on its own inside the turn; the code survived. Found: "from 0 tokens" (fixed af18473e); a live thread never took a changed limit, and the first Codex chat after a launch no percentage (fixed 701dae1f) |
| V1 | Claude manual compaction on the fixed build | "Compacting conversation…" live with Stop; the divider without a reload; facts kept |

Unit suites at the end: agent-harness-providers 864, core services 590, client-core 879 (all passing).

### 7.1 Real work, end to end (2026-11-10, the Pulse test repo, worktrees on `develop`)

Long coding tasks a user would run, each on its own worktree of the Pulse test repository (never this repo), driven
through the composer, the Compact button, the model picker and Settings › Context compaction. Every result was
checked outside the app: the branch's commits, and the repo's own api and web suites and typecheck run in the
worktree.

| Run | What | Result |
|---|---|---|
| E1 | Sonnet 5.5 builds monitor tags (migration, repository, routes, tests) and the web UI; Compact with focus instructions; move to Codex (tag validation); back to Claude for a review | 3 commits (2 Claude, 1 Codex), api 130/130, web 135/135, web build green. 84K → 11K; Codex and Claude both recalled the codename and reviewer after the compaction and both moves |
| E2 | Background tasks: an Opus 5.5 orchestrator splits two endpoints over a Sonnet worker and a Codex worker, reviews, merges; Compact; move to Codex for the README | 5 commits, api 144/144, typecheck green; auto-compaction inside the orchestrator's 33-minute turn (68K → 5K) and inside both Codex workers (52K, 53K — fresh threads, no warm-up); the ticket id survived compaction and the move |
| E3 | Codex: cursor pagination over six list routes, then sorting; auto-compaction **turned off while the chat was open**; Compact; Claude reviews | auto-compacted at 51K under 20 %; with the setting off it ran to 109K without compacting (the live thread took the change); Claude's review fixed a real web-client bug in Codex's commit; api 130/130, web 135/135 |

Found and fixed on the way:

| Finding | Fix |
|---|---|
| Claude's gauge read "65k / 100k" on a 1M model: with an auto-compaction threshold the CLI reports the shortened window as the context's size, and the result-derived snapshot reported the real one, so the limit jumped | 57d5a993 — the gauge keeps the model's window; the threshold shows as "Auto-compacts at" |
| One Compact on a Codex chat whose thread had been reopened twice (two setting changes) wrote three compaction rows, without a size | 396eabbe — the unsubscribe follows the conversation's current state; a reopened thread keeps its last size |
| After a Codex compaction the gauge kept the size before it (109K) | dd1c41ef — "compacted, the new size shows after the next response" until Codex reports it |
| A Codex turn stored 1.5 MB of metadata (whole `rg` outputs, 190 KB each), read back on every history load | 8b9d022e — a turn keeps 32K characters per tool result (head and tail) |
| An orchestrator that spawned a worker on the wrong model (a bound agent pinned another one) could not stop it | b43c574d — `cancel_background_agent` |

Observed, not changed (owner decisions):

- The orchestrator (Claude Code) wrote "Co-Authored-By: Claude Opus 5.5" into its workers' commit instructions —
  Codex workers' commits carry it too. The CLI's attribution setting could turn it off for every chat.
- A worker's permission request shows in the orchestrator's Tasks dock with only "Open task chat": approving a
  wave means visiting each worker chat.
- Claude's auto-compaction threshold is computed from 200K until the first turn reports the model's window, so a
  1M model's first turn compacts earlier than the percentage says.

### 7.2 Interrupted work, handoffs and background agents (2026-11-11, installed builds with the fixes above)

| Run | What | Result |
|---|---|---|
| E4 | Sonnet 5.5 adds an audit log; the app is quit and reinstalled mid-turn; the user reopens the chat and says "continue" | after the restart the chat shows "Stopped before the response finished", the partial steps and all 8 changed files; Claude finished the wiring, cleanup and tests and committed; api 126/126, typecheck green; the compliance owner and the retention recalled |
| E5 | Sonnet builds a per-IP rate limit for the status endpoints → Compact (summary opens in the dialog) → move to Codex for a review → Compact on Codex → the threshold changed while the chat is open → Compact again → reload → back to Claude | 55K → 6K with the summary (dialog: title, summary, "the agent continues from this summary", Escape closes it, nothing unfolds in the transcript); Codex reviewed and found nothing to fix; each Codex compaction wrote **one** row with "from N tokens" (57K, 29K — the 396eabbe fix), the gauge read "compacted" until the next response (dd1c41ef); 3 dividers before and after the reload; the ticket and the owner recalled by Codex and by Claude; api 125/125, typecheck green |
| E6 | An Opus 5.5 orchestrator spawns a Sonnet worker (version endpoint) and a Codex worker (validation audit); the user asks to stop the Codex worker; the orchestrator reviews and brings in the Sonnet commit; Compact | the orchestrator stopped the worker with `cancel_background_agent` (status cancelled, nothing merged), and stopped its own first spawn that a bound agent had moved to another model; the Sonnet worker's commit fast-forwarded onto the branch; 54K → 4K, the summary in the dialog; the release manager recalled; api 123/123, typecheck green |

Found and fixed on the way:

| Finding | Fix |
|---|---|
| The summary unfolded inside the transcript | 726510bf — a dialog |
| The composer's toolbar wrapped (Compact alone under "+") beside a long model label: it folded effort and context only below a fixed 420 px | fe86e1a0 — it folds whenever the row would wrap |
| A model changed from another client left the open chat's composer naming the old one | 23162a49 — the chat stream's router maps `chat.updated` to a refetch of the chat (ddfd7556 did it from the chat-list stream, which no surface keeps open beside a chat; reverted there) |
| Claude's limit read 1.00M with the default threshold and 872K (window − max output) with a custom one — below the CLI's own 967K compaction point | d4d8291c — the whole window either way |
| A Claude orchestrator's Codex worker ran on Codex but its chat said claude-agent, so the session composer made Claude's capability decisions for it | 6231ae44 — the worker's record takes the provider of its model |
| 30 % on a chat that names Sonnet 5.5 by its alias compacted at 67K: the result reports limits under the wire model, the alias fell back to 200K | fd4b1b6e — the turn's main model's limits are recorded under the alias too |

Verified on the final build (E7–E9): the composer follows a model switched from another client both ways without a
reload; Compact stays on the toolbar's row (effort and context fold into More options); Claude's limit reads 1.00M
with a custom threshold and "Auto-compacts at 300k" for 30 % of 1M from the second turn after a launch; an Opus
orchestrator's Codex worker is recorded as `codex` and ran there.

Still for the owner: worker permission requests are answered from each worker's chat (the Tasks dock only links to it);
the Claude CLI's default commit attribution ("Co-Authored-By: Claude …") appears in every Claude-made commit in a
user's repo, workers included.

