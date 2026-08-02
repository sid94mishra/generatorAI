> **SUPERSEDED (2026-07):** the production UI now uses the shared `components/agent/StreamPanel` + design-system primitives; this proposal was not adopted as written.

# Chat + Workflow Chat Panel — UX Redesign Proposal

> **Status:** Proposal for review. No production code has been changed. A
> runnable sample lives at [`apps/web/src/components/chat/redesign/`](../apps/web/src/components/chat/redesign/) and can be viewed at `/__redesign/chat` (dev-only route).

---

## 1. What we have today

Below is a distilled reading of the current implementation (verified against
[ChatView.tsx](../apps/web/src/components/chat/ChatView.tsx),
[StreamingMessage.tsx](../apps/web/src/components/chat/StreamingMessage.tsx),
[AssistantMessage.tsx](../apps/web/src/components/chat/AssistantMessage.tsx),
[WorkflowMessages.tsx](../apps/web/src/components/workflow/WorkflowMessages.tsx),
[ChatInput.tsx](../apps/web/src/components/chat/ChatInput.tsx)).

### Structure per turn (chat)

┌──────────────────────────────────────────────────────────┐
│  [Loader] Generating response…            (banner)       │  ← ChatView top banner
├──────────────────────────────────────────────────────────┤
│  🟢 You  · just now                                       │
│  <optimistic user bubble>                                 │
│                                                           │
│  🤖 Thinking…    (dot pulse)                              │  ← StreamingMessage.blocks
│  ┌── Thought process ▸                                    │
│  ┌── search\_files      Running                            │
│  ┌── Sub-Agent (Explore)  Running                         │
│  ┌── read\_file          Done                              │
│  ┌── read\_file          Done                              │
│  ┌── System (2)  ▸                                        │
│  <plain prose reveal, word-by-word>                       │
│  <streaming caret>                                        │
│  [model · ↑1.2k ↓512 · 8.3s]                              │
└──────────────────────────────────────────────────────────┘
\`\`\`

Every block is a compact left-accent row inside \`space-y-2\`. Blocks are
grouped by category (system, subagent, error) and rendered in temporal
order. Text reveals with a smooth caret + word cadence.

### Structure per stage (workflow)

Each stage is an \*\*accordion\*\* in \`WorkflowMessages\`:

\`\`\`
┌─ Stage: Analyze  [Running · 3/7 · 2 tools · 12s]  ▾   ─┐
│  Context from previous stages ▸                        │
│  📥 PROMPT                                              │
│  <prompt text>                                          │
│  🤖 RESPONSE                                            │
│  <same streaming blocks as chat, above>                 │
│  Stage Output (structured) ▸                            │
└────────────────────────────────────────────────────────┘
\`\`\`

The page top shows: header + status strip + optional graph (collapsed) +
tabbed area (Messages / Files). Stages auto-expand while running and
auto-scroll their content.

### Streaming + skeleton

- \*\*Skeleton\*\* only appears in the empty-content window (\`!hasContent && isActive\`) — three shimmer bars + status text.
- \*\*Word-cadence\*\* smoothing via \`useSmoothText\` on the tail text block.
- \*\*Stick-to-bottom\*\* via \`useStickToBottom\` — good, but re-anchors on every scroll signature change (\`displayMessages.length:blocks.length:text.length:status\`), which fires per token.

### Pain points (matches your attached screenshot)

1. \*\*Wall-of-blocks feel\*\* — everything (thinking, sub-agents, tool calls, system, memory writes, errors) is stacked in one column with identical visual weight. The eye can’t find the answer.
2. \*\*No progress spine\*\* — the top “Completed: Synthesize detailed analysis report (7/7)” line comes from an implicit summary; there is no \*visible\* step counter or todos while streaming.
3. \*\*Todos are a floating footer\*\* — \`Todos (4/4)\` is at the very bottom, disconnected from the current turn.
4. \*\*Two look-alike renderers\*\* — \`AssistantMessage\` (history) and \`StreamingMessage\` (live) render the same block set but with subtly different chrome (avatar, header row, box vs no box). Any style change has to be made twice.
5. \*\*Skeleton is one-shot\*\* — once the first block arrives, skeleton disappears. Long tool calls have no per-step shimmer; users see idle green “Running” pills.
6. \*\*Scroll thrash\*\* — each token flush triggers \`useStickToBottom\`. During long streaming, the answer prose paragraph the user is reading can jump when a tool row above it expands/inserts.
7. \*\*Workflow stage panel repeats chat chrome\*\* — a stage that has 1 prompt / 1 response is wrapped in \`Prompt\` + \`Response\` labels + collapsibles, doubling the visual noise.
8. \*\*Empty-state, banner, and streaming-status compete\*\* — top banner “Generating response…” + inline “🤖 Thinking…” + block-level spinner all say the same thing.
9. \*\*Input card is very tall\*\* — the codebase panel + model dropdown + reasoning chip + attach chip + send button occupy \~140px minimum; on a laptop only \~40% of the viewport is content.

---

## 2. Target UX — what the reference shows

The reference (VS Code Copilot chat panel screenshot):

- \*\*Turn = one card\*\*. Top line: user prompt (large, no bubble). Second line: task title auto-derived from the prompt (“Pipeline Analysis and Stage Handoff Strategies”).
- \*\*A single progress summary line\*\* at the top of the assistant response: \`Completed: Synthesize detailed analysis report (7/7)\`.
- \*\*Todo list card\*\*, checked off, right below the summary.
- \*\*Timeline of steps\*\* as light-weight rows: \`Read AGENTS.md\`, \`Explore: Deep-dive StageExecutionService and context\`, \`Searched files matching …\`, \`Read StageExecutionService.ts\`, \`Created memory file …\`, \`Reviewed 2 files\`. Each row is a single line, muted, expandable if it has children.
- \*\*Sub-agent invocations\*\* collapse to a single row (“Explore: … 7/7”) and \*only\* expand when clicked.
- \*\*Final assistant response\*\* at the bottom sits in a more prominent block with clearer typography (prose).
- \*\*Composer\*\* is a slim rounded input at the very bottom (\~80px).

Two design principles fall out of this:

1. \*\*Steps are muted, answers are prominent.\*\* The user’s eye should land on the final answer; steps are context, one line each, expandable on demand.
2. \*\*The turn is the atomic unit of scrolling.\*\* Once a turn completes, it becomes a stable, condensed block. New turns append below. No mid-turn reflow.

---

## 3. Proposed redesign

### 3.1 Concept — “Turn Cards with Activity Timeline”

Every user↔assistant round-trip becomes a single \*\*Turn Card\*\*:

\`\`\`
┌────────────────────────────────────────────────────────────────────┐
│  Q  Can we go through the details and analyse the current impl…   │  ← user
│                                                                    │
│  ● Pipeline analysis and stage handoff strategies      7/7  ✓     │  ← header
│                                                                    │
│  ┏━ Activity ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│  │ ● Read  AGENTS.md                                    120ms ✓  │ │
│  │ ● Explore  StageExecutionService & context           2.1s  ✓  │ │  ← subagent, expand
│  │   ├ Searched \*\*StageExecutionService.ts\*\*  1 match             │ │
│  │   ├ Searched types  1 match                                    │ │
│  │   ├ Read StageExecutionService.ts (lines 1-500)                │ │
│  │   └ Created memory  stage-execution-pipeline-impl.md           │ │
│  │ ● Explore  DAGScheduler & WorkflowRunService         1.8s  ✓  │ │
│  │ ● Explore  DB schema and repositories                          │ │
│  │ ○ Explore  composition root and API routes           running  │ │  ← streaming
│  │ · Reviewed 2 files                                             │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┏━ Todos ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 4/4 ┓ │
│  │  ✓ Analyse current implementation                              │ │
│  │  ✓ Synthesise detailed analysis report                         │ │
│  │  ✓ Draft implementation plan                                    │ │
│  │  ✓ Review + update plan                                        │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ── Answer ──                                                       │
│  Excellent. I now have comprehensive understanding of the entire   │
│  current architecture. Let me draft the plan…                      │  ← markdown prose
│                                                                    │
│  ▎gpt-5.4-mini · ↑12.4k ↓3.1k · 43.2s                              │  ← usage chip
└────────────────────────────────────────────────────────────────────┘
\`\`\`

\*\*Visual hierarchy:\*\*

- Muted (60% opacity): the Activity block, timestamps, usage chip.
- Neutral (100% foreground): the Answer prose.
- Accented (\`--color-primary\`): the header progress dot + step counter.

### 3.2 Component decomposition

\`\`\`
<ConversationSurface>          ── scroll host, stick-to-bottom, insert-anchor
  <TurnCard turn={t}>          ── one per user prompt
    <TurnHeader>               ── user prompt, task title (auto), progress
    <ActivityTimeline>         ── collapsible; grouped step rows
      <StepRow />              ── icon, verb, target, status, duration, expand
      <SubagentStep>           ── nested StepRow[] when expanded
      <StepSkeleton />         ── used when a step is pending
    <TodoList>                 ── optional, shown when tool-produced
    <AnswerBlock>              ── markdown prose (streaming or static)
    <UsageChip>
\`\`\`

\*\*Data mapping from the current stream store:\*\*

| Current block type | New surface |
|---|---|
| \`text\` (last) | \`AnswerBlock\` (streaming or static) |
| \`text\` (mid, before more tool calls) | \`StepRow\` with kind \`note\` |
| \`thinking\` | \`StepRow\` with kind \`think\` (expandable) |
| \`tool\_call\` (running) | \`StepRow\` with kind \`tool\`, status running, shimmer |
| \`tool\_call\` (complete) | \`StepRow\` with kind \`tool\`, status done, expandable |
| \`system\_group\` category=\`subagent\` | \`SubagentStep\` — one row per agent, expandable to child rows |
| \`system\_group\` category=\`error\` | inline red \`StepRow\` with kind \`error\` |
| \`system\_group\` category=other | consolidated “System (N)” collapsed row |
| \`usage\` | \`UsageChip\` |

The activity timeline is a \*\*derived view\*\* over the existing stream blocks —
we do \*\*not\*\* change the stream store schema. \`deriveTimeline(blocks)\`
takes the temporal-ordered blocks and returns \`TimelineStep[]\`.

### 3.3 Streaming + skeleton rules

1. \*\*Per-step shimmer.\*\* While a tool call is \`running\`, its \`StepRow\` shows a shimmer bar underneath the label (2 lines, 60%/40% width). When it flips to \`done\`, the shimmer is replaced by the result summary (e.g. \`1 match\`, \`500 lines\`, \`wrote 12 files\`).
2. \*\*Answer block skeleton.\*\* Before the first text token arrives, \`<AnswerBlock isPending />\` renders three shimmer paragraphs of decreasing width — mimicking real prose. Not a spinner.
3. \*\*Optimistic user card.\*\* As soon as the user hits send, the user turn card renders immediately with an empty activity + skeleton answer.
4. \*\*No global banner.\*\* The “Generating response…” bar at the top of ChatView / ChatPage is retired. Progress lives inside the turn card.
5. \*\*Insert-anchor scrolling.\*\* When a new step row is inserted, we anchor scroll to the \*bottom of the answer block\* (not the last step). If the user is pinned, the viewport tracks the answer; if not, nothing jumps.
6. \*\*Reveal-in-place.\*\* New step rows fade + slide 8px from the top for 180ms. \`content-visibility: auto\` on completed turns above the viewport so re-renders are cheap.
7. \*\*Freeze on complete.\*\* Once \`stream.status === 'complete'\` and \`chatHistory\` catches up, the turn card is frozen and the streaming version replaced by the persisted equivalent (same \`TurnCard\` component, hydrated from persisted metadata). No visual jump.

### 3.4 Scroll model

Current: single scroll container per page + \`useStickToBottom\` keyed on a
composite signature that changes every text token.

Proposed:

- One scroll container per page (unchanged).
- \`useStickToBottom\` keyed on \`(turnCount, activeTurn.answerLength)\` — \*\*not\*\* on step count. Step insertions no longer trigger scroll adjustments.
- Explicit \`scrollIntoView\` when a turn \*completes\*, so its usage chip lands at the bottom edge.
- “Jump to latest” pill unchanged.

This eliminates jitter when tools flush faster than paint.

### 3.5 Workflow chat panel

Each stage today is an accordion in \`WorkflowMessages\`. New model:

- The workflow run page has a \*\*left rail\*\* (24rem) with a \*\*Pipeline Spine\*\* listing every stage vertically with status dot + name + duration. This replaces the horizontal \`DagStatusStrip\` (which stays for very wide runs, collapsed).
- The \*\*right pane\*\* is a scrolling \`ConversationSurface\` where each stage becomes a \`TurnCard\`. The user prompt slot renders as \*\*“Stage prompt”\*\* (definition prompt or handoff summary); the activity + answer render like chat.
- Selecting a stage in the spine \`scrollIntoView\`s its turn card.
- Parallel stages appear as \*\*sibling \`TurnCard\`s\*\* in a horizontal 2-up layout when the viewport width > 1280px; on narrower viewports they stack vertically with a subtle “ran in parallel with …” header.
- Awaiting-input stages get a distinct amber left border on their \`TurnCard\` and pin an inline HITL controls block below the activity — matches the current \`InlineStageApproval\` position but in the new card chrome.

The full-graph React Flow canvas stays behind the existing “Graph ▾” toggle.

### 3.6 Composer

Kept but slimmed:

- Height when idle: \*\*\~64px\*\* (single line + 40px toolbar).
- Toolbar collapses: \`[+ context] [model:pill] [reasoning:pill]  ...  [attach] [send]\`.
- Model / codebase / reasoning are \`Popover\` primitives, not expanded panels — the composer never grows past 200px unless the textarea does.
- Stop button replaces send while \`isStreaming\` (icon toggle, no layout shift).

### 3.7 Perf checklist

- [ ] \`TurnCard\` memoised on \`(turnId, status, activityHash, answerHash)\`.
- [ ] \`StepRow\` memoised on \`(stepId, status, resultSummary)\` — expansion state is local.
- [ ] \`deriveTimeline(blocks)\` runs in \`useMemo\` keyed on \`blocks.length + blocks[last].id\`.
- [ ] Virtualised list from \`@tanstack/react-virtual\` when \`turns.length > 60\` (matches current \`VIRTUAL\_THRESHOLD\`).
- [ ] \`content-visibility: auto\` on frozen turn cards.
- [ ] SSE token flush → answer text state only. Step insertions bypass answer state.
- [ ] \`useSmoothText\` retained for the answer only.

### 3.8 Accessibility

- Steps and todos are keyboard navigable (\`role="listitem"\`, \`tabIndex=0\`, \`Enter/Space\` toggles).
- Every status pill is \`icon + label\` (never colour alone).
- \`aria-live="polite"\` on the streaming answer region; \`aria-busy\` on running step rows.
- Screen readers announce a single summary per turn: “Assistant answered in 43 seconds, 7 steps.”

---

## 4. Migration plan (no big-bang)

The redesign can land in 4 additive PRs, each behind a \`feature.chatV2\` flag:

1. \*\*New primitives\*\* — \`TurnCard\`, \`ActivityTimeline\`, \`StepRow\`, \`AnswerBlock\`, \`TodoList\`, \`UsageChip\` + \`deriveTimeline(blocks)\`. Nothing wired into pages yet. Includes the runnable sample under \`redesign/\`.
2. \*\*ChatPage / ChatView opt-in\*\* — behind flag, \`TurnCard\`-based rendering reads from the \*same\* \`useStreamStore\` + \`useChatMessages\` sources. Both renderers coexist.
3. \*\*WorkflowMessages opt-in\*\* — same components applied to stage runs; introduces the Pipeline Spine.
4. \*\*Cutover\*\* — remove flag, delete \`AssistantMessage\` / old \`StreamingMessage\` bodies once telemetry confirms parity.

No DB / schema / SSE changes required.

---

## 5. Open questions for review

1. \*\*Answer block prominence\*\* — proposed: keep it as \*bare prose\* (no glass box, no avatar) so it reads like a document. Alternative: keep a soft border. Preference?
2. \*\*Turn header title\*\* — proposed: auto-derived (first \~8 words of the user prompt in Title Case). Alternative: no title. Do we want the LLM to summarise it later?
3. \*\*Todos surface\*\* — proposed: only when the assistant actually emits a todo list tool. Never fabricated. Confirm?
4. \*\*Pipeline Spine width\*\* — proposed: 24rem left rail. Should it be resizable / collapsible on narrow screens?
5. \*\*Parallel stages layout\*\* — 2-up cards vs. vertical stack with a “ran in parallel” badge. Pick one?
6. \*\*Freeze animation\*\* — should the transition from streaming to frozen turn be visible (e.g. a subtle border pulse) or silent?

Please leave comments inline or in a review issue and we’ll adjust before writing production code.

---

## 6. Sample to look at

Open \`/\_\_redesign/chat\` in the dev server. The sample is fed synthetic data
so it works without the API server. It renders:

- One completed turn (frozen)
- One in-flight streaming turn with a running subagent step
- The new composer

Files:

- [apps/web/src/components/chat/redesign/TurnCard.tsx](../apps/web/src/components/chat/redesign/TurnCard.tsx)
- [apps/web/src/components/chat/redesign/ActivityTimeline.tsx](../apps/web/src/components/chat/redesign/ActivityTimeline.tsx)
- [apps/web/src/components/chat/redesign/StepRow.tsx](../apps/web/src/components/chat/redesign/StepRow.tsx)
- [apps/web/src/components/chat/redesign/AnswerBlock.tsx](../apps/web/src/components/chat/redesign/AnswerBlock.tsx)
- [apps/web/src/components/chat/redesign/Composer.tsx](../apps/web/src/components/chat/redesign/Composer.tsx)
- [apps/web/src/pages/RedesignPreviewPage.tsx](../apps/web/src/pages/RedesignPreviewPage.tsx)