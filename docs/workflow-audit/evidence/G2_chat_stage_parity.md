# G2 — Chat ↔ Stage parity: a stage is a compact chat

Branch `desktop_redesign`, read-only analysis, 2026-09-24. Paths are relative to the repo root.

Abbreviations: **CMS** = `packages/core/src/services/ChatManagementService.ts`, **SES** = `packages/core/src/services/StageExecutionService.ts`, **SA** = `packages/core/src/services/SessionAllocator.ts`, **AMP** = `packages/core/src/services/agentModePolicy.ts`, **RUNPAGE** = `apps/web/src/pages/WorkflowRunPageV2.tsx`, **STI** = `apps/web/src/components/workflow/redesign/StageTimelineItem.tsx`.

Builds on `docs/workflow-audit/evidence/B_runtime.md` and `C_orchestration_integrations.md`. Findings that are **new in this pass** are marked **[new]**.

---

## 0. Headline

1. There are **three** config builders today, not two. CMS has its own create path (`createChat`, CMS:1649-2156) and resume path (`buildConversationConfig`, CMS:2249-2510). They are hand-copied and have **already drifted** [new]:
   * The create path applies the agent projection *before* the explicit `harnessConfig` pass-through (CMS:1760 then 1776-1787). The resume path does it the other way round (CMS:2290-2304 then 2314). For list fields (`skillDirectories`, `customAgents`) the winner therefore flips after a restart or model switch.
   * `systemPromptAppend` and `maxTurns` are forwarded only on resume (CMS:2293, 2303). The create path drops them (CMS:1776-1787).
   
   SES is a third, older copy (SES:1131-1259, 366-477) that drifted further.
2. The stage builder is a **subset** of the chat builder, **plus** a few divergences that are bugs [new]:
   * **Agent instructions go into the system message *before* the platform browser block.** `resolveStageAgent` runs at SES:1198 and appends the `<generatorai:agent trust="user">` fence at SES:454-470. The browser hint is appended afterwards, at SES:1244-1254. The chat path deliberately appends agent instructions **last** (CMS:1439-1450, 2053), because otherwise user-authored text gets the "first word" over platform blocks.
   * **`projection: 'replace'` wipes the whole stage system message**, including the workflow author's own `systemMessage`: `base = isReplace ? ''` (SES:457). Chat drops only the replaceable base (CMS:1459-1463).
   * **The team mapping drops `tools`, `disallowedTools`, `reasoningEffort`, `maxTurns` and `permissionMode` for sub-agents** (SES:445-451 vs CMS:1418-1429). A team member that the agent author restricted with `disallowedTools` is unrestricted inside a stage.
3. The client side is **already mostly unified**:
   * `StreamPanel` is the shared conversation body (`apps/web/src/components/agent/StreamPanel.tsx:1-15`), and STI uses it (STI:308-316).
   * The stream reducer keys stages as `stageRun:<id>` (`packages/client-core/src/stream/eventRouter.ts:486-493`).
   * `ChatInput` accepts `customSendFn` (`apps/web/src/components/chat/ChatInput.tsx:73`).
   * `PermissionCard` is callback-driven (`PermissionCard.tsx:22-33`).
   
   What is missing is a **server-side conversation API for stages** (send, stop, attach, gate cards) and one **server-side composer**.
4. The **permission/HITL plumbing is split across two gate systems**. Chats use `AgentInteractionService` (CMS:586-649). Stages use `HitlService` (SES:701-783). `AgentInteractionService` *already* declares a `stage_run` scope (`AgentInteractionService.ts:36-38`), which nothing uses. The two systems have different durability, and that difference is deliberate (`AgentInteractionService.ts:6-16`). The shared design must keep it: stages survive restarts, chat gates expire.

---

## 1. Capability inventory and parity table

Legend: **Stage today**: ✅ yes · ◐ partial · ❌ no · n/a. **UI**: whether the run page (RUNPAGE + `components/workflow/redesign/*`) can surface it today.

### 1a. Tools

| # | Capability | Chat wiring | Stage today | Where to wire for stage | Run-page UI |
|---|---|---|---|---|---|
| T1 | Integrated browser tools + hint + auto-start | create CMS:1809-1865; resume CMS:2354-2372; `reattachOnPrompt` CMS:2775-2777; gated on `toolPolicy.groups.browser` | ◐. SES:1216-1259, only when `__workspaceId` is set, which never happens on orchestrated runs (C-6). A different hint string is inlined (SES:1244-1249) instead of `BROWSER_SYSTEM_HINT` | Composer `PlatformToolBinder.browser`, workspace id from `findWorkspaceByOwner(runId)` rather than a variable | ✅ Browser tab (RUNPAGE:656-693) plus auto-open on `browser.session_created` (RUNPAGE:199-244) |
| T2 | Computer use (`computer_*` tools, hint, staged platform skill, live settings toggle in binding key) | CMS:1867-1897, 2378-2407; `registerComputerUseSkill` CMS:1221-1247; key `cu0/1` CMS:1272-1273 | ❌ | Binder `computer`. `ComputerToolContext.chatId` is optional (`tools/computer/computerToolTypes.ts:24-30`), so a stage owner can bind it. **Should require an explicit opt-in** (unattended desktop control) | ❌ No Computer tab. Consent prompts need a surface (chat has `components/chat/ComputerPanel.tsx`) |
| T3 | Widget tools (`render/update/close/search/read/describe/list/action/exec`) + `WIDGET_SYSTEM_HINT` | CMS:1902-1932, 2411-2435 | ❌ | Binder `widgets`. `WidgetToolBinding` already has `workflowRunId` and `stageRunId` fields (`tools/widgetTools.ts:39-50`), prepared but unused | ◐ Widget tab exists (RUNPAGE:719-731, `WidgetHost sessionId="stageRun:<id>"`) but is dead. STI passes no `widgets`/`streamKey` to StreamPanel (STI:308-316), so inline widgets cannot render |
| T4 | Widget interaction digest prepended to the next prompt | CMS:3234-3263 (`drainRecentInteractions`) | ❌ | Composer `preparePrompt()` step | n/a until T3 |
| T5 | Extension/custom tools (`CustomToolRegistry`), extension-authoring pair gated on `groups.extensionAuthoring` | CMS:1980-1988, 2450-2456; `selectCustomTools` CMS:1288-1294 | ❌ | Binder `custom` (keeps the review-5.3 gate) | Tool rows render via StreamPanel ✅ |
| T6 | Orchestrator/background-agent tools + `ORCHESTRATOR_SYSTEM_PROMPT` + native `Agent`/`Task` removed; auto-enabled by an orchestrator-role agent | CMS:1772-1773, 1993-2031, 2461-2483 | ❌. An orchestrator-role agent becomes SDK `customAgents` (SES:444-452), the path the feature doc rejects | Binder `orchestrator` with an owner abstraction (`parentChatId` → `parentOwner`). Workers are chats; the parent could be a stage | ❌ No BackgroundTasksPanel on the run page |
| T7 | `record_plan` tool (non-blocking plan filing, blocking in plan mode for Codex/OpenCode/ACP) | `applyPlanModeConfig` CMS:831-839; `recordPlan` CMS:856-922 | ❌. Stage plans only through the approval gate (SES:2320-2337, `recordStagePlan` SES:3344+) | Gate port `recordPlan` for the stage owner | Plan tab exists for chats. Stage plans are PlanDocuments with `chatId = stageRunId` (SES:3366-3371) |
| T8 | Chat → workflow tools (`run_workflow`/`check_workflow_run`) | none exist (C-18) | n/a | New binder entry, both owners | — |
| T9 | Hook bridge (synchronous `HookBridge`) | CMS:2037-2042, 2497-2504. **[new] Never wired in production**: `buildHookBridge` has no assignment in `apps/server/src/composition-root.ts` (grep; `chatExtensions` at :797-803). Dead in chat too | ❌. Stages use `HookExecutor` phases (SES:1265-1307) | Binder `hooks` once a factory exists; one factory for both owners | Hook events render in RunTimeline |
| T10 | Voice dictation | client-only (`components/chat/VoiceRecorder.tsx` inside ChatInput) | n/a server | Comes free with ChatInput reuse | ❌ No composer |

