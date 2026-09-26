# Handoff to the Workflow Overhaul Plan

Published per `07-phases.md` §"Handoff to the Workflow Overhaul Plan (end of P4)". Sections land as each P4 task
finishes; the full handoff is complete at the end of P4.

## Transcript kit and the tool-card registry (P4-07)

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
unregister function. Contract test: `apps/web/src/blocks/transcript/__tests__/toolCardRegistry.test.tsx`.
