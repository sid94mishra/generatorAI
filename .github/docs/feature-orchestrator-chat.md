# Feature — Orchestrator Mode (Chat)

> A chat can be put into **Orchestrate mode**, in which the agent decomposes a request and delegates sub-tasks to **background agents**. Each background agent is a *real* GeneratorAI Chat — with its own session, its own stream, its own history and its own model — not an in-process SDK subagent. Workers are visible, clickable and resumable; the orchestrator consolidates their results into one answer.
>
> Distinct from the **workflow orchestrator** (`generatorai orchestrator …`, DAG runs). This doc is about the *chat* feature.

---

## 1. Why a native chat, not an SDK subagent

Both `@github/copilot-sdk` and `@anthropic-ai/claude-agent-sdk` ship in-process subagents (`customAgents` / `agents`). They were evaluated and rejected for this feature:

| Requirement | SDK subagent | Native background chat |
|---|---|---|
| Visible in the UI as its own conversation | ❌ in-process, invisible | ✅ real `chats` row |
| Independent SSE stream you can watch live | ❌ only the final message returns | ✅ own `scope=chat` stream |
| Persisted history, resumable after restart | ❌ | ✅ |
| Per-task model (cheap worker, expensive orchestrator) | partial | ✅ |
| Works identically across providers | ❌ semantics differ | ✅ provider-agnostic |

SDK subagents remain useful as an *internal* optimization **inside** a worker (cheap read-only fan-out); they are not the delegation mechanism.

Design lineage: **agents-as-tools** (the orchestrator owns the final answer) rather than handoff, and **reference-based handoff** (workers write artifacts and return a compact digest) to avoid the "game of telephone" context degradation.

---

## 2. Entity & DB shape

Migration **v17** adds to `chats`:

| Column | Type | Meaning |
|---|---|---|
| `orchestrator_mode` | bool | This chat may spawn background agents. |
| `parent_chat_id` | FK → `chats.id` (self, nullable) | Set on a worker; points at its orchestrator. Follows the `workflow_runs.parent_stage_run_id` precedent. |
| `background_task_name` | text | Human label (e.g. `research-react`). |
| `background_task_index` | int | Position within the spawning wave. |
| `background_task_status` | text | `running` / `needs_review` / `completed` / `failed` / `cancelled`. Indexed. |

Worker chats are **hidden from the main sidebar** — `useChats` filters out any chat with a `parentChatId`. They are reachable only via the Background Tasks panel or a direct URL.

---

## 3. Tools exposed to the orchestrator

`buildOrchestratorToolSet()` ([packages/core/src/tools/orchestrator/index.ts](../../packages/core/src/tools/orchestrator/index.ts)) injects these into the conversation **only** when `orchestratorMode && !parentChatId` — so a worker can never recursively spawn. Order is deterministic (a prompt-caching requirement, see §7).

| Tool | Purpose |
|---|---|
| `list_models` | Live catalog with `{id, name, priceTier, category}`. The orchestrator calls this **first** to route by cost. |
| `spawn_background_agent` | Create a worker chat from a `TaskBrief` (`taskName`, `objective`, `model?`, `inputArtifacts?`, `sharedWorkspace?`). Returns a `taskId` immediately — it does not block. |
| `check_background_agents` | Poll or block (`wait: true`) until workers go idle, then return their `TASK_RESULT` digests. |
| `send_to_background_agent` | Send a follow-up / revision to a worker; flips it back to `running`. |
| `list_background_agents` | Current status of every worker under this orchestrator. |

The blocking wait is implemented as `Promise.race([idlePromise, timeout])` where `idlePromise` resolves off an `EventBus` `harness.idle` subscription on the worker session — no polling loop.

---

## 4. Reference-based handoff (`TASK_RESULT`)

A worker does **not** dump its full transcript back into the orchestrator's context. It writes real artifacts and returns a compact digest:

```
<TASK_RESULT>
{
  "summary": "...",
  "keyFindings": ["..."],
  "artifacts": ["tasks/research-react/react-research.md"],
  "risks": ["..."],
  "openQuestions": ["..."]
}
</TASK_RESULT>
```

`OrchestratorService` parses this out of the worker's final message; if parsing fails it falls back to the latest persisted assistant message from the DB and logs a warning. The Background Tasks panel renders the digest sections directly.

---

## 5. Shared workspace + scratchpad

