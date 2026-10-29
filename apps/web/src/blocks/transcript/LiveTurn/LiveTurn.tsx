// ────────────────────────────────────────────────────────────────
// LiveTurn — the agent turn still in flight, the same panel wherever a turn
// streams (D-172): the chat's live turn and a workflow stage's response. The
// agent header (avatar, name, model, usage), the turn body, a "stopped" note
// and the thinking placeholder before the first token. Workflow-only parts
// (the stage row, its result, output chips, review card) sit around it.
//
// A finished turn is replaced by its persisted response (TranscriptTurn's
// AgentResponse), which carries the same header — so nothing jumps when the
// stream ends.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import type { StreamSegment, TimelineStep } from '@generatorai/client-core';
import { AgentTurnHeader } from '../AgentTurnHeader/AgentTurnHeader.js';
import { ThinkingPlaceholder } from '../ThoughtPill/ThoughtPill.js';
import { StoppedNote } from '../TranscriptTurn/TranscriptTurn.js';
import { TurnBody } from '../TurnBody/TurnBody.js';

export interface LiveTurnProps {
  agentName: string;
  avatar?: 'initials' | 'bot';
  /** The provider logo for the avatar (when the agent is a provider's, not a named agent). */
  avatarProvider?: string | undefined;
  /** Model label, once the provider reported it. */
  model?: string | undefined;
  provider?: string | undefined;
  /** Usage chip for the header, once the turn finished. */
  usage?: ReactNode;
  /** Ordered segments — or, for a persisted split view, `steps` + `answer`. */
  segments?: readonly StreamSegment[] | undefined;
  steps?: readonly TimelineStep[] | undefined;
  answer?: string | undefined;
  /** Stream key scoping the usage cache ledger and the reveal pacing. */
  streamKey: string;
  /** Streaming or parked on a gate. */
  active: boolean;
  /** Answer tokens are arriving. */
  answerStreaming: boolean;
  /** The turn was stopped by the person. */
  stopped?: boolean;
  /** The turn is pending and has produced nothing yet (shows the placeholder even before `active`). */
  thinking?: boolean;
  /** "Claude is thinking…" — the placeholder's text. */
  thinkingLabel: string;
  error?: string | null | undefined;
}

/** The agent turn in flight. Renders nothing until there is something to show. */
export function LiveTurn({
  agentName,
  avatar,
  avatarProvider,
  model,
  provider,
  usage,
  segments,
  steps,
  answer,
  streamKey,
  active,
  answerStreaming,
  stopped = false,
  thinking = false,
  thinkingLabel,
  error,
}: LiveTurnProps) {
  const hasContent = (segments?.length ?? 0) > 0 || (steps?.length ?? 0) > 0 || !!answer;
  if (!hasContent && !active && !stopped && !thinking && !error) return null;
  const answered = segments ? segments.some((s) => s.type === 'steps' || s.type === 'answer') : (steps?.length ?? 0) > 0 || !!answer;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="live-turn" data-gai-block="live">
      <AgentTurnHeader
        agentName={agentName}
        {...(avatar ? { avatar } : {})}
        avatarProvider={avatarProvider}
        model={model}
        provider={provider}
        usage={usage}
      />
      {hasContent || error ? (
        <TurnBody
          segments={segments}
          steps={steps}
          answer={answer}
          active={active}
          answerStreaming={answerStreaming}
          loading={active && !answered}
          error={error}
          streamKey={streamKey}
        />
      ) : null}
      {stopped ? <StoppedNote partial={hasContent} testId="stream-stopped-note" /> : null}
      {!hasContent && !error && (thinking || active) ? <ThinkingPlaceholder label={thinkingLabel} /> : null}
    </div>
  );
}