### 1b. MCP / skills / agents

| # | Capability | Chat wiring | Stage today | Where to wire | UI |
|---|---|---|---|---|---|
| M1 | MCP merge (`mergeMcpServers`: agent ∪ explicit overrides, one precedence rule) | CMS:1957-1960, 2335-2338 | ◐. Workflow → stage shallow-deep merge (SES:1142, 1159-1160), then `{...cfg, ...projection}` (SES:426-431). The **agent wins over the stage's explicit override**, the opposite of chat (CMS:2329-2334 names exactly this bug) | Composer `resolveMcp()` | — |
| M2 | Hub resolution (`secretref:` → value, hub disable flags) | `mcpHub.resolveForRun` CMS:1961-1969, 2339-2347 | ❌ (C-2) | `resolveMcp()` with `{workflowDefinitionId, workflowRunId}` | Surface `dropped` as `harness.session_info` |
| M3 | Per-scope enable/disable (`excludedMcpServerIds`) | via resolver (`AgentResolver.runtimeFromHarnessConfig`) | ✅ via `runtimeOverrides` (SES:397) | same | Stage builder `McpServerSelector` ✅ |
| S1 | Skill staging | managed workspace root (CMS:1384-1393, 1754-1755, 2319-2322) | ◐. Staged into `workingDirectory` (SES:410-424), i.e. the git worktree, so autoCommit commits them (C-8) | `applyAgentProjection(..., workspaceRoot = run workspace rootPath)` | — |
| S2 | `disabledSkills`, `skillDirectories` pass-through | CMS:1780-1781, 2296-2297 | ✅ (SES:1145-1146), plus run uploads (SES:1175-1178) | same | — |
| S3 | Stage-level `skills: StageSkillReference[]` | n/a | ❌ dead field (C-13; `shared/src/types/StageDefinition.ts:113`) | Delete; use `agentOverrides.addSkillIds` | `StageNode` badge reads the dead field |
| A1 | `agentRef` + `agentOverrides` + resolver (scope, snapshot) | `applyAgentProjection` CMS:1338-1437 (scope `'chat'`, frozen `agentSnapshot` on resume, CMS:2323) | ◐. `resolveStageAgent` SES:366-477 (scope `'stage'`, `agentName` legacy, `runtimeOverrides`). **No snapshot**: a mid-run agent edit changes later stages / retries | Shared `applyAgentProjection` with `scope`, `agentName`, `runtimeOverrides`, `snapshot` | Stage builder `AgentBindingSection` ✅ |
| A2 | Team → `customAgents` (full field set) | CMS:1417-1430 | ◐. Drops `tools/disallowedTools/reasoningEffort/maxTurns/permissionMode` (SES:445-451) **[new]** | shared | — |
| A3 | Agent instruction fencing, appended LAST, `replace` drops only the replaceable base | `appendAgentInstructions` CMS:1451-1479, 2053, 2507 | ◐. Fenced, but appended **before** the browser block and `replace` drops everything (SES:454-470) **[new]** | shared | — |
| A4 | `defaultAgentMode` (sticky mode) | Chat record, CMS:2136-2138; per-turn override CMS:415-420 | ◐. `stageDef.agentMode` only (SES:3399-3405). The agent's `runtime.defaultAgentMode` is ignored (C slice). **No web builder control for `agentMode`** (grep: no `agentMode` in `components/workflow/*`) **[new]** | SessionSpec `defaultAgentMode` | ❌ |
| A5 | Agent tool-group **enforcement in the permission handler** (`deniedByAgent`) | ❌ **[new]** Chat relies only on `excludedBuiltinTools` (CMS:1406-1413). Its handler (CMS:586-649) never checks groups, which SES:694-699 says is advisory on Copilot | ✅ SES:710-731 | Move into the shared gate wrapper so **both** get it | — |
| A6 | Orchestrator mode from agent role | CMS:1772-1773 | ❌ | Binder T6 | — |

### 1c. Permission modes, HITL, plan mode

