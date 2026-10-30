// The chat header's facts (Main, MChatRunning, MChatNoAgent; 04 §2.3 "shared chat anatomy"; MD-18): the StatusLine
// ("Running 4:12 · Orchestrator", "Needs you · Bug Fixer", "Done · Claude Opus 5.5") and the header menu (MDF-57).
// Pure, unit-tested.
import type { MobileIconConcept } from '@generatorai/design-tokens';
import { messageWasStopped, type ChatMessage } from '@generatorai/client-core';
import { STATUS_MAPS, type StatusState } from '@generatorai/shared';

export interface ChatStatusInput {
  archived: boolean;
  /** A permission, question or plan is waiting on this person. */
  gatePending: boolean;
  /** The stream's status (client-core `StreamState['status']`). */
  streamStatus: 'idle' | 'pending' | 'thinking' | 'streaming' | 'complete' | 'error';
  /** The user stopped the turn. */
  stopped: boolean;
  /** With no live stream: how the last persisted turn ended (null when the chat never ran). */
  lastTurn: 'done' | 'stopped' | null;
  /** The agent's name, else the model label. */
  detail: string | null;
  /** When the turn went live on this screen (the stream carries no turn start). */
  liveSince: string | null;
}

export interface ChatStatus {
  state: StatusState;
  label?: string;
  detail?: string;
  elapsedSince?: string;
}

/** The header's StatusLine, or null when there is nothing to say (an archived or never-run chat). */
export function chatHeaderStatus(input: ChatStatusInput): ChatStatus | null {
  if (input.archived) return null;
  const detail = input.detail ? { detail: input.detail } : {};
  if (input.gatePending) return { state: 'needs_you', ...detail };
  const live = input.streamStatus === 'pending' || input.streamStatus === 'thinking' || input.streamStatus === 'streaming';
  if (live) {
    const mapping = STATUS_MAPS.stream[input.streamStatus]!;
    return { state: mapping.state, ...(mapping.label ? { label: mapping.label } : {}), ...detail, ...(input.liveSince ? { elapsedSince: input.liveSince } : {}) };
  }
  if (input.streamStatus === 'error') return { state: 'failed', ...detail };
  const ended = input.streamStatus === 'complete' ? (input.stopped ? 'stopped' : 'done') : input.lastTurn;
  if (ended === 'stopped') {
    const m = STATUS_MAPS.chatTurn.cancelled;
    return { state: m.state, ...(m.label ? { label: m.label } : {}), ...detail };
  }
  if (ended === 'done') return { state: 'succeeded', label: 'Done', ...detail };
  return null;
}

export type ChatMenuId = 'rename' | 'copy-transcript' | 'share' | 'fork' | 'rewind' | 'open-pane' | 'archive' | 'unarchive' | 'delete';

export interface ChatMenuItem {
  id: ChatMenuId;
  label: string;
  icon: MobileIconConcept;
  disabled?: boolean;
  destructive?: boolean;
  testID?: string;
}
export type ChatMenuEntry = ChatMenuItem | { type: 'separator' };

/**
 * The header ⋯ / ⋮ menu (04 §2.3, MDF-57): Rename · Copy transcript · Share transcript · Fork chat · Rewind… · Open
 * workspace pane | Archive (undo) or Move to active | Delete… (confirmed).
 */
export function chatMenu(input: { archived: boolean; hasMessages: boolean; streaming: boolean; canRewind: boolean; forking: boolean }): ChatMenuEntry[] {
  const { archived, hasMessages, streaming, canRewind, forking } = input;
  return [
    { id: 'rename', label: 'Rename', icon: 'edit' },
    { id: 'copy-transcript', label: 'Copy transcript', icon: 'copy', disabled: !hasMessages, testID: 'copy-transcript' },
    { id: 'share', label: 'Share transcript', icon: 'upload', disabled: !hasMessages },
    { id: 'fork', label: 'Fork chat', icon: 'branch', disabled: forking || archived || !hasMessages, testID: 'fork-chat' },
    { id: 'rewind', label: 'Rewind…', icon: 'history', disabled: !canRewind || archived || streaming },
    { id: 'open-pane', label: 'Open workspace pane', icon: 'dock' },
    { type: 'separator' },
    archived ? { id: 'unarchive', label: 'Move to active', icon: 'archive' } : { id: 'archive', label: 'Archive', icon: 'archive' },
    { type: 'separator' },
    { id: 'delete', label: 'Delete…', icon: 'trash', destructive: true },
  ];
}

/** The transcript as plain text, for the share sheet. */
export function transcriptText(messages: ReadonlyArray<{ role: string; content?: string | null }>, title: string): string {
  const lines = [title, ''];
  for (const m of messages) {
    const text = m.content?.trim();
    if (!text) continue;
    lines.push(`${m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Agent' : m.role}: ${text}`, '');
  }
  return lines.join('\n');
}

/** The newest user prompt the server has a turn id for ("Rewind…" from the menu). */
export function lastUserPrompt(messages: readonly ChatMessage[]): { turnId: string; prompt: string } | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role === 'user' && m.metadata?.turnId) return { turnId: m.metadata.turnId, prompt: m.content };
  }
  return null;
}

/** How the last persisted turn ended, for the StatusLine of a chat with no live stream. */
export function lastTurnOutcome(messages: readonly ChatMessage[]): 'done' | 'stopped' | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return null;
  return messageWasStopped(last) ? 'stopped' : 'done';
}
