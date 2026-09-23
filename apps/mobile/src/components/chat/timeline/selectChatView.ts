// ────────────────────────────────────────────────────────────────
// selectChatView — what the chat SCREEN needs from a stream, as primitives.
//
// The screen used to subscribe to the whole `StreamState`, so every text
// chunk re-rendered the screen (all its hooks, the header effect, the
// composer props) before a single row was touched. This selector returns
// only fields that change when something STRUCTURAL happens — a block is
// added or settles, a gate opens, usage lands — plus a blocks signature.
// Read through `useShallow`, a token appending to the live block changes
// nothing here, so nothing above the row re-renders (plan §7.2).
//
// Pure, so the "what counts as structural" rule is unit-testable.
// ────────────────────────────────────────────────────────────────

import { DEFAULT_STREAM, type StreamBlock, type StreamState } from '@generatorai/client-core';

import { awaitsUserDecision, blocksSignature } from './deriveTimeline';

export type LastBlockKind = 'none' | 'thinking-live' | 'tool-running' | 'text' | 'other';

export interface ChatStreamView {
  status: StreamState['status'];
  typing: boolean;
  turnId: number;
  serverTurnId: string | null;
  pendingUserMessage: string | null;
  turnUserMessage: string | null;
  cancelRequested: boolean;
  usage: StreamState['usage'];
  hooks: StreamState['hooks'];
  contextTokens: number | null;
  /** See `blocksSignature`. */
  signature: string;
  blockCount: number;
  lastBlock: LastBlockKind;
  /** The open gate block, by identity — replaced only when its status changes. */
  gateBlock: Extract<StreamBlock, { type: 'permission' | 'question' }> | null;
  gate: 'permission' | 'question' | 'plan' | null;
  isLive: boolean;
}

export function selectChatView(stream: StreamState | undefined): ChatStreamView {
  const s = stream ?? DEFAULT_STREAM;
  const blocks = s.blocks;
  const last = blocks[blocks.length - 1];
  const lastBlock: LastBlockKind = !last
    ? 'none'
    : last.type === 'thinking' && !last.isComplete
      ? 'thinking-live'
      : last.type === 'tool_call' && last.status === 'running'
        ? 'tool-running'
        : last.type === 'text'
          ? 'text'
          : 'other';
  // A retained stream can miss a resolution while its screen is unmounted.
  // Completed/failed turns cannot keep the composer blocked by an old card;
  // genuinely pending server interactions are independently seeded by REST.
  const isLive = s.status === 'streaming' || s.status === 'thinking' || s.status === 'pending';
  const gate = isLive ? awaitsUserDecision(blocks) : null;
  let gateBlock: ChatStreamView['gateBlock'] = null;
  if (gate === 'permission' || gate === 'question') {
    for (const b of blocks) {
      if (b.type === gate && b.status === 'pending') {
        gateBlock = b;
        break;
      }
    }
  }
  return {
    status: s.status,
    typing: s.typing,
    turnId: s.turnId,
    serverTurnId: s.serverTurnId,
    pendingUserMessage: s.pendingUserMessage,
    turnUserMessage: s.turnUserMessage,
    cancelRequested: s.cancelRequested,
    usage: s.usage,
    hooks: s.hooks,
    contextTokens: s.contextUsage?.currentTokens ?? null,
    signature: blocksSignature(blocks),
    blockCount: blocks.length,
    lastBlock,
    gateBlock,
    gate,
    isLive,
  };
}

/**
 * What the agent is doing right now, or null when the transcript already
 * shows it (a live thinking row or a running tool has its own spinner).
 */
export function activityLabelFor(view: ChatStreamView): string | null {
  if (!view.isLive) return null;
  if (view.status === 'pending') return 'Working…';
  if (view.lastBlock === 'thinking-live' || view.lastBlock === 'tool-running') return null;
  if (view.status === 'thinking') return 'Thinking…';
  // W30-d — text held back to a block boundary is text that exists but is
  // deliberately not on screen; without this the paragraph being written
  // looks like nothing happening.
  if (view.typing) return 'Writing…';
  return view.lastBlock === 'text' ? null : 'Responding…';
}
