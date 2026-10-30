# D — Workflow module: Web UI audit (builder, stage options, run page, right pane, client streaming)

Branch `desktop_redesign`. Read-only static trace (handler → network call → server route/service → repo/runtime). Nothing below was reproduced live in this pass unless it says so; every claim has a file:line. Paths are relative to the repo root; `web/` = `apps/web/src/`.

## Prior-audit fixes: are they in this branch?

| Prior fix | Status | Evidence |
|---|---|---|
| Edge-type picker | Present | `web/components/workflow/StageEdge.tsx:103-119,175-210`; save does delete-and-re-add on retype `web/pages/WorkflowBuilderPage.tsx:407-437` |
| VariableInputModal re-seeds on open | Present | `web/components/workflow/VariableInputModal.tsx:109-126` |
| Stage overrides on plain definitions | Present, with a hole | both pages call `encodeStageOverrides` (`WorkflowBuilderPage.tsx:504,518`, `WorkflowDefinitionPage.tsx:147,162`). **The hole:** the no-variables branch of the modal drops overrides entirely (D-15) |
| Variable default type coercion | Present | `web/components/workflow/settings/VariablesTab.tsx:32-45,236-241,292` |
| Custom-expression placeholder | Present | `web/components/workflow/StagePropertiesPanel.tsx:367-372`. **But:** the same class of bug is still live on the regex validation rule (D-26) |
| Undo/redo history coalescing | Present | `web/stores/workflowBuilderStore.ts:454,560-588`; `resetBuilder` seeds entry 0 at `:346` |
| Hooks tab `hooks: undefined` | Present | `workflowBuilderStore.ts:302` (`?? []`); create path sends hooks at `WorkflowBuilderPage.tsx:319` |
| Wake-now button | Present and wired | `StageTimelineItem.tsx:297` → `WorkflowRunPageV2.tsx:415-420` → `useWakeStageRun` (`workflowQueries.ts:410-413`) → `POST /workflow-runs/:runId/stages/:stageId/wake` (`HttpPlatformClient.ts:1156-1158`) |
| Workflows list virtualization (13,887 nodes / 495 ms) | Present | `web/pages/WorkflowListPage.tsx:103-163,581-656` (`@tanstack/react-virtual`, grid chunked by row) |

---

## (a) Builder flow

### Entry points
- **List page** (`WorkflowListPage.tsx`) has five entry points. **New Workflow** navigates to `/workflows/new` (`:413-419`; also the empty-state button at `:570-576`). **Upload JSON** (`:403-411`, handler `:207-248`) checks the file client-side (`.json`, ≤5 MB, a `name` field, a non-empty `stages` array), calls `useImportFromJSON` (`POST /workflow-definitions/import`, server `ImportWorkflowJsonSchema` at `packages/shared/src/config/WorkflowDefinitionSchemas.ts:352-377`) and on success navigates to `/workflows/:id/edit`. The server message shows in a `<pre>` banner (`:425-442`). **Template** (`:250-310`) downloads a sample JSON. **Browse templates** opens Settings → Templates (`:538-556`). The card's **Run** icon only navigates to the definition page (`:608`); it does not start a run.
- **Export JSON does not exist anywhere in the web UI.** `HttpPlatformClient.exportDefinition` (`web/platform/HttpPlatformClient.ts:2598`) has no callers (UX gap).
- **Builder** (`WorkflowBuilderPage.tsx`) resets the store on every `id` change (`:194-198`) and then runs `loadDefinition(definition)` whenever the query data changes (`:200-204`). **Note:** this effect also fires on every refetch triggered by save mutations; this is the root of D-3.

### Adding a stage (every entry point)
1. Canvas "Add Stage" pill (`DAGCanvas.tsx:268-290`) calls `handleAddStage` (`WorkflowBuilderPage.tsx:231-248`).
2. The empty-state "Add First Stage" button (`DAGCanvas.tsx:305-315`) calls the same function.
3. The Duplicate icon on a node (`StageNode.tsx:175-185`) calls `duplicateStage` (`workflowBuilderStore.ts:467-492`).
- **No** drag-from-palette, **no** context menu, **no** keyboard "add", and **no** toolbar "Add Stage" button. `Plus` is imported in the page but unused (`WorkflowBuilderPage.tsx:17`).
- New stage IDs are local: `stage-${Date.now()}-xxxxx` (`WorkflowBuilderPage.tsx:235`, store `:472`). Names are `Stage ${nodes.length+1}`, so names repeat after a delete (D-28).

### Connecting edges and choosing the edge type
- You drag handle to handle (`StageNode.tsx:132-155`). `onConnect` (`workflowBuilderStore.ts:388-424`) rejects self-edges, duplicates and cycles, and always creates an `on_success` edge with the local id `edge-<src>-<tgt>`.
- The type is chosen from the edge badge menu (`StageEdge.tsx:144-210`), which calls `updateEdgeType` (store `:513-525`; this is recorded in history). An edge is deleted with the hover ✕ (`StageEdge.tsx:162-173`) or the Delete/Backspace key (`DAGCanvas.tsx:117-124`).

### Validate button
- `handleValidate(true)` (`WorkflowBuilderPage.tsx:251-263`) calls the **client-only** `validate()` (store `:624-713`). It checks: no stages, cycles, self-edges, duplicate edges, a stage with no prompts and no agent, and `{{var}}` references that are not declared. On success it shows a "Workflow is valid" chip for 3 s (`:641-645`).
- It does **not** call the server's `POST /workflow-definitions/:id/validate` (`useValidateWorkflowDefinition`, `workflowQueries.ts:128-133`, which has zero callers). The `orphan` error type is declared (store `:49`) but never produced. For what it misses, see D-25.

### Save diffing (`handleSave`, `WorkflowBuilderPage.tsx:295-464`)
- **Create path** (`isNew || !definitionId`, `:305`): `POST` the definition, then `setDefinitionId` (`:322`, set before the stages are saved), then add each stage one after another while building `localToServerId` (`:325-333`), then add each edge with remapped IDs (`:336-349`), then navigate to `/:id/edit`.
- **Update path** (`:356-444`): `PATCH` the definition, then delete stages that are on the server but not local (`:379-383`), then update or add each local stage (`:386-401`, **the new server IDs are discarded**), then delete edges that are on the server but not local, plus retyped edges (`:419-423`), then add edges that are local-only or retyped **using raw `edge.source`/`edge.target` with no remap** (`:426-436`).
- There is no transaction and no rollback. A failure aborts part-way through (`:445-450`). The diff uses the `definition` captured in the closure (stale) as the "server state".

### Undo/redo
- Toolbar buttons (`:655-672`) and Ctrl+Z / Ctrl+Shift+Z (`DAGCanvas.tsx:126-136`, skipped while an input has focus) drive history. History records add, remove, duplicate, connect, edge retype, stage property edits (coalesced) and drag end (`store :373-375`).
- Not recorded: auto-layout (`DAGCanvas.tsx:92-103` → `setNodes`/`setEdges`, store `:355-356`) and all workflow-level settings (variables, hooks, project; history only snapshots nodes and edges, store `:41-44`).
- History is wiped after every save by the refetch → `loadDefinition` (store `:311-312`).

---

