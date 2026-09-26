// ────────────────────────────────────────────────────────────────
// OpenTelemetry GenAI semantic conventions (P07 WP-7.4, RV-36).
//
// The span tree a workflow produces, aligned with the GenAI conventions:
//
//   workflow.run
//     workflow.loop <key>            (P05 containers)
//       workflow.iteration <k>
//         invoke_agent <stage key>   (one per stage attempt)
//           chat <model>             (one per provider turn)
//             execute_tool <tool>    (one per tool call)
//
// `invoke_agent`, `chat` and `execute_tool` carry the `gen_ai.*`
// attributes (operation, provider, request model, usage, conversation,
// agent, tool). Message content is captured only when the operator opts in
// with the standard `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`.
// Everything here is a no-op when no OTel SDK is registered.
// ────────────────────────────────────────────────────────────────

import { context, trace, SpanKind, SpanStatusCode, type Context, type Span } from '@opentelemetry/api';
import { getTracer, recordException } from './tracing.js';

/** GenAI attribute names (OTel semantic conventions, gen_ai.*). */
export const GEN_AI = {
  OPERATION: 'gen_ai.operation.name',
  PROVIDER: 'gen_ai.provider.name',
  REQUEST_MODEL: 'gen_ai.request.model',
  RESPONSE_MODEL: 'gen_ai.response.model',
  INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  CONVERSATION_ID: 'gen_ai.conversation.id',
  AGENT_NAME: 'gen_ai.agent.name',
  AGENT_ID: 'gen_ai.agent.id',
  TOOL_NAME: 'gen_ai.tool.name',
  TOOL_CALL_ID: 'gen_ai.tool.call.id',
  INPUT_MESSAGES: 'gen_ai.input.messages',
  OUTPUT_MESSAGES: 'gen_ai.output.messages',
} as const;

/** The GenAI provider name of a harness type (`gen_ai.provider.name`). */
export function genAiProviderName(harnessType: string | undefined): string {
  switch (harnessType) {
    case 'claude-agent':
      return 'anthropic';
    case 'codex':
      return 'openai';
    case 'copilot':
      return 'github_copilot';
    default:
      return harnessType ?? 'unknown';
  }
}

/** Message content goes on spans only when the operator opts in (the OTel GenAI switch). */
export function genAiContentCapture(): boolean {
  return typeof process !== 'undefined' && process.env?.['OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT'] === 'true';
}

/** Start a span under `parent` (default: the active context), without making it active. */
export function startSpan(
  tracerName: string,
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  parent?: Context,
  kind: SpanKind = SpanKind.INTERNAL,
): Span {
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attributes)) if (v !== undefined) clean[k] = v;
  return getTracer(tracerName).startSpan(name, { kind, attributes: clean }, parent ?? context.active());
}

/** The context whose active span is `span` (the parent of what runs inside it). */
export function contextWithSpan(span: Span, parent?: Context): Context {
  return trace.setSpan(parent ?? context.active(), span);
}

/** Run `fn` with `ctx` active (provider spans created inside nest under its span). */
export function runInContext<T>(ctx: Context, fn: () => T): T {
  return context.with(ctx, fn);
}

/** End a span with an error status (or OK). */
export function endSpan(span: Span, error?: unknown): void {
  if (error !== undefined) recordException(span, error);
  else span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

interface TurnSpan {
  span: Span;
  tools: Map<string, Span>;
  /** Usage summed over the turn's usage reports. */
  usage: Record<string, number>;
}

/**
 * A provider's `chat` and `execute_tool` spans. The provider runs each turn
 * in `chat()` and feeds its events to `observe()`: usage lands on the turn's
 * span, tool calls become child spans.
 */
export class GenAiTurnSpans {
  private readonly turns = new Map<string, TurnSpan>();

  constructor(
    private readonly tracerName: string,
    private readonly harnessType: string,
  ) {}

  /** Run one turn inside a `chat <model>` span (a child of the active context: a stage's `invoke_agent`). */
  async chat<T>(conversationId: string, model: string | undefined, prompt: string, fn: (span: Span) => Promise<T>): Promise<T> {
    const span = startSpan(
      this.tracerName,
      model ? `chat ${model}` : 'chat',
      {
        [GEN_AI.OPERATION]: 'chat',
        [GEN_AI.PROVIDER]: genAiProviderName(this.harnessType),
        [GEN_AI.REQUEST_MODEL]: model,
        [GEN_AI.CONVERSATION_ID]: conversationId,
        'generatorai.harness': this.harnessType,
        'generatorai.prompt.length': prompt.length,
        ...(genAiContentCapture() ? { [GEN_AI.INPUT_MESSAGES]: JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: prompt }] }]) } : {}),
      },
      undefined,
      SpanKind.CLIENT,
    );
    const turn: TurnSpan = { span, tools: new Map(), usage: {} };
    this.turns.set(conversationId, turn);
    try {
      const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));
      if (genAiContentCapture()) {
        const content = (result as { content?: unknown } | undefined)?.content;
        if (typeof content === 'string') {
          span.setAttribute(GEN_AI.OUTPUT_MESSAGES, JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content }] }]));
        }
      }
      endSpan(span);
      return result;
    } catch (err) {
      endSpan(span, err);
      throw err;
    } finally {
      for (const t of turn.tools.values()) t.end();
      if (this.turns.get(conversationId) === turn) this.turns.delete(conversationId);
    }
  }

  /** A provider event of the turn in flight: usage and tool calls. */
  observe(conversationId: string, event: { kind: string; data?: unknown }): void {
    const turn = this.turns.get(conversationId);
    if (!turn) return;
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (event.kind === 'harness.usage') {
      const add = (key: string, v: unknown) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) return;
        turn.usage[key] = (turn.usage[key] ?? 0) + v;
        turn.span.setAttribute(key, turn.usage[key]);
      };
      add(GEN_AI.INPUT_TOKENS, data['inputTokens']);
      add(GEN_AI.OUTPUT_TOKENS, data['outputTokens']);
      if (typeof data['model'] === 'string') turn.span.setAttribute(GEN_AI.RESPONSE_MODEL, data['model']);
      if (typeof data['costUsd'] === 'number') turn.span.setAttribute('generatorai.usage.cost_usd', data['costUsd']);
      return;
    }
    if (event.kind === 'harness.tool_start') {
      const tool = typeof data['tool'] === 'string' ? data['tool'] : 'tool';
      const callId = typeof data['callId'] === 'string' ? data['callId'] : `${tool}#${turn.tools.size}`;
      const span = startSpan(
        this.tracerName,
        `execute_tool ${tool}`,
        { [GEN_AI.OPERATION]: 'execute_tool', [GEN_AI.TOOL_NAME]: tool, [GEN_AI.TOOL_CALL_ID]: callId },
        trace.setSpan(context.active(), turn.span),
      );
      turn.tools.set(callId, span);
      return;
    }
    if (event.kind === 'harness.tool_complete') {
      const tool = typeof data['tool'] === 'string' ? data['tool'] : 'tool';
      const callId = typeof data['callId'] === 'string' ? data['callId'] : [...turn.tools.keys()].find((k) => k.startsWith(`${tool}#`));
      const span = callId ? turn.tools.get(callId) : undefined;
      if (!span || !callId) return;
      turn.tools.delete(callId);
      if (data['success'] === false) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }
  }
}

export { SpanKind };
export type { Context as TraceContext, Span as TraceSpan };