By default (`TaskBrief.sharedWorkspace !== false`) workers **share the orchestrator's execution workspace**, so file edits from every worker land in one tree. This is what makes *code* tasks work — with isolated workspaces the orchestrator could never read what a worker wrote.

- `createChat({ workspaceId })` reuses an existing workspace and skips both workspace creation and the worktree block.
- `archiveChat` guards on `ws.ownerId === chatId`, so archiving a worker never wipes the orchestrator's workspace.
- Workers are instructed to write under `tasks/<taskName>/` and to read — but not edit — outside it.
- `OrchestratorService.writeScratchpad()` maintains `<sharedRoot>/orchestrator/state.json` (`{tasks: [{taskId, taskName, model, status, reviewRounds, artifactDir}]}`) on every spawn, worker idle and parent idle. `orchestrator/plan.md` is optional and agent-authored.

Set `sharedWorkspace: false` per task for pure research fan-out that should stay isolated.

---

## 6. Cost-aware model routing

The orchestrator prompt makes delegation the **default** and requires a routing step: call `list_models()`, then assign the cheapest capable model per worker and reserve expensive models for genuinely hard reasoning.

`resolveWorkerModel(briefModel, parentModel)` resolves in order:

1. `brief.model` (explicit orchestrator choice)
2. `config.defaultWorkerModel` (`GENERATORAI_ORCH_DEFAULT_WORKER_MODEL`)
3. **auto** — cheapest non-`high` tier, preferring `medium`
4. `parentModel` (last resort)

So workers never silently inherit an expensive orchestrator model. `priceTier()` derives `low` / `medium` / `high` from `priceCategory` → `billingMultiplier` → `category`. The model list is cached for 60s.

---

## 7. Prompt-caching strategy

Provider prompt caches are prefix-hash matched and model-specific, so identical prefixes across workers **share** the cache: one write (~1.25×) plus N−1 reads (~0.1×). The implementation follows these rules:

| Rule | What it means in code |
|---|---|
| **M1** | The worker system prompt is a **canonical constant**. The task brief goes in the *first user message* (`renderBriefMessage`), never in the system prompt. |
| **M2** | Deterministic tool order + stable JSON key order. |
| **M3** | **Warm-first-then-parallel** — spawn worker #1, wait for its response to start, then release the rest of the wave. Anthropic: *"the cache entry only becomes available after the first response begins."* Tracked per-wave via an `activeByParent` counter. |
| **M4** | Batch same-model workers into one wave — hence the orchestrator picks a model **tier**, not an arbitrary per-task model. |
| **M5** | Reference-based handoff is itself a caching rule (small, stable payloads). |
| **M6** | Orchestrator tools are rebuilt identically on resume so the prefix doesn't drift. |
| **M7** | `prompt_cache_key` / explicit breakpoints / 1h TTL are **best-effort** — the CLI-backed harnesses may not expose them. |
| **M8** | Observe cache-read/write token counts where reported. |

Guaranteed levers are prefix stability, warm-first, and reference handoff; explicit cache controls are opportunistic.

Set `GENERATORAI_ORCH_WARM_FIRST=0` to disable warm-first (parallel from the first request).

---

## 8. Status lifecycle

```
spawn ──> running ──(worker turn ends)──> needs_review ──┬─(orchestrator consolidates)─> completed
                ^                                        │
                └──── send_to_background_agent ──────────┘
                                                          └─(error)──> failed
```

`needs_review` means "worker finished, result ready" — review is a *reasoning* act, not a UI gate. The orchestrator reads the digest via `check_background_agents` and either accepts it or revises via `send_to_background_agent`.

Auto-completion: `OrchestratorService` subscribes once per parent to the **orchestrator's own** session (`parentSubs`). When the parent emits `harness.idle` (consolidation done), any worker still in `needs_review` flips to `completed`, persists, and emits `chat.background_task.status`. Because `check_background_agents(wait: true)` blocks the tool call until workers are idle, parent-idle can only fire *after* consolidation. The sweep is idempotent and skips workers that a follow-up put back into `running`.

---

## 9. Events

| Kind | Emitted when |
|---|---|
| `chat.background_task.spawned` | A worker chat is created. |
| `chat.background_task.status` | Status transition (incl. the auto-complete sweep). |
| `chat.background_task.completed` | Worker reached `completed`. |
| `chat.background_task.failed` | Worker errored. |