## (b) UI control → payload field → persisted? → runtime-honored?

Key: **Persisted** means it survives Save → reload through `toStageParams` (`WorkflowBuilderPage.tsx:66-86`) or the definition PATCH (`:358-371`). The update path is a merge, not a replace: `WorkflowDefinitionService.updateStage` (`packages/core/src/services/WorkflowDefinitionService.ts:298-315`) and `StageDefinitionRepository.update` (`packages/db/src/repositories/StageDefinitionRepository.ts:117-140`) skip `undefined`, and `JSON.stringify` drops `undefined` keys (`HttpPlatformClient.ts:1255`). So **a value that is cleared to `undefined` never reaches the server** (D-4).

### Stage panel: Properties tab (`StagePropertiesPanel.tsx`)
| Control | Line | Writes | Persisted | Runtime honored |
|---|---|---|---|---|
| Stage Name | 175-180 | `name` | Yes (an empty name → 400, min 1) | Yes (display, override matching) |
| Description | 184-191 | `description` (`undefined` when emptied) | Set yes; **clear no** (D-4) | Display only |
| Template select | 199-205 | `templateId` | Set yes; **clear no** | **No.** Nothing in `packages/core/src` reads `stage.templateId` at run time (only `WorkflowDefinitionService.ts:256` copies it). Dead control (D-9) |
| Model Override (ModelPicker) | 209-229 | `harnessConfigOverrides.model` (the whole object becomes `undefined` if model was the only key) | Set yes; **clearing the sole override: no** (D-4) | Yes (routed by model; `harnessType` is never set from the UI, and ModelPicker returns only an id, `components/shared/ModelPicker.tsx:121`) |
| Reasoning Effort | 233-253 | `harnessConfigOverrides.reasoningEffort` | Yes (the whole object is sent) | Yes via AgentResolver projection (`StageExecutionService.ts:405`) |
| Prompts → Inline (PromptEditor) | 293-297; `PromptEditor.tsx:42-80` | `prompts[] {label,text,waitForCompletion}` | Yes, **but a new prompt has `text:''`, which the server rejects** (`PromptDefinitionSchema.text.min(1)`, `WorkflowDefinitionSchemas.ts:15`) (D-5) | Yes (`StageExecutionService.ts:1809-1855`) |
| Prompt "Wait" checkbox | `PromptEditor.tsx:135-143` | `prompts[i].waitForCompletion` | Yes | Yes, but unchecking fires `sendPrompt` without waiting (`StageExecutionService.ts:1995-2018`), a footgun with no explanation (D-33) |
| Prompts → Files (PromptFilePicker) | 299-304; `PromptFilePicker.tsx:30-75` | `prompts[0].attachments[]`; **creates a prompt with `text:''` when none exists** (`:40-48,64`) | Only if an inline text also exists; otherwise Save 400s | **No.** The stage runtime never reads `prompt.attachments`; attachments come only from `variables.__promptDirectories` (`StageExecutionService.ts:1957`). Dead control (D-8) |
| Prompts → Agent (AgentBindingSection) | 305-307; `AgentBindingSection.tsx:256-261` | `agentRef` (null clears) | Yes (explicit null, `WorkflowBuilderPage.tsx:76`) | Yes (AgentResolver) |
| Agent "Customize capabilities" | `AgentBindingSection.tsx:268-289` | `harnessConfigOverrides.agentOverrides` | Yes (clearing the last one can hit D-4 when it leaves the object empty) | Yes (`AgentResolver.ts:116-148`) |
| Skills checklist | `SkillSelector.tsx:55-77` | `harnessConfigOverrides.agentOverrides.addSkillIds`, `disabledSkills` | Yes | Yes (`AgentResolver.ts:116-119`). The StageNode skill pill reads `stage.skills` and never lights up (D-30) |
| MCP Servers checklist | `McpServerSelector.tsx:357-375` | `harnessConfigOverrides.excludedMcpServerIds` | Yes | Yes (`AgentResolver.ts:147-148`). The StageNode MCP pill reads `mcpServers` and never lights up (D-30) |
| Stage Variables (key = value) | 321-326; `VariableEditor` 880-945 | `variables: Record` | Yes | **No.** `WorkflowRunService` launches stages with `run.variables ∪ override.variables` only (`WorkflowRunService.ts:1508-1522`). `stageDef.variables` is never merged. `ConfigResolver.resolveStageConfig`, which would merge it (`ConfigResolver.ts:103-116`), has **zero callers**. The builder's own `{{var}}` validation also ignores stage variables (store `:680`). Dead control (D-7) |

### Stage panel: Execution tab
| Control | Line | Writes | Persisted | Runtime honored |
|---|---|---|---|---|
| Run Condition (always / on_success / on_failure / expression) | 347-374 | `condition {type, expression}` | Yes | Yes (`DAGScheduler.ts:153-161`, `ConditionEvaluator.ts:27-50`). **"On upstream failure" combined with the default `on_success` edge can never run** (D-32) |
| Custom expression input | 360-374 | `condition.expression` | Yes | Yes. There is no syntax check in the UI; an unparseable expression silently fails to false |
| Timeout (seconds) | 376-384 | `timeoutMs` (0 → `undefined`) | Set yes; **reset to 0: no** (D-4) | Yes (`StageExecutionService.ts:1995-1999`) |
| Context from Predecessors | 386-397 | `contextFilter` (full / summary-only / none; **`structured` is missing** though the schema allows it, `WorkflowDefinitionSchemas.ts:247`) | Yes | Yes |
| Approval required | 398-405 | `approvalRequired` | Yes (`?? false`) | Yes (HITL gate) |
| Retry on failure toggle | 409-420 | `retryPolicy` (off → `undefined`) | On yes; **off: no** (D-4) | Yes |
| Max Retries / Backoff / Multiplier | 423-455 | `retryPolicy.*` | Yes | Yes |
| Result Validation rules | 461-464, 673-797 | `resultValidation[]` (all removed → `undefined`) | Add yes; **remove all: no** (D-4) | Yes (`ResultValidator.ts:128-160`). **The regex placeholder `/export\s+default/` never matches** (D-26) |
| Stage Hooks (name, enabled, phase, type, command/url/handler+args, failurePolicy) | 469, 498-660 | `hooks[]` | Yes (`[]` does clear). **An HTTP hook with an empty URL → 400** (`HookDefinitionSchema` `url().url()`, `WorkflowTemplate.ts:73`) | pre_run / post_run / post_prompt / on_error / on_cancel: yes (`StageExecutionService.ts:1278,2049,2288,2651,3263`). `pre_prompt` fires via `HookInterceptor.onUserPromptSubmitted` (`HookInterceptor.ts:382-392`) only on harnesses that call that hook |

