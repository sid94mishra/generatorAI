// ────────────────────────────────────────────────────────────────
// Event stream → a renderable timeline.
//
// The previous CLI put this in `EventRenderer.ts` and wrote straight to the
// terminal, which meant the TUI could not reuse a line of it. The reducer
// here produces data; a renderer decides how it looks.
//
// The `__isInternalTurn` filtering is domain knowledge worth preserving: hook
// context injection and validation feedback run as real turns on the same
// session, and rendering them makes the agent look like it is talking to
// itself.
// ────────────────────────────────────────────────────────────────

export type TimelineItemKind =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool'
  | 'stage'
  | 'notice'
  | 'error'
  | 'usage';

export interface ToolCallState {
  id: string;
  tool: string;
  args?: unknown;
  result?: unknown;
  status: 'running' | 'complete' | 'error';
  startedAt: number;
  endedAt?: number;
  error?: string;
}

export interface TimelineItem {
  id: string;
  kind: TimelineItemKind;
  /** Accumulated text for streaming kinds. */
  text: string;
  /** Set once the producing turn has completed. */
  complete: boolean;
  at: number;
  stageName?: string;
  tool?: ToolCallState;
  level?: 'info' | 'warn' | 'error';
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; costUsd?: number };
}

export interface TimelineState {
  items: TimelineItem[];
  /** The item currently receiving tokens, if any. */
  streamingItemId: string | null;
  currentStage: string | null;
  /** Highest sequence seen, for `Last-Event-ID` resume. */
  lastSequence: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
  /** True while a turn the user did not initiate is in flight. */
  internalTurn: boolean;
  runStatus: string | null;
  pendingApproval: { stageId: string; stageName: string; prompt?: string } | null;
}

export function emptyTimeline(): TimelineState {
  return {
    items: [],
    streamingItemId: null,
    currentStage: null,
    lastSequence: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
    internalTurn: false,
    runStatus: null,
    pendingApproval: null,
  };
}

export interface StreamEvent {
  kind: string;
  data: Record<string, unknown>;
  sequence?: number;
}

export interface ReduceOptions {
  showThinking?: boolean;
  showTools?: boolean;
  /** Drop everything except stage transitions, errors and the final message. */
  minimal?: boolean;
  /** Cap on retained items; older ones are dropped. 0 keeps everything. */
  maxItems?: number;
}