| # | Capability | Chat | Stage | Where to wire | UI (web / mobile / TUI) |
|---|---|---|---|---|---|
| P1 | Persistent permission policy | `chat.permissionMode`, default `bypassPermissions` (CMS:2139); PATCH route gated for raising to bypass (`routes/chats.ts:508-526`); part of the binding key (CMS:1304-1315) | `run.permissionMode` (NULL = bypass, SES:734-745); PATCH `/workflow-runs/:id/permission-mode` (`routes/workflowRuns.ts:395`) with no admin-scope check for raising to bypass (compare the chat route) | `PermissionModeSource` (chat row / run row / deployment default `getDefaultChatPermissionMode()` AMP:85) | Web: run page has no mode control; the comment at RUNPAGE:753-755 says "permission mode is always bypassPermissions". Mobile: `components/runs/PermissionModeSheet.tsx` ✅. Chat: composer ✅ |
| P2 | Per-turn `permissionMode` sent to the provider | `resolveTurnPermissionMode(agentMode, chat.permissionMode)` CMS:2793, 3315 | ❌. `resolveTurnPermissionMode(agentMode, undefined)` → deployment default (SES:3399-3405) (C-5). Follow-ups send **no** turn options at all (SES:3085) **[new]** | `composer.turnOptions()` reads the source **per turn** | — |
| P3 | Tool-approval gate | `buildPermissionHandler` → `AgentInteractionService.open({kind:'chat'})` → `chat.permission.requested` / `.resolved` / `.expired` (CMS:586-693, 3847-3861) | ◐. `HitlService.interrupt` (SES:758-777) → `stage_run.awaiting_input`. Closure bound at allocation (single-mode misroute, B-9); covered by the stage timeout (B-7) | Gate port, looked up per turn through a `TurnContextRegistry` keyed by conversationId | Web chat: `PermissionCard` inside StreamPanel. Web stage: `InlineHitlControls` (STI:363-371), which shows tool/args but is not the PermissionCard. Mobile: chat `PermissionCard.tsx`, runs `ApprovalCard.tsx`. TUI: chat permission POST (`apps/cli/src/tui/App.tsx:181`), stage `awaiting_input` status only (`packages/tui-kit/src/content.tsx:560`). Push: `notificationPolicy.ts:135` (stage) and `:154` (chat, with lock-screen actions) |
| P4 | Clarifying questions (`onQuestionRequest`, AskUserQuestion) | CMS:695-755, 802 | ❌ (no handler; provider behaviour undefined) | Gate port `question` → `AgentInteractionService` `stage_run` scope, or HITL `kind:'question'` | Chat `QuestionCard` in StreamPanel; push `notificationPolicy.ts:199` |
| P5 | Native plan-review gate (`onPlanReviewRequest`, ExitPlanMode) | CMS:429-565, 801 | ❌. Plan instructions are prepended to the prompt (SES:1922-1932), and the plan is gated only through `approvalRequired` at the end of the stage (SES:2320-2337) | Gate port `planReview` | Plan cards: chat ✅, stage via Plan documents |
| P6 | `planModeInstructions` + `AUTO_MODE_PLAN_INSTRUCTIONS` system block | CMS:818-826 | ❌ (prompt prefix only) | Composer `applyModeBlocks` | — |
| P7 | Plan prefix only for providers without a native gate (`capabilitiesFor(...).planMode`) | CMS:3268-3273 | ◐. Prefix always prepended in plan mode, native gate or not (SES:1929-1931) | `preparePrompt()` | — |
| P8 | Unattended guard (workers never open gates) | `isAttendedChat` CMS:410-420, 799 | n/a. Stages *can* park (HitlService is durable) | Composer input `attended: boolean` | — |
| P9 | Completion review gate (approve / request changes / reject, review rounds) | none | ✅ stage-only (SES:2301-2529) | stays stage-only | ✅ InlineHitlControls |

### 1d. Turn lifecycle and conversation

| # | Capability | Chat | Stage | Notes |
|---|---|---|---|---|
| L1 | Send a user message | `POST /chats/:id/prompt` multipart (`routes/chats.ts:615-732`) → `sendPrompt` (CMS:2625-3343) | ◐. Only operator follow-ups: approve + `followUpPrompt` (`routes/workflowRuns.ts:476-558`) or review batch `stage_followup` (`routes/review.ts:278-287`) → `sendStageFollowUp` (SES:2951-3116) | See §4 |
| L2 | Busy guard (CHAT_BUSY / INTERACTION_PENDING, synchronous claim) | CMS:2643-2685 | ❌. The follow-up **polls** until the stage leaves `running`/`awaiting_input`, up to 10 min (SES:2970-2982). The review route awaits it synchronously, so the HTTP request hangs **[new]** | Shared `TurnRunner` |
| L3 | Stop / interrupt a turn (graceful + force + budget, persists partial, expires gates, stops workers) | `cancelTurn` CMS:3822-3944; `/chats/:id/cancel` (`routes/chats.ts:582-612`) | ◐. `pauseStage`/`cancelStage` (SES:3121+) are stage-level, not turn-level, and have the resurrect bug (B-3). The web hooks exist (`hooks/workflowQueries.ts:400, 424`) but **RUNPAGE never imports them**: there is no Stop on the run page **[new]** | `TurnRunner.cancel` |
| L4 | Attachments (upload → artifact → `AttachmentRef`, persisted on the message, served back) | `routes/chats.ts:686-707`, CMS:2842-2857, `GET /chats/:id/attachments/:artifactId` (`:742`) | ◐. Only run-upload prompt dirs (`workflowPromptAttachments`, SES:1957). **`PromptDefinition.attachments` (`StageDefinition.ts:22`) is never read** **[new]** | `TurnRunner.send(prompt, attachments)` |
| L5 | Message queueing / steering mid-turn | **Neither exists.** A second prompt is refused (CMS:2664-2671). No client queue (grep) | n/a | Out of scope. Parity is "refuse while busy" |
| L6 | Turn id, turn_start/user_message events, ordered sequence, `textSegments`, `providerAnchor`, `fileOp`, `success`, `parentId`, partial-on-cancel, plan/question cards in metadata | `finalizeTurn` + listener CMS:2782-2869, 2908-3225 | ◐. Listener SES:1393-1481 and a **third copy** in `sendStageFollowUp` SES:3024-3078. No turnId, success, fileOp, sequence, parentId or partial. A failed tool renders as a success in stage history **[new]** | Shared `TurnRecorder` |
| L7 | Resume after restart: provider session id persisted and resumed (`resumeProviderSessionId`) | CMS:2263-2270, `rememberProviderSession` CMS:3379-3392 | ❌. Always a fresh session plus a recap turn (SES:1532-1573) | `rememberProviderSession` for stage sessions. That is also what makes post-completion follow-ups possible (§4) |
| L8 | Rebind on model/agent/permission change (`conversationBindingKey`, resume-with-config fallback to recreate, 90 s deadline, error+idle on failure) | CMS:1261-1317, 2722-2769 | ❌. Single mode ignores config (SA:248-296, C-1b/B-9) | Composer returns `bindingKey`; the allocator compares |
| L9 | Prewarm (provider + baseline checkpoint) | CMS:1607-1644, 2081-2087 | ❌ | Could prewarm stage N+1 while stage N runs (optional) |
| L10 | Restore notice after rewind/undo | CMS:352-394, 3275-3276 | ❌ | Needed only if stage rewind is added |
| L11 | Rewind / fork | CMS:3464+, 3674+; routes `routes/chats.ts:816, 832` | ❌ | Chat-only for now |
| L12 | Conversation seed (synthetic branch digest) | CMS:3282-3285 | ❌ | Chat-only |
| L13 | Title generation | **Does not exist.** The chat name is user-supplied (`CreateChatParams.name`; mobile `RenameSheet.tsx`). There is no LLM titling in core or server (grep) | n/a | Stage names come from the definition. Nothing to share |

### 1e. Workspace, changes, checkpoints

