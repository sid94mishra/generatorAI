// ────────────────────────────────────────────────────────────────
// B-24 TranscriptTurn — one turn: the user's message and the agent's
// response(s) to it (B-14, B-15 + TurnBody), or a system note.
//
// View modes (G-06): Normal (grouped steps), Verbose (every step expanded),
// Summary (the user message, the final answer and one line "N steps · +a −d").
// A finished response can be collapsed to its header + digest; the D-33
// fallback collapses finished turns beyond the last 20 by default.
//
// Memoised on the turn's entries: a new message elsewhere, or a streamed token
// in the live turn, does not re-render a settled turn.
// ────────────────────────────────────────────────────────────────

import { memo, useMemo, useState, type ReactNode } from 'react';
import {
  deriveSegments,
  digestBlocks,
  formatDigest,
  formatStepDuration,
  messageBlocks,
  type TranscriptEntry,
  type TranscriptTurn as TurnModel,
} from '@generatorai/client-core';
import type { ChatMessage } from '@generatorai/shared';
import { TRANSCRIPT_COPY } from '@generatorai/shared/ui-contract';
import { cn } from '@/ui/lib/cn.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Icon } from '@/ui/icons/Icon.js';
import { AgentTurnHeader } from '../AgentTurnHeader/AgentTurnHeader.js';
import { AssistantText } from '../AssistantText/AssistantText.js';
import { TurnBody } from '../TurnBody/TurnBody.js';
import { AttachmentList } from '../UserMessage/AttachmentList.js';
import { UserMessage } from '../UserMessage/UserMessage.js';
import { useTranscriptActions } from '../transcriptContext.js';

export interface TranscriptTurnProps {
  turn: TurnModel;
  /** Name the agent's responses are signed with. */
  agentName: string;
  /** Workflow surfaces draw the bot glyph instead of initials. */
  avatar?: 'initials' | 'bot';
  /** Start this turn's finished responses collapsed (the D-33 fallback). */
  defaultCollapsed?: boolean;
  /** Hover actions of a user message (rewind …). */
  renderUserActions?: ((message: ChatMessage) => ReactNode) | undefined;
  /**
   * Actions under a finished response (copy transcript, fork …). `engaged` is
   * true once the response was hovered or focused — hosts mount hover-only
   * actions lazily instead of once per message.
   */
  renderResponseActions?: ((message: ChatMessage, engaged: boolean) => ReactNode) | undefined;
  /** The live stream's rendering, for a `live` entry. */
  renderLive?: (() => ReactNode) | undefined;
}

/** "Stopped before …" — a stopped turn is never a silent gap. */
export function StoppedNote({ partial, testId }: { partial: boolean; testId: string }) {
  return (
    <p className="flex items-center gap-1.5 text-small text-fg-3" data-testid={testId}>
      <Icon concept="stop" size={12} />
      {partial ? TRANSCRIPT_COPY.stoppedPartial : TRANSCRIPT_COPY.stoppedEmpty}
    </p>
  );
}

function AgentResponse({
  message,
  agentName,
  avatar,
  defaultCollapsed,
  renderActions,
  startedAt,
}: {
  /** When the turn's user message was sent: the digest's duration runs from it to this response. */
  startedAt?: ChatMessage['timestamp'] | undefined;
  message: ChatMessage;
  agentName: string;
  avatar: 'initials' | 'bot';
  defaultCollapsed: boolean;
  renderActions: ((message: ChatMessage, engaged: boolean) => ReactNode) | undefined;
}) {
  const ctx = useTranscriptActions();
  const summary = ctx.viewMode === 'summary';
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [engaged, setEngaged] = useState(false);
  const engage = () => {
    if (!engaged) setEngaged(true);
  };
  const blocks = useMemo(() => messageBlocks(message), [message]);
  const segments = useMemo(() => deriveSegments(blocks, { active: false }), [blocks]);
  const isTool = message.role === 'tool';
  const partial = message.metadata?.partial === true;
  const folded = collapsed && !summary;
  // The digest walks the blocks again; only a folded or summarised response shows it.
  const durationMs = turnDurationMs(startedAt, message.timestamp);
  const digest = useMemo(
    () => (folded || summary ? digestBlocks(blocks, durationMs) : null),
    [folded, summary, blocks, durationMs],
  );
  const digestLine = digest ? formatDigest(digest, formatStepDuration) : undefined;

  return (
    <div
      className="group/response flex min-w-0 flex-col gap-2"
      data-chat-row
      data-gai-block="response"
      onPointerEnter={engage}
      onFocus={engage}
    >
      {isTool ? null : (
        <AgentTurnHeader
          agentName={agentName}
          avatar={avatar}
          timestamp={message.timestamp}
          {...(digestLine ? { digest: digestLine } : {})}
          trailing={
            summary ? undefined : (
              <IconButton
                size="sm"
                icon={collapsed ? 'chevron-right' : 'chevron-down'}
                label={collapsed ? 'Expand response' : 'Collapse response'}
                tooltip={false}
                aria-expanded={!collapsed}
                onClick={() => setCollapsed((v) => !v)}
              />
            )
          }
        />
      )}
      {summary ? (
        digest?.finalText ? <AssistantText text={digest.finalText} /> : null
      ) : folded ? null : (
        <TurnBody segments={segments} streamKey={message.sessionId} />
      )}
      {partial ? <StoppedNote partial={segments.length > 0} testId="message-stopped-note" /> : null}
      {!folded && message.attachments && message.attachments.length > 0 ? (
        <AttachmentList attachments={message.attachments} chatId={message.chatId} download />
      ) : null}
      {!folded && renderActions ? renderActions(message, engaged) : null}
    </div>
  );
}

