// ────────────────────────────────────────────────────────────────
// ScriptedFauxHarness — the testkit's fake provider.
//
// A `FauxProvider` (the W44 conformance double) whose replies come from a
// per-STAGE script instead of a per-conversation queue. A workflow test
// thinks in stages ("B3 fails once, then answers"), while the executor
// talks to conversations and sends several internal turns per stage
// (context ack, output retry, summary). This class bridges the two:
//
//   1. every prompt is classified into a `TurnKind` by the engine adapter's
//      `classify` (the persisted turn metadata), falling back to the fixed
//      texts `StageExecutionService` sends today (`classifyPrompt`);
//   2. the conversation is resolved to the stage run currently speaking
//      through it (via the engine's `resolveStage`, a DB lookup), so the
//      same script works in `single` and `per-stage` session modes;
//   3. the next scripted `Turn` that answers that kind is dequeued from the
//      stage run's queue — work turns by default, internal turns only when
//      a `Turn` names them in `on` — and anything unscripted gets a stable
//      default reply.
//
// Every call is recorded in `calls`, so a test can assert on what the engine
// actually asked the model, turn by turn.
// ────────────────────────────────────────────────────────────────

import { FauxProvider } from '@generatorai/agent-harness-providers';
import type { FauxScriptEntry } from '@generatorai/agent-harness-providers';
import type {
  AttachmentRef,
  ConversationResponse,
  CreateConversationParams,
  SendPromptOptions,
} from '@generatorai/core';
import type { AgentEvent } from '@generatorai/shared';
import { RealClock, type TestClock } from './clock.js';

/** What a prompt is, as far as today's stage executor is concerned. */
export type TurnKind =
  | 'prompt'
  | 'context'
  | 'summary'
  | 'output_retry'
  | 'validation_feedback'
  | 'recap'
  | 'continuation'
  | 'follow_up';

/** Kinds a `Turn` without an explicit `on` answers. */
export const WORK_TURN_KINDS: ReadonlySet<TurnKind> = new Set([
  'prompt',
  'continuation',
  'validation_feedback',
  'follow_up',
]);

/** Shape of a provider failure a turn can simulate. */
export interface HarnessErrorLike {
  message: string;
  /** Copied onto the thrown error as `code`. */
  code?: string;
}

export interface ScriptedToolCall {
  name: string;
  input?: Record<string, unknown>;
  /** Result reported by `harness.tool_complete` (default `'ok'`). */
  result?: unknown;
  /** When set, the tool call completes with `success: false` and this text. */
  error?: string;
}

/** One scripted model turn. */
export interface Turn {
  /** Assistant reply text. Omitted → empty reply. */
  text?: string;
  /** Tool calls reported before the text, each completing immediately. */
  toolCalls?: ScriptedToolCall[];
  /** Reported as `harness.usage` at the end of the turn. */
  usage?: { inputTokens?: number; outputTokens?: number; cost?: number };
  /** The turn fails: `harness.error` is emitted and the call rejects. */
  error?: HarnessErrorLike;
  /** Wait this long (on the engine's `TestClock`) before replying. */
  delayMs?: number;
  /**
   * Never reply. The call resolves with empty content only when it is
   * aborted (`abortConversation` or the caller's signal) — which is how a
   * real provider behaves on pause/cancel/timeout (F-1).
   */
  hang?: true;
  /** Prompt kinds this turn answers. Default: `WORK_TURN_KINDS`. */
  on?: TurnKind | TurnKind[];
}

/** The stage run a conversation is speaking for. */
export interface StageKey {
  stageName: string;
  stageRunId: string;
  workflowRunId: string;
  conversationId: string;
}

/**
 * Script per stage. A record is keyed by stage name (`'*'` = every stage
 * without its own entry); a function receives the full key. Each stage RUN
 * gets its own copy of the queue, consumed across retries and restarts.
 */
export type ScriptSource = Record<string, Turn[]> | ((key: StageKey) => Turn[] | undefined);

export interface HarnessCall {
  seq: number;
  /** Engine generation (bumped by `killAndRestart`). */
  generation: number;
  conversationId: string;
  stageName: string;
  stageRunId: string;
  kind: TurnKind;
  prompt: string;
  /** The scripted turn that answered, or undefined for a default reply. */
  scripted?: Turn;
  outcome: 'replied' | 'error' | 'aborted' | 'pending';
  response?: string;
  /** Wall-clock start and end of the call (ms). */
  startedAt: number;
  endedAt?: number;
}

/**
 * Classify a prompt by the fixed texts `StageExecutionService` sends. The
 * strings are today's; PHASE-02/03 replace them with typed turn roles.
 */