### Workflow Settings modal (`WorkflowConfigPanel.tsx`), tab by tab
| Tab / control | Line | Writes | Persisted | Honored |
|---|---|---|---|---|
| General: Name | `GeneralTab.tsx:170-177` | `name` | Yes | Yes |
| General: Description | `:185-192` | `description` (sent as `description \|\| undefined`, `WorkflowBuilderPage.tsx:362`) | Set yes; **clear no** (D-4) | Display |
| General: Session Mode radio | `:201-231` | `sessionMode` | Yes | Yes |
| *(missing)* workflow model / harness config | — | `harnessConfig` is loaded and saved (`:311,364`) but **no control edits it**, even though the stage picker says "Inherit from workflow settings" (`StagePropertiesPanel.tsx:226`) (D-31) | — | — |
| Project & Codebases: Project select | `ProjectCodebasesTab.tsx:71-80` | `projectId` (sent as `?? undefined`, `WorkflowBuilderPage.tsx:367`) | Link yes; **unlink ("No Project") no**, although `UpdateWorkflowDefinitionSchema` accepts `null` (`WorkflowDefinitionSchemas.ts:210`) (D-4) | Yes |
| Codebases checklist (max 3) | `:111-155` | `selectedCodebases` → `orchestratorConfig.codebaseAliases`; also `gitRepositories` | Aliases yes; **deselecting all: no** (`buildOrchestratorConfig` returns `undefined`, `WorkflowBuilderPage.tsx:271`). `gitRepositories` is **stripped by zod**: `OrchestratorConfigSchema` does not declare it (`WorkflowDefinitionSchemas.ts:145-166`) (D-23) | Yes |
| Auto-commit / Push / Create PR | `:168-217` | `orchestratorConfig.autoCommit/autoPush/autoCreatePR` | Yes while ≥1 codebase is selected; the section is hidden otherwise | Yes (per the prior audit) |
| Variables tab: add / name / label / type / required / options / default | `VariablesTab.tsx:63-319` | `variables[]` | Yes, but **renaming loses focus on every keystroke** (`key={variable.name}`, `:153`). **Choice options cannot be typed** (`:270-278`). Invalid names or labels → 400 (D-10, D-11) | Yes |
| Hooks tab (workflow-level) | `HooksTab.tsx:271-436` | `hooks[]` (sent as `length>0 ? hooks : undefined`, `WorkflowBuilderPage.tsx:369`) | Add yes; **removing the last hook: no** (D-4). Empty HTTP URL → 400 | Yes (`executeWorkflowHooks`) |
| Tags | `TagsMetadataTab.tsx:252-268` | `tags[]` | Yes (the 50-char / 20-tag limits are not enforced client-side → 400) | Filter/search only |

### Fields with no builder UI at all
`toStageParams` does not send `outputFormat`, `outputSchema`, `expectedOutput`, `contextSources`, `iterationConfig`, `agentMode`, `browserConfig`, `promptType`, `skills` or `agentName`. They survive editing (merge semantics), but they are **dropped from a duplicated stage on save** (D-27). Workflow-level `browserConfig`, `defaultAgentRef`, `permissionMode`, `useWorktree` and `selectedArtifacts` also have no UI.

---

## (c) Run launch configuration (VariableInputModal)

Opened by Run in the builder (`WorkflowBuilderPage.tsx:467-477`, requires only a `definitionId`, **not a clean save**, D-17) and by the definition page (`WorkflowDefinitionPage.tsx:179-182`).

What the user can configure per run:
| Item | Where | Wire |
|---|---|---|
| Declared variables (string / number / boolean / choice / text) with required, number and choice checks | `VariableInputModal.tsx:190-253,371-448` | Converted to types, defaults re-applied when blank |
| Git variables (`git_url`/`repo_url`/…, `branch`/…) auto-filled from linked codebases and hidden | `:61-70,74-93,128-142` | The builder derives these from store `selectedCodebases`. **The definition page derives them from `orchestratorConfig.gitRepositories`, which the server strips, so they are never auto-filled there** (D-23) |
| Stage overrides: **skip only** | `:450-506` | `__stageOverrides` variable (plain) or top-level `stageOverrides` (orchestrated) via `encodeStageOverrides` (`packages/client-core/src/api/stageOverrides.ts:73-82`). **Rendered only when at least one variable is displayable; the no-variables branch calls `onSubmit({}, uploads)` with no overrides** (`:281`) (D-15) |
| Upload prompts / skills / agents files | `:509-516,529-625` | Orchestrated: form upload. Builder plain path: create → upload → start (D-14) |
| Model per run | — | **Not offered** |
| Codebase / branch per run | — | **Not offered** (fixed by the definition) |
| Per-stage variables / timeout / contextFilter / agent | — | The server supports them (`StageRunOverrideSchema`, `WorkflowDefinitionSchemas.ts:386-399`) but there is **no UI** (the StageOverrideEntry `variables` field is always `{}`) |
| Permission mode / session mode / run name | — | **Not offered** (the page comment says permission mode is always bypass, `WorkflowRunPageV2.tsx:753-755`) |

Launch paths differ between the two pages:
- Builder: orchestrated iff `projectId || gitRepositories.length` (`WorkflowBuilderPage.tsx:490`). Plain path = `createRun` → `uploadRunFiles` → `startRun` (`:516-524`).
- Definition page: orchestrated iff `orchestratorConfig` exists **or any uploads** (`WorkflowDefinitionPage.tsx:128`). Its comment says the create/upload/start sequence "writes to a fallback folder that is abandoned when startRun provisions the workspace" (`:124-127`), which is exactly what the builder still does (D-14).
- Both swallow failures with `console.error` only (`WorkflowBuilderPage.tsx:531-533`, `WorkflowDefinitionPage.tsx:170-172`) (D-13).

---

## (d) Run page and the right pane, tab by tab (`WorkflowRunPageV2.tsx`)

### Data sources
- `useWorkflowRun` polls every 5 s until the run is terminal (`workflowQueries.ts:270-284`) → `setRun` into `workflowRunStore` (`:183-185`).
- `useWorkflowDefinition` supplies stage definitions and edges.
- `useRunWorkspace` polls every 10 s **unconditionally, forever** (`workflowQueries.ts:501-509`).
- `useRunScratchpad` polls every 3 s while active and fetches **the whole scratchpad** (`:536-545`).
- `connectWorkflowRun(runId)` provides live SSE (`:247-251`).
- `streams` = `pickStageStreams` over `useStreamStore` with `useShallow` (`:98-104`).
- `permissionMode` comes from a one-shot fetch (`:264-271`).
- `deriveRunView` (`deriveRunView.ts:227-378`) is recomputed on every `elapsedMs` tick, i.e. every second (`:275-285`, timer at `workflowRunStore.ts:287-297`).

### deriveRunView mapping (`deriveRunView.ts`)
| StageView field | Source | Notes |
|---|---|---|
| status | `sr.status` via `STAGE_STATUS_MAP` (`:22-33`) | Live from the SSE `stageStatus` effect or the 5 s poll |
| order / depth / dependsOn | sort by def `order` then `startedAt` (`:239-251`); Kahn depth (`:53-94`) | |
| steps / stepsDone | `deriveTimeline(stream.blocks)` (`:269-271`) | **Live stream only.** Empty if the stream was evicted (D-21) |
| answer / segments | persisted `sr.outputText` when terminal or awaiting, else streamed (`:284-287`) | Good reload fallback |
| interrupt (HITL) | `sr.interruptData` (`:291-310`) | **Only arrives with the 5 s poll** (D-19) |
| files | `sr.artifactManifest` (`:316-321`); page fallback = the whole run workspace listing, every file marked "added" (`WorkflowRunPageV2.tsx:473,765-800`) | Misleading (D-22) |
| hooks | `stream.hooks` filtered by stageRunId (`:183-194`) | Live only; empty after a reload |
| usage / contextUsage | stream (`:196-208,361-362`) | Live only |
| prompt | the first prompt only, interpolated (`:334-336`) | |
| model | **always `undefined`** (`:364`) | Dead field |