| # | Capability | Chat | Stage | Notes |
|---|---|---|---|---|
| W1 | Workspace exposure (`workingDirectory` + `additionalDirectories` + `env` + `[Workspace]` hint) | `applyWorkspaceExposure` CMS:1510-1535, used at 1722/1751/2282 | ◐. Only `workingDirectory = __workingDirectory` (SES:1167-1172): no additional mounts, env or hint. `process.cwd()` fallback (B-5) | Composer with `ExecutionWorkspace` input |
| W2 | Mount model (sources, in-place/worktree, readiness gate) | `MountService.plan/stage/prepare/ready` CMS:1676-1686, 1748-1750, 2077-2079, 2693-2695 | n/a. Runs use `WorkspaceManager.createWorkspace` + `setupProjectWorktrees` (WRS:684-750, 872-925) | Future: runs use mounts too. Not a blocker for the composer |
| W3 | Per-turn checkpoints (before/after) + live capture on every `tool_complete` | CMS:2822-2838, 3185-3200, 3108-3114 | ◐. Per-stage before/after only (SES:1102-1115, `captureStageAfter` SES:501-524). **No live capture**, so the Changes tab is static during a stage | `TurnRecorder` calls `scheduleLiveCapture` for both |
| W4 | Changes tray / inline diffs | `ChatChangesTray.tsx`, `InlineDiff.tsx`; ChangesSurface | ◐. Run-scope `ChangesSurface` (RUNPAGE:606-629); inline file-op chips need `fileOp` (L6) | — |
| W5 | Review surface (comments → deliver to agent) | target `chat` (`routes/review.ts:274-276`) | ◐. `stage_followup` only while a stage is `awaiting_input` (RUNPAGE:617-628). Otherwise "Comments are saved" and they are never delivered | §4 |
| W6 | Auto source control per turn (commit / push / PR) | `runAutoSourceControl` CMS:2555-2623, 3212-3218; hint CMS:1938-1947 | n/a. Run-level post-processing, orchestrated path only (C-1) | Stays different: SCM is a run concern |
| W7 | Long responses saved as artifacts | CMS:2992-3005 | ✅ (stage has its own `persistStageArtifacts`, SES:899-1028) | — |

### 1f. Model, provider, context, usage, notifications

| # | Capability | Chat | Stage | Notes |
|---|---|---|---|---|
| R1 | Model / harnessType / reasoningEffort | CMS:1706-1711, 1785; composer selectors (`ChatInput.tsx:74-79`) | ✅ SES:1136-1152 + overrides; builder model/effort (`StagePropertiesPanel.tsx:196-241`). No `harnessType` UI (C-4) | — |
| R2 | contextTier | CMS:1786, 2302; composer (`ChatInput.tsx:80-83`) | ◐. Not copied from the workflow level (SES:1136-1152 omits it). Arrives only via overrides or the resolver | SessionSpec |
| R3 | BYOK `provider` | CMS:1783, 2299 | ✅ SES:1148 | Copilot-only either way (C matrix) |
| R4 | maxTurns / systemPromptAppend | resume only (CMS:2293, 2303) **[new drift]** | maxTurns ✅ (SES:1151); systemPromptAppend only through blanket overrides | SessionSpec |
| R5 | Usage / cost (`harness.usage`) and context gauge (`harness.context_usage`) | Provider events forwarded (CMS:3031); client `contextUsage.ts`, `eventRouter.ts:861-876` | ✅ events forwarded (SES:1400-1403) | UI: stage shows `UsageChip` only (STI:353); no context gauge |
| R6 | Compaction | Provider-internal only (no platform command) | same | parity by construction |
| R7 | Push notifications | `chat.permission.requested` / `question.asked` / `plan.review_requested` (`notificationPolicy.ts:154, 199, 215`) | `stage_run.awaiting_input` (`:135`), `workflow_run.failed/completed` | If stage gates use the chat-shaped events (§3), push gets lock-screen actions for free |
| R8 | Provider capability warnings | none (neither reads `getConversationWarnings`, C-11) | none | Composer returns `warnings` |
| R9 | Error recovery on bind failure (emit error + idle) | CMS:2745-2766 | Throws before `try`, no retry (B slice) | — |

**Net:** a stage has full parity only on model, effort, BYOK, maxTurns, MCP id exclusion, skill-directory pass-through, usage events and compaction. Everything else is partial or absent.

---

## 2. What must stay owner-specific

| Chat-only | Why |
|---|---|
| Sources/mount editing (`updateChatSources` CMS:1542), rewind/fork, conversation seed, restore notice | Runs have a run-owned workspace and a DAG. Rewinding one stage without its successors is undefined |
| Per-turn auto SCM (CMS:2555) | Commits are a run-level post-processing concern (the orchestrator). A per-stage commit would fragment PR history |
| Orchestrator *worker* lifecycle (`parentChatId`, workers archived with the parent, `isAttendedChat`) | Workers are chats by design. A stage may *spawn* workers (T6), but the workers stay chats |
| Composer-sticky `defaultAgentMode` PATCH, chat rename | Chat record UX |
| `AgentInteractionService` expire-on-boot semantics for chat gates | The SDK callback cannot survive a restart (`AgentInteractionService.ts:9-16`) |

| Stage-only | Why |
|---|---|
| Prompt sequence, predecessor context injection (SES:1672-1737), output-format/JSON, summary turn, result validation, completion review gate, retries with op epochs, durable effect sandwich (SES:1586-1666), heartbeat, artifact persistence, `pre_run`/`post_run` hooks, stage timeout | This is the "workflow" part of "a compact chat in a workflow". The composer builds the *session*; the stage executor owns the *script* that drives it |
| HitlService durability (a parked stage survives a restart and re-drives) | Stages are unattended and long-lived |
| Session allocation modes (single/per-stage) | Chats are always 1:1 |

**Principle:** everything that decides **what the model can see and do** (the `CreateConversationParams` and the per-turn `SendPromptOptions`) belongs in one composer. Everything that decides **what to say to the model and when** (the script) stays with the owner.

---

## 3. Shared abstraction: `SessionComposer` + `PlatformToolBinder` + `GatePort` + `TurnRecorder`

Location: `packages/core/src/services/session/` (new folder).

### 3.1 Types