export function classifyPrompt(text: string): TurnKind {
  const t = text.trimStart();
  if (t.startsWith('The following stages have already been completed')) return 'context';
  if (t.startsWith('Provide a concise summary (max 500 words)')) return 'summary';
  if (
    t.startsWith('Your response did not include a clear summary') ||
    t.startsWith('Your response is missing the required structured output')
  ) {
    return 'output_retry';
  }
  if (t.startsWith('⚠️ **Validation Feedback') || t.startsWith('⚠️ **Validation Failed')) return 'validation_feedback';
  if (t.startsWith('This stage was interrupted by a restart')) return 'recap';
  if (t.startsWith('Continue from where you left off')) return 'continuation';
  if (text.includes('**IMPORTANT: How to create files**')) return 'prompt';
  return 'follow_up';
}

/** Default reply for an unscripted turn. Work replies are ≥ 50 chars (F-10). */
export function defaultReply(kind: TurnKind, stageName: string): string {
  switch (kind) {
    case 'context':
      return 'Context received.';
    case 'summary':
      return `Summary of ${stageName}: the stage completed its scripted work.`;
    case 'output_retry':
      return `Summary: ${stageName} produced its scripted output.`;
    case 'recap':
      return 'Understood.';
    default:
      return `${stageName} output: the stage finished its scripted work successfully.`;
  }
}

function answers(turn: Turn, kind: TurnKind): boolean {
  if (turn.on === undefined) return WORK_TURN_KINDS.has(kind);
  return Array.isArray(turn.on) ? turn.on.includes(kind) : turn.on === kind;
}

/** Per-stage-run script queues, shared by every engine generation. */
export class ScriptBook {
  private readonly queues = new Map<string, Turn[]>();

  constructor(private readonly source: ScriptSource = {}) {}

  take(key: StageKey, kind: TurnKind): Turn | undefined {
    let queue = this.queues.get(key.stageRunId);
    if (!queue) {
      const turns =
        typeof this.source === 'function'
          ? this.source(key)
          : (this.source[key.stageName] ?? this.source['*']);
      queue = [...(turns ?? [])];
      this.queues.set(key.stageRunId, queue);
    }
    const idx = queue.findIndex((t) => answers(t, kind));
    if (idx === -1) return undefined;
    return queue.splice(idx, 1)[0];
  }

  /** Turns still queued for a stage run (for "script fully consumed" asserts). */
  remaining(stageRunId: string): readonly Turn[] {
    return this.queues.get(stageRunId) ?? [];
  }
}

export interface ScriptedFauxHarnessOptions {
  book: ScriptBook;
  /** Maps a conversation to the stage run speaking through it. */
  resolveStage: (conversationId: string) => StageKey;
  /** Engine-aware turn classification (metadata first); default: `classifyPrompt`. */
  classify?: (conversationId: string, prompt: string) => TurnKind;
  clock?: TestClock;
  calls?: HarnessCall[];
  generation?: number;
}

type Handler = (event: AgentEvent) => void;

export class ScriptedFauxHarness extends FauxProvider {
  readonly calls: HarnessCall[];
  /** `createConversation` params, in creation order (conversationId → params). */
  readonly conversationParams = new Map<string, CreateConversationParams>();
  readonly generation: number;

  private readonly book: ScriptBook;
  private readonly resolveStage: (conversationId: string) => StageKey;
  private readonly classify: (conversationId: string, prompt: string) => TurnKind;
  private readonly clock: TestClock;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly aborters = new Map<string, Set<AbortController>>();
  private killed = false;
  private seq = 0;
  private callIdSeq = 0;

  constructor(opts: ScriptedFauxHarnessOptions) {
    super();
    this.book = opts.book;
    this.resolveStage = opts.resolveStage;
    this.classify = opts.classify ?? ((_c, p) => classifyPrompt(p));
    this.clock = opts.clock ?? new RealClock();
    this.calls = opts.calls ?? [];
    this.generation = opts.generation ?? 0;
    this.seq = this.calls.length;
  }

  /**
   * Simulate the process dying. Every call in flight and every later call
   * never settles, and aborts are ignored, so the executor frames of this
   * generation stay parked forever instead of writing to the DB beside the
   * next generation.
   */
  kill(): void {
    this.killed = true;
  }

  get isKilled(): boolean {
    return this.killed;
  }

  override async createConversation(params: CreateConversationParams): Promise<string> {
    this.conversationParams.set(params.conversationId, params);
    return super.createConversation(params);
  }

