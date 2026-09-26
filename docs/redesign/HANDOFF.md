# Handoff to the Workflow Overhaul Plan

Published per `07-phases.md` §"Handoff to the Workflow Overhaul Plan (end of P4)" — complete as of P4-12. From here
the Overhaul's UI work packages build on `apps/web/src/ui` (the kit) and `apps/web/src/blocks` (query-aware parts), per
D-35. Layer rules (lint-enforced, `.claude/CLAUDE.md`): `ui/` is presentational; `blocks/` may read data hooks and
stores but never `features/`; a `features/<area>` never imports another feature; cross-feature wiring and registry
files live in `app/`.

## 1. Storybook and the Storybook MCP

| What | Where |
|---|---|
| Start the workshop | `pnpm --filter @generatorai/web storybook` → http://localhost:6006 (`.claude/launch.json` "storybook") |
| MCP for agents | `http://localhost:6006/mcp` while Storybook runs (`@storybook/addon-mcp`; registered as `storybook` in the repo-root `.mcp.json`). Query it for an existing component **before** writing one |
| Static build | `pnpm --filter @generatorai/web build-storybook` → `apps/web/storybook-static` (served on :6007 for VRT) |
| Story tests + a11y | `pnpm --filter @generatorai/web test:stories` (three theme projects) |
| Stories-present gate | `pnpm --filter @generatorai/web check:design --strict` fails a `ui/{primitives,patterns,shell,templates}` component without a sibling `*.stories.tsx` |

Tokens, spacing, radii and the Rosetta table for translating a board: `02-design-system-spec.md`,
`03-component-inventory-kit.md`. Only design utilities in new code (no arbitrary values, `var(--…)`, palette classes).

## 2. Templates and shell parts