### Main column (timeline)
- `StageTimelineItem` (`redesign/StageTimelineItem.tsx`) per stage. Clicking the header focuses and toggles the stage. `StreamPanel` renders steps, answer and error (`:308`).
- Per-stage controls:
  - **Retry** (failed only, `:235`) → `useRetryStageRun` → `POST …/stages/:id/retry`. Works.
  - **Wake now** (sleeping, `:297`). Works.
  - **Stage actions "…" button: `onClick={(e) => e.stopPropagation()}` and nothing else** (`:244-256`). Dead control (D-18).
  - Chips: files / Structured output / Details → open the Inspector (`:335` etc.). "Structured output" does not switch the Inspector to its Output tab.
  - Skip note falls back to "Condition not met" (`:381`).
- HITL `InlineHitlControls` (`:362`, component `InlineHitlControls.tsx`): Approve → `resumeStage({approved:true})`; Request changes (feedback required) → `outcome:'changes_requested'`; Reject (two-step confirm) → `outcome:'rejected'` (`WorkflowRunPageV2.tsx:366-408`). There is **no pending or disabled state** while in flight, and errors are `console.error` only.
- "Show event timeline" opens a modal with `RunTimeline` built from `run` (`RunTimeline.tsx:224-231`). **Clicking an entry calls `selectStageRun` on the store, which V2 never reads** (D-20).
- Graph toggle → `RuntimeDAGCanvas`. **Node clicks also only set `store.selectedStageRunId`** (`RuntimeDAGCanvas.tsx:164-181`, `RuntimeStageNode.tsx:113-115`), so the page's focus (`focusedStageId`, local state `:117`) does not follow (D-20).
- `PipelineFlow` pills → `focusStage`. Works.

### Header controls (`RunHeaderBar.tsx`) → network
| Button | Condition | Handler | Call | Feedback |
|---|---|---|---|---|
| Pause | running/starting (`:128`) | `handlePause` (`WorkflowRunPageV2.tsx:352`) | `POST /workflow-runs/:id/pause` | none; `void mutateAsync`, rejection unhandled |
| Resume | paused (`:139`) | `:353` | `POST …/resume` | none |
| Cancel | running/paused (`:150`) | `:354` | `POST …/cancel` | **no confirmation**, no error display |
| Retry | failed/cancelled (`:161`) | `:357-364` | `POST …/retry` → navigate to the new run id | `.then` only, no `.catch` |
| (none) | completed | — | — | no "Re-run" for completed runs, no "Cancel" for a `created` run |

### Right pane (`RightPane`, tabs at `WorkflowRunPageV2.tsx:592-733`)
| Tab | Data source | Populated? |
|---|---|---|
| **Changes** (default) | `ChangesSurface` on `runData.workspaceId`, review scope run, `reviewTarget` = the awaiting stage (`:602-646`) | Yes when the run has a workspace. Otherwise an honest empty state |
| **Files** / per-file tabs | `useFileTabs` → `FilesSurface` on the workspace (`components/diff/useFileTabs.tsx`) | Yes |
| **Inspector** → Files | `stage.files` (manifest) else the run-wide listing | Populated but **misleading**: every stage shows every run file as "A" (D-22) |
| Inspector → Output | scratchpad text (`:465-481`) + `outputData` + `summary` | Yes (3 s polling while active) |
| Inspector → Hooks | `stream.hooks` | **Live only**; "No hooks fired" after a reload or eviction |
| Inspector → Tools | `stage.steps` from stream blocks | Live only; empty after eviction |
| **Browser** (≤5) | `BrowserPanel` on the workspace; auto-opens on `browser.session_created` via the mux `session` scope (`:199-244`) | Yes (on demand) |
| **Terminal** (≤4) | `TerminalPanel` PTY in the workspace plus a worktree selector (`:694-718`) | Yes |
| **Widget** | `WidgetHost sessionId="stageRun:<id>"` (`:719-731`) | **Dead.** Still no widget tools for stages: `buildWidgetTools` is bound only in `ChatManagementService.ts:1903,2413`, and `StageExecutionService`/`WorkflowRunService` contain no "widget" references (D-16, carried over from the prior audit and still open) |

---

## (e) Client streaming analysis

**Transport.** There is one multiplexed `EventSource` per tab (`web/platform/muxStream.ts:1-31`). Per-scope cursors are POSTed on reconnect, frames are deduped on the global cursor id, and subscriptions are reconciled from `hello`/`subs`. The run page subscribes to scope `run:<runId>` via `openConnection` (`web/stores/sseManager.ts:756-1262`), which is ref-counted per scope.

**Hydrate / replay.** After `onOpen` (or a 1 s fallback), `startHydration` pages `platform.streamReplay('run', runId, afterSeq, 500)` until exhausted (`:828-988`). Rows are grouped by `payload.stageRunId` and each settled stage group is replayed into `stageRun:<id>` (`:895-944`). Session-level events are replayed separately. Stage→session mappings are registered from `stage_run.running`. Live frames that arrive during the replay are buffered and flushed afterwards with seq dedup (`:1030-1044`). There is gap-fill on `onResync` and a stall watchdog (`:1100-1262`).
- Cost: `replayAccumulated` re-maps **all** accumulated rows on every page (`:879-889`), which is O(n²/500) work. `allRows` holds the full history in memory until hydration ends. A 20k-event run means about 40 pages × up to 20k-object maps, plus a second full pass through a throwaway router for invalidations (`:1008-1020`) (D-24).

**Reducers.** Router effects are applied by `applyHostEffect` (`sseManager.ts:461-590`):
- `runStatus` → `updateRunStatus`.
- `stageStatus` → `updateStageRunStatus` (`workflowRunStore.ts:233-270`). This copies only `error`, `sessionId` and `currentStep`. **`interruptData` in `data` is dropped** (D-19). Status events for stage runs that are not yet in the store (retries, iterations) are ignored until the next poll.
- `runTimeline`/`stageTimeline` → `addTimelineEvent`. This array is **never read by any component** (write-only, D-34).
- `stageAwaitingInput` → `awaitingInputStages`, also write-only.
- Stage transcripts are intentionally **not** cleaned up (`packages/client-core/src/stream/eventRouter.ts:834-838`).

**Ordering / consistency.** Two writers own `run`: the SSE effects and the 5 s poll's `setRun` (which replaces the whole object, `workflowRunStore.ts:145-174`). A poll snapshot taken just before a stage transition can land after the SSE event and briefly roll the status back until the next event or poll (D-21b).