let seq = 0;
function itemId(): string {
  seq += 1;
  return `t${seq}`;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Folds one event into the timeline.
 *
 * Returns a NEW state so a React store can diff it; mutating in place would
 * make `useSyncExternalStore` miss updates.
 */
export function reduceEvent(
  state: TimelineState,
  event: StreamEvent,
  options: ReduceOptions = {},
): TimelineState {
  const { kind, data } = event;
  const now = Date.now();
  const sequence = event.sequence ?? state.lastSequence;

  // Re-delivered events after a reconnect must not duplicate output.
  if (event.sequence !== undefined && event.sequence <= state.lastSequence) return state;

  const base = { ...state, lastSequence: Math.max(state.lastSequence, sequence) };
  const isInternal = Boolean(data['__isInternalTurn']);

  switch (kind) {
    case 'harness.turn_start':
      return { ...base, internalTurn: isInternal, streamingItemId: null };

    case 'harness.turn_end':
    case 'harness.completion':
    case 'chat.turn_complete':
      return {
        ...base,
        internalTurn: false,
        streamingItemId: null,
        items: closeStreaming(base.items, base.streamingItemId),
      };

    case 'harness.user_message': {
      if (base.internalTurn || isInternal) return base;
      return push(base, {
        id: itemId(),
        kind: 'user',
        text: str(data['content'] ?? data['text']),
        complete: true,
        at: now,
      }, options);
    }

    case 'harness.token': {
      if (base.internalTurn || isInternal || options.minimal) return base;
      return appendStreaming(base, 'assistant', str(data['text']), now, options);
    }

    case 'harness.reasoning_delta': {
      if (base.internalTurn || isInternal || options.showThinking === false || options.minimal) {
        return base;
      }
      return appendStreaming(base, 'thinking', str(data['text']), now, options);
    }

    case 'harness.message_complete': {
      if (base.internalTurn || isInternal) return base;
      const content = str(data['content']);
      // A message_complete carrying the full text supersedes the accumulated
      // token stream: providers occasionally normalise whitespace or fix up
      // markdown between the last token and the final message.
      if (base.streamingItemId && content) {
        return {
          ...base,
          streamingItemId: null,
          items: base.items.map((item) =>
            item.id === base.streamingItemId ? { ...item, text: content, complete: true } : item,
          ),
        };
      }
      if (!content) {
        return { ...base, streamingItemId: null, items: closeStreaming(base.items, base.streamingItemId) };
      }
      return push(base, { id: itemId(), kind: 'assistant', text: content, complete: true, at: now }, options);
    }

    case 'harness.tool_start': {
      if (base.internalTurn || isInternal || options.showTools === false) return base;
      const tool: ToolCallState = {
        id: str(data['toolCallId'] ?? data['id'] ?? itemId()),
        tool: str(data['tool'] ?? data['name'] ?? 'tool'),
        args: data['args'] ?? data['input'],
        status: 'running',
        startedAt: now,
      };
      return push(
        base,
        {
          id: itemId(),
          kind: 'tool',
          text: tool.tool,
          complete: false,
          at: now,
          tool,
          ...(base.currentStage ? { stageName: base.currentStage } : {}),
        },
        options,
      );
    }

    case 'harness.tool_complete':
    case 'harness.tool_error': {
      if (options.showTools === false) return base;
      const callId = str(data['toolCallId'] ?? data['id']);
      const failed = kind === 'harness.tool_error';
      return {
        ...base,
        items: base.items.map((item) => {
          if (item.kind !== 'tool' || !item.tool) return item;
          if (callId && item.tool.id !== callId) return item;
          if (!callId && item.tool.status !== 'running') return item;
          return {
            ...item,
            complete: true,
            tool: {
              ...item.tool,
              status: failed ? 'error' : 'complete',
              result: data['result'] ?? data['output'],
              endedAt: now,
              ...(failed ? { error: str(data['error'] ?? data['message']) } : {}),
            },
          };
        }),
      };
    }

    case 'stage.started':
    case 'stage_run.started': {
      const stageName = str(data['stageName'] ?? data['name'] ?? data['stageId']);
      return push(
        { ...base, currentStage: stageName },
        { id: itemId(), kind: 'stage', text: stageName, complete: false, at: now, stageName, level: 'info' },
        options,
      );
    }

    case 'stage.completed':
    case 'stage_run.completed': {
      const stageName = str(data['stageName'] ?? data['name'] ?? base.currentStage);
      return {
        ...base,
        items: base.items.map((item) =>
          item.kind === 'stage' && item.stageName === stageName ? { ...item, complete: true } : item,
        ),
      };
    }

    case 'stage.failed':
    case 'stage_run.failed': {
      const stageName = str(data['stageName'] ?? data['name'] ?? base.currentStage);
      return push(
        base,
        {
          id: itemId(),
          kind: 'error',
          text: `${stageName}: ${str(data['error'] ?? 'stage failed')}`,
          complete: true,
          at: now,
          stageName,
          level: 'error',
        },
        options,
      );
    }

    case 'stage.awaiting_input': {
      const stageName = str(data['stageName'] ?? data['name']);
      return push(
        {
          ...base,
          pendingApproval: {
            stageId: str(data['stageId'] ?? data['id']),
            stageName,
            ...(data['prompt'] ? { prompt: str(data['prompt']) } : {}),
          },
        },
        {
          id: itemId(),
          kind: 'notice',
          text: `${stageName} is waiting for approval`,
          complete: true,
          at: now,
          stageName,
          level: 'warn',
        },
        options,
      );
    }

    case 'stage.resumed':
      return { ...base, pendingApproval: null };

    case 'run.status':
    case 'workflow_run.status':
      return { ...base, runStatus: str(data['status']) };

    case 'harness.usage': {
      const usage = {
        inputTokens: base.usage.inputTokens + (num(data['inputTokens']) ?? 0),
        outputTokens: base.usage.outputTokens + (num(data['outputTokens']) ?? 0),
        totalTokens: base.usage.totalTokens + (num(data['totalTokens']) ?? 0),
        costUsd: base.usage.costUsd + (num(data['costUsd']) ?? 0),
      };
      return { ...base, usage };
    }

    case 'harness.error':
    case 'run.error':
      return push(
        base,
        {
          id: itemId(),
          kind: 'error',
          text: str(data['message'] ?? data['error'] ?? 'Unknown error'),
          complete: true,
          at: now,
          level: 'error',
        },
        options,
      );

    default:
      return base;
  }
}

function push(state: TimelineState, item: TimelineItem, options: ReduceOptions): TimelineState {
  const items = [...state.items, item];
  const max = options.maxItems ?? 0;
  return {
    ...state,
    items: max > 0 && items.length > max ? items.slice(items.length - max) : items,
  };
}

function closeStreaming(items: TimelineItem[], streamingId: string | null): TimelineItem[] {
  if (!streamingId) return items;
  return items.map((item) => (item.id === streamingId ? { ...item, complete: true } : item));
}

/**
 * Appends to the live item, opening one if the previous turn closed.
 *
 * Thinking and assistant text must not share an item: interleaving them into
 * one blob is precisely the bug the web `sseManager` cross-buffer flush
 * exists to prevent.
 */
function appendStreaming(
  state: TimelineState,
  kind: 'assistant' | 'thinking',
  text: string,
  now: number,
  options: ReduceOptions,
): TimelineState {
  if (!text) return state;

  const current = state.items.find((i) => i.id === state.streamingItemId);
  if (current && current.kind === kind && !current.complete) {
    return {
      ...state,
      items: state.items.map((item) =>
        item.id === current.id ? { ...item, text: item.text + text } : item,
      ),
    };
  }

  const item: TimelineItem = {
    id: itemId(),
    kind,
    text,
    complete: false,
    at: now,
    ...(state.currentStage ? { stageName: state.currentStage } : {}),
  };
  return { ...push({ ...state, items: closeStreaming(state.items, state.streamingItemId) }, item, options), streamingItemId: item.id };
}

/** Folds a batch, e.g. a replay response. */
export function reduceAll(
  state: TimelineState,
  events: StreamEvent[],
  options: ReduceOptions = {},
): TimelineState {
  return events.reduce((acc, event) => reduceEvent(acc, event, options), state);
}

// ── History ───────────────────────────────────────────────────────

/** A persisted message, as `GET /api/chats/:id/messages` returns it. */
export interface PersistedMessage {
  id?: string;
  role?: string;
  content?: string;
  timestamp?: string | number;
  metadata?: Record<string, unknown> | null;
}

/**
 * Seeds a timeline from stored messages.
 *
 * Without this a pane shows only what arrives on the live stream, so opening
 * any existing conversation reports "No messages yet" no matter how long it
 * is — the single most disorienting thing the UI could do.
 *
 * `lastSequence` is deliberately left at 0: history carries no stream
 * sequence numbers, and claiming one would make the reducer discard the
 * replayed events that follow.
 */
export function timelineFromHistory(messages: PersistedMessage[]): TimelineState {
  const items: TimelineItem[] = [];

  for (const message of messages) {
    const text = typeof message.content === 'string' ? message.content : '';
    if (!text.trim()) continue;
    // Hook context and validation feedback are real turns on the same
    // session; showing them makes the agent look like it talks to itself.
    if (message.metadata?.['__isInternalTurn']) continue;

    const kind: TimelineItemKind =
      message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'notice';

    items.push({
      id: message.id ?? `history-${items.length}`,
      kind,
      text,
      complete: true,
      at: toEpochMs(message.timestamp),
    });
  }

  return { ...emptyTimeline(), items };
}

function toEpochMs(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}
