# PHASE 03b: Stage conversation and run-page correctness

**Goal:** make "a stage is a compact chat" interactive on the run page. On the run page, a user can:
- send a message into a stage;
- stop a turn;
- attach files;
- answer permission, question and plan cards;
- amend a completed stage;
- control the stage from a working menu.

This phase also fixes the run page's streaming correctness and cost problems.

**Estimate:** 2 weeks. **Depends on:** P03. **Branch:** `wf/phase-03b-stage-conversation`.
**Closes:** W-27 (run controls), W-33, W-55, W-65 (run page part). PD-3, PD-4 and PD-9 are applied.

## Read first
- `G2_chat_stage_parity.md` §4
- `D_web_ui.md` D-13, D-18..D-24
- `PHASE-03-engine-v2.md` (commands API, attempts, `turn_role`, `amended_at`)

## WP-3b.1 StageConversationService (server)
Location: `packages/core/src/services/engine/StageConversationService.ts`, with routes under `apps/server/src/routes/workflowRuns.ts`.

`POST /workflow-runs/:runId/instances/:instanceId/messages` takes a multipart body: `prompt`, `attachments[]`, `mode`. The outcome depends on the stage's state:

| Stage state | Result |
|---|---|
| running, mid-turn | 409 `STAGE_BUSY` (PD-3; chat parity) |
| awaiting a gate | 409 `INTERACTION_PENDING` |
| between turns (`validating`, or a script step boundary) | Queued as the next operator turn (`turn_role: operator`) |
| completed | **Amend** (PD-4). A resume attempt on the same `session_key` runs the operator turn and updates `output_text`/`output`/the artifact. It sets `amended_at` and emits `stage_run.amended`. Successors are **not** re-run; the UI offers "Re-run downstream" (`forkRun`). This fixes W-55 |
| failed or paused | Treated as `command retry {mode: resume, promptOverride: prompt}` |

Other routes:
- `POST …/instances/:instanceId/turn/cancel {force?}` stops the current turn without failing the stage.
- `POST …/interactions/:interactionId/{permission|answer|plan}` resolves a gate through `StageGatePort`.

The review-batch route (`routes/review.ts`, target stage) calls `send`, and marks the batch delivered only on success.

**Delete** the approve-with-`followUpPrompt` path (PD-9): `markFollowUpPending` and the route-injected follow-up.

## WP-3b.2 Web: stage as a compact chat
Files: `components/workflow/redesign/StageTimelineItem.tsx`, `pages/WorkflowRunPage.tsx`. Existing components only (PD-19).
- For the focused stage, render the shared `ChatInput` in its compact variant, with `customSendFn` pointing at the messages route, attachments, Stop and `pendingInteractionLabel`.
- `StreamPanel` gets `widgets`, `streamKey="stageRun:<id>"`, and the permission, question and plan callbacks. `PermissionCard`, `QuestionCard` and the plan cards render for stages. `InlineHitlControls` stays only for `completion_review`.
- **Stage "…" menu:** Pause stage, Resume, Cancel stage, Retry (resume or restart), Skip as completed, Copy output, Open in inspector, and Re-run from here (the latter enabled in P05). Every item goes through the commands API.
- **`RunHeaderBar`:**
  - a permission-mode control (the chat mode selector; W-65);
  - a cancel confirmation;
  - errors from every control shown as toasts (D-13).
- Add a context-gauge chip next to `UsageChip`.

## WP-3b.3 Run-page streaming correctness and cost
- `updateStageRunStatus` copies `interruptData` (D-19) and inserts unknown instances.
- The graph, timeline and page focus share one store field (D-20).
- `protectStream` every instance of the mounted run, and release on unmount (D-21).
- Polls merge per instance by `version` (D-21b).
- Stop polling the scratchpad and workspace for terminal runs. Fetch the scratchpad for the focused stage only (D-24).
- The 1 s clock lives in the header only, with memoised stage views and stable callbacks (D-24).
- Inspector Files come from per-attempt checkpoints, labelled per stage (D-22).

## WP-3b.4 Mobile and TUI
- **Mobile:** reuse `components/chat/Composer.tsx` in the stage transcript with the stage send function, and render approvals as the chat-shaped cards.
- **TUI:** chat-shaped gate events mean the chat permission key bindings work for stages.
- **CLI:** `run stage send <run> <stage> <text>` and `run stage stop <run> <stage>`.

## Tests
- **Server:**
  - a send while running returns 409;
  - a send to a completed stage amends it (successors untouched; `stage_run.amended`);
  - a send between turns is queued;
  - turn cancel;
  - attachments are persisted and served;
  - each gate type resolves;
  - the review batch reports delivered only on success.
- **Web** (Playwright, bundled Chromium): the composer sends; Stop works; the permission and question cards round-trip; the "…" menu commands work; the permission control works; an error toast appears on a forced 409.
- **Store tests** for D-19, D-20, D-21 and D-21b.

## Acceptance criteria
- On the run page a user can do everything with a stage that they can do with a chat, except rewind and fork, which the run's fork replaces.
- No run-page control fails silently.
