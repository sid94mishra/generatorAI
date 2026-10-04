// ────────────────────────────────────────────────────────────────
// StageComposer — the focused stage's compact composer (WF-17; P03b WP-3b.2).
//
// A stage is a compact chat: the shared composer's `stage` variant
// (attachments, agent mode, Stop; no model chips), sending to the stage
// conversation API. What a message does depends on the stage (the server
// decides and says so): between turns it is the next turn, a completed stage
// is AMENDED (successors keep what they used), a paused stage resumes with
// it. The outcome is said inline under the box (D-30: no success toasts); a
// refusal is toasted by the mutation.
// ────────────────────────────────────────────────────────────────

import { useCallback, useState } from 'react';
import type { AgentMode } from '@generatorai/shared';
import { Composer } from '@/blocks/composer/index.js';
import { useCancelStageTurn, useSendStageMessage } from '@/hooks/workflowQueries.js';
import { cn } from '@/ui/lib/cn.js';
import { useTwoPhaseStop } from '@/hooks/useTwoPhaseStop.js';
import type { StageView } from '../model/types.js';

export interface StageComposerProps {
  runId: string;
  stage: StageView;
  workspaceId?: string | undefined;
  /** The stage agent's name, for the placeholder ("Message Bug Fixer in this stage…"). */
  agentName?: string | undefined;
  /**
   * Pinned under the run's scrolling stages, like the chat composer: the chat's frame, plus a line
   * naming the stage it messages (the box is no longer inside that stage's row).
   */
  docked?: boolean;
}

/** Why the composer is closed for this stage, or null when it takes a message. */
export function stageComposerClosedReason(stage: Pick<StageView, 'rawStatus'>): string | null {
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

function placeholderFor(stage: StageView, agentName: string | undefined): string {
  switch (stage.rawStatus) {
    case 'completed':
      return 'Follow up — amends this stage’s output (later stages keep what they used)';
    case 'paused':
      return 'Message the paused stage — it resumes with your message';
    default:
      return agentName ? `Message ${agentName} in this stage…` : 'Message this stage — sent as its next turn';
  }
}

const OUTCOME_COPY = {
  queued: 'Queued as the stage’s next turn',
  amending: 'Amending the stage’s output',
  retrying: 'The stage resumes with your message',
} as const;

export function StageComposer({ runId, stage, workspaceId, agentName, docked = false }: StageComposerProps) {
  const send = useSendStageMessage();
  const cancel = useCancelStageTurn();
  const [agentMode, setAgentMode] = useState<AgentMode>('auto');
  const [outcome, setOutcome] = useState<string | null>(null);
  const streaming = stage.streaming === true;

  const sendAsync = send.mutateAsync;
  const customSendFn = useCallback(
    async ({ prompt, attachments, mode }: { prompt: string; attachments: File[]; mode?: AgentMode }) => {
      setOutcome(null);
      const r = await sendAsync({ runId, instanceId: stage.id, prompt, files: attachments, ...(mode ? { mode } : {}) });
      setOutcome(OUTCOME_COPY[r.outcome]);
    },
    [sendAsync, runId, stage.id],
  );

  // Stop ends the turn (the stage carries on). The shared two-phase machine
  // decides when a press may force it, so a double-click cannot (CONVINV-R11).
  const stop = useTwoPhaseStop({
    isLive: streaming,
    onCancel: ({ force }) => cancel.mutate({ runId, instanceId: stage.id, ...(force ? { force: true } : {}) }),
  });

  const closed = stageComposerClosedReason(stage);
  const pending =
    stage.rawStatus === 'awaiting_input'
      ? stage.interrupt
        ? 'Decide the review above first. Request changes sends your feedback to this session.'
        : 'Answer the stage’s request above to continue.'
      : null;

  return (
    <div className="flex flex-col gap-1" data-testid="stage-composer">
      <Composer
        variant="stage"
        docked={docked}
        {...(docked
          ? {
              aboveComposer: (
                <p className="truncate px-1 pb-1.5 text-small text-fg-3" data-testid="stage-composer-target">
                  To stage <span className="font-medium text-fg-2">{stage.name}</span>
                </p>
              ),
            }
          : {})}
        sessionId={`stageRun:${stage.id}`}
        manageStream={false}
        disabled={closed !== null}
        placeholder={closed ?? placeholderFor(stage, agentName)}
        customSendFn={customSendFn}
        {...(workspaceId ? { workspaceId } : {})}
        isStreaming={streaming}
        stopState={stop}
        onStop={stop.press}
        agentMode={agentMode}
        onAgentModeChange={setAgentMode}
        // A stage message runs in the stage's own session (its model and effort); the picker read
        // "Default (recommended)" for every stage and its choice was never sent.
        showModelSelector={false}
        pendingInteractionLabel={pending}
      />
      {outcome ? (
        <p role="status" className={cn('px-1 text-small text-fg-3', docked && 'mx-auto w-full max-w-190 px-3 pb-2')}>
          {outcome}
        </p>
      ) : null}
    </div>
  );
}
