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
  "Compacting conversation…" while it runs; a failure as a warning step.

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