| ID | Component (`apps/web/src/ui/…`) | Slots / use |
|---|---|---|
| T-01 | `templates/ListPage` | header · title block · filter bar · table/list · bulk bar (ChatsList) |
| T-02 | `templates/DetailPage` | header · title block · tabs · body · optional 360 side rail (ProjectDetail, WorkflowDetail) |
| T-03 | `templates/FormWithAside` | header · form sections · 320 summary aside · sticky footer (ChatCreate, WorkflowNew) |
| T-04 | `templates/Workspace` | `header` · `main` · `bottom` · `dock` (template split) **or** `dockHost` (a host that owns the split, e.g. `blocks/dock` Dock) · `bare` when main/bottom bring their own scroll and padding. The chat page uses `bare` + `dockHost`; a run page should do the same (`defaultSize={440}` on its Dock, D-27) |
| T-05 | `templates/MasterDetail` | list pane + detail (Settings modal) |
| L-01 | `templates/Dashboard` | Home |
| — | `templates/Gate` | 404 / route error / pairing |
| S-04/S-05 | `shell/MainCard`, `shell/PageHeaderSlot` | every page renders its own C-01 `patterns/PageHeader` (breadcrumb, status, meta, actions, `dockToggle`, optional 38px `subbar` — the run header's second row) and sets `legacyHeader: false` on its route (`app/routes/defineRoute.tsx`) |
| S-08/S-09 | `shell/DockFrame`, `shell/NarrowDockSheet` | dock chrome; used through `blocks/dock` Dock |
| S-12 | `shell/FindBarFrame` | desktop find bar (wired once in `app/shell/FindBar`, nothing to do per page) |

Not built yet (PW owns it): L-04 CanvasEditor (builder canvas). L-05 `templates/ModalWithAside` (the Run dialog body) landed with PW-a.

## 3. Transcript kit and the tool-card registry (P4-07)

`apps/web/src/blocks/transcript` (import from `@/blocks/transcript/index.js`) is the one way to show an agent at work —
the chat, the Tasks dock "Last steps" and a workflow stage body (a stage is a compact chat). The React-free model is in
`@generatorai/client-core` (`transcript/`: `deriveTimeline`, `deriveSegments`, `groupSteps`, `buildTranscriptTurns`,
`digestBlocks`, usage math); the shared words and kinds are in `@generatorai/shared/ui-contract` (`toolVerbs.ts`,
`gates.ts`, `copy.ts`).

| Part | Use |
|---|---|
| `TurnBody` | one response's body from `segments` (`deriveSegments(blocks)`), or `steps` + `answer` |
| `TranscriptView` / `TranscriptTurn` | a whole transcript of `buildTranscriptTurns(messages)` turns |
| `StepList` | a step rail (`TimelineStep[]`) — grouped (Normal) or expanded (Verbose) |
| `PermissionCard`, `QuestionCard`, `PlanReadyCard`, `ComputerConsentCard` | the gate family on `GateCardFrame` |
| `TranscriptProvider` | click-throughs, gate handlers, host slots (`renderWidget`, `renderScmResult`) and the view mode |

The chat's host slots are filled with `blocks/widgets` `WidgetFrame` and `blocks/scm` `ScmResultCard` (P4-12); a run
page passes the same two.

### Registering a tool card (WF-12 / WF-13 / WF-14)

```ts
// app/registries/toolCards.ts — side-effect registration at module load
import { registerToolCard, type ToolCardProps } from '@/blocks/transcript/index.js';

function WorkflowRunCard({ step, ctx }: ToolCardProps) {
  // step.args / step.result / step.status / step.durationMs; ctx.actions (dock click-throughs), ctx.live
  return <RunSummary run={parseRun(step.result)} />;
}

registerToolCard({
  id: 'workflow.run',                  // unique; re-registering an id replaces it
  match: 'run_workflow',               // exact name (after mcp__server__ humanizing), RegExp, or (tool) => boolean
  icon: 'workflows',                   // IconConcept for the neutral row glyph
  verb: () => 'Started workflow',      // row verb (default: ui-contract toolStepVerb)
  target: (step) => runName(step),     // row target (default: arg-derived)
  result: (step) => runStatusWord(step), // row result node
  subject: (step) => runName(step),    // card header "Called `run_workflow` · <subject> · <duration>"
  Card: WorkflowRunCard,               // body under the row, in the ToolCallCardFrame
  openIn: 'browser',                   // optional: 'terminal' | 'changes' | 'browser' trailing row action
});
```

Resolution: an exact `match` beats a RegExp/predicate; among equals the latest registration wins, so an overhaul entry
can override a built-in (`builtin.shell`, `builtin.file-edit`, `builtin.browser`). `registerToolCard` returns an
unregister function. Contract test: `apps/web/src/blocks/transcript/__tests__/toolCardRegistry.test.tsx`. Load the
registration file the way `app/registries/tasksSections.tsx` is loaded (with the chat route in
`app/routes/chats.routes.tsx`, and with the run route once a run page renders the transcript).

## 4. Composer — compact stage variant and the tool-toggle registry (P4-08)

`apps/web/src/blocks/composer` (`@/blocks/composer/index.js`). The composer never owns the turn: Stop state and sending
come from the host.

```tsx
<Composer
  variant="stage"                       // WF-17 StageMessageBox: no model/mode/effort chips, no meta or hint row
  sessionId={stageSessionId}
  disabled={false}                      // D-29: typing is never blocked; while running, Send becomes Stop
  placeholder="Message Bug Fixer in this stage…"
  isStreaming={stageRunning}
  stopState={stop} onStop={stop.press}  // two-phase stop from the host (client-core composerMachine rules)
  pendingInteractionLabel={blockedReason}  // "Decide the review above first…" — the server refuses sends until it clears
  customSendFn={({ prompt, attachments }) => sendStageMessage(stageKey, prompt, attachments)}
/>
```

`aboveComposer` takes the chat's `ChangesTray` (exported from the same index) or anything else a host stacks on the box.

Tool toggles ("Tools in this chat", F-composer-14) — the registry ships **empty**; the popover button renders only when
an entry is available (D-36):

```ts
// app/registries/composerTools.ts
import { registerComposerTool } from '@/blocks/composer/index.js';

registerComposerTool({
  id: 'workflows',                                  // ComposerToolToggleId (ui-contract composer.ts)
  label: 'Workflows',
  hint: 'Let this chat run workflows',
  icon: 'workflows',
  order: 40,                                        // ascending
  defaultFor: (chat) => !!chat.orchestratorMode,
  available: () => true,
  read: (chat) => chat.tools?.workflows ?? !!chat.orchestratorMode,
  write: (chatId, on) => setChatWorkflowsTool(chatId, on),  // resolve when stored; failures toast
});                                                 // returns unregister; same id replaces
```

`useComposerTools(chat)` / `listComposerTools()` read the registry. A toggle must take effect mid-conversation — today a
chat's capability delta freezes at session start (05-gap-matrix "per-chat tool toggles").

## 5. Dock — state, tab registry, controller and the Tasks sections registry (P4-06, P4-11, P4-12)

`apps/web/src/blocks/dock` (`@/blocks/dock/index.js`), shared by the chat and a future run page.

| API | Contract |
|---|---|
| `<Dock open onOpenChange storageKey layoutStorageKey tabs defaultTabType addableTabTypes focusTabRequest onTabClose main defaultSize />` | S-08 DockFrame + DockTabStrip; ≥1200 px a resizable split beside `main`, <1200 px a 380 px non-modal sheet, full width on a phone; closing collapses, never unmounts; panels mount on first selection and stay mounted until their tab closes |
| `DockRegistry` = `Record<type, DockTabDef>` | `DockTabDef { Component (memo, takes DockPanelProps {id,type,index,active}) , label, icon, description?, pinned?, allowMultiple?, maxInstances?, getTabLabel?, getTabIcon?, getTabCount?, getTabDot?, disabled?, disabledReason? }`. A panel reads its data from a context or store, never a closure, and gates live work (sockets, frames) on `active` |
| `useDockOpen(key, initial)` | `[open, setOpen, toggle]`, persisted `'1'|'0'` |
| `useDockState` (inside Dock) | per-scope tab list, caps (`DOCK_TAB_CAPS` browser 5 · terminal 4 · file 8 · widget 6), 6 s cap notice, focus requests `{type, tabId?, token}` idempotent per token |
| `useSurfaceDockTabs({isOrchestrator, computerUseEnabled})` | W29 ledger: the tab types this surface can draw, the "+" menu types, the default tab |
| `useDockLinkParam(cb)` | `?dock=changes|files|terminal|browser|tasks|computer|plan` (R-4) |
| keys | `dockStorageKeys('chat'|'run')` in `@generatorai/shared/ui-contract` `pane.ts`: `generatorai:dock:<scope>:open|layout|<id>` |
| `stores/dockStore.ts` `useDockStore` | the page's `{open, toggle}` controller for the `dock.toggle` command (Ctrl/⌘ Alt B) and the desktop View menu checkmark — register it while mounted (`useChatDockRouting` does for chat). The page header's own toggle is an `IconButton icon="dock"` named "Show side pane"/"Hide side pane", `data-testid="dock-toggle"` |

Panels available as blocks: `ChangesDockPanel` (`blocks/changes`, reads `ChangesDockContext`), `FilesDockPanel` /
`FileDockPanel` + `useFileTabs` (`blocks/files`, Sources header = `SourcesBlock`), `TerminalDockPanel`
(`blocks/terminal`), `BrowserDockPanel` (`blocks/browser`), `PlanPanel` (`blocks/plan`), `WidgetHost` (`blocks/widgets`).
Tasks and Computer are chat-only (`features/chat/dock`).

**Tasks sections registry** (F-dock-06; contract in `apps/web/src/features/chat/dock/tasks/tasksSections.ts`,
registrations in `apps/web/src/app/registries/tasksSections.tsx`):

```tsx
import { registerTasksSection } from '@/features/chat/index.js';

registerTasksSection({
  id: 'workflow-runs',                             // kebab-case; testid `tasks-section-workflow-runs`
  title: 'Workflow runs from this chat',
  order: 200,                                      // built-in "Background tasks" is 100
  when: ({ chat }) => chat.orchestratorMode === true,
  useCount: ({ chatId }) => useChatWorkflowRuns(chatId).data?.length,   // a hook; undefined = unknown
  render: (ctx) => <WorkflowRunsSection {...ctx} />,                  // ctx.stacked: host draws the title row
}, { replace: Boolean(import.meta.hot) });         // duplicate ids throw otherwise; returns unregister
```

## 6. Status map (D-18)

One vocabulary for chats, runs, stages, automations and tasks: `@generatorai/shared` `status/`.

- 8 visual states (`STATUS_STATES`): `queued · running · waiting · needs_you · paused · succeeded · failed · skipped`,
  each with glyph, tone, badge recipe and spin in `STATUS_STATE_DEFS`.
- Per-domain maps in `STATUS_MAPS`: `workflowRun`, `stageRun`, `legacyWorkflow`, `automationExecution`,
  `automationRunItem`, `backgroundTask`, `chat` (lifecycle only — "Archived" is a neutral chip), `chatTurn`, `stream`,
  `session`, `toolCall`, …; `toStatus(domain, value)` → mapping, `resolveStatus(domain, value)` → `{state, label, def}`.
  Domain words: chats say "Done", runs say "Succeeded" (`STATUS_DOMAIN_LABELS`).
- Helpers: `chatActivity({stream, pendingInteraction})` (Needs you outranks the stream — the chat header's badge),
  `toolCallStatus(block)`.
- Render: `ui/primitives/StatusBadge` (`state`, `label?`, `context: 'chat'|'run'`, `phase?` → "Running · Finalizing");
  dense rows use `StatusDot` with `STATUS_TONE_TEXT`.

## 7. Workflow kit pieces (WF-xx, `03-component-inventory-domain.md` §4) — what exists

| ID | Piece | Built by | State at handoff |
|---|---|---|---|
| WF-01 | VersionChip / DraftChip | Redesign P5 | **exists** (PW-a): `blocks/workflow` `VersionChip` |
| WF-02 | KeyChip | Redesign P5 | **exists** (PW-a): `blocks/workflow` `KeyChip` |
| WF-03 | ProblemsPanel | Redesign P5 | not built yet |
| WF-04 | StageTableRow | PW | **built (PW-c)**: `features/workflows/run/stages/StageRow.tsx` |
| WF-05 | RunLifecycleCard | PW | not built; `patterns/StepRail` exists |
| WF-06 | BudgetMeter | Redesign P5 (view) | **built (PW-c)**: `features/workflows/run/header/BudgetMeter.tsx` (tokens-only without reported cost) |
| WF-07 | ContextGauge (stage) | reuse B-13 | **exists**: `blocks/composer/parts/ContextGauge` |
| WF-08 | DecisionCard | PW | **built (PW-c)**: `features/workflows/run/controlFlow/DecisionCard.tsx` |
| WF-09 | ReviewCard | PW | **built (PW-c)**: `features/workflows/run/stages/ReviewCard.tsx` |
| WF-10 | VersionHistoryPanel | PW | not built |
| WF-11 | RunDialogPlanPreview | PW | **exists** (PW-a): `blocks/workflow` `RunPlanPreview` inside the query-aware `RunDialog` (L-05 ModalWithAside) — the builder opens the same dialog (`prepareTarget` saves first) |
| WF-12 | Chat run card | PW | **built (PW-c)**: `features/workflows/chat/WorkflowRunCards.tsx` via the segment-card registry |
| WF-13 | Chat approval card | PW | **built (PW-c)**: inside the WF-12 card (GateCardFrame) |
| WF-14 | Chat draft card | PW | **built (PW-c)**: `features/workflows/chat/WorkflowRunCards.tsx` |
| WF-15 | CanvasGroupNode | PW | not built (L-04 CanvasEditor not built) |
| WF-16 | StageKindPalette | PW | not built; `primitives/Autocomplete` exists |
| WF-17 | StageMessageBox | Redesign P4 | **exists**: `Composer variant="stage"` (§4); PW wires `customSendFn` |
| WF-18 | ExitRuleTable / CarryTable | PW | not built; `NumberField`, `Table`, `SegmentedControl` exist |
| WF-19 | IterationsTable | PW | **built (PW-c)**: `features/workflows/run/controlFlow/IterationsTable.tsx` |
| WF-20 | TriggerChip | Redesign P5 | **exists** (PW-a): `blocks/workflow` `TriggerChip` (+ `iconOnly`), `RUN_TRIGGERS` |

Extension points the Overhaul plugs into without reopening chat code: tool-card registry (§3), composer tool toggles
(§4), Tasks sections (§5).

## 8. The chat workspace as a reference (P4-12)

`features/chat/ChatPage.tsx` on T-04 is the template for a run page: `ChatHeader` (PageHeader: breadcrumb with the
name as h1, D-18 status, meta chips, More menu, dock toggle), `ChatTranscript` (TranscriptView host), the composer with
`aboveComposer`, and `Dock` through `dockHost`. Logic lives in `useChatView`; the page is JSX plus the dock registry.
The workflow run page followed it in PW-c (`features/workflows/run/WorkflowRunPage.tsx`: RunHeader, stage table,
Dock at 440 px with `generatorai:dock:run:*` keys); `components/layout/RightPane.tsx` and `hooks/useResizablePane.ts`
are deleted. "Open in editor" for a page header: `blocks/editor/useEditorActions()` over the page's
`editorTargetStore` target.
