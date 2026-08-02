> **SUPERSEDED (2026-07):** the production UI now uses the shared `components/agent/StreamPanel` + design-system primitives; this proposal was not adopted as written.

# Workflow Run Panel — UX Redesign Proposal

> **Status:** Proposal for review. No production code has been changed. A runnable sample lives at [`apps/web/src/components/workflow/redesign/`](../apps/web/src/components/workflow/redesign/) and can be viewed at `/__redesign/workflow-run` (dev-only route).
>
> This proposal builds on the chat-panel redesign at [`docs/CHAT_WORKFLOW_UX_REDESIGN.md`](./CHAT_WORKFLOW_UX_REDESIGN.md) — the same `TurnCard` / `ActivityTimeline` / `AnswerBlock` primitives are reused inside each stage.

---

## 1. Full feature inventory the redesign must cover

Verified against the current implementation. Every one of these must remain reachable in the new UI.

### Run-level

| Feature | Where today | Data / API |
|---|---|---|
| Run status (10 states) | Header `RunStatusBadge` | `WorkflowRunStatus` — `pending / starting / running / paused / cancelling / cancelled / completed / failed` |
| Elapsed timer + N/M stages + failed count | Header meta row | `elapsedMs`, `stageRuns[]` |
| Start / Pause / Resume / Cancel / Retry | `WorkflowRunControls` | `useStart/Pause/Resume/Cancel/RetryWorkflowRun` |
| Run error banner | Header | `run.error` |
| Permission mode (HITL) — 4 modes | `HitlPanel` modal | `bypassPermissions / default / acceptEdits / plan` |
| Pending interrupts queue | `HitlPanel` list | polled `listPendingInterrupts` |
| Live activity strip | `LiveActivityBar` | derived from stages |
| Awaiting-approval banner | `HitlNotificationBanner` | `stages.filter(awaiting_input)` |
| Pipeline strip (chips per stage) | `DagStatusStrip` | run + orderMap |
| Full DAG graph (collapsible) | `RuntimeDAGCanvas` + toggle | definition edges + stage runs |
| Bottom timeline (event log) | `RunTimeline` | derived events |
| Files & Uploads tab | `RunArtifactsPanel` | workspace / artifacts / uploads / worktree sources |
| Workflow Messages tab | `WorkflowMessages` | per-stage `useStageChatHistory` + `useStreamStore` |
| Breadcrumb | Header | route params + `definition.name` |

### Stage-level

| Feature | Where today | Data |
|---|---|---|
| Stage status (10 states) | `StatusBadge`, `StageSection` header | includes `pending / queued / running / paused / awaiting_input / sleeping / completed / failed / cancelled / skipped` |
| Step progress (N/M) | Stage header pill | `currentStep / totalSteps` |
| Parallel indicator (⚡ N others) | Stage header | derived via overlap sweep-line |
| Per-stage duration timer (live tick) | Stage header | `startedAt → completedAt \|\| now` |
| Prompt block (definition prompt + follow-up) | `PromptBlock` | first user message or definition prompt |
| Context block (predecessor summaries + hook context) | `ContextBlock` | messages with `isContextMessage` or `isHookContext` |
| Response block (live stream + persisted) | `ResponseBlock` + `StreamingMessage` / `AssistantMessage` | stream store keyed `stageRun:<id>` |
| Tool calls count / files count | Stage header meta | derived |
| Structured output (JSON) | `OutputDataBlock` | `stageRun.outputData` |
| Summary passed to successors | `SummaryBlock` | `stageRun.summary` |
| Inline HITL approval + follow-up | `InlineStageApproval` | `interruptData`, approve/reject + optional prompt |
| Per-stage controls: pause / resume / retry / cancel | `StageRunControls` | dedicated endpoints |
| Retry button on failed stage | `RetryStageButton` | `useRetryStageRun` |
| Error box | inline | `stageRun.error` |
| Sub-agent / system / thinking blocks | `StreamingMessage` sub-components | grouped stream blocks |
| Sleeping (durable wait) | `RuntimeStageNode` only | `wake_at` timestamp |

### Cross-cutting

- Auto-follow scroll (throttled) on the actively streaming stage.
- Auto-expand running stages.
- Replay-safe rendering (SSE replay first, then history fallback) — must not flash between the two.
- 10-state colour + icon parity (never colour alone).
- Light + dark parity, keyboard access.