```ts
// packages/core/src/services/session/types.ts
export type SessionOwner =
  | { kind: 'chat'; chatId: string; sessionId: string; parentChatId?: string; orchestratorMode?: boolean }
  | { kind: 'stage'; stageRunId: string; workflowRunId: string; workflowDefinitionId: string; sessionId: string };

/** Where the persistent permission policy comes from — re-read every turn. */
export type PermissionModeSource =
  | { kind: 'chat'; read: () => Promise<ChatPermissionMode | undefined> }     // chat row
  | { kind: 'run';  read: () => Promise<WorkflowRunPermissionMode | undefined> } // run row
// Both fall back to getDefaultChatPermissionMode() (AMP:85). Fixes C-5 and C-9.

export interface GatePort {                        // owner-specific human gates
  permission(req: PermissionRequest, turn: TurnContext): Promise<PermissionResponse>;
  question?(req: QuestionRequest, turn: TurnContext): Promise<AgentQuestionResponse>;
  planReview?(req: PlanReviewRequest, turn: TurnContext): Promise<PlanReviewDecision>;
  recordPlan?(args: RecordPlanArgs, turn: TurnContext): Promise<RecordPlanResult | null>;
}

export interface ComposeInput {
  owner: SessionOwner;
  conversationId: string;
  mode: 'create' | 'resume';
  spec: SessionSpec;                        // §5: already merged (workflow ⊕ stage, or chat)
  workspace?: ExecutionWorkspace;           // managed root + mounts (exposure, staging, browser, computer)
  projectId?: string;
  agentSnapshot?: ResolvedAgentProjection;  // frozen projection on resume
  resumeProviderSessionId?: string;
  attended: boolean;                        // chat: !parentChatId; stage: true (HITL is durable)
  gates: GatePort;
  permissionSource: PermissionModeSource;
  turns: TurnContextRegistry;               // lazily read by every gate (see 3.4)
}

export interface ComposeResult {
  params: CreateConversationParams;         // handed to harness.create/resumeConversation
  projection: ResolvedAgentProjection;      // callers persist redactProjection() as the snapshot
  bindingKey: string;                       // formatConversationBindingKey(+ tool-surface hash)
  warnings: ComposeWarning[];               // mcp dropped, capability loss (C-11)
  turnOptions(agentMode?: AgentMode): Promise<SendPromptOptions>;   // per turn
  preparePrompt(prompt: string, turn: TurnContext): Promise<string>; // widget digest, plan prefix, restore notice
  dispose(): void;                          // drop owner registrations (browser owner, widget instances)
}

export interface SessionComposer { compose(input: ComposeInput): Promise<ComposeResult>; }
```

### 3.2 Order of operations (canonical; copied from `createChat`, which is the documented order)

```ts
async compose(i): Promise<ComposeResult> {
  const cfg = base(i)                                   // conversationId, model, harnessType, streaming  (CMS:1706-1711)
  if (i.resumeProviderSessionId) cfg.resumeProviderSessionId = ...        // CMS:2263-2270
  const wsHint = await applyWorkspaceExposure(cfg, i.workspace)         // CMS:1510-1535
  const projection = await applyAgentProjection(cfg, {                  // CMS:1338-1437 ⊕ SES:366-477
    agentRef, agentName, agentOverrides, runtimeOverrides, harnessConfig: spec,
    projectId, workspaceRoot: i.workspace?.rootPath /* managed root, never the worktree */,
    snapshot: i.agentSnapshot, scope: i.owner.kind })
  applyExplicitSpec(cfg, i.spec)                        // ONE precedence rule for create AND resume (fixes the drift)
  const replaceableBase = cfg.systemMessage?.content ?? ''
  appendSystemBlock(cfg, wsHint)
  const binder = new PlatformToolBinder(deps, i.owner, i.workspace, projection.toolPolicy.groups, i.spec)
  await binder.browser(cfg)        // tools first + BROWSER_SYSTEM_HINT            CMS:1809-1865
  await binder.computer(cfg)       // + COMPUTER_USE_SYSTEM_HINT + platform skill  CMS:1867-1897
  binder.widgets(cfg)              // + WIDGET_SYSTEM_HINT (+ authoring hint)      CMS:1902-1932
  appendScmHint(cfg, i.spec.sourceControl)   // chat only; stage passes undefined  CMS:1938-1947
  const mcp = await resolveMcp(cfg, i.spec, i.owner)   // mergeMcpServers + hub     CMS:1957-1972
  binder.custom(cfg)               // registry minus authoring pair unless granted CMS:1980-1988
  binder.orchestrator(cfg, projection)   // + prompt + deny Agent/Task            CMS:1993-2031
  binder.hooks(cfg)                // HookBridge factory (unwired today)            CMS:2037-2042
  applyModeConfig(cfg, i)          // gates → i.gates via i.turns; plan instructions; record_plan  CMS:788-846
  appendAgentInstructions(cfg, projection, replaceableBase)   // LAST             CMS:1451-1479
  return { params: cfg, projection, bindingKey, warnings: [...projection.warnings, ...mcp.dropped],
           turnOptions: (m) => resolveTurnOptions(i, m), preparePrompt, dispose: binder.dispose }
}
```

Tool order stays `browser, computer, widgets, custom, orchestrator, record_plan`, identical to today's chat output. That keeps the chat prompt-cache prefix byte-identical (CMS:1998-2000 names the cost of changing it).

### 3.3 Functions to extract from CMS (current signature → destination)

| Current (file:line) | Signature today | Dependencies | Destination |
|---|---|---|---|
| `applyWorkspaceExposure` CMS:1510 | `(cfg: Record<string,unknown>, workspace: ExecutionWorkspace) => Promise<string\|undefined>` | `workspaceManager.getExposure` | `session/workspaceExposure.ts` |
| `appendWorkspaceHint` CMS:1528 | `(cfg, hint?) => void` | — | `session/systemMessage.ts#appendSystemBlock(cfg, text)`; also replaces the ~10 inline copies at CMS:1857-1861, 1885-1891, 1927-1931, 1939-1946, 2008-2012, 2364-2368, 2395-2401, 2423-2431, 2440-2446, 2471-2475 and SES:1250-1254 |
| `applyAgentProjection` CMS:1338 | `(cfg, source:{agentRef?,agentOverrides?,harnessConfig?,projectId?,workspaceRoot?,snapshot?}) => Promise<ResolvedAgentProjection>` | `agentResolver`, `agentStaging` | `session/agentProjection.ts`, generalised with `scope`, `agentName`, `runtimeOverrides`. Absorbs `resolveStageAgent` SES:366-477 (`(sessionConfig, stageDef, workflowHarnessConfig, variables)`) including its `permissionMode` runtime (SES:408) |
| `appendAgentInstructions` CMS:1451 | `(cfg, projection, replaceableBase='') => void` | — | same module |
| `registerComputerUseSkill` CMS:1221 | `(cfg, workspaceRoot) => Promise<void>` | `systemArtifacts`, `agentStaging` | `PlatformToolBinder.computer` |
| `selectCustomTools` CMS:1288 | `(allowExtensionAuthoring: boolean) => unknown[]` | `customToolRegistry` | `PlatformToolBinder.custom` |
| inline browser / computer / widget / orchestrator blocks (CMS:1809-2031 and 2354-2483) | — | `browserService`, `workspaceManager`, `computerService`, `widgetService`+`widgetRegistry`+`widgetAssetsBase`, `orchestratorService` | `PlatformToolBinder.{browser,computer,widgets,orchestrator}(cfg)`. The owner string becomes `chat:<id>` / `stage:<id>` (already used: CMS:1840, SES:1240) |
| MCP block CMS:1957-1972 / 2335-2350 | inline | `mergeMcpServers`, `mcpHub` | `session/resolveMcp.ts#resolveMcp(cfg, spec, owner) => {servers, dropped}` |
| `applyPlanModeConfig` CMS:788 | `(cfg, chat:{id,parentChatId?,permissionMode?,defaultAgentMode?}) => void` | the 3 chat gate builders, `recordPlan`, `planModeEnabled` | `session/modeConfig.ts#applyModeConfig(cfg, {attended, gates, turns, permissionSource})`. The handlers become thin adapters that look up the **current** turn in `turns` and call `gates.*` |
| `buildPermissionHandler` CMS:586, `buildQuestionHandler` CMS:695, `buildPlanReviewHandler` CMS:429, `recordPlan` CMS:856, `reviewRecordedPlan` CMS:925 | `(chatId) => handler` | `agentInteractionService`, `planService`, `turnContexts`, `eventBus`, `chatRepo` | stay in CMS as the **ChatGatePort** implementation (chat-specific event names and persistence) |
| `buildPermissionHandler` SES:701 | `(workflowRunId, stageRunId, groups?, semaphoreCallbacks?) => handler` | `workflowRunRepo`, `hitlService` | **StageGatePort** in SES. The `deniedByAgent` part (SES:710-717) moves into a shared `withAgentToolPolicy(gate, groups)` wrapper used by **both** owners (fixes A5) |
| `formatConversationBindingKey` CMS:1261 | `(parts:{harnessType,model,agentRef,agentVersion,permissionMode?}) => string` | `computerService.isEnabled` | `session/bindingKey.ts`. Add a tool-surface hash so stage single-mode can compare (fixes C-1b) |
| `resolveStageTurnOptions` SES:3399 | `(stageDef) => SendPromptOptions` | — | `ComposeResult.turnOptions(agentMode)` using `resolveTurnPermissionMode(agentMode, await source.read())` |
| listener + `finalizeTurn` CMS:2884-3225; SES:1376-1481; SES:3019-3078 | inline closures | `messageRepo`, `eventBus`, `workspaceCheckpointService` | `session/TurnRecorder.ts` (tool-call merge by callId, `success`, `fileOp`, `sequence`, `parentId`, `textSegments`, `providerAnchor`, partial-on-cancel, live checkpoint). Owners pass `enrich(event)` (chat: `chatId`; stage: `stageRunId`, `workflowRunId`, `__isInternalTurn`) and `messageMeta` |
| `rememberProviderSession` CMS:3379 | `(sessionId, conversationId, known?) => Promise<void>` | `harness.getProviderSessionId`, `sessionRepo` | `session/providerSession.ts`, called by both on `harness.idle` |

