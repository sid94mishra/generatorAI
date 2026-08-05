// ────────────────────────────────────────────────────────────────
// deriveTimeline — Convert stream blocks + stage metadata into
// TimelineStep[] for the ActivityTimeline.
//
// Rules:
//  - thinking blocks (per StreamingMessage.groupBlocks logic)
//  - tool_call blocks map 1:1 to a step
//  - system blocks with category 'subagent' consolidate to a single
//    step with children (running/completed/failed status derived)
//  - system blocks with category 'error' become failed steps
//  - regular system blocks are dropped (they carry no user-visible value
//    once we have thinking + tool_call detail)
//  - text blocks are the "answer" and do NOT become steps
// ────────────────────────────────────────────────────────────────

import type { StreamBlock } from '@/stores/streamStore.js';
import type { TimelineStep, StepKind, StepStatus } from '@/components/chat/redesign/types.js';

/** Infer a step "kind" from the tool name. Used to pick the right icon. */
function inferKind(toolName: string): StepKind {
  const n = toolName.toLowerCase();
  if (n.includes('read')) return 'read';
  if (n.includes('write') || n.includes('edit') || n.includes('create')) return 'edit';
  if (n.includes('search') || n.includes('grep') || n.includes('find') || n.includes('glob')) return 'search';
  if (n.includes('shell') || n.includes('exec') || n.includes('run') || n.includes('bash') || n.includes('pwsh')) return 'run';
  if (n.includes('memory') || n.includes('remember')) return 'memory';
  if (n.includes('subagent') || n.includes('agent') || n.includes('explore')) return 'subagent';
  return 'tool';
}

/** Shorten a filesystem path to its basename for compact tool-call
 *  headings, while keeping non-path strings (queries, commands, URIs)
 *  short and readable. Preserves URL-looking values (http://, https://,
 *  git://) and short strings under 40 chars. */
