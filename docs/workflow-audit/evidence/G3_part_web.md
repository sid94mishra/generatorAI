# Workflow client-UI legacy/dead-code audit (web + mobile + client-core)

Scope: `apps/web` workflow/automation pages, `apps/web/src/components/workflow/**`, `apps/web/src/stores/{sseManager,workflowBuilderStore,workflowRunStore}.ts`,
`apps/web/src/hooks/{workflowQueries,automationQueries,useAutomationExecutionStream}.ts`, `apps/mobile` runs/workflows, `packages/client-core/src/api/*`.
All findings verified by reading the actual file content and grepping for real callers (not assumed from prior notes).

---

## 1. Legacy fields/aliases sent or read by the UI

### 1.1 `gitRepositories` — fully dead parallel-tracking state (HIGH confidence, entire subsystem)
- `apps/web/src/stores/workflowBuilderStore.ts:69,248,288,301,326,538` — `gitRepositories: GitRepositoryConfig[]` state + `setGitRepositories` action, loaded from `definition.orchestratorConfig?.gitRepositories`.
- `apps/web/src/components/workflow/settings/ProjectCodebasesTab.tsx:20,36,45,51-58,61` — every codebase checkbox toggle also pushes/pulls an entry into `gitRepositories`, 1:1 mirroring `selectedCodebases`/`codebaseAliases`. There is no independent "add repo by URL" UI — `gitRepositories` is pure derived shadow state.
- `apps/web/src/pages/WorkflowBuilderPage.tsx:268-282` — sent on save as `{ codebaseAliases: codebases, gitRepositories }`.
- **Why dead:** `packages/shared/src/config/WorkflowDefinitionSchemas.ts:145-166` (`OrchestratorConfigSchema`, the actual server-accepted zod schema) has **no `gitRepositories` field at all**. A plain zod `z.object()` strips unknown keys, so the server silently discards it on write. On read, `apps/web/src/pages/WorkflowDefinitionPage.tsx:87-96,138-142` and `workflowBuilderStore.ts:288,301` read `definition.orchestratorConfig?.gitRepositories`, which will always be `undefined` — the field can never come back from the server either.
- The TS interface `packages/shared/src/types/WorkflowOrchestrator.ts:174-203` (`OrchestratorConfig`) still declares `gitRepositories: GitRepositoryConfig[]` (non-optional!), which is why the client code type-checks at all — this is type/schema drift baked into shared types, not just a client mistake.
- **What replaces it:** `codebaseAliases` (project/codebase model) — already the thing actually sent and persisted.
- **Removal risk:** Low. Deleting `gitRepositories` state/actions/UI wiring changes nothing observable (it never round-trips). The one real fix needed is `packages/shared` (`OrchestratorConfig` interface, `GitRepositoryConfig` type) but that's outside this scope (server/shared types) — flag as a cross-cutting dependency.
- **Dependents:** `ProjectCodebasesTab.tsx`, `WorkflowBuilderPage.tsx` (save payload + `isOrchestrated` check, see 1.2), `WorkflowDefinitionPage.tsx` (`linkedCodebases` memo + run-time `selectedCodebases` fallback), `workflowBuilderStore.ts` (state/actions/load/reset).
- **Est. LOC removable (web):** ~45.

### 1.2 Redundant `gitRepositories.length > 0` branch condition
- `apps/web/src/pages/WorkflowBuilderPage.tsx:490` — `const isOrchestrated = !!store.projectId || store.gitRepositories.length > 0;`
- Since `gitRepositories` only ever gets entries when `projectId` is set (1.1), this `||` clause is unreachable dead logic — `!!store.projectId` alone is equivalent today. Low risk, 1 line.

### 1.3 `scope` / `setScope` — dead workflow-builder field (HIGH confidence)
- `apps/web/src/stores/workflowBuilderStore.ts:77,139,252,293,330,548` — `scope: EntityScope` state + `setScope` action.
- Loaded via an **unsafe cast**: `scope: (definition as unknown as { scope?: EntityScope }).scope ?? 'global'` (line 293) — the `as unknown as` is needed because `WorkflowDefinitionWithStages` (`packages/shared/src/types/WorkflowDefinition.ts`) has **no `scope` field at all**; only `projectId`.
- `setScope` has **zero callers** anywhere in `apps/web/src` (confirmed by full-repo grep — the only other `setScope` hits are unrelated local `useState` in `AgentsListPage.tsx`/`ProjectDetailPage.tsx`/mobile `chats.tsx`).
- `scope` is never included in the save payload in `WorkflowBuilderPage.tsx` (grep for `\bscope\b` in that file returns nothing).
- **What replaces it:** `projectId` is the real scoping mechanism.
- **Removal risk:** Low — read via unsafe cast off a field that doesn't exist, never written back, no writer UI.
- **Est. LOC removable (web):** ~8.