**Rendering performance.**
- The `elapsedMs` timer (1 s) re-renders the page and re-runs `deriveRunView`, including `deriveTimeline` over every stage's blocks, **every second**. It builds new `StageView` objects each time, and `onOpenInspector` is an inline arrow (`WorkflowRunPageV2.tsx:565-573`), so `React.memo(StageTimelineItem)` is defeated and every stage row (including open `StreamPanel` markdown) re-renders every second (D-24).
- There is no list virtualization on the run timeline. That is acceptable because collapsed stages do not mount their bodies (`StageTimelineItem.tsx`, `open &&`).
- Output tab: the full scratchpad text sits in a single `<p whitespace-pre-wrap>` (`RightInspector.tsx:208-210`). Fine for DOM count, but the entire scratchpad is refetched every 3 s while running, even when the Inspector is closed.

**Memory growth.** `streamStore` is capped at 32 streams, LRU by `lastActivityAt`, and only protected keys are exempt (`web/stores/streamStore.ts:190-257`, `packages/client-core/src/stream/reducer.ts:840-864`). **The run page never calls `protectStream`** (only `ChatPage.tsx:340` does). Completed stages of the run on screen are therefore the first evicted once the tab holds more than 32 streams (for example after browsing chats, or a run with more than 32 stage runs from retries or iterations). Their tool steps, hooks, usage and context gauge silently vanish, and nothing re-replays them while the connection stays open (D-21). `seenSequenceIds` grows for the life of a live connection (`sseManager.ts:321-327`). `timelineEvents` grows without bound (D-34). Leaving a run page does not remove its `stageRun:*` keys (`closeConnection`, `:1264-1296`); the cap bounds this.

**Workflows list.** Virtualized (see the prior-fix table). The run list on the definition page is paged 5 at a time (`WorkflowDefinitionPage.tsx:53,381-404`).

---

## (f) UX gaps vs modern workflow builders (n8n, Temporal UI, Dagster, LangGraph Studio, Inngest)

| Capability | Status here |
|---|---|
| Per-node run history (last N executions of this stage across runs) | Missing. Only a per-run list on the definition page |
| Re-run from node / "replay from here" | Missing. Only retry-failed-stage and retry-whole-run (new run); no re-run of a completed run or a completed stage with the same inputs |
| Live logs | Partial: stream steps inline and in the Terminal tab; no raw log / event view per stage (the timeline modal shows status transitions only) |
| Diff between runs (outputs, variables, duration) | Missing |
| Inline validation on nodes (red badge on the offending node, jump to error) | Missing: a banner list only; `stageIds` are computed but not used to highlight nodes; the server `issues` endpoint is unused |
| Variable autocomplete in prompts (`{{` → declared vars, `{{repo_path_…}}`, predecessor outputs) | Missing: plain Textarea (`PromptEditor.tsx:216-222`); highlight only in Preview |
| Condition builder (visual AND/OR with variable pickers, live evaluation) | Missing: free-text expression with no parse check |
| Versioning (history, diff, restore, pin a run to a version) | Missing: `version` increments server-side (`WorkflowDefinitionService.ts:196`) but is not shown or restorable |
| Dry-run / test a single stage with sample input | Missing |
| Export / share definition | Missing in the UI (the client method exists) |
| Persisted node layout | Missing: positions are never saved; dagre re-layout on every load or save |
| Per-run model / codebase / branch override | Missing (see c) |
| Stage-level pause/cancel from the run page | Hooks exist (`usePauseStageRun`, `useResumeStageRun`, `useCancelStageRun`, `workflowQueries.ts:398-425`) but have **no UI** |
| Cost/usage roll-up per run | Per-stage chips only (live) |
| Run search/filter (status, date, variables) | Missing on the definition page |
| Keyboard palette / quick-add node | Missing |

---

## (g) Issues

### D-1 [P0] Saving an existing workflow with a new stage that is connected by an edge always fails, and the edge is lost
- **Evidence:** the update path adds new stages without capturing their server IDs (`WorkflowBuilderPage.tsx:386-401`), then posts edges with the raw local node IDs (`:426-436`: `fromStageId: edge.source`). Local IDs are `stage-<ts>-xxxxx` (`:235`). The server validates `fromStageId/toStageId` as `z.string().uuid()` (`WorkflowDefinitionSchemas.ts:275-280`, route `apps/server/src/routes/workflowDefinitions.ts:172`), so the request gets 400 "Request body validation failed". The create path does remap (`:325-347`); the update path forgot to.
- **Scenario:** open a saved workflow, add Stage 4, connect Stage 3 → Stage 4, Save. Stage 4 is created on the server and the edge POST 400s. The mid-save refetch (D-3) reloads the canvas from the server, so the edge disappears and `isDirty` becomes false. Repeating produces a disconnected Stage 4 every time. The same happens for any edge to a **duplicated** stage.
- **Fix:** capture `serverStage.id` in a `localToServerId` map in the update loop (as the create path does) and remap `edge.source/target` before `addEdge`. Better: replace the whole diff with one server `PUT /workflow-definitions/:id/graph` that applies stages and edges transactionally.

### D-2 [P0] Deleting a stage in the builder: the save fails on any run workflow and orphans edges on every workflow
- **Evidence:** the update path deletes the stage first (`WorkflowBuilderPage.tsx:379-383`). `WorkflowDefinitionService.deleteStage` deletes the stage's edges and then the stage (`WorkflowDefinitionService.ts:317-326`, no transaction). (a) `stage_runs.stage_definition_id REFERENCES stage_definitions(id)` has no cascade (`packages/db/src/migrations/index.ts:341`, `schema.ts:555-557`) and `foreign_keys = ON` (`packages/db/src/index.ts:334`), so a stage that has ever run fails the FK **after its edges were already deleted**. (b) Even without runs, the edge-diff loop then tries to delete the same edges from the stale `definition.edges` (`WorkflowBuilderPage.tsx:419-423`); `StageEdgeRepository.getById` throws NotFound (`StageEdgeRepository.ts:43-51`) → 404 → abort.
- **Scenario:** A→B→C, delete B, connect A→C, Save. With no runs: B is deleted and its edges cascade; the save aborts on the 404 before A→C is added; the reload shows A and C disconnected. With past runs: A→B and B→C are deleted, B stays (the FK blocks it), and the save errors. The workflow is now silently broken (B is an orphan root and C runs in parallel with A).
- **Fix:** skip edge deletes whose endpoints were deleted in this save, or just refetch server edges after the stage deletes. On the server, make `deleteStage` transactional and either soft-delete stages that have `stage_runs` or detach them (nullable FK or archive). Ultimately an atomic graph save (see D-1).
- **Confidence:** static trace; reproduce live before fixing (the FK behaviour follows from the schema).

### D-3 [P0] A save is not atomic, and any failure mid-save throws away the user's other unsaved edits
- **Evidence:** every stage and edge mutation invalidates `workflow-definition` (`workflowQueries.ts:173-175,190-192,204-206,224-226,238-240`). The builder reloads the store whenever `definition` changes (`WorkflowBuilderPage.tsx:200-204` → `loadDefinition`, which sets `isDirty:false` and resets history, `workflowBuilderStore.ts:280-313`). The catch branch only shows the error for 5 s (`:445-450`).
- **Scenario:** any 400/404/500 during save (D-1, D-2, D-5, an empty HTTP hook URL, a bad variable name) leaves a partly written server state. The canvas is then overwritten with that state, and every edit not yet sent is gone, with no "unsaved" marker and no navigation guard.
- **Fix:** do not reload the store from query data while `isSaving` or `isDirty` (reload only on id change or an explicit revert). Validate everything client-side first, send one atomic save, and on failure keep local state and mark the failing field.