---

## 2. What today’s layout looks like

```
┌────────────────────────────────────────────────────────────────────────────┐
│ glass-header (~90px)  breadcrumb + big status + name + meta + controls    │
├────────────────────────────────────────────────────────────────────────────┤
│ LiveActivityBar     (~34px)  ●Running or ⚠ Awaiting                        │
├────────────────────────────────────────────────────────────────────────────┤
│ DagStatusStrip      (~42px)  [stage1] — [stage2] — [stage3] — [stage4]    │  ← wraps to hscroll
├───────────────────────────────────────────────────┬────────────────────────┤
│ [Graph ▾]  toggle strip                           │ ← flat button on right │
├────────────────────────────────────────────────────────────────────────────┤
│ (optional) RuntimeDAGCanvas 320px                                          │
├────────────────────────────────────────────────────────────────────────────┤
│ Tabs:  [Workflow Messages]  [Files & Uploads]                             │
│                                                                            │
│   ▸ Stage 1  [Completed · 3/3 · 2 tools · 12s]                            │
│       Context ▸  |  📥 Prompt  |  🤖 Response …                            │
│   ▸ Stage 2  [Running   · 4/7 · 1 tool  · 8s ]                            │
│       (auto-expanded)                                                      │
│   ▸ Stage 3  [Pending]                                                    │
│   ▸ Stage 4  [Skipped]                                                    │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│ ▲ Timeline  (collapsible)                                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

### Pain points

1. **Header takes 90px, LiveBar 34px, strip 42px, tabs 40px** — before you see the first stage, ~210px is chrome. On a 720p laptop that’s 30% of the viewport.
2. **Progress in three places** — status badge (top-left), `LiveActivityBar` counter, `DagStatusStrip` pill state — with subtle differences. Users have to check which is authoritative.
3. **Full DAG is behind a toggle** but the strip is a small horizontal scroll that hides structure (fan-out, fan-in, edge conditions). Real DAG topology is invisible unless you click.
4. **Stage sections stack vertically** with heavy chrome inside each (context row → prompt row → response header → response → output data → summary → error box). A completed stage that ran a single tool call renders ~7 nested cards.
5. **Parallel stages** are rendered *sequentially* in the message list with a small ⚡ badge; you cannot see them side-by-side, so it’s hard to see “what’s running now.”
6. **No stage-level “glance summary”** — to see whether a completed stage produced files or just text, you have to expand it and scroll.
7. **Timeline is stashed at the bottom** with a small chevron — most users never see it. It’s the best debugging surface but hidden.
8. **HITL is split across 4 surfaces** — banner + `LiveActivityBar` amber state + inline stage approval + `HitlPanel` modal. Users don’t know which to trust.
9. **Retry-a-stage vs retry-a-run** live in different places — the stage-level retry sits inside the collapsed section (users must expand a failed stage first).
10. **The bottom timeline duplicates the strip** (also shows stage-start / stage-completed events); it doesn’t add unique value in its current form.
11. **Files panel** is a full-width replacement of the message spine (tab swap). You cannot look at a stage’s output *and* the file it wrote at the same time.
12. **Sleeping / durable-wait stages** have UI only in the DAG canvas — the message spine renders nothing meaningful.

---

## 3. Design principles for the redesign

1. **One surface, three panes.** The run is one page; you never lose your place by switching tabs. Left rail = pipeline. Center = stage detail. Right = context (files / structured output / hooks). Panes are resizable + collapsible.
2. **Progress lives once, at the top.** A single, always-visible **RunHeaderBar** shows: status pill, name, elapsed, `done/total` bar, controls, HITL banner (when active). Everything else in the UI depends on this bar, not competes with it.
3. **Pipeline is a spine, not a strip.** A vertical `PipelineSpine` on the left rail renders stages in DAG topological order with fan-out/fan-in indentation, live status dots, per-stage duration, and click-to-jump. Ideal for tall runs (5+ stages) — a horizontal strip stops working around 6 stages anyway.
4. **A stage is a TurnCard.** Reuse the chat primitives (`TurnCard` / `ActivityTimeline` / `AnswerBlock`) so a stage looks like a chat turn: prompt at top, muted activity timeline in the middle, prominent answer at the bottom, structured output + summary as small chips below the answer.
5. **Parallel stages render side-by-side** in a horizontal 2-col group inside the center pane (when viewport width ≥ 1280px). On narrower screens they stack with a shared `Parallel batch (2)` header.
6. **HITL is one thing.** A `HitlBanner` at the top of the center pane replaces the four current surfaces. It opens an inline approval strip in-context for the awaiting stage; the modal permission mode selector becomes a settings popover on the header.
7. **Right pane = live inspector.** Contextual to the currently-focused stage: its files (changed / created / read), structured output JSON, hooks that fired, tool call log. Always visible; users can pin any tab. Replaces the Files-vs-Messages tab swap.
8. **Timeline is on-demand overlay**, not a bottom strip. `Cmd/Ctrl-K` opens a full-screen event log; the bottom bar is retired.
9. **DAG graph is a lightbox**, not a docked panel. Opens on `G`; closes on `Escape`. When you need the graph, you *really* need it — dedicate the whole viewport for those moments.
10. **Nothing color-only.** Every state has icon + label + colour, matching current `StatusBadge` conventions.

---

## 4. Proposed layout

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ RunHeaderBar (54px)                                                             │
│   ● Running · Complex DAG Demo #17 · 3 / 7 stages · 4m 12s     [Pause][Cancel] │
│   ▓▓▓▓▓░░░░░░░░░ 43%    ⚡ 2 parallel   ⚠ 1 awaiting                            │
├────────────┬─────────────────────────────────────────────────┬─────────────────┤
│            │  HitlBanner (only when awaiting)                │                 │
│ PipelineS  ├─────────────────────────────────────────────────┤                 │
│  pine      │                                                 │ Right Inspector │
│            │  ┌─ Stage 1 · Spec & Plan · ✓ · 42s ─────────┐  │                 │
│  ● 1 Spec  │  │  📥 Prompt  ▸                              │  │  [ Files ]     │
│    · 42s   │  │  ● Activity 6/6 ▾                          │  │  [ Output ]    │
│    ✓       │  │    ● Read baseprompt.txt        220ms  ✓  │  │  [ Hooks ]     │
│    │       │  │    ● Explore repo structure     2.1s   ✓  │  │  [ Tools ]     │
│  ● 2 Impl  │  │  📄 Answer …                               │  │                 │
│    · 3m    │  │  [Summary passed to next ▸]                │  │  Selected:      │
│    ▶       │  └────────────────────────────────────────────┘  │  Stage 2 — Impl │
│    │       │                                                 │                 │
│  ├─┬─ 3    │  ┌─ Parallel batch (2) · running ────────────┐  │  Files (7)      │
│  │ │ Back  │  │  ┌─ 3 Backend ····· ▶ · 1m ─┐             │  │  ▸ backend/     │
│  │ │ ▶     │  │  │ ...                       │             │  │    ▸ index.ts M │
│  │ │ 1m    │  │  └───────────────────────────┘             │  │    ▸ auth.ts  A │
│  │ │       │  │  ┌─ 4 Frontend ····· ▶ · 1m ┐              │  │  ▸ README.md M  │
│  │ ├─ 4    │  │  │ ...                       │             │  │                 │
│  │ │ Front │  │  └───────────────────────────┘             │  │  [Open diff]    │
│  │ │ ▶     │  └────────────────────────────────────────────┘  │                 │
│  │ │ 1m    │                                                 │                 │
│  │ │       │  ┌─ Stage 5 · Merge · ⏳ pending ────────────┐  │                 │
│  │ ●───────│  │  Waiting for stages 3, 4                  │  │                 │
│  ● 5 Merge │  └────────────────────────────────────────────┘  │                 │
│    pending │                                                 │                 │
│            │                                                 │                 │
│  ● 6 Deploy│  ┌─ Stage 6 · Deploy · ⚠ Awaiting approval ─┐  │                 │
│    ⚠ input │  │  Model wants to run: bash deploy.sh …     │  │                 │
│  ● 7 Notify│  │  [ Approve ] [ Reject ]                    │  │                 │
│            │  │  + Add follow-up …                         │  │                 │
│            │  └────────────────────────────────────────────┘  │                 │
└────────────┴─────────────────────────────────────────────────┴─────────────────┘
  ⌘K → event log · G → graph · P → pause · R → retry focused
```