### 1.4 `stage.templateId` — write-only / never consumed by execution (MEDIUM-HIGH confidence)
- `apps/web/src/components/workflow/StagePropertiesPanel.tsx:74-77,101,199-205` — "Template" `<StyledSelect>` populated from `useTemplates()` → `platform.getWorkflowTemplates()`, writes `onUpdate({ templateId: v || undefined })`.
- `apps/web/src/components/workflow/StageNode.tsx:95,101,212` — displays `stage.templateId` as a badge / "Custom stage" fallback text.
- **Why dead:** `stage.templateId` is persisted (`packages/db/src/repositories/StageDefinitionRepository.ts:53,120,195`) but there is **zero** reference to `.templateId` anywhere in the execution/orchestrator engine (`packages/core/src/services/WorkflowOrchestrator.ts`, `packages/core/src/services/orchestrator/OrchestratorService.ts` — full-repo grep for `.templateId` outside DB/route/web/mobile turns up nothing in execution code). The only server-side `templateId` concept that's actually *used* is the **workflow-level** import-a-whole-template flow (`WorkflowDefinitionService.ts:399-426`, `WorkflowOrchestrator.ts:273-286`) — a completely different feature from the stage-level field.
- Worse: the `templateOptions` populating this select come from `platform.getWorkflowTemplates()` — the *workflow*-template registry — so the UI is offering workflow-import templates as if they were per-stage prompt templates, writing the selection to a DB column execution never reads.
- **What replaces it:** Nothing — this is a vestigial field/UI with no functional effect today. The real per-stage "template" concern is just prompts + agent binding.
- **Removal risk:** Medium (need to confirm no other hidden consumer exists in scripts/webhooks; `WebhookService.ts`/`WebhookRepository.ts` also touch `.templateId` — worth a quick server-side check before deleting the DB column, but the **client UI/select is safe to remove regardless**).
- **Est. LOC removable (web):** ~15 (select block + badge display + template-options plumbing).

### 1.5 `promptType` — dead read, and the values checked aren't even valid enum members
- `apps/web/src/components/workflow/StageNode.tsx:96` — `const promptLabel = (stage.promptType as string) === 'skills' ? 'skill' : (stage.promptType as string) === 'agents' ? 'agent' : 'prompt';`
- **Why dead:** Zero writers of `stage.promptType` anywhere in `apps/web` or `apps/mobile` (full grep). Additionally `packages/shared/src/config/WorkflowDefinitionSchemas.ts:24-25` defines `PromptTypeSchema = z.enum(['inline', 'file'])` — **`'skills'`/`'agents'` are not valid values of this enum at all**, so the comparison can never be true even if something *did* set it. This line always evaluates to `'prompt'`.
- **Removal risk:** Low — replace with a plain `'prompt'` label or delete the conditional.
- **Est. LOC removable (web):** ~1 (but worth flagging as a real dead-code/possible-bug finding).

### 1.6 `PromptDefinition.source` / `.filePath` — schema fields the client never sets
- `packages/shared/src/config/WorkflowDefinitionSchemas.ts:13-22` — `PromptDefinitionSchema` has `source: 'inline'|'file'` (default `'inline'`) and `filePath` (optional).
- Neither `apps/web/src/components/workflow/PromptEditor.tsx` nor `PromptFilePicker.tsx` ever sets `source` or `filePath` — file attachment is done exclusively through `attachments: string[]` on the first prompt (`PromptFilePicker.tsx:41-58,64`). Confirmed via grep: zero writes of `.source =` or `filePath:` for prompts anywhere in scoped web/mobile files.
- **Classification:** (a) removable legacy on the client side — the client has already fully moved to `attachments`; `source`/`filePath` are inert fields it never touches. No client code to delete (nothing references them), but worth noting for the shared-schema owner since it's dead surface area the UI doesn't use.