### D-4 [P1] Clearing or turning off a setting never persists (`undefined` is dropped on the wire and skipped by the repos)
- **Evidence:** `JSON.stringify` drops `undefined` (`HttpPlatformClient.ts:1255`). `StageDefinitionRepository.update` and `WorkflowDefinitionRepository.update` only write `!== undefined` keys (`StageDefinitionRepository.ts:117-140`, `WorkflowDefinitionRepository.ts:129-139`). UI writers that clear to `undefined`: retry toggle off (`StagePropertiesPanel.tsx:411-417`), timeout 0 (`:379`), remove all validation rules (`:463`), description (`:187`), template "No template" (`:202`), model back to "Workflow default" when it is the only override (`:213-221`, `AgentBindingSection.tsx:223`). At workflow level (`WorkflowBuilderPage.tsx:360-370`): `description || undefined`, `hooks: length>0 ? … : undefined`, `orchestratorConfig` becomes `undefined` when no codebases (`:271`), `projectId ?? undefined` (the server accepts `null`, `WorkflowDefinitionSchemas.ts:210`).
- **Scenario:** turn off "Retry on failure", Save, reload: retry is back on, and the stage retries three times in production. Delete the last workflow hook: it still fires. Unlink the project: still linked.
- **Fix:** send explicit `null` for cleared fields and have the service and repos treat `null` as "clear" (as already done for `agentRef`/`defaultAgentRef`). Add a round-trip test (set → clear → reload) for each panel field.

### D-5 [P1] An empty prompt or an unfilled Files pick makes the workflow unsaveable, and a failed first save creates duplicate definitions
- **Evidence:** "Add Prompt" creates `text:''` (`PromptEditor.tsx:43-47`). The Files sub-tab creates `text:''` prompts (`PromptFilePicker.tsx:40-48,64`). Client validation only counts prompts (`workflowBuilderStore.ts:665-675`), but the server requires `text.min(1)` and `label.min(1)` (`WorkflowDefinitionSchemas.ts:13-22`). On a new workflow, `setDefinitionId(created.id)` runs before the stages are saved (`WorkflowBuilderPage.tsx:322`), yet the next Save still takes the create branch because `isNew` (URL `/workflows/new`) is still true (`:305`).
- **Scenario:** new workflow, one stage with an empty prompt, Save gets 400. The definition exists with 0 stages. Fill in the prompt and Save again: a **second** definition is created. Each retry adds another orphan to the list.
- **Fix:** validate empty text and labels client-side and highlight the prompt. On a create-path failure, either delete the half-created definition or switch to the update path (`isNew && !store.definitionId`).

### D-6 [P1] Workflow delete (single, bulk, definition page) fails silently whenever runs exist
- **Evidence:** the server refuses with 409 unless `?force=true` (`apps/server/src/routes/workflowDefinitions.ts:93-117`, `WorkflowDefinitionService.ts:216-223`). `confirmDelete` awaits with no catch (`WorkflowListPage.tsx:313-317`, `WorkflowDefinitionPage.tsx:189-194`), bulk likewise (`WorkflowListPage.tsx:320-325`; the hook throws a generic count, `workflowQueries.ts:103-125`). `ConfirmDialog` just calls `onConfirm` (`web/components/ui/ConfirmDialog.tsx:98`).
- **Scenario:** delete any workflow that was ever run. Nothing happens (an unhandled rejection), with no message and no "delete runs too" option.
- **Fix:** catch `ApiError` 409, show the server message, and offer "Delete workflow and its N runs" (calling with `force=true`, which needs `exec:agent`).

### D-7 [P1] The stage "Variables" editor is dead at run time
- **Evidence:** the UI writes `stage.variables` (`StagePropertiesPanel.tsx:321-326`) and it persists. Runtime variables for a stage are `run.variables ∪ override.variables` (`WorkflowRunService.ts:1508-1522`, `:1700-1704`); `StageExecutionService.executeStage` takes `variables` from its caller (`:1040`) and never reads `stageDef.variables`. The only merge, `ConfigResolver.resolveStageConfig` (`ConfigResolver.ts:103-116`), has zero callers. Builder validation also treats stage variables as undefined (`workflowBuilderStore.ts:680-708`).
- **Scenario:** set `lang = ts` on a stage and use `{{lang}}` in its prompt. Validate says the variable is undefined. If you declare it at workflow level instead, the stage value is ignored and the model receives the literal `{{lang}}` or the workflow default.
- **Fix:** merge `stageDef.variables` between the definition defaults and the run overrides in `launchStage`/`executeStage` (or call `resolveStageConfig`), and count stage keys as declared in `validate()`. Otherwise remove the section.

### D-8 [P1] Prompts → "Files" sub-tab is dead at run time (and triggers D-5)
- **Evidence:** it writes `prompts[0].attachments` (`PromptFilePicker.tsx:30-75`). `StageExecutionService` builds attachments only from `variables.__promptDirectories` (`:1957`) and sends only `prompt.text` (`:1810-1855`). No runtime path reads `PromptDefinition.attachments` (the only consumer is the legacy `ConfigResolver.resolve`, `ConfigResolver.ts:71-77`).
- **Scenario:** tick a project prompt file. The node shows "1 prompt", but the agent never sees the file.
- **Fix:** resolve `prompt.attachments` into harness attachments in the prompt loop, or remove the tab.

### D-9 [P2] The stage Template select is dead at run time
- **Evidence:** it writes `templateId` (`StagePropertiesPanel.tsx:199-205`). The only reads are display (`StageNode.tsx:95,210-214`) and a copy on create (`WorkflowDefinitionService.ts:256`). The runtime never reads it.
- **Fix:** apply the template's prompts or config on selection (copy into the stage), or remove the control.

### D-10 [P1] Workflow Variables: renaming loses focus after every keystroke, and bad names 400 the save
- **Evidence:** rows use `key={variable.name}` while the name input edits `variable.name` directly (`VariablesTab.tsx:153,205-211`), so React remounts the row on every character. There is no identifier or empty check (the server regex is at `WorkflowDefinitionSchemas.ts:57`, and `label.min(1)` too). The stage `VariableEditor` already fixed this exact bug (`StagePropertiesPanel.tsx:919-925`).
- **Fix:** `key={index}` plus the draft-name pattern from `VariableRow` (`StagePropertiesPanel.tsx:810-875`), and client validation of name, label and duplicates.

### D-11 [P1] Choice-variable options cannot be typed
- **Evidence:** `value={options.join(', ')}` with `onChange` that splits and filters empty entries (`VariablesTab.tsx:270-278`). Typing "a," becomes `['a']`, which re-renders as "a", so the comma vanishes and a second option can only be pasted.
- **Fix:** keep a local raw string and parse on blur, or use a chip input.

### D-12 (merged)
Project unlink and codebase deselect are part of D-4. The dead `gitRepositories` payload is D-23.

