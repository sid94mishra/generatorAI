// ────────────────────────────────────────────────────────────────
// StageComposer — the focused stage's compact composer (P03b WP-3b.2).
//
// A stage is a compact chat: this is the shared `ChatInput` (attachments,
// agent mode, Stop) with its model selector off, sending to the stage
// conversation API. What a message does depends on the stage (the server
// decides and says so): between turns it is the next turn, a completed
// stage is AMENDED (successors keep what they used), a paused stage resumes
// with it. A refusal (mid-turn, an open gate) is toasted like a chat's.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import type { AgentMode } from '@generatorai/shared';
import { ChatInput } from '@/components/chat/ChatInput.js';
import { toast } from '@/components/Toast.js';
import { useCancelStageTurn, useSendStageMessage } from '@/hooks/workflowQueries.js';
import { useTwoPhaseStop } from '@/hooks/useTwoPhaseStop.js';
import type { StageView } from './types.js';

interface StageComposerProps {
  runId: string;
  stage: StageView;
  workspaceId?: string | undefined;
}

/** Why the composer is closed for this stage, or null when it takes a message. */
function closedReason(stage: StageView): string | null {
  switch (stage.rawStatus) {
    case 'pending':
    case 'ready':
    case 'retry_wait':
    case 'waiting':
      return 'This stage has not started its conversation yet.';
    case 'failed':
    case 'skipped':
    case 'cancelled':
      return 'This stage is final. Re-run it from here (the "…" menu) to continue its work.';
    default:
      return null;
  }
}

function placeholderFor(stage: StageView): string {
  switch (stage.rawStatus) {
    case 'completed':
      return 'Follow up — amends this stage’s output (later stages keep what they used)';
    case 'paused':
      return 'Message the paused stage — it resumes with your message';
    default:
      return 'Message this stage — sent as its next turn';
  }
}

const OUTCOME_COPY = {
  queued: 'Queued as the stage’s next turn',
  amending: 'Amending the stage’s output',
  retrying: 'The stage resumes with your message',
} as const;

export function StageComposer({ runId, stage, workspaceId }: StageComposerProps) {
  const send = useSendStageMessage();
  const cancel = useCancelStageTurn();
  const [agentMode, setAgentMode] = useState<AgentMode>('auto');
  const streaming = stage.streaming === true;

  const customSendFn = useCallback(
    async ({ prompt, attachments, mode }: { prompt: string; attachments: File[]; mode?: AgentMode }) => {
      const r = await send.mutateAsync({ runId, instanceId: stage.id, prompt, files: attachments, ...(mode ? { mode } : {}) });
      if (r.outcome !== 'queued') toast({ variant: 'success', title: OUTCOME_COPY[r.outcome] });
    },
    [send, runId, stage.id],
  );

  // Stop ends the turn (the stage carries on). The shared two-phase machine
  // decides when a press may force it, so a double-click cannot (CONVINV-R11).
  const stop = useTwoPhaseStop({
    isLive: streaming,
    onCancel: ({ force }) => cancel.mutate({ runId, instanceId: stage.id, ...(force ? { force: true } : {}) }),
  });

  const closed = closedReason(stage);
  const pending =
    stage.rawStatus === 'awaiting_input'
      ? stage.interrupt
        ? 'Approve the output or request changes above to continue.'
        : 'Answer the stage’s request above to continue.'
      : null;

  return (
    <div className="pt-1" onClick={(e) => e.stopPropagation()}>
      <ChatInput
        sessionId={`stageRun:${stage.id}`}
        manageStream={false}
        disabled={closed !== null}
        placeholder={closed ?? placeholderFor(stage)}
        customSendFn={customSendFn}
        showModelSelector={false}
        showGitConnector={false}
        {...(workspaceId ? { workspaceId } : {})}
        isStreaming={streaming}
        stopState={stop}
        onStop={stop.press}
        agentMode={agentMode}
        onAgentModeChange={setAgentMode}
        pendingInteractionLabel={pending}
      />
    </div>
  );
}