### 3.4 `TurnContextRegistry` (the fix for the closure problem)

Chat already solves this: its gates are installed once and read `this.turnContexts.get(chatId)` lazily (CMS:283-290, 433, 589). Generalise it and key it by **conversationId**:

```ts
interface TurnContext { owner: SessionOwner; turnId: string; agentMode: AgentMode;
  permissionMode: HarnessPermissionMode; planIds: string[]; interactionIds: string[];
  nextSequence: number; cardSequence: Map<string, number>;
  semaphore?: { pause(): void; resume(): Promise<void> } }   // stage only
class TurnContextRegistry { set(conversationId, ctx); get(conversationId); delete(conversationId) }
```

In `single` session mode, stage N sets the context for the shared conversation before each turn. A permission request is then filed against **the active stage run** instead of stage 1's (fixes B-9/C-1b). The `semaphoreCallbacks` currently threaded into the closure (SES:1322-1327) live on the context.

### 3.5 Who calls it

* **CMS.createChat**: `normaliseSources` → workspace → `composer.compose({mode:'create', …})` → `harness.createConversation(params)` → persist `agentSnapshot = redactProjection(projection)`. About 400 lines (CMS:1703-2053) collapse into one call.
* **CMS.buildConversationConfig**: `composer.compose({mode:'resume', agentSnapshot, resumeProviderSessionId, …})`. The create/resume drift disappears because there is only one code path.
* **SES.executeStage**: `spec = resolveSessionSpec(workflow.session, stage.session, runOverrides)` → `compose({owner:{kind:'stage',…}, workspace: runWorkspace, permissionSource:{kind:'run'}, gates: stageGatePort})` → `sessionAllocator.allocateSession(..., result)`. The allocator compares `bindingKey` in single mode: if it differs, it calls `harness.resumeConversation(conversationId, params)`, the same rebind trick CMS:2725-2736 uses (history kept, tools/model swapped), or allocates fresh when the provider changes.
* **SES per turn**: `turns.set(conversationId, ctx)` → `prompt = await result.preparePrompt(...)` → `sendPromptAndWait(conv, prompt, attachments, signal, await result.turnOptions(stageDef.agentMode))`.

### 3.6 Extraction steps, in dependency order

Each step is behaviour-preserving for chat unless noted. Golden tests come first.

0. **Golden snapshot tests.** Serialise the composed config (tool names in order, system message, MCP keys, excluded lists, gate presence) for: chat create, chat resume, orchestrator chat, worker chat, stage (current). Record the create/resume drift as a *known diff* to be fixed in step 4.
1. **Pure helpers** `appendSystemBlock`, `appendTools`, `unionList` (`session/cfg.ts`). Replace the inline copies in CMS and SES. No behaviour change.
2. **`PlatformToolBinder`** extracted from CMS; CMS create and resume both call it. No behaviour change (tool order preserved).
3. **`resolveMcp`** extracted; SES calls it (fixes C-2, M1 precedence). Emit `dropped` as `harness.session_info`.
4. **Unified `applyAgentProjection` + `applyExplicitSpec` + `appendAgentInstructions`.** Replace `resolveStageAgent`. Fixes A2, A3, S1/C-8, the chat create/resume precedence drift, and the missing `systemPromptAppend`/`maxTurns`. Stage staging root = `findWorkspaceByOwner(runId).rootPath`. Persist a stage `agentSnapshot` on the stage run for retries.
5. **Workspace exposure for stages.** Needs the run's `ExecutionWorkspace`. First set `__workspaceId` on the orchestrated path (C-6), or better read it from the run row. Gives stages `additionalDirectories`, `env` and the workspace hint.
6. **`TurnContextRegistry` + `GatePort`.** Chat: wrap the existing handlers (ChatGatePort). Stage: StageGatePort over `HitlService`, plus `question` via `AgentInteractionService` `stage_run` scope (P4). Add the shared `withAgentToolPolicy` wrapper to both (A5).
7. **`PermissionModeSource` + `turnOptions`.** Stage reads `run.permissionMode` per turn, defaulting to the deployment posture (C-5/C-9). Follow-ups get turn options (P2).
8. **`SessionComposer.compose`** assembles 1-7. CMS create/resume and SES call it. Delete the old copies.
9. **SessionAllocator single-mode rebind** on `bindingKey` change (C-1b/B-9).
10. **`TurnRecorder`**: replace the three listeners (CMS:3010-3225, SES:1393-1481, SES:3024-3078). Adds success/fileOp/sequence/live checkpoint to stages. Add `rememberProviderSession` for stage sessions (L7).
11. **Binder feature flags for stages**: widgets on (gated by `groups.widgets`); computer **off unless `spec.computerUse === true` and the run is not bypass**; orchestrator via agent role; custom tools on (minus authoring).
12. **`TurnRunner`** (send / cancel / busy guard) and the stage conversation routes + UI (§4).
13. **`SessionSpec`** schema + migration (§5), then capability validation at save time (C-11).

