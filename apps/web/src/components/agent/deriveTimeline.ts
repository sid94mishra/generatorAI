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

// ── Step identity ────────────────────────────────────────────────
//
// Review 6.4 (plan item 18): every derivation used to build brand-new step
// objects, so `StepRow`'s `React.memo` — which compares the `step` prop by
// identity — never bailed out during a live turn. On a streaming answer that
// meant every row re-rendered on every token.
//
// Stream blocks are immutable (the reducer replaces a block to change it), so
// a block object's identity already encodes everything a step is derived from
// except the two turn-level inputs (`opts.active`, `awaitingDecision`), which
// fold into a small `key`. A step whose anchor block, key and children are all
// identical to the last derivation IS the last derivation's step.
//
// Interning runs post-order at the end of `deriveTimeline` (children before
// parents) because a subagent's children stream in after the parent step was
// created; a parent is only reused when its children array is element-wise
// identical, so a memoised row can never miss a new child.
//
// Keyed by the block object in a WeakMap so it costs nothing to evict: when a
// stream is cleared its blocks are unreachable and the entries go with them.
// A few variants per anchor are kept because `deriveStreamView` derives the
// same blocks twice per frame (the full list, then per-segment slices) and
// the subagent composite's key legitimately differs between the two.

interface StepCacheEntry {
  key: string;
  step: TimelineStep;
}

const STEP_VARIANTS_PER_ANCHOR = 4;
const stepCache = new WeakMap<object, StepCacheEntry[]>();

/** Side table from a freshly built step to the block it was derived from. */
type StepAnchors = Map<TimelineStep, { anchor: object; key: string }>;

