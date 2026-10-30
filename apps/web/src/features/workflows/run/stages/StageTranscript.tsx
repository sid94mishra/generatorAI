// ────────────────────────────────────────────────────────────────
// A stage's conversation, shown the way the chat shows one: the persisted
// turns of its session (`chat_messages`, filtered to this stage run) through
// the transcript kit's TranscriptTurn, with only the turn in flight rendered
// from the live stream.
//
// The stream store holds only what this tab received, so deriving a finished
// stage from it dropped every text block between tool calls once the stage
// completed (its persisted answer replaced them) and everything after a
// reload or a revisit. The persisted messages carry each turn's text segments
// and tool calls in order, exactly as the chat replays them.
// ────────────────────────────────────────────────────────────────

import { memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { buildTranscriptTurns } from '@generatorai/client-core';
import type { ChatMessage } from '@generatorai/shared';
import { TranscriptTurn } from '@/blocks/transcript/index.js';
import { useStageChatHistory } from '@/hooks/queries.js';
import { useStreamStore } from '@/stores/streamStore.js';
import type { StageView } from '../model/types.js';
import type { StageAgent } from './useStageAgent.js';

export interface StageTranscriptProps {
  stage: StageView;
  /** Who answers, named as the chat names it (`useStageAgent`). */
  agent: StageAgent;
  /** A turn of this stage is in flight: the stream renders it, not its partial persisted copy. */
  live: boolean;
  /** The stream's rendering of the turn in flight (or of a turn the server never finished persisting). */
  liveBody: ReactNode;
  /** What shows until there is a persisted conversation: a stage without a session, or history still loading. */
  fallback: ReactNode;
}

/**
 * The persisted rows to show. While a turn streams, its own rows are left to the
 * stream: the server persists the response as it goes (`complete: false`) and
 * stamps it with the turn id the stream carries.
 */
export function persistedRows(
  messages: readonly ChatMessage[],
  live: boolean,
  liveTurnId: string | null,
): ChatMessage[] {
  if (!live) return [...messages];
  return messages.filter(
    (m) => m.role === 'user' || (m.complete !== false && !(liveTurnId && m.metadata?.turnId === liveTurnId)),
  );
}

/**
 * Whether the turn the stream calls live is already saved, finished. The stream is then stale — left
 * "streaming" by a tab that went away mid-turn, or by a provider that never ends its turn on the wire —
 * and the saved reply wins: hiding it behind the stale stream lost a follow-up's answer on a revisit.
 */
export function liveTurnSaved(messages: readonly ChatMessage[], liveTurnId: string | null): boolean {
  return !!liveTurnId && messages.some((m) => m.role === 'assistant' && m.complete !== false && m.metadata?.turnId === liveTurnId);
}

/** Whether the conversation already holds a response to its latest prompt. */
export function answeredLastPrompt(messages: readonly ChatMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role === 'user') return false;
    if (m.role === 'assistant') return true;
  }
  return false;
}

export const StageTranscript = memo(function StageTranscript({
  stage,
  agent,
  live,
  liveBody,
  fallback,
}: StageTranscriptProps) {
  const { data: messages, refetch } = useStageChatHistory(stage.sessionId, stage.id);
  const liveTurnId = useStreamStore((s) => s.streams[`stageRun:${stage.id}`]?.serverTurnId ?? null);

  // The history is fetched once; a stage moving on (a turn ending, a gate, a retry, an
  // amendment) is what adds rows to it.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    void refetch();
  }, [stage.rawStatus, stage.streaming, stage.version, stage.attempt, stage.amendedAt, refetch]);

  const saved = liveTurnSaved(messages ?? [], liveTurnId);
  const turnLive = live && !saved;
  const rows = useMemo(() => persistedRows(messages ?? [], turnLive, liveTurnId), [messages, turnLive, liveTurnId]);
  const streamHasContent = stage.segments.length > 0 || stage.steps.length > 0;
  // The stream renders the turn in flight, and a turn whose response never reached the
  // history (the server stopped before persisting it) rather than leaving a gap.
  const showLive = turnLive || (!saved && streamHasContent && !answeredLastPrompt(rows));
  const turns = useMemo(() => buildTranscriptTurns(rows, { live: showLive }), [rows, showLive]);

  if (!stage.sessionId || rows.length === 0) return <>{fallback}</>;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="stage-transcript">
      {turns.map((turn) => (
        <TranscriptTurn
          key={turn.key}
          turn={turn}
          agentName={agent.name}
          harnessProvider={agent.harnessProvider}
          renderLive={() => liveBody}
        />
      ))}
    </div>
  );
});