### D-13 [P1] Run launch and run controls fail silently
- **Evidence:** `executeRun` catches with `console.error` in both pages (`WorkflowBuilderPage.tsx:531-533`, `WorkflowDefinitionPage.tsx:170-172`). The modal just stops spinning. Pause, resume and cancel are `void mutateAsync` (`WorkflowRunPageV2.tsx:352-354`); retry has `.then` without `.catch` (`:357-364`); HITL handlers use `console.error` (`:374-376,388-390,405-407`).
- **Scenario:** a missing required variable server-side, provider down, or a HITL claim lost to another approver: the user sees nothing.
- **Fix:** surface `ApiError.message` inline in the modal or as a toast, and disable HITL buttons while in flight.

### D-14 [P1] Files uploaded from the builder's Run dialog are lost on non-project workflows
- **Evidence:** the builder plain path does `createRun` → `uploadRunFiles` → `startRun` (`WorkflowBuilderPage.tsx:516-524`). The definition page states this sequence "writes to a fallback folder that is abandoned when startRun provisions the workspace" and routes any upload through the orchestrated path instead (`WorkflowDefinitionPage.tsx:124-128`).
- **Fix:** mirror the definition page (uploads force `startOrchestratedRun`) and share one `launchRun` helper between the pages.

### D-15 [P2] The Run dialog with no displayable variables drops stage overrides and auto-filled git values
- **Evidence:** the no-variables branch has no Stage Overrides section and submits `onSubmit({}, uploads)` (`VariableInputModal.tsx:265-326`, especially `:281`). When every variable is a git variable auto-filled from codebases, `displayVariables` is empty, so the `git_url`/`branch` values are never sent. A `required` git variable then fails server-side (`WorkflowRunService.ts:430-437`) and the failure is silent (D-13).
- **Fix:** always render the overrides section, and submit the auto-filled `values` in this branch too.

### D-16 [P2] The Widget tab is still dead UI
- **Evidence:** `WorkflowRunPageV2.tsx:719-731`. No widget tools are bound for stage sessions (`ChatManagementService.ts:1903,2413` only; `StageExecutionService.ts` has no widget references).
- **Fix:** bind `buildWidgetTools` in `StageExecutionService` session config keyed `stageRun:<id>`, or hide the tab.

### D-17 [P2] Run is allowed with unsaved changes and executes the last saved version
- **Evidence:** `handleRun` checks only `definitionId` (`WorkflowBuilderPage.tsx:471-476`), while the modal shows the **unsaved** store variables and stage names (`:834,838`). The server runs the saved definition.
- **Scenario:** edit a prompt, click Run without saving, and the old prompt runs. Stage-skip indices come from the unsaved order (see D-29).
- **Fix:** when `isDirty`, prompt "Save and run" or "Run last saved".

### D-18 [P2] The stage "…" actions button does nothing, and per-stage pause/resume/cancel have no UI
- **Evidence:** `StageTimelineItem.tsx:244-256` (`onClick={(e) => e.stopPropagation()}`). The hooks `usePauseStageRun`, `useResumeStageRun` and `useCancelStageRun` exist (`workflowQueries.ts:398-425`) and are referenced nowhere in `.tsx`.
- **Fix:** make it a menu (Pause / Resume / Cancel stage, Retry, Copy output, Open in inspector) or remove it.

### D-19 [P2] HITL approve/reject controls appear up to 5 s late
- **Evidence:** the router passes `stage_run.awaiting_input` data (with `interruptData`) into `stageStatus` (`packages/client-core/src/stream/eventRouter.ts:1712-1726`). `updateStageRunStatus` copies only `error`, `sessionId` and `currentStep` (`workflowRunStore.ts:240-256`). `deriveRunView` builds `interrupt` only from `sr.interruptData` (`deriveRunView.ts:291-310`), so the stage says "Awaiting input" with no buttons until the 5 s poll. The stream system message also still says "check the HITL panel", which V2 removed (`eventRouter.ts:1730`).
- **Fix:** copy `data.interruptData` (and clear it on resume) in `updateStageRunStatus`, and fix the copy.

### D-20 [P2] Clicks in the Graph and Timeline don't focus the stage on the page
- **Evidence:** `RuntimeDAGCanvas.tsx:164-181` and `RuntimeStageNode.tsx:113-115` call `selectStageRun`. `RunTimeline.tsx:226,253` does the same. V2 keeps focus in local `focusedStageId` (`WorkflowRunPageV2.tsx:117`) and never reads `selectedStageRunId`. Meanwhile `setRun` auto-selects a different stage in the store (`workflowRunStore.ts:163-166`), so the graph highlights one stage while the page focuses another.
- **Fix:** make `focusedStageId` read from and write to the store, or pass `onSelect` into both components.

### D-21 [P2] Stage streams on screen can be evicted, and the tool trace, hooks and usage disappear
- **Evidence:** streams are capped at 32 with LRU by `lastActivityAt` (`streamStore.ts:190-257`, `reducer.ts:840-864`). Only `ChatPage.tsx:340` calls `protectStream`; the run page does not. Completed stages are the least recently active and go first.
- **Scenario:** after opening about 30 chats in a tab (or a loop-heavy run with more than 32 stage runs), the early stages of the current run lose their steps, the Inspector Tools and Hooks tabs empty, and nothing replays them.
- **Fix:** `protectStream('stageRun:'+id)` for every stage run of the mounted run (released on unmount).
- **D-21b (same area):** the 5 s poll's `setRun` replaces the whole run and can briefly roll back fresher SSE statuses (`workflowRunStore.ts:145-174`). Merge per stage by `updatedAt`/`version` instead of replacing.

### D-22 [P2] The Inspector "Files" tab lists the entire run workspace as "added" for every stage
- **Evidence:** `focusedStage.files ?? workspaceFilesFromRun(workspace)` (`WorkflowRunPageV2.tsx:473`), with every entry `kind:'added'` (`:782-791`).
- **Scenario:** a review stage that changed nothing shows 40 "A" files.
- **Fix:** label it "Run workspace (not stage-specific)", or compute per-stage changes from checkpoints.

### D-23 [P2] `gitRepositories` is a dead payload, so the definition page never auto-fills git variables
- **Evidence:** the builder sends `orchestratorConfig.gitRepositories` (`WorkflowBuilderPage.tsx:282`), but `OrchestratorConfigSchema` does not declare it and zod strips it (`WorkflowDefinitionSchemas.ts:145-166`). The definition page builds `linkedCodebases` only from `gitRepositories` (`WorkflowDefinitionPage.tsx:86-96`), so it is always `undefined` for builder-saved workflows: no "Linked Codebases" panel and no git variable auto-fill. The builder store's `gitRepositories` is always `[]` after load (`workflowBuilderStore.ts:288`), so that half of `isOrchestrated` is dead (`WorkflowBuilderPage.tsx:490`).
- **Fix:** derive from `codebaseAliases` in both places and delete the `gitRepositories` plumbing from the builder.

### D-24 [P2] Run page render and network cost scale with time × stages
- **Evidence:** the 1 s `elapsedMs` tick drives `deriveRunView` (`WorkflowRunPageV2.tsx:275-285`), which calls `deriveTimeline` for every stage (`deriveRunView.ts:269`). `React.memo(StageTimelineItem)` is defeated by new objects and an inline `onOpenInspector` (`:565-573`). The scratchpad (all outputs) is refetched every 3 s even with the Inspector closed (`:79`, `workflowQueries.ts:536-545`). The workspace listing is polled every 10 s forever, including on terminal runs (`workflowQueries.ts:501-509`). Replay re-maps all rows on every page (`sseManager.ts:874-889`).
- **Fix:** move the clock into the header only. Memoise `StageView` per stage keyed on (stageRun, stream). Stable callbacks. Fetch the scratchpad entry for the focused stage only, and only while the Inspector is visible. Stop workspace polling once the run is terminal. Map rows incrementally during replay.