These flow through the normal unified `/api/stream` on the **orchestrator's** chat scope, so the panel updates live.

---

## 10. REST

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/chats/:id/background-tasks` | List workers under an orchestrator chat. |
| `GET` | `/api/chats/:id/background-tasks/:taskId` | Fetch a worker's parsed `TASK_RESULT` digest. |
| `POST` | `/api/chats/:id/background-tasks/:taskId/cancel` | Cancel a running worker. |

---

## 11. Web UI

- **New Chat dialog** — an **Orchestrate** toggle sets `orchestratorMode`.
- **Background Tasks tab** (RightPane) — [apps/web/src/components/chat/BackgroundTasksPanel.tsx](../../apps/web/src/components/chat/BackgroundTasksPanel.tsx). Auto-opens the first time a worker is spawned. Shows per-worker status chips, the model each worker was routed to, the parsed digest (Summary / Key findings / Artifacts / Risks / Open questions) and an **Open worker chat** link.
- Worker chats are ordinary streaming chats when opened directly; their own Background Tasks panel is empty because `orchestratorMode` is `false` on workers.

Hooks: `useBackgroundTasks` / `useBackgroundTaskDigest` / `cancelBackgroundTask` in [apps/web/src/hooks/queries.ts](../../apps/web/src/hooks/queries.ts).

---

## 12. Configuration

| Var | Default | Purpose |
|---|---|---|
| `GENERATORAI_ORCH_MAX_WORKERS` | governor default | Max concurrent background agents per orchestrator. |
| `GENERATORAI_ORCH_MAX_REVIEW_ROUNDS` | governor default | Cap on `send_to_background_agent` revision rounds per worker. |
| `GENERATORAI_ORCH_DEFAULT_WORKER_MODEL` | (unset → auto-cheapest) | Pin a worker model instead of auto-routing. |
| `GENERATORAI_ORCH_WORKER_TIMEOUT_MS` | governor default | Per-worker wall clock before it is failed. |
| `GENERATORAI_ORCH_WARM_FIRST` | `1` | Set `0` to release the whole wave in parallel (loses the shared prompt-cache prefix). |

---

## 13. Wiring & the circular dependency

`OrchestratorService` needs `ChatManagementService` (to create worker chats) and `ChatManagementService` needs `OrchestratorService` (to inject the tools). The cycle is broken by **late binding** in `createCoreServices`, mirroring the `worktreeService` precedent:

1. Construct `ChatManagementService` with a by-reference `extensions` object.
2. Construct `OrchestratorService`.
3. `orchestratorService.setChatManagementService(cms)`.
4. `chatExtensions.orchestratorService = orch` — visible by reference.
5. In the composition root, `orchestratorService.setWorkspaceManager(workspaceManager)` once the workspace manager exists.

`disposeForParent()` unsubscribes both the worker and parent session subscriptions; it is called when the orchestrator chat is archived.

---

## 14. Files to know

| Path | Role |
|---|---|
| [packages/core/src/services/orchestrator/OrchestratorService.ts](../../packages/core/src/services/orchestrator/OrchestratorService.ts) | Spawn / check / send / status sweep / scratchpad / model routing. |
| [packages/core/src/services/orchestrator/prompts.ts](../../packages/core/src/services/orchestrator/prompts.ts) | `ORCHESTRATOR_SYSTEM_PROMPT`, `WORKER_SYSTEM_PROMPT`, `renderBriefMessage`. |
| [packages/core/src/tools/orchestrator/index.ts](../../packages/core/src/tools/orchestrator/index.ts) | `buildOrchestratorToolSet`. |
| [packages/shared/src/config/OrchestratorSchemas.ts](../../packages/shared/src/config/OrchestratorSchemas.ts) | `TaskBriefSchema`, `TaskResultDigestSchema`. |
| [apps/web/src/components/chat/BackgroundTasksPanel.tsx](../../apps/web/src/components/chat/BackgroundTasksPanel.tsx) | RightPane tab. |

---

## 15. Known limits / roadmap

- **No peer messaging** between workers (Claude "agent teams" style mailbox). Workers coordinate only through the shared workspace + the orchestrator.
- **No durable recovery** of in-flight background tasks across a server restart.
- **No nested orchestration** — workers have `orchestratorMode: false` by construction.