### 1.7 `agentName` — read-only legacy fallback (kept but real per schema comment)
- `apps/web/src/components/workflow/StageNode.tsx:106,218-221` — reads `stage.agentName` to show a "Delegated to agent" badge.
- `apps/web/src/stores/workflowBuilderStore.ts:667` — `hasAgent = !!stage.agentRef || !!stage.agentName` in validation.
- Server-side comment confirms: `packages/shared/src/config/WorkflowDefinitionSchemas.ts:270` *"Portable `scope:slug` ref of the agent driving this stage. **Supersedes `agentName`**."*
- **Why flagged:** The current builder (`AgentBindingSection.tsx`) only ever writes `agentRef`, never `agentName` — so on a fresh install with zero existing data (per product owner: no live users, no back-compat needed) `stage.agentName` can never be populated by anything in this codebase. It's defensive code for data that cannot exist.
- **Classification:** (b) genuine defensive code *in general*, but (a) removable given the explicit "no backward compatibility" directive — there is no legacy data to protect.
- **Removal risk:** Low. ~3 LOC.

### 1.8 `AutomationExecutionSummary.totalRuns/completedRuns/failedRuns` — dead deprecated fields (client-core)
- `packages/client-core/src/api/client.ts:533-536`: `/** @deprecated The server sends the *Iterations counts below; kept for older callers. */ totalRuns?: number; completedRuns?: number; failedRuns?: number;`
- Confirmed via grep: **zero reads** of `totalRuns`/`completedRuns`/`failedRuns` anywhere in `apps/web/src` or `apps/mobile` — only the type declaration itself. All UI already reads `totalIterations`/`completedIterations`/`failedIterations`.
- **Removal risk:** Low. **Est. LOC removable (client-core):** ~4.

### 1.9 Mobile: `AutomationView.workflowDefinitionId` legacy single-workflow fallback
- `apps/mobile/src/components/work/automationModel.ts:32-33` (field, commented *"Legacy single-workflow field some older payloads still carry"*) and `:149-152` (`workflowIdsOf` fallback function).
- **Classification:** (b)/(a) borderline — genuinely defensive against a wire shape, but per the "no backward compatibility" directive and no live data, safe to collapse to just `workflowIds`.
- **Removal risk:** Low-medium (depends on whether the server route this hits always sends `workflowIds` today — quick server check recommended before deleting). **Est. LOC (mobile):** ~5.

---

## 2. Legacy code paths / duplicate implementations

### 2.1 `WorkflowRunPageV2.tsx` — no-op `?legacy=1` effect, and there is no V1 page anymore
- `apps/web/src/pages/WorkflowRunPageV2.tsx:1-11` (header comment) and `:256-261`:
  ```
  // Redirect legacy → old page if requested
  useEffect(() => {
    if (searchParams.get('legacy') === '1') {
      // Legacy handled elsewhere; V2 is default. No redirect.
    }
  }, [searchParams]);
  ```
  **Confirmed a genuine no-op** — the effect body does nothing.
- Confirmed there is **no `WorkflowRunPage.tsx` (V1) file** in `apps/web/src/pages` anymore, and the router (`apps/web/src/router.tsx:80`) only ever mounts `WorkflowRunPageV2` for `workflows/:id/runs/:runId`. The "old page" the comment refers to has already been deleted; only this dead effect + header comment survive.
- `apps/web/src/components/workflow/redesign/RunHeaderBar.tsx:3` — comment: *"replaced the legacy V1 ..."* — same historical reference, harmless (comment-only).
- **Removal risk:** Low. Delete the effect, the `useSearchParams` import if otherwise unused, and reword the header comment. **Est. LOC (web):** ~8.

### 2.2 `workflowRunStore.ts` `timelineEvents` / `awaitingInputStages` — write-only dead state (confirmed, corrects prior line numbers)
- **State + actions live in `apps/web/src/stores/workflowRunStore.ts`**, not `sseManager.ts` as an earlier note assumed:
  - `workflowRunStore.ts:47,57,103,108,283,338-341,350` — `timelineEvents: RunTimelineEvent[]`, `awaitingInputStages: AwaitingInputInfo[]`, `addTimelineEvent`, `setAwaitingInput`, `clearAwaitingInput`.