### D-25 [P2] Validate misses the errors the server will reject, and server errors are unlabelled
- **Evidence:** `validate()` (`workflowBuilderStore.ts:624-713`) does not check empty prompt text or labels, workflow variable names or labels, hook HTTP URLs, tag limits, condition syntax, duplicate stage names, or unreachable stages (the `orphan` type is declared but never produced, `:49`). Self-edge messages print raw IDs (`:642`). The server's `/validate` (`useValidateWorkflowDefinition`) is never called. A save failure shows only "Request body validation failed" (`apps/server/src/middleware/validate.ts:35-38`), and the `fields` detail is ignored (`WorkflowBuilderPage.tsx:447`).
- **Fix:** mirror the zod schemas client-side (import the shared schemas and run `safeParse` per stage before save), highlight the offending node via `stageIds`, and render the server's `fields`.

### D-26 [P2] The regex validation placeholder teaches syntax that can never match
- **Evidence:** placeholder `e.g., /export\s+default/` (`StagePropertiesPanel.tsx:761`). The runtime does `new RegExp(rule.value)` (`packages/core/src/services/ResultValidator.ts:141-144`), so the slashes are literal and the rule always fails, which triggers retries and then stage failure. This is the same defect class as the fixed expression placeholder.
- **Fix:** use the placeholder `export\s+default`, or strip `/…/flags` server-side, and show a live "matches sample?" check.

### D-27 [P2] Duplicating a stage drops the fields the builder cannot edit
- **Evidence:** `duplicateStage` copies the whole stage (`workflowBuilderStore.ts:473-478`), but `toStageParams` omits `outputFormat`, `outputSchema`, `expectedOutput`, `contextSources`, `iterationConfig`, `agentMode`, `browserConfig`, `promptType`, `skills` and `agentName` (`WorkflowBuilderPage.tsx:66-86`).
- **Scenario:** duplicate an imported JSON-output stage. The copy shows the JSON pill until Save, then it becomes a plain-text stage.
- **Fix:** send every `CreateStageSchema` field in `toStageParams` (derive it from the schema keys).

### D-28 [P2] Save and load throw away layout, undo history and selection; positions are never persisted
- **Evidence:** `loadDefinition` always runs dagre (`workflowBuilderStore.ts:274-278`) and resets `history`, `selectedNodeId` and `isDirty` (`:280-313`). It runs after every successful save because of the refetch (D-3). Stage entities have no position field. Auto-layout is not recorded in undo (`DAGCanvas.tsx:92-103`).
- **Scenario:** hand-arrange a 10-stage DAG and Save. The nodes jump back, the properties panel closes to "No stage selected", and Ctrl+Z does nothing.
- **Fix:** persist `position` per stage (or a layout blob on the definition), don't reload after your own save, and `pushHistory()` after auto-layout.
- **Related:** default names `Stage ${nodes.length+1}` repeat after deletes (`WorkflowBuilderPage.tsx:239`). Duplicate names break name-matched stage overrides and `contextSources`.

### D-29 [P2] A stage-skip override can skip the wrong stage
- **Evidence:** overrides carry both `stageName` and `stageIndex` (`client-core/src/api/stageOverrides.ts:63-69`). The server matches **name OR index** in one `find` (`WorkflowRunService.ts:1878-1881`, although its comment says "name first, then index"). The index comes from builder node order (unsaved) or definition stage order (`VariableInputModal.tsx:116-123`), while the server index is `allStageRuns.indexOf(sr)` (`:1503`).
- **Scenario:** skip "Deploy" (index 2) while the stage-run order has "Lint" at index 2. Both are skipped.
- **Fix:** match by name, falling back to index only when no override has a name match (or send stage definition IDs).

### D-30 [P3] Canvas capability pills read fields the panel never writes
- **Evidence:** the skill pill reads `stage.skills` (`StageNode.tsx:101`) while the selector writes `agentOverrides.addSkillIds`. The MCP pill reads `harnessConfigOverrides.mcpServers` (`:102-104`) while the selector writes `excludedMcpServerIds`. The agent pill reads `agentName` (`:106,218`) while binding writes `agentRef`.
- **Fix:** derive the pills from the fields the panel actually writes.

### D-31 [P3] There is no workflow-level model or harness UI, though the stage picker promises inheritance
- **Evidence:** "Inherit from workflow settings" (`StagePropertiesPanel.tsx:226`), but GeneralTab has only name, description and session mode (`settings/GeneralTab.tsx:155-235`). `harnessConfig` is round-tripped but uneditable (`WorkflowBuilderPage.tsx:311,364`). `harnessType` is never set anywhere in the UI.
- **Fix:** add Model, Reasoning, Default agent and Browser controls to General.

### D-32 [P3] The stage Run Condition overlaps edge types and can contradict them
- **Evidence:** "On upstream failure" (`StagePropertiesPanel.tsx:79-84`) with the default `on_success` incoming edge: the edge is inactive when the parent failed, so the stage is skipped, and when the parent succeeded the condition is false, so it is skipped (`DAGScheduler.ts:140-161`). The stage can never run and there is no warning.
- **Fix:** drop on_success/on_failure from the stage condition (edges own them), or warn when the condition conflicts with every incoming edge type.

### D-33 [P3] Smaller controls
- The "Wait" checkbox has no explanation and, when unchecked, stage completion can race the model (`PromptEditor.tsx:135-143`, `StageExecutionService.ts:2011-2017`).
- The `structured` contextFilter is missing from the select (`StagePropertiesPanel.tsx:391-395`).
- Cancel run has no confirmation (`RunHeaderBar.tsx:150-160`).
- Completed runs have no Re-run.
- The card "Run" button only navigates (`WorkflowListPage.tsx:608`).
- The "Structured output" chip doesn't open the Output tab (`StageTimelineItem.tsx:335`; `RightInspector` keeps its own tab state).

### D-34 [P3] Write-only run-store state and dead code
- **Evidence:** `timelineEvents` and `awaitingInputStages` are written by SSE effects (`sseManager.ts:513-565`) and never read by any component. They grow for the life of the run page. The `?legacy=1` effect is a no-op (`WorkflowRunPageV2.tsx:256-261`) and the header comment claims the legacy page is preserved (`:9-10`).
- **Fix:** delete them, or feed the timeline modal from `timelineEvents`.

---

### Suggested fix order
1. D-1, D-2, D-3 together: a single atomic graph-save endpoint plus not reloading the store from query data during or after your own save.
2. D-4 (explicit `null` clears) and D-5/D-25 (client-side zod parity).
3. Dead runtime controls: D-7, D-8, D-9, D-16 (wire them or remove them).
4. D-6 and D-13 (surface errors).
5. D-19, D-20, D-21, D-24 (run page correctness and performance).