  override onConversationEvent(conversationId: string, handler: Handler): () => void {
    let set = this.handlers.get(conversationId);
    if (!set) {
      set = new Set();
      this.handlers.set(conversationId, set);
    }
    set.add(handler);
    const offSuper = super.onConversationEvent(conversationId, handler);
    return () => {
      set.delete(handler);
      offSuper();
    };
  }

  override async abortConversation(conversationId: string): Promise<void> {
    if (this.killed) return;
    for (const ac of this.aborters.get(conversationId) ?? []) ac.abort();
    await super.abortConversation(conversationId);
  }

  override async sendPrompt(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    options?: SendPromptOptions,
  ): Promise<void> {
    void this.sendPromptAndWait(conversationId, prompt, attachments, undefined, options).catch(() => undefined);
  }

  override async sendPromptAndWait(
    conversationId: string,
    prompt: string,
    attachments?: AttachmentRef[],
    signal?: AbortSignal,
    options?: SendPromptOptions,
  ): Promise<ConversationResponse> {
    if (this.killed) return new Promise<never>(() => undefined);

    const kind = this.classify(conversationId, prompt);
    const key = this.resolveStage(conversationId);
    const turn = this.book.take(key, kind);
    const call: HarnessCall = {
      seq: ++this.seq,
      generation: this.generation,
      conversationId,
      stageName: key.stageName,
      stageRunId: key.stageRunId,
      kind,
      prompt,
      ...(turn ? { scripted: turn } : {}),
      outcome: 'pending',
      startedAt: Date.now(),
    };
    this.calls.push(call);

    // One controller per call: aborted by the caller's signal (stage
    // timeout) or by `abortConversation` (pause / cancel / stale reap).
    const ac = new AbortController();
    const onSignal = (): void => ac.abort();
    signal?.addEventListener('abort', onSignal, { once: true });
    let set = this.aborters.get(conversationId);
    if (!set) {
      set = new Set();
      this.aborters.set(conversationId, set);
    }
    set.add(ac);

    try {
      if (signal?.aborted) ac.abort();
      if (turn?.hang) {
        await new Promise<void>((resolve) => {
          if (ac.signal.aborted) return resolve();
          ac.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      } else if (turn?.delayMs) {
        await this.clock.sleep(turn.delayMs, ac.signal);
      }
      if (this.killed) return new Promise<never>(() => undefined);

      if (ac.signal.aborted) {
        call.outcome = 'aborted';
        call.response = '';
        return { content: '' };
      }

      if (turn?.toolCalls?.length) {
        for (const tc of turn.toolCalls) {
          const callId = `tk-call-${++this.callIdSeq}`;
          this.emitTo(conversationId, {
            kind: 'harness.tool_start',
            data: { tool: tc.name, args: tc.input ?? {}, callId },
          } as AgentEvent);
          this.emitTo(conversationId, {
            kind: 'harness.tool_complete',
            data: {
              tool: tc.name,
              callId,
              result: tc.error ?? tc.result ?? 'ok',
              success: tc.error === undefined,
            },
          } as AgentEvent);
        }
      }

      const entries: FauxScriptEntry[] = [];
      if (turn?.error) {
        const text = turn.text ?? '';
        if (text) entries.push({ type: 'text', content: text });
        entries.push({ type: 'error', message: turn.error.message });
      } else {
        const text = turn ? (turn.text ?? '') : defaultReply(kind, key.stageName);
        if (text) entries.push({ type: 'text', content: text });
        entries.push({ type: 'complete', ...(turn?.usage ? { usage: turn.usage } : {}) });
      }
      this.script(entries, conversationId);
      try {
        const res = await super.sendPromptAndWait(conversationId, prompt, attachments, signal, options);
        // A real provider resolves the turn AFTER its events were delivered.
        // The executor's event handler awaits a DB write before it records
        // the reply, so give it a macrotask to land — otherwise every reader
        // of the accumulated turn text races the harness (a faux artefact).
        await new Promise<void>((r) => setImmediate(r));
        call.outcome = 'replied';
        call.response = res.content;
        return res;
      } catch (err) {
        call.outcome = 'error';
        if (turn?.error?.code && err instanceof Error) {
          (err as Error & { code?: string }).code = turn.error.code;
        }
        throw err;
      }
    } finally {
      call.endedAt = Date.now();
      signal?.removeEventListener('abort', onSignal);
      set.delete(ac);
    }
  }

  /** Emit an event FauxProvider has no script entry for (successful tool calls). */
  private emitTo(conversationId: string, event: AgentEvent): void {
    for (const h of this.handlers.get(conversationId) ?? []) {
      try {
        h(event);
      } catch {
        /* a handler error must not kill the provider */
      }
    }
  }
}