Legend:

- `●` filled dot = terminal (success/failure), `▶` = running, `⏳` = pending, `⚠` = HITL.
- Left rail width: 260–320px, resizable, collapsible to 44px (icon-only). Persisted per user.
- Right inspector: 320–420px, resizable, collapsible.
- Center pane: min 560px content width, `max-w-3xl` for readable stage cards.

### Anatomy: a single stage

Uses the chat `TurnCard` primitives verbatim, with one added slot for **structured output / summary chips** and one for **inline HITL controls**:

```
┌─ Stage 2 · Implement    [Running · 4/7]  ⚡ parallel(2)  · 1m 12s  [⋯] ┐
│ 📥  Prompt                                                             │
│    Implement the backend service based on the plan …                   │
│                                                                        │
│ ● Activity 4/7  active                                                 │
│   ✓ Read plan.md                                       120ms           │
│   ✓ Wrote backend/index.ts               58 lines      1.4s           │
│   ✓ Wrote backend/auth.ts               102 lines      2.1s           │
│   ▶ Running  npm install                              (running)         │
│                                                                        │
│ ── Answer ──                                                           │
│ I implemented the backend as three modules …                           │
│                                                                        │
│ [ 📎 3 files · Show ]  [ Summary ▸ ]  [ Structured output ▸ ]         │
│                                                                        │
│ ▎gpt-5.4-mini · ↑8.4k ↓1.2k · 32.1s                                    │
└────────────────────────────────────────────────────────────────────────┘
```