- **Writers** are in `sseManager.ts:515-528` (`case 'runTimeline'`), `:537-552` (`case 'stageTimeline'`), `:558-564` (`case 'stageAwaitingInput'`).
- **Confirmed zero readers:** full grep of `apps/web/src/**/*.tsx` for `timelineEvents`/`awaitingInputStages` finds matches **only** in `workflowRunStore.ts` itself and `__tests__/stores/workflowRunStore.test.ts` (tests assert the write path works, not that anything downstream reads it).
- `RunTimeline.tsx:19,225-226` — the component that renders the run's timeline only reads `useWorkflowRunStore((s) => s.run)`, **not** `timelineEvents`. It derives its own view from `run.stageRuns` directly.
- `deriveRunView.ts` — awaiting-input UI (`InlineHitlControls`) is driven by `stageRun.status === 'awaiting_input'` + `sr.interruptData` (lines 32, 285, 292), **not** by `awaitingInputStages`.
- **Removal risk:** Low. This is genuinely dead: two state slices, two actions, 3 sseManager `case` blocks (~45 LOC), all pure write-only. **Est. LOC removable (web):** ~55 (store fields+actions ~20, sseManager case blocks ~35).

### 2.3 `HitlPanel.tsx` — file no longer exists; only stale comments remain
- `find` confirms **no `HitlPanel.tsx` file exists** anywhere in `apps/web/src`. It's already been deleted/replaced by `InlineHitlControls.tsx` (`apps/web/src/components/workflow/redesign/InlineHitlControls.tsx`).
- Only 2 stray comment references remain: `deriveRunView.ts:223` (`/** Effective permission mode (from HitlPanel or run). */`) and `HttpPlatformClient.ts:1217` (comment). Both are comment-only, cosmetic cleanup, no code risk.

### 2.4 Three re-export "backward-compatibility shim" files — trivially removable
- `apps/web/src/components/workflow/StyledSelect.tsx` (8 lines) — *"StyledSelect — backward-compatibility shim. The canonical implementation now lives in components/ui/Select."* Only importer: `StagePropertiesPanel.tsx:24`.
- `apps/web/src/components/workflow/ToggleSwitch.tsx` (8 lines) — *"moved to '@/components/ui' ... This shim keeps old import paths working."* Only importer: `StagePropertiesPanel.tsx:25` (the `components/ui/index.ts` `ToggleSwitch` export is a **different, canonical** file — not this shim).
- `apps/web/src/components/workflow/redesign/deriveTimeline.ts` (13 lines) — *"moved to the shared agent module. Re-export shim so existing imports keep working."* **Zero importers found anywhere** in `apps/web/src` — fully dead, not even providing back-compat for anyone.
- **Removal risk:** Low. Fix the one import line in `StagePropertiesPanel.tsx` (two imports) to point at the canonical modules, delete all three files. **Est. LOC removable (web):** ~29 (files) + trivial import-path edits.

### 2.5 `sseManager.ts` `connectAutomationExecution` / `disconnectAutomationExecution` — dead duplicate of `useAutomationExecutionStream.ts`
- `apps/web/src/stores/sseManager.ts:1353-1364` exports `connectAutomationExecution(executionId, platform)` / `disconnectAutomationExecution(executionId)`, both wrapping the same `openConnection`/`closeConnection` machinery used for chat/run streams.
- **Confirmed zero callers** anywhere outside `sseManager.ts` itself (grep for both names across `apps/web/src`).
- The actual automation-execution page instead uses **`apps/web/src/hooks/useAutomationExecutionStream.ts`**, a separate, independent implementation that calls `openMultiplexedStream('automation', executionId, ...)` directly — this is the live, used path (confirmed it correctly uses the unified multiplexed stream, not a legacy per-scope EventSource).
- This is a genuine duplicate: two different ways to subscribe to the same `scope=automation` SSE stream, one fully unused.
- **Removal risk:** Low. **Est. LOC removable (web):** ~12.

### 2.6 `StageTimelineItem.tsx` — dead "Stage actions" `…` button (confirms task's callout)
- `apps/web/src/components/workflow/redesign/StageTimelineItem.tsx:243-256`:
  ```tsx
  <Button
    onClick={(e) => e.stopPropagation()}
    ...
    aria-label="Stage actions"
  >
    <MoreHorizontal className="h-3 w-3" />
  </Button>
  ```
  The only handler is `stopPropagation()` — no menu, no dropdown, no `onClick` action of any kind. Clicking it does nothing but prevent the row from toggling collapse.
- **Removal risk:** Low. **Est. LOC removable (web):** ~14.

### 2.7 `workflowQueries.ts` — 12 exported hooks with zero callers (verified per-symbol)
All confirmed via grep across `apps/web/src/**/*.{ts,tsx}` excluding `workflowQueries.ts` itself and tests:

| Hook | Line | Callers found |
|---|---|---|
| `useValidateWorkflowDefinition` | 128 | 0 |
| `useImportFromTemplate` | 136 | 0 |
| `useDeleteWorkflowRun` | 356 | 0 |
| `usePauseStageRun` | 398 | 0 |
| `useResumeStageRun` | 404 | 0 |
| `useCancelStageRun` | 422 | 0 |
| `useWorkflowTemplate` (singular) | 442 | 0 |
| `useOrchestratorContext` | 490 | 0 |
| `useRunDiff` | 548 | 0 |
| `useWorkflowFiles` | 578 | 0 |
| `useUploadWorkflowFiles` | 588 | 0 |
| `useDeleteWorkflowFile` | 605 | 0 |

(For comparison, hooks that *are* used include `useWorkflowRun`, `useWorkflowDefinition`, `useWakeStageRun`, `useRetryStageRun`, `useStartOrchestratedRun`, `useRunWorkspace`, `useRunScratchpad`, `useUploadRunFiles`, etc. — real wiring, not flagged.)
- Note: `usePauseStageRun`/`useResumeStageRun`/`useCancelStageRun` having zero callers is notable — the UI apparently only supports **retry** and **wake** on a stage-run, not pause/resume/cancel at the stage level, even though the platform client and hooks exist for it. Either genuinely removable, or a missing-UI gap (worth a product decision, but as pure code the hooks are dead).
- **Removal risk:** Low-medium (double check `useValidateWorkflowDefinition` isn't intended-but-dead UX — i.e., "Validate" button might have been designed but never wired; worth a product glance before deleting the underlying platform method too).
- **Est. LOC removable (web):** ~150 (12 hooks × ~12 lines avg).

### 2.8 `automationQueries.ts` — `useUpdateAutomation` has zero callers
- `apps/web/src/hooks/automationQueries.ts:143` — confirmed 0 callers anywhere in `apps/web/src`. There is no "edit automation" UI wired to it currently (create/delete/enable/disable/trigger are all used).
- **Est. LOC removable (web):** ~13.

### 2.9 Mobile: `workflowHooks.ts` `phaseLabel` — zero callers
- `apps/mobile/src/components/work/workflowHooks.ts:22-31` — confirmed zero callers anywhere in `apps/mobile`. `parseWorkflowHooks` (the other export in the same file) **is** used, in `apps/mobile/app/workflows/[id].tsx:125`.
- **Est. LOC removable (mobile):** ~10.

### 2.10 "Widget" tab in `WorkflowRunPageV2.tsx` — needs live verification, not a static-analysis-confirmed dead control
- `apps/web/src/pages/WorkflowRunPageV2.tsx:719-731` renders `<WidgetHost sessionId={`stageRun:${focusedStageId}`} />`.
- Unlike the prior audit's blanket claim, this key **is** live-populated: `sseManager.ts:571` writes stage-scoped stream state under exactly this `stageRun:<id>` key, and `deriveRunView.ts:265,389` reads it back. So structurally this is wired, not obviously dead by static analysis alone.
- Whether any stage's agent ever actually emits widget blocks in practice is a runtime question this read-only pass can't settle — flag as **needs live verification**, not a confirmed removal candidate (contradicts/softens the prior note that called it definitively dead).

---

## 3. Comment grep — classification of every "legacy/deprecated/fallback/shim/..." hit in scope

| Location | Text | Classification |
|---|---|---|
| `WorkflowRunPageV2.tsx:9-11,256-261` | `?legacy=1` preserved-old-page note + no-op effect | (a) removable legacy — see 2.1 |
| `WorkflowRunPageV2.tsx:773` | "Legacy fabricated files from pre-fix runs — kept out of the file list" | (b) genuine defensive filter (guards a known bad-data shape); low priority given no live data but not urgent |
| `WorkflowBuilderPage.tsx:276` | "...codebases only as `gitRepositories` (the legacy clone-a-URL field)..." | (a) documents dead field, see 1.1 |
| `WorkflowDefinitionPage.tsx:126` | "The legacy create/upload/start sequence writes to a fallback folder..." | (b) — describes a real still-active two-path branch (orchestrated vs plain create+start), not itself removable; both paths are live (see 2.x notes on `isOrchestrated`) |
| `WorkflowDefinitionPage.tsx:138` | "fallback to gitRepositories aliases for backward compat" | (a) removable, see 1.1 |
| `edgeTypeStyles.ts:40` | "Fallback used when an edge carries an unknown/missing type" | (b) genuine defensive default — keep |
| `deriveRunView.ts:178` | "landed here via the router's stage-fallback key" | (b) genuine defensive attribution guard — keep |
| `deriveRunView.ts:312` | "Filter out legacy `unnamed.<ext>` [files]" | (b)/(a) borderline — guards old artifact naming; low priority, safe to keep given the project directive doesn't require touching it, but a candidate if hunting further |
| `deriveTimeline.ts:2` | "moved to shared agent module. Re-export shim" | (a) removable legacy, dead — see 2.4 |
| `InlineHitlControls.tsx:28` | "Omit to hide the action (e.g. legacy interrupts)" | (b) genuine defensive prop-optionality — keep |
| `RightInspector.tsx:133` | "Default to workspace for legacy manifest entries that don't carry a source" | (b) genuine defensive default — keep |
| `RunHeaderBar.tsx:3` | "replaced the legacy V1 ..." | (b) historical comment only, harmless, could be reworded |
| `StyledSelect.tsx:2` / `ToggleSwitch.tsx:2-4` | "backward-compatibility shim" | (a) removable, see 2.4 |
| `RuntimeDAGCanvas.tsx:137` | "Fallback: sequential edges based on stage order" | (b) genuine defensive fallback for definitions with no explicit edges — keep |
| `workflowBuilderStore.ts:296` | "fall back to the legacy gitRepositories aliases" | (a) removable, see 1.1 |
| `workflowRunStore.ts:330` | "Fallback to first [stage]" | (b) genuine UX default — keep (not checked in depth, low risk either way) |
| `AutomationDetailPage.tsx:123` | "Legacy modes (single/loop/batch/script) have nothing to configure" | (b) **false positive** — describes real, current `hasSchema` branching logic; "legacy" here just means "pre-schema" automations, which are still a valid, supported trigger type today. Not removable. |
| `client-core/client.ts:533` | `@deprecated ... kept for older callers` | (a) removable, see 1.8 |
| `mobile/automationModel.ts:32,149` | "Legacy single-workflow field" | (a)/(b) borderline, see 1.9 |
| `mobile/runModel.ts`, `statusStyle.ts`, `workSegment.ts` fallback comments | generic UI fallback wording | (b) genuine defensive UX defaults — keep |
| `client-core/client.ts:1018,1030` (chat `create()`) | `useWorktree`, "gitRepositories deliberately absent" | Out of scope — this is chat/session creation, not the workflow module; not counted here |

No genuine "real TODO / FIXME" markers were found inside the in-scope workflow/automation client files (grep for `TODO`/`FIXME` in this file set returned nothing beyond what's listed above).

---

## 4. Duplicates summary

1. **Run page V1 vs V2:** V1 file is already deleted; only a dead `?legacy=1` no-op effect + stale comments remain in V2 (2.1). Not a live duplicate anymore, just debris.
2. **Automation-execution SSE subscription, two implementations:** `sseManager.ts` `connectAutomationExecution`/`disconnectAutomationExecution` (dead, 0 callers) vs `useAutomationExecutionStream.ts` (live, actually used) — see 2.5. Delete the sseManager pair.
3. **Stage-param mapper:** `WorkflowBuilderPage.tsx:66-86` `toStageParams()` — **investigated and this is NOT a legacy duplicate.** Its own comment explains it was introduced specifically to fix a past bug where the create-path and update-path stage mappings had drifted (dropping `resultValidation`/`contextFilter`/`approvalRequired` on create). It's the single, current, correct implementation. No second mapper was found elsewhere in web/mobile/client-core (`encodeStageOverrides` in `packages/client-core/src/api/stageOverrides.ts` is a different concern — run-time variable/stage-override encoding, not stage-definition-to-API-params mapping; both `WorkflowBuilderPage.tsx` and `WorkflowDefinitionPage.tsx` correctly share this one client-core implementation for run-start, no duplication there either).
4. **Template import UI:** Only one real workflow-template-import path was found (`useImportFromTemplate` — but note this specific *hook* has 0 callers, see 2.7 table; mobile's own `TemplatePickerSheet.tsx` calls `admin.definitions.importTemplate` directly via `useMutation`, not through the shared web hook — these aren't duplicates of each other since they're two different apps, but the **web hook itself looks unused/dead**, possibly because `WorkflowListPage.tsx` calls `platform.importFromTemplate` some other way — worth a quick look before deleting `useImportFromTemplate` to confirm the actual template-import entry point on web.
5. **Two "orchestrator" concepts:** `useStartOrchestratedRun` (project/codebase-scoped, worktree-based runs) vs plain `useCreateWorkflowRun`+`useStartWorkflowRun` (global, no-project runs) are **both live and intentionally different**, selected by `isOrchestrated` (see 1.2) — not a duplicate to remove, this is real branching for two supported workflow shapes.
6. **Unrelated same-named "Workflow" concept:** `apps/web/src/hooks/queries.ts` (`useWorkflows`, `usePauseWorkflow`, `useResumeWorkflow`, `platform.getWorkflows/pauseWorkflow/resumeWorkflow`) is a **separate, chat/session-scoped** concept (background sub-workflows inside a chat), unrelated to the `WorkflowDefinition`/`WorkflowRun` system audited here. Flagging only as a naming-collision risk for whoever does the cleanup — out of this audit's scope, not counted in LOC estimates.
7. **Mobile vs web duplicated logic:** No significant duplicated *business logic* found between `apps/mobile/src/components/work/*` and `apps/web/src/**` that isn't already justified by the platform split (mobile's view-model files like `runModel.ts`/`automationModel.ts`/`agentModel.ts` are deliberately framework-free pure functions per their own header comments, mirroring shapes client-core also models but kept separate on purpose for RN testability — not flagged as removable duplication).

---

## 5. LOC estimates (removable, conservative — code only, not counting comment-only cleanups)

| Area | Estimate |
|---|---|
| **apps/web** | ~330 LOC (gitRepositories subsystem ~45, scope field ~8, isOrchestrated redundant branch ~1, templateId UI ~15, promptType ~1, agentName fallback ~3, `?legacy=1` debris ~8, timelineEvents/awaitingInputStages ~55, 3 shim files ~29, dead SSE duplicate ~12, dead "Stage actions" button ~14, 12 dead workflowQueries hooks ~150, `useUpdateAutomation` ~13) — HitlPanel comment cleanup and other comment-only edits are trivial and not counted. |
| **apps/mobile** | ~15 LOC (`phaseLabel` ~10, legacy `workflowDefinitionId` fallback ~5) |
| **packages/client-core** | ~4 LOC (deprecated `AutomationExecutionSummary` fields) |

Mobile and client-core are notably clean relative to web — almost all the accumulated cruft is in the web builder/run pages and the `workflowQueries.ts` hook surface, concentrated around the `gitRepositories`→`codebaseAliases` migration and the V1→V2 run-page migration that were each only half-finished (server/type moved on, client kept parallel dead state).

## 6. Items from the task's checklist explicitly checked and found NOT legacy / already clean
- `copilotConfig` — zero hits anywhere in scope; already fully migrated to `harnessConfig`.
- `interactive` agentMode alias — no such alias found in workflow files.
- `stageTemplateId` — does not exist anywhere; only `templateId` (see 1.4).
- `iterationConfig`, `hooksFile`, `selectedArtifacts`, `defaultAgentRef`, `masterSessionId`, `providerInstanceId` — zero hits in any in-scope client file. These are either server-only schema fields the UI never surfaces (a feature gap, not legacy cruft — e.g. `defaultAgentRef` has real server support but no builder UI to set it) or don't exist in this codebase at all.
- `useWorktree` — only appears in chat-session creation (`client.ts:1030`), out of workflow scope.
- `waitForCompletion` — real, actively used per-prompt field (`PromptEditor.tsx`, `PromptFilePicker.tsx`, `WorkflowListPage.tsx`), not legacy.
- Old per-scope SSE `EventSource` paths for workflows — already fully migrated; `sseManager.ts` comments (lines 38-41, 1327-1332) explicitly document the old per-stage-session pattern was removed pre-"STR-04"; no `new EventSource(` calls exist outside the unified `openMultiplexedStream` path.
- `DAGCanvas.tsx` vs `RuntimeDAGCanvas.tsx`, `StageNode.tsx` vs `RuntimeStageNode.tsx` — intentional design-time vs run-time split, both actively used, not duplicates.
- Stage-param mapper (`toStageParams`) — confirmed single canonical implementation, not a duplicate (see Duplicates §3).