function SystemNote({ text }: { text: string }) {
  return (
    <Callout tone="neutral" data-chat-row data-gai-block="system">
      <span className="text-ui text-fg-2 whitespace-pre-wrap">{text}</span>
    </Callout>
  );
}

/** The server prompts an orchestrator itself ("[system] Every background agent…"); that is not the user talking. */
const SYSTEM_PROMPT_PREFIX = '[system] ';

/** Wall-clock time from the user's message to the response, when both times are known. */
function turnDurationMs(
  startedAt: ChatMessage['timestamp'] | undefined,
  endedAt: ChatMessage['timestamp'] | undefined,
): number | undefined {
  if (startedAt == null || endedAt == null) return undefined;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

function renderEntry(entry: TranscriptEntry, props: TranscriptTurnProps, startedAt?: ChatMessage['timestamp']): ReactNode {
  switch (entry.kind) {
    case 'user':
      if (entry.message.content.startsWith(SYSTEM_PROMPT_PREFIX)) {
        return <SystemNote key={entry.key} text={entry.message.content.slice(SYSTEM_PROMPT_PREFIX.length)} />;
      }
      return (
        <UserMessage
          key={entry.key}
          content={entry.message.content}
          attachments={entry.message.attachments}
          chatId={entry.message.chatId}
          timestamp={entry.message.timestamp}
          actions={props.renderUserActions?.(entry.message)}
        />
      );
    case 'pending_user':
      return <UserMessage key={entry.key} content={entry.content} pending />;
    case 'agent':
      return (
        <AgentResponse
          key={entry.key}
          message={entry.message}
          agentName={props.agentName}
          avatar={props.avatar ?? 'initials'}
          defaultCollapsed={props.defaultCollapsed ?? false}
          renderActions={props.renderResponseActions}
          startedAt={startedAt}
        />
      );
    case 'system':
      return <SystemNote key={entry.key} text={entry.message.content} />;
    case 'live':
      return <div key={entry.key}>{props.renderLive?.()}</div>;
  }
}

/** The turn's user message time — where its responses' durations start. */
function turnStart(entries: readonly TranscriptEntry[]): ChatMessage['timestamp'] | undefined {
  for (const entry of entries) if (entry.kind === 'user') return entry.message.timestamp;
  return undefined;
}

function TranscriptTurnImpl(props: TranscriptTurnProps) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-4')} data-gai-turn={props.turn.key} aria-label="Turn">
      {props.turn.entries.map((entry) => renderEntry(entry, props, turnStart(props.turn.entries)))}
    </section>
  );
}

function sameEntries(a: readonly TranscriptEntry[], b: readonly TranscriptEntry[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.kind !== y.kind || x.key !== y.key) return false;
    if ('message' in x && 'message' in y && x.message !== y.message) return false;
    if (x.kind === 'pending_user' && y.kind === 'pending_user' && x.content !== y.content) return false;
  }
  return true;
}

/** One turn of the transcript. */
export const TranscriptTurn = memo(
  TranscriptTurnImpl,
  (a, b) =>
    sameEntries(a.turn.entries, b.turn.entries) &&
    a.turn.live === b.turn.live &&
    a.agentName === b.agentName &&
    a.avatar === b.avatar &&
    a.defaultCollapsed === b.defaultCollapsed &&
    a.renderUserActions === b.renderUserActions &&
    a.renderResponseActions === b.renderResponseActions &&
    a.renderLive === b.renderLive,
);