### Anatomy: parallel batch

Two `TurnCard`s side-by-side inside a `ParallelBatch` container. The container tracks the group's completion (2/2, 1/2 running, etc.) and lets the user collapse the whole batch.

### Anatomy: awaiting-input stage

The card sports an amber left border and an **InlineHitlControls** block *above* the activity (so it never scrolls out of view). Controls: `Approve` / `Reject` / `Approve & follow up…` (opens a textarea).

### Anatomy: sleeping stage

`sleeping` gets a distinct indigo pill + a `wake in Xm Ys` countdown chip, and a small `Wake now` button (calls the existing resume endpoint).

---

## 5. Component decomposition

New files (all in a fresh `apps/web/src/components/workflow/redesign/`):

```
redesign/
  RunHeaderBar.tsx        — status + name + progress bar + controls + HITL summary
  PipelineSpine.tsx       — left rail; renders stages in topological order with fan-out
  SpineItem.tsx           — one row of the spine
  CenterPane.tsx          — scroll host for stage cards
  StageCard.tsx           — TurnCard reuse + stage-specific chips + inline HITL
  ParallelBatch.tsx       — horizontal group container
  InlineHitlControls.tsx  — approve / reject / follow-up
  RightInspector.tsx      — tabbed panel: Files / Output / Hooks / Tools
  RunHitlBanner.tsx       — permission-mode + pending queue summary
  RunEventOverlay.tsx     — ⌘K full-screen timeline
  GraphLightbox.tsx       — G-key full-screen DAG canvas
  RunRedesignPage.tsx     — orchestrates everything; the new WorkflowRunPage entry
  types.ts                — RunView, StageView derived types
  deriveRunView.ts        — memoised: run + defs + streams → RunView
```

`deriveRunView` is the *only* piece that reads from the existing stores. All new components take pure `RunView` / `StageView` props, so the same components render the mock preview + a live run + a Storybook fixture identically.

---

## 6. Streaming + skeleton rules (workflow-specific)

Chat rules apply verbatim to stage cards, plus:

1. **Spine-level shimmer.** While a stage is `pending` or `queued` in the spine, its dot shimmers softly. When it hits `running`, the dot switches to the primary-pulse animation.
2. **Auto-follow only within the focused stage.** The center pane pins the focused stage in view; step insertions in that card scroll only the internal answer region. Non-focused stages never cause the outer scroll to move.
3. **Parallel batch fairness.** When a batch is running with N stages, every card renders in its own `<Suspense>`-friendly slot. Slow-streaming stages don’t block sibling cards.
4. **Pending stages render as compact placeholders**, not full cards — just header + `Waiting for: Stage 3, Stage 4`. This dramatically shortens tall runs.
5. **Terminal stages** get `content-visibility: auto` so a run with 30 completed stages doesn't pay for their DOM.
6. **HITL banner is sticky** at the top of the center pane; scrolls with the content but re-pins on the next visible awaiting stage.

---

## 7. Perf + a11y checklist