function sameChildren(a: readonly TimelineStep[] | undefined, b: readonly TimelineStep[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function internStep(fresh: TimelineStep, anchors: StepAnchors): TimelineStep {
  if (fresh.children) {
    fresh.children = fresh.children.map((c) => internStep(c, anchors));
  }
  const ref = anchors.get(fresh);
  if (!ref) return fresh;
  const variants = stepCache.get(ref.anchor);
  if (variants) {
    for (const v of variants) {
      if (v.key === ref.key && sameChildren(v.step.children, fresh.children)) return v.step;
    }
  }
  const next: StepCacheEntry[] = [{ key: ref.key, step: fresh }];
  if (variants) {
    for (const v of variants) {
      if (v.key !== ref.key && next.length < STEP_VARIANTS_PER_ANCHOR) next.push(v);
    }
  }
  stepCache.set(ref.anchor, next);
  return fresh;
}

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
/**
 * Display name for a tool.
 *
 * MCP tools arrive as `mcp__<server>__<tool>`; rendering that raw produced
 * rows like "mcp__generatorai-tools__click_element mcp__generatorai-tools__click_element"
 * (the same string as verb AND fallback target). The last segment is what the
 * user recognises; the server name is still visible in the expanded args.
 */
export function humanizeToolName(tool: string): string {
  if (tool.startsWith('mcp__')) {
    const parts = tool.split('__');
    return parts[parts.length - 1] || tool;
  }
  return tool;
}

/** The harness's built-in shell tools — the ones whose output is a real
 *  command console (and so get the "open in terminal" affordance). */
export function isShellTool(tool: string): boolean {
  return /^(bash|powershell|shell)$/i.test(tool);
}

function summarizeArgs(toolName: string, args: unknown): { target: string; meta?: string } {
  // No target beats repeating the tool name next to itself ("Write Write").
  if (args == null || typeof args !== 'object') return { target: '' };
  const a = args as Record<string, unknown>;
  // Common named args across the SDKs. Order matters: prefer specific over generic.
  let targetKey = '';
  let targetRaw = '';
  for (const key of ['file_path', 'filePath', 'path', 'uri', 'url', 'pattern', 'query', 'command', 'description'] as const) {
    const v = a[key];
    if (typeof v === 'string' && v.trim()) {
      targetKey = key;
      targetRaw = v;
      break;
    }
  }
  const target = targetRaw ? shortenTarget(targetRaw, targetKey) : '';
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
      (b.type === 'question' && b.status === 'pending') ||
      (b.type === 'permission' && b.status === 'pending'),
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
  const subagentBlocks: StreamBlock[] = [];
  for (const b of blocks) {
    if (b.type === 'system' && b.category === 'subagent') {
      subagentMessages.push(b.message);
      subagentBlockIds.push(b.blockId);
      subagentBlocks.push(b);
    }
  }

  const steps: TimelineStep[] = [];
  const anchors: StepAnchors = new Map();
  let subagentEmitted = false;
  /**
   * SDK-subagent nesting: a tool block whose `parentCallId` names an earlier
   * `Agent` call renders as that step's CHILD, not as a sibling — otherwise a
   * subagent's Read/Grep storm is indistinguishable from the main agent's own
   * activity. The parent `tool_use` always streams before its children, so a
   * single forward pass with this map suffices; a child whose parent is
   * missing (clipped replay window) falls back to the top level rather than
   * disappearing.
   */
  const stepByCallId = new Map<string, TimelineStep>();

  for (const b of blocks) {
    switch (b.type) {
      case 'thinking': {
        // Skip empty thinking (server often emits a heartbeat block).
        if (!b.text.trim()) continue;
        const settled = b.isComplete || !opts.active;
        const thinkStep: TimelineStep = {
          id: `thinking-${b.blockId}`,
          kind: 'think',
          verb: settled ? 'Thought about' : 'Thinking about',
          target: b.text.length > 60 ? `${b.text.slice(0, 60)}…` : b.text,
          mono: false,
          status: settled ? 'done' : 'running',
          detail: b.text,
        };
        anchors.set(thinkStep, { anchor: b, key: settled ? 'settled' : 'live' });
        steps.push(thinkStep);
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
        const fileOp = b.fileOp;
        const step: TimelineStep = {
          id: `tool-${b.blockId}`,
          kind,
          verb: humanizeToolName(b.tool),
          target,
          mono: true,
          status,
          // Per-op line stats trump the generic arg-derived meta: "+27 −3"
          // says more about a Write than "27 matches" ever could.
          meta: fileOp ? `+${fileOp.additions} −${fileOp.deletions}` : meta,
          detail,
          callId: b.callId,
          ...(fileOp ? { fileOp } : {}),
          ...(isShellTool(b.tool) ? { isShell: true } : {}),
        };
        // `status` is the only derived field that can change while the block
        // object stays the same (it folds in `opts.active` / the gate state).
        anchors.set(step, { anchor: b, key: status });
        stepByCallId.set(b.callId, step);
        const parent = b.parentCallId ? stepByCallId.get(b.parentCallId) : undefined;
        if (parent) {
          (parent.children ??= []).push(step);
        } else {
          steps.push(step);
        }
        break;
      }

      case 'system': {
        if (b.category === 'subagent') {
          if (!subagentEmitted) {
            const status = subagentState(subagentMessages, opts.active);
            const children: TimelineStep[] = subagentMessages.map((m, i) => {
              const child: TimelineStep = {
                id: `sub-child-${subagentBlockIds[i] ?? i}`,
                kind: 'note',
                verb: '',
                target: m,
                mono: false,
                status: /completed/i.test(m) ? 'done' : /failed/i.test(m) ? 'failed' : /started/i.test(m) ? 'running' : 'done',
              };
              const childAnchor = subagentBlocks[i];
              if (childAnchor) anchors.set(child, { anchor: childAnchor, key: child.status });
              return child;
            });
            const subStep: TimelineStep = {
              id: `sub-${subagentBlockIds[0] ?? b.blockId}`,
              kind: 'subagent',
              verb: 'Explore',
              target: subagentTarget(subagentMessages),
              mono: false,
              status,
              children,
            };
            // The composite is derived from EVERY subagent block, so its key
            // carries the whole message list, not just the first block.
            anchors.set(subStep, {
              anchor: subagentBlocks[0] ?? b,
              key: `${status}|${subagentMessages.join(' ')}`,
            });
            steps.push(subStep);
            subagentEmitted = true;
          }
          break;
        }
        if (b.category === 'error') {
          const errStep: TimelineStep = {
            id: `err-${b.blockId}`,
            kind: 'error',
            verb: 'Error',
            target: b.message,
            mono: false,
            status: 'failed',
          };
          anchors.set(errStep, { anchor: b, key: 'failed' });
          steps.push(errStep);
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
      case 'permission':
        // PLN-01 / 5.1 — rendered as their own interactive segments, not steps.
        break;
    }
  }

  // Post-order: children are interned before the parent decides whether it
  // is unchanged. See "Step identity" above.
  for (let i = 0; i < steps.length; i += 1) steps[i] = internStep(steps[i]!, anchors);
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
  | { type: 'question'; id: string; question: Extract<StreamBlock, { type: 'question' }> }
  | { type: 'permission'; id: string; permission: Extract<StreamBlock, { type: 'permission' }> };

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
    } else if (b.type === 'permission') {
      // Review finding 5.1 — the permission card sits exactly where the
      // agent tried to run the tool, same reasoning as the plan/question
      // cards above.
      flushSteps();
      flushText();
      segments.push({ type: 'permission', id: `permission-${b.interactionId}`, permission: b });
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