function shortenTarget(raw: string, key: string): string {
  const s = raw.trim();
  if (!s) return s;
  // Command / query / description / pattern — leave content intact but
  // collapse any long absolute paths inside to their basename so a shell
  // command like `powershell New-Item -Path "C:\Users\...\long\path\"`
  // doesn't dominate the heading.
  const nonPathKeys = new Set(['pattern', 'query', 'command', 'description']);
  if (nonPathKeys.has(key)) {
    const collapsed = s
      // Windows absolute path in quotes → basename
      .replace(/"[A-Za-z]:\\[^"]*[\\\/]([^\\\/"]+)"/g, '"…\\$1"')
      // Windows absolute path unquoted (whitespace-delimited) → basename
      .replace(/([A-Za-z]:\\[^\s"]*[\\\/])([^\s"\\\/]+)/g, '…\\$2')
      // POSIX absolute path → basename
      .replace(/(\/[^\s"]*\/)([^\s"\/]+)/g, '/…/$2');
    return collapsed.length > 80 ? `${collapsed.slice(0, 77)}…` : collapsed;
  }
  // URLs — keep as-is
  if (/^[a-z]+:\/\//i.test(s)) {
    return s.length > 60 ? `${s.slice(0, 57)}…` : s;
  }
  // Path — take basename. Handle both forward and back slashes.
  const parts = s.split(/[\\/]/).filter(Boolean);
  const base = parts[parts.length - 1] ?? s;
  return base.length > 60 ? `${base.slice(0, 57)}…` : base;
}

/** Produce a compact right-aligned "meta" string from tool args. */
function summarizeArgs(toolName: string, args: unknown): { target: string; meta?: string } {
  if (args == null || typeof args !== 'object') return { target: toolName };
  const a = args as Record<string, unknown>;
  // Common named args across the SDKs. Order matters: prefer specific over generic.
  let targetKey = '';
  let targetRaw = '';
  for (const key of ['file_path', 'filePath', 'path', 'uri', 'pattern', 'query', 'command', 'description'] as const) {
    const v = a[key];
    if (typeof v === 'string' && v.trim()) {
      targetKey = key;
      targetRaw = v;
      break;
    }
  }
  const target = targetRaw ? shortenTarget(targetRaw, targetKey) : toolName;
  let meta: string | undefined;
  if (typeof a.startLine === 'number' && typeof a.endLine === 'number') {
    meta = `lines ${a.startLine}–${a.endLine}`;
  } else if (typeof a.limit === 'number') {
    meta = `${a.limit} matches`;
  }
  return { target, meta };
}

/** Determine the sub-agent state from a set of subagent system messages. */
function subagentState(messages: string[], active: boolean): StepStatus {
  const hasCompleted = messages.some((m) => /completed/i.test(m));
  const hasFailed = messages.some((m) => /failed/i.test(m));
  const hasStarted = messages.some((m) => /started/i.test(m));
  if (hasFailed) return 'failed';
  if (hasCompleted) return 'done';
  if (hasStarted && !active) return 'done';
  if (hasStarted) return 'running';
  return 'pending';
}

/** Extract agent name(s) from "Sub-agent started: <name>" messages. */
function subagentTarget(messages: string[]): string {
  const names = new Set<string>();
  for (const m of messages) {
    const match = /sub-?agent\s+(?:started|completed|failed):\s*(.+)/i.exec(m);
    if (match?.[1]) names.add(match[1].trim());
  }
  const list = [...names];
  if (list.length === 0) return 'Sub-agent';
  if (list.length === 1) return list[0]!;
  return list.join(', ');
}

export interface DeriveTimelineOptions {
  /** true while the stream is not yet complete — affects subagent status. */
  active: boolean;
  /**
   * true while a plan/question gate is blocking the turn. Computed from the
   * blocks when omitted.
   */
  awaitingDecision?: boolean;
}

/**
 * Is the turn parked on the human rather than the model?
 *
 * The gate tool call (`exit_plan_mode` / `ask_user`) stays `running` for as
 * long as the card is unanswered, because it genuinely is — but presenting
 * that as a spinner tells the user to keep waiting when the turn is in fact
 * waiting on THEM.
 */
export function awaitsUserDecision(blocks: StreamBlock[] | undefined): boolean {
  if (!blocks) return false;
  return blocks.some(
    (b) =>
      (b.type === 'plan' && b.status === 'awaiting_review') ||
      (b.type === 'question' && b.status === 'pending'),
  );
}

export function deriveTimeline(
  blocks: StreamBlock[] | undefined,
  opts: DeriveTimelineOptions = { active: false },
): TimelineStep[] {
  if (!blocks || blocks.length === 0) return [];

  const awaitingDecision = opts.awaitingDecision ?? awaitsUserDecision(blocks);

  // Consolidate ALL subagent messages first (they may be non-consecutive).
  const subagentMessages: string[] = [];
  const subagentBlockIds: number[] = [];
  for (const b of blocks) {
    if (b.type === 'system' && b.category === 'subagent') {
      subagentMessages.push(b.message);
      subagentBlockIds.push(b.blockId);
    }
  }

  const steps: TimelineStep[] = [];
  let subagentEmitted = false;

  for (const b of blocks) {
    switch (b.type) {
      case 'thinking': {
        // Skip empty thinking (server often emits a heartbeat block).
        if (!b.text.trim()) continue;
        const settled = b.isComplete || !opts.active;
        steps.push({
          id: `thinking-${b.blockId}`,
          kind: 'think',
          verb: settled ? 'Thought about' : 'Thinking about',
          target: b.text.length > 60 ? `${b.text.slice(0, 60)}…` : b.text,
          mono: false,
          status: settled ? 'done' : 'running',
          detail: b.text,
        });
        break;
      }

      case 'tool_call': {
        const { target, meta } = summarizeArgs(b.tool, b.args);
        const kind = inferKind(b.tool);
        // A tool call may only spin while the turn is genuinely live. Several
        // legitimate paths drop the matching `tool_complete` (harness.error,
        // aborted/denied turns, providers that only echo a tool_result for
        // some tools, event replay of a turn whose completion was never
        // persisted). Keying off `b.status` alone left those rows spinning
        // forever after the turn ended. Once the turn is settled, an
        // unresolved call degrades to a neutral terminal state instead.
        const status: StepStatus = b.status === 'complete'
          ? 'done'
          : awaitingDecision
            ? 'waiting'
            : opts.active ? 'running' : 'pending';
        // Detail is built lazily: `args`/`result` routinely hold whole file
        // trees or multi-MB tool output, and eagerly pretty-printing them for
        // every tool call of every message costs hundreds of ms on chat open
        // even though the row is collapsed by default.
        const { args, result } = b;
        const detail = args == null && result == null
          ? undefined
          : () => {
            const parts: string[] = [];
            if (args != null) {
              try { parts.push('Args:\n' + JSON.stringify(args, null, 2)); } catch { /* ignore */ }
            }
            if (result != null) {
              const resStr = typeof result === 'string' ? result : (() => {
                try { return JSON.stringify(result, null, 2); } catch { return String(result); }
              })();
              parts.push('Result:\n' + resStr);
            }
            return parts.join('\n\n');
          };
        steps.push({
          id: `tool-${b.blockId}`,
          kind,
          verb: b.tool,
          target,
          mono: true,
          status,
          meta,
          detail,
        });
        break;
      }

      case 'system': {
        if (b.category === 'subagent') {
          if (!subagentEmitted) {
            const status = subagentState(subagentMessages, opts.active);
            steps.push({
              id: `sub-${subagentBlockIds[0] ?? b.blockId}`,
              kind: 'subagent',
              verb: 'Explore',
              target: subagentTarget(subagentMessages),
              mono: false,
              status,
              children: subagentMessages.map((m, i) => ({
                id: `sub-child-${subagentBlockIds[i] ?? i}`,
                kind: 'note',
                verb: '',
                target: m,
                mono: false,
                status: /completed/i.test(m) ? 'done' : /failed/i.test(m) ? 'failed' : /started/i.test(m) ? 'running' : 'done',
              })),
            });
            subagentEmitted = true;
          }
          break;
        }
        if (b.category === 'error') {
          steps.push({
            id: `err-${b.blockId}`,
            kind: 'error',
            verb: 'Error',
            target: b.message,
            mono: false,
            status: 'failed',
          });
          break;
        }
        // 'system' category — drop (noise once we have thinking/tools).
        break;
      }

      case 'text':
        // Text blocks are the answer, not steps.
        break;

      case 'widget':
        // Widget blocks are surfaced separately by StreamPanel (rendered
        // inline as an interactive iframe below the timeline). They are
        // NOT steps.
        break;

      case 'plan':
      case 'question':
        // PLN-01 — rendered as their own interactive segments, not steps.
        break;
    }
  }

  return steps;
}

/** Filter widget blocks — used by StreamPanel to render inline widgets
 *  below the answer. Excludes closed widgets. */
export function widgetBlocks(blocks: StreamBlock[] | undefined) {
  if (!blocks) return [];
  return blocks.filter(
    (b): b is Extract<StreamBlock, { type: 'widget' }> =>
      b.type === 'widget' && b.status !== 'closed',
  );
}

/** Extract the assistant text from stream blocks — the "answer" for AnswerBlock. */
export function deriveAnswer(blocks: StreamBlock[] | undefined): string {
  if (!blocks || blocks.length === 0) return '';
  let text = '';
  for (const b of blocks) {
    if (b.type === 'text') text += b.content;
  }
  return text;
}

/** Count the number of tool calls in a set of blocks. */
export function countTools(blocks: StreamBlock[] | undefined): number {
  if (!blocks) return 0;
  return blocks.filter((b) => b.type === 'tool_call').length;
}

// ── Ordered segments (temporal interleaving) ─────────────────────
//
// deriveTimeline + deriveAnswer split blocks into "all steps" + "all
// text", which collapses the natural sequence — every text chunk the
// agent emits between tool calls ends up clubbed together below the
// timeline. `deriveSegments` instead walks the blocks in their true
// temporal order and yields alternating segments, so a run like
//   text · tool · text · tool · text
// renders as five ordered segments instead of [tool,tool] + [text…].
// The blocks array is already strictly ordered (streamStore never
// reorders blocks), so a single in-order pass preserves the sequence.

export type StreamSegment =
  | { type: 'steps'; id: string; steps: TimelineStep[] }
  | { type: 'answer'; id: string; text: string }
  | { type: 'widget'; id: string; widget: Extract<StreamBlock, { type: 'widget' }> }
  | { type: 'plan'; id: string; plan: Extract<StreamBlock, { type: 'plan' }> }
  | { type: 'question'; id: string; question: Extract<StreamBlock, { type: 'question' }> };

/** Walk stream blocks in order and produce interleaved step / answer /
 *  inline-widget segments that preserve the temporal sequence in which
 *  the agent emitted reasoning, tool calls and prose. */
export function deriveSegments(
  blocks: StreamBlock[] | undefined,
  opts: DeriveTimelineOptions = { active: false },
): StreamSegment[] {
  if (!blocks || blocks.length === 0) return [];

  const segments: StreamSegment[] = [];
  let stepBuf: StreamBlock[] = [];
  let textBuf = '';
  let textStartId: number | null = null;

  // The gate block lives outside any single step run, so resolve it once over
  // the whole array and hand it to every `deriveTimeline` slice below.
  const stepOpts: DeriveTimelineOptions = {
    ...opts,
    awaitingDecision: opts.awaitingDecision ?? awaitsUserDecision(blocks),
  };

  const flushSteps = () => {
    if (stepBuf.length === 0) return;
    // Reuse deriveTimeline on the consecutive run so subagent/error
    // consolidation, arg summarisation and icons stay identical.
    const steps = deriveTimeline(stepBuf, stepOpts);
    if (steps.length > 0) {
      segments.push({ type: 'steps', id: `steps-${stepBuf[0]!.blockId}`, steps });
    }
    stepBuf = [];
  };

  const flushText = () => {
    if (!textBuf) { textStartId = null; return; }
    segments.push({ type: 'answer', id: `answer-${textStartId}`, text: textBuf });
    textBuf = '';
    textStartId = null;
  };

  for (const b of blocks) {
    if (b.type === 'text') {
      flushSteps();
      if (textStartId === null) textStartId = b.blockId;
      textBuf += b.content;
    } else if (b.type === 'widget') {
      flushSteps();
      flushText();
      // Only inline widgets are drawn in the conversation flow; full-page
      // widgets are surfaced by the page's RightPane. Closed widgets drop.
      if (b.status !== 'closed' && b.surface === 'inline') {
        segments.push({ type: 'widget', id: `widget-${b.instanceId}`, widget: b });
      }
    } else if (b.type === 'plan') {
      // PLN-01 — the plan card sits exactly where the agent produced it, so
      // the transcript reads research → questions → plan → implementation.
      flushSteps();
      flushText();
      segments.push({ type: 'plan', id: `plan-${b.planId}`, plan: b });
    } else if (b.type === 'question') {
      flushSteps();
      flushText();
      segments.push({ type: 'question', id: `question-${b.interactionId}`, question: b });
    } else {
      // thinking / tool_call / system → activity-timeline step block.
      flushText();
      stepBuf.push(b);
    }
  }
  flushSteps();
  flushText();
  return segments;
}

// ── StreamPanel convenience view ─────────────────────────────────

export interface StreamView {
  steps: TimelineStep[];
  answer: string;
  widgets: Array<Extract<StreamBlock, { type: 'widget' }>>;
  /** Blocks rendered in true temporal order (interleaved steps/answer). */
  segments: StreamSegment[];
}

/** One-call derivation of the StreamPanel inputs from raw stream blocks.
 *  `opts.active` should be true while the stream/turn is still running
 *  (it affects sub-agent step status). */
export function deriveStreamView(
  blocks: StreamBlock[] | undefined,
  opts: DeriveTimelineOptions = { active: false },
): StreamView {
  return {
    steps: deriveTimeline(blocks, opts),
    answer: deriveAnswer(blocks),
    widgets: widgetBlocks(blocks),
    segments: deriveSegments(blocks, opts),
  };
}
