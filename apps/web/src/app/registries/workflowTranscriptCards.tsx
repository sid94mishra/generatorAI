// Transcript segment cards of the Workflow Overhaul (P06 WP-6.2), drawn by
// blocks/transcript TurnBody through its segment-card registry (D-35): the run
// a `run_workflow` call started and the draft a `create_workflow_draft` call
// submitted. Loaded with the chat route and the workflow routes (a stage
// transcript shows the same cards). The cards themselves are Overhaul UI
// (components/chat/WorkflowRunCards.tsx) until the D-35 port.

import { registerSegmentCard } from '@/blocks/transcript/index.js';
import { WorkflowDraftCard, WorkflowRunCard } from '@/components/chat/WorkflowRunCards.js';

registerSegmentCard('workflow_run', (segment, ctx) => (
  <WorkflowRunCard run={segment.run} callId={segment.callId} chatId={ctx.chatId} />
));
registerSegmentCard('workflow_draft', (segment) => <WorkflowDraftCard draft={segment.draft} />);