---

## 4. Stage-as-chat interaction

### 4.1 What a user can do on the run page today

| Action | Possible? | Evidence |
|---|---|---|
| Send a free-form follow-up to a **running** stage | ❌ | No composer on RUNPAGE. `sendStageFollowUp` is reachable only via approve + `followUpPrompt` (`routes/workflowRuns.ts:524-553`) or a review batch while a stage is `awaiting_input` (RUNPAGE:617-628, `routes/review.ts:278-287`) |
| Follow up on a **completed** stage | ❌ in practice | Per-stage sessions are released on completion (SES:2612-2618). The follow-up then finds no conversation, `console.warn`s and returns (SES:2991-2999). **[new]** The review route still marks the batch `delivered = true` (`routes/review.ts:282-288`) although nothing was sent |
| Steer or interrupt the current turn | ❌ | No Stop. `usePauseStageRun`/`useCancelStageRun` exist (`hooks/workflowQueries.ts:400, 424`) but RUNPAGE imports only retry/wake (RUNPAGE:27-33) |
| Attach files | ❌ | — |
| Approve a tool | ◐ | `InlineHitlControls` on `awaiting_input` (STI:363-371), not the PermissionCard. Web run permission mode is hard-wired to bypass by UI copy (RUNPAGE:753-755); mobile has `PermissionModeSheet` |
| Answer an agent question | ❌ | No `onQuestionRequest` on stages |
| Change model/mode for the next turn | ❌ | — |

A follow-up that *does* run also has problems:
* It flips a **completed** stage `running → completed` (SES:3002, 3087) outside the state machine (B slice).
* It has no heartbeat (B-2).
* It sends no turn options (SES:3085).
* It re-emits `stage_run.completed`, which re-enters `onStageCompleted` validation through the reconciler.

### 4.2 "Stage is a chat" UX

**Server:**

* `POST /workflow-runs/:runId/stages/:stageId/messages` (multipart: `prompt`, `attachments[]`, `mode`) → `StageConversationService.send(stageRunId, prompt, attachments, mode)` built on the shared `TurnRunner`:
  * busy guard: 409 `STAGE_BUSY` while the stage script is mid-turn, *or* enqueue as the next operator turn. **Decision needed.**
  * `turns.set`, `preparePrompt`, `turnOptions`, `TurnRecorder`, checkpoint.
* `POST /workflow-runs/:runId/stages/:stageId/turn/cancel` (`force`, `budgetSeconds`) → `TurnRunner.cancel`. This is distinct from stage cancel, which fails the stage.
* `POST /workflow-runs/:runId/stages/:stageId/interactions/:iid/{permission|answer}` → the gate port resolves.
* Stage gates emit the **same event shapes** as chat (`*.permission.requested/resolved/expired`, `*.question.asked`, `*.plan.review_requested`), with `stageRunId` instead of `chatId`. Emit on the stage session; the composition-root bridge already republishes events carrying `workflowRunId` to the run scope. StreamPanel then renders `PermissionCard`/`QuestionCard` unchanged, and push gets the chat-style lock-screen actions (`notificationPolicy.ts:154-230`).
* **Post-completion follow-ups** need the conversation to be resumable. Record `providerSessionId` for stage sessions (L7) and on follow-up re-compose with `mode:'resume'` (like CMS:2725-2769). Semantics decision: a follow-up on a completed stage **amends** its output (append to the `stage-output` artifact, mark `amendedAt`) and **does not** re-run successors automatically. The UI offers "Re-run downstream from here".