- [ ] `StageCard` memo on `(id, status, currentStep, totalSteps, streamDigest, outputHash)`.
- [ ] `deriveRunView` in `useMemo` on `(run.stageRuns.map(s => s.updatedAt).join('|'))`.
- [ ] Spine rows memoised on `(id, status, duration bucket)`.
- [ ] Virtualise center pane cards when `stages.length > 40`.
- [ ] `content-visibility: auto` on terminal stages out of viewport.
- [ ] `aria-live="polite"` on RunHeaderBar; `role="tree"` for spine (each SpineItem `role="treeitem"`).
- [ ] Keyboard: `↑/↓` navigates spine, `Enter` focuses card, `⌘K` timeline, `G` graph, `P` pause, `R` retry focused.
- [ ] Every status pill = icon + label + colour.
- [ ] Skeleton bars use existing `.skeleton-shimmer` class.

---

## 8. Migration plan

Same shape as the chat proposal — 4 additive PRs behind a `feature.runV2` flag:

1. **Primitives + preview page** — `redesign/` folder, mock-data preview at `/__redesign/workflow-run`.
2. **`RunRedesignPage` opt-in** — reads the same stores as `WorkflowRunPage`; both coexist behind flag.
3. **Right inspector integration** — hook up `useRunWorkspace`, `useStageChatHistory` for tools, `hookExecutor` recent runs.
4. **Cutover** — flip default, delete `WorkflowRunPage` chrome (keep `RuntimeDAGCanvas`, `RunTimeline`, `HitlPanel` internals — they’re reused inside the new components).

No DB / SSE / API changes required.

---

## 9. Open questions for review

1. **Left-rail default width** — 280px is comfy on 1440p, feels heavy on 1024p. Auto-collapse under 1024px width?
2. **Right inspector default tab** — Files, Output, or Tools? (My call: **Files** if the run has changes, else **Output**.)
3. **Parallel batch layout** — 2-up cards on ≥1280px, stacked below? Or always stacked with a horizontal “tab strip” at the top?
4. **Timeline (⌘K)** — do we still want the vertical event stream, or replace with a Sankey-like Gantt (start/end bars per stage)?
5. **Graph lightbox** — opens with `G`, closes with `Escape`. Should double-click on a spine node also open it, or keep it out of the primary flow?
6. **HITL follow-up** — currently the textarea is optional and injected mid-stream. Should the new UI keep that behavior, or upgrade follow-up into a first-class "second prompt" turn inside the stage card?
7. **`sleeping` stage** — do we surface a `Wake now` button, or keep it read-only? The core `resume` endpoint supports it.

---

## 10. Sample to look at

Open **`/__redesign/workflow-run`** in the dev server. Uses mock data, works without the API. It renders:

- 7-stage run with a fan-out → parallel(2) → fan-in shape.
- Stages in every relevant status: completed, running, parallel-running, awaiting_input (with inline HITL), sleeping (with countdown), pending, skipped, failed.
- Live simulation: click **Simulate progress** to advance stages.

Files:

- [apps/web/src/components/workflow/redesign/RunRedesignPage.tsx](../apps/web/src/components/workflow/redesign/RunRedesignPage.tsx)
- [apps/web/src/components/workflow/redesign/RunHeaderBar.tsx](../apps/web/src/components/workflow/redesign/RunHeaderBar.tsx)
- [apps/web/src/components/workflow/redesign/PipelineSpine.tsx](../apps/web/src/components/workflow/redesign/PipelineSpine.tsx)
- [apps/web/src/components/workflow/redesign/StageCard.tsx](../apps/web/src/components/workflow/redesign/StageCard.tsx)
- [apps/web/src/components/workflow/redesign/ParallelBatch.tsx](../apps/web/src/components/workflow/redesign/ParallelBatch.tsx)
- [apps/web/src/components/workflow/redesign/InlineHitlControls.tsx](../apps/web/src/components/workflow/redesign/InlineHitlControls.tsx)
- [apps/web/src/components/workflow/redesign/RightInspector.tsx](../apps/web/src/components/workflow/redesign/RightInspector.tsx)
- [apps/web/src/components/workflow/redesign/types.ts](../apps/web/src/components/workflow/redesign/types.ts)
- [apps/web/src/pages/WorkflowRunRedesignPreviewPage.tsx](../apps/web/src/pages/WorkflowRunRedesignPreviewPage.tsx)