**Web (reuse, don't fork):**

* In STI, below `StreamPanel` (STI:308-316), render `<ChatInput customSendFn={(a)=>platform.sendStageMessage(runId, stage.id, a)} sessionId={`stageRun:${id}`} agentMode … isStreaming stopState onStop />` for the **focused** stage only, in a compact variant with the model selector off by default.
  * `ChatInput` props already cover attachments, mode, stop state, `pendingInteractionLabel` and `workspaceId` for `@` mentions (`ChatInput.tsx:67-157`).
* Pass `widgets` + `streamKey="stageRun:<id>"` to StreamPanel, and the permission/question answer callbacks StreamPanel already accepts (`StreamPanel.tsx:102-110`).
* Keep `InlineHitlControls` **only** for `stage_completion_review` (P9). Route tool approvals through `PermissionCard`.
* Right pane:
  * Widget tab becomes live once T3 lands.
  * Add a Computer tab (T2 consent).
  * Add a context gauge chip next to `UsageChip` (R5).
  * Add a run permission-mode control to `RunHeaderBar` (the mobile sheet already exists).
* Transcript on reload: stage messages are persisted with `sessionId + metadata.stageRunId` (SES:1959-1965). They need `turnId` (L6) so history and live dedup work the way `ChatMessageList` expects.

**Mobile:** `StageTranscriptInline.tsx` and `ApprovalCard.tsx` exist. Reuse `components/chat/Composer.tsx` with a stage send function, the same way web does.

**TUI:** the chat permission POST exists (`apps/cli/src/tui/App.tsx:181`). With chat-shaped stage gate events the same key bindings work.

---

## 5. Stage config streamlining: one `SessionSpec`

### 5.1 Duplication today

| Concept | Chat (`CreateChatParams`, `shared/src/types/Chat.ts:139-201`; zod `AgentHarnessConfigSchema`, `shared/src/config/ChatSchemas.ts:33-86`) | Workflow / stage (`HarnessConfig`, `shared/src/types/Workflow.ts:12-50`; zod `HarnessConfigSchema`, `WorkflowDefinitionSchemas.ts:67-110`; `StageDefinition`, `shared/src/types/StageDefinition.ts:74-146`) |
|---|---|---|
| model | `model` **and** `harnessConfig.model` | `harnessConfig.model`, `harnessConfigOverrides.model` |
| provider routing | `harnessConfig.harnessType` | same (no UI) |
| reasoning / contextTier / maxTurns / BYOK `provider` | `harnessConfig.*` | same |
| agent binding | `agentRef` **and** `harnessConfig.agentRef`; `agentOverrides` **and** `harnessConfig.agentOverrides` | `stage.agentRef`, `stage.agentName` (deprecated), `harnessConfigOverrides.agentRef`, workflow `harnessConfig.agentRef`, **workflow `defaultAgentRef` (persisted by `WorkflowDefinitionService.ts:188-195`, no runtime reader in `packages/core/src` — grep)** **[new]** |
| skills | `harnessConfig.skillDirectories/disabledSkills`, `agentOverrides.addSkillIds` | same + **dead** `stage.skills` + workflow `skills[]` / `selectedArtifacts.skillIds` + run uploads `__skillDirectories` |
| MCP | `harnessConfig.mcpServers`, `excludedMcpServerIds` | same (stage deep-merges `mcpServers`, SES:1159) |
| tools | `availableTools/excludedTools` | same |
| permission | `permissionMode` **and** `harnessConfig.permissionMode` (enum without `dontAsk`) | `harnessConfig.permissionMode` (enum **with** `dontAsk`) + **run** `permissionMode` (the one actually used, SES:738) |
| mode | `defaultAgentMode` | `stage.agentMode` + `harnessConfig.defaultAgentMode` (resolver only) |
| plan instructions | `harnessConfig.planModeInstructions` | same (never applied on stages) |
| browser | `browserConfig` | workflow `browserConfig` + **dead** `stage.browserConfig` |
| attachments | per turn | **dead** `PromptDefinition.attachments` |
| system message | `harnessConfig.systemMessage/systemPromptAppend` | same |
| orchestrator | `orchestratorMode` | (implicit via agent role, not honoured) |

The two zod schemas are near-copies that have already diverged: the permission enum, bounds (`.max(500)` only in chat), and the `harnessType` position.

### 5.2 Proposal

```ts
// packages/shared/src/types/SessionSpec.ts
export interface SessionSpec {
  // runtime
  model?: string;
  harnessType?: HarnessProviderId;
  reasoningEffort?: ReasoningEffort;
  contextTier?: 'default' | 'long_context';
  maxTurns?: number;
  provider?: BYOKProviderConfig;
  // agent
  agentRef?: string;
  agentOverrides?: AgentOverrides;          // addSkillIds / MCP add-remove / tool-group delta / appendInstructions
  // instructions
  systemMessage?: { mode: 'append' | 'replace'; content: string };
  systemPromptAppend?: string;
  planModeInstructions?: string;
  // capability surface
  tools?: { available?: string[]; excluded?: string[] };
  mcp?: { servers?: Record<string, McpServerConfig>; excludedIds?: string[] };
  skills?: { directories?: string[]; disabled?: string[] };
  customAgents?: CustomAgentConfig[];
  // interaction policy
  permissionMode?: PermissionMode;          // ONE enum incl. dontAsk
  defaultAgentMode?: AgentMode;
  // platform integrations (all gated again by the agent's toolPolicy.groups)
  browser?: BrowserConfig;
  computerUse?: boolean;                    // default: chat=feature flag, stage=false
  widgets?: boolean;                        // default true
  orchestrator?: boolean;                   // default: from agent role
}
```

* Zod: `SessionSpecSchema` in `packages/shared/src/config/SessionSpecSchema.ts` with the chat bounds. `CreateChatSchema.session`, `CreateWorkflowDefinitionSchema.session` and `CreateStageSchema.session` (partial) all reuse it.
* Chat: `CreateChatParams = { name, description, projectId, sources, primary, tags, sourceControl, session: SessionSpec, … }`. The legacy flat fields are mapped by `normaliseChatSpec()` for one release.
* Workflow: `WorkflowDefinition.session: SessionSpec` replaces `harnessConfig`, `defaultAgentRef` and `browserConfig`. `run.permissionMode` stays as a **run-time override** (HITL control), and `PermissionModeSource` layers it on top of `session.permissionMode`.
* Stage: `StageDefinition.session?: Partial<SessionSpec>` replaces `harnessConfigOverrides`, `agentRef`, `agentName`, `agentMode` (→ `defaultAgentMode`), `skills` (delete), `browserConfig` and `PromptDefinition.attachments`. The script fields (prompts, contextFilter, outputFormat, validation, approvalRequired, retry, timeout, hooks, condition) stay on the stage.
* One pure merge: `resolveSessionSpec(...layers: Partial<SessionSpec>[]): SessionSpec`. Scalars are most-specific-wins; `tools.excluded`, `mcp.excludedIds` and `skills.disabled` union; `mcp.servers` is key-merged (most specific wins per key); `agentOverrides` is delegated to the resolver's existing fold. This replaces SES:1131-1165 and the implicit rules in `AgentResolver`.
* DB: keep the JSON columns (`harness_config`, `harness_config_overrides`) and store the new shape with `specVersion: 2`. A read adapter upgrades v1 on load, so no destructive migration is needed.
* Builder: `StagePropertiesPanel` "Model & Template" becomes a shared `SessionSpecEditor` also used by `CreateChatDialog`: model, effort, contextTier, harnessType, agent, mode, skills, MCP, permission, browser/computer/widgets toggles. Validate against `capabilitiesFor(harnessType|model)` at save time (C-11).

---

## 6. Risks

1. **Prompt-cache invalidation.** Any change to tool order or system-block order costs a one-time full cache miss on every live chat (CMS:1998-2000). Mitigation: step 0 golden tests plus preserving the create-path order. The stage order *will* change (agent instructions move last), which is intended.
2. **Behaviour change for existing workflows.** Widgets, custom tools and the real MCP credentials start reaching stages. MCP servers that silently failed (C-2) will now work, including their side effects. Computer use must be **opt-in per stage and blocked on bypass runs**: unattended desktop control is the most dangerous tool the platform has.
3. **Extension-authoring tools.** The review-5.3 gate (`selectCustomTools`) must travel with the binder. Stages must never get `write_extension`/`reload_extension` by default.
4. **Two HITL systems.** Unifying the *port* is safe. Unifying the *store* is not: chat gates expire on boot by design, stage gates survive. StageGatePort must keep `HitlService` (or give `AgentInteractionService`'s `stage_run` scope restart semantics).
5. **Permission default flip.** Deriving stage per-turn mode from `run.permissionMode` with the deployment default (acceptEdits off-loopback) makes previously silent Claude/Codex stages prompt or park. That is correct (C-5/C-9) but visible. Ship it with the run-page permission control.
6. **Single-mode rebind.** Resuming the shared conversation with a different model or provider may not be supported across providers. Fall back to a fresh session plus a recap (SES:1532-1573 already implements the recap).
7. **Follow-ups on completed stages.** They create output that successors have already consumed. The "amend, don't auto-re-run" rule and the UI affordance must land together. The state-machine transitions need to be legalised (B slice table).
8. **Provider capability gaps.** opencode/acp ignore tools, MCP and gates (C matrix). Parity on paper is not parity in practice. The composer `warnings` must be surfaced, or stage saves on those providers must be refused.
9. **Test surface.** CMS and SES have extensive suites (the B slice ran 25 files). Extraction touches config shape assertions. Keep a compatibility shim (`ChatManagementService.buildConversationConfig` delegating) until the suites are migrated.
10. **Windows / OneDrive.** Skill staging moves to the managed root, which is already the chat path. No new file-system risk.
