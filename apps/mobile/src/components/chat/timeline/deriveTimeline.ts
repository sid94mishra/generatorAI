// ────────────────────────────────────────────────────────────────
// deriveTimeline — stream blocks → transcript rows.
//
// The mobile port of web's `deriveTimeline` + `groupSteps`, folded into one
// pass because a phone renders the answer text and the activity rows in ONE
// list (there is no separate timeline column), so the output is already the
// final row order.
//
// Rules (Appendix D of the standalone-client plan):
//   • thinking / text blocks are rows of their own;
//   • tool calls become steps; consecutive steps of one FAMILY (read, search,
//     edit, shell, …) fold into a grouped row once there are two or more;
//   • a step whose `parentCallId` names an earlier `Agent` call nests under
//     it — the agent row shows "Agent: <name> (n steps)";
//   • a failed call (`error`, or an `{ ok: false }` envelope) is `failed`
//     with the message it carried; a running call while a gate is open is
//     `waiting`, never a spinner; a call left unresolved after the turn
//     ended is `pending` (neutral), not running forever;
//   • `warning` system blocks keep their tone (D6); `error` ones are danger;
//   • a pending gate appends a "waiting for you" row; a cancelled turn
//     appends a "stopped" row; hook invocations and usage trail the turn.
//
// Pure — no React, no store — so the whole taxonomy is unit-testable.
// ────────────────────────────────────────────────────────────────

import type {
  StreamBlock,
  StreamHookInvocation,
  StreamUsage,
  ToolCallBlock,
  ToolFileOp,
} from '@generatorai/client-core';

import { isShellTool, rowFromToolCall, type AgentConsoleRow } from '../../../terminal/agentConsoleRows';
import { asScmResultBlock, type ScmResultBlock } from './scmResultBlock';
import { toolKind, toolLabel, toolSummary, type ToolKind } from '../toolPresentation';

export type StepStatus = 'running' | 'done' | 'failed' | 'waiting' | 'pending';

/**
 * Grouping family. `create` folds into `edit` (an agent that writes three
 * files and edits two made five changes, not two runs), `task`/`agent` never
 * fold because they are containers, and `think` never reaches here.
 */
export type ToolFamily = 'read' | 'search' | 'edit' | 'delete' | 'shell' | 'web' | 'agent' | 'other';

export interface ScreenshotRef {
  /** Workspace-relative path of the PNG the tool wrote. */
  relativePath: string;
  label: string;
}

export interface ToolStep {
  id: string;
  callId: string;
  block: ToolCallBlock;
  tool: string;
  /** Humanised verb — "Read file", "Run command", an MCP tool's short name. */
  label: string;
  family: ToolFamily;
  kind: ToolKind;
  /** The one argument that matters: a path, a command, a query. */
  target: string;
  /** "+12 −3" for file ops; "lines 10–40" for ranged reads. */
  meta: string | null;
  status: StepStatus;
  fileOp?: ToolFileOp;
  shell?: AgentConsoleRow;
  image?: ScreenshotRef;
  /** Set when `status === 'failed'` and the result said why. */
  errorMessage?: string;
  /** SDK subagent nesting: children of an `Agent` call. */
  children?: ToolStep[];
  /** Display name of the subagent, for `Agent` calls. */
  agentName?: string;
}

export interface StepGroup {
  id: string;
  family: ToolFamily;
  steps: ToolStep[];
  label: string;
  summary: string;
  status: StepStatus;
  failed: number;
  fileOps?: { files: number; additions: number; deletions: number };
}

export type SystemTone = 'neutral' | 'info' | 'warning' | 'danger';

export type TimelineRow =
  | { kind: 'thinking'; id: string; block: Extract<StreamBlock, { type: 'thinking' }>; live: boolean }
  | { kind: 'text'; id: string; block: Extract<StreamBlock, { type: 'text' }>; live: boolean }
  | { kind: 'tool'; id: string; step: ToolStep }
  | { kind: 'group'; id: string; group: StepGroup }
  | { kind: 'system'; id: string; block: Extract<StreamBlock, { type: 'system' }>; tone: SystemTone }
  | { kind: 'widget'; id: string; block: Extract<StreamBlock, { type: 'widget' }> }
  | { kind: 'waiting'; id: string; gate: 'permission' | 'question' | 'plan' }
  | { kind: 'stopped'; id: string }
  | { kind: 'hook'; id: string; hook: StreamHookInvocation }
  | { kind: 'usage'; id: string; usage: StreamUsage }
  // Emitted by `chat.scm.result` (agent-native commits); see `scmResultBlock.ts`.
  | { kind: 'scm_result'; id: string; block: ScmResultBlock };

export interface DeriveTimelineOptions {
  /** True while the turn is live — decides whether an open call spins. */
  active: boolean;
  /** Computed from the blocks when omitted. */
  awaitingDecision?: boolean;
  /** Prefix for row ids, so history turns and the live turn never collide. */
  idPrefix?: string;
  hooks?: readonly StreamHookInvocation[];
  usage?: StreamUsage | null;
  /** The turn was cancelled by the user (live: `cancelRequested`; history: `metadata.partial`). */
  stopped?: boolean;
}

/** Runs shorter than this render as plain rows. */
export const MIN_GROUP = 2;

const GROUPABLE: ReadonlySet<ToolFamily> = new Set<ToolFamily>(['read', 'search', 'edit', 'shell', 'web', 'other']);

/** Tools that are the harness's subagent launcher. */
const AGENT_TOOL = /^(agent|task|subagent|spawn_agent|run_agent|dispatch_agent)$/i;

export function isAgentTool(tool: string): boolean {
  return AGENT_TOOL.test(humanizeToolName(tool));
}

/** `mcp__server__tool` → `tool`. */
export function humanizeToolName(tool: string): string {
  if (tool.startsWith('mcp__')) {
    const parts = tool.split('__');
    return parts[parts.length - 1] || tool;
  }
  return tool;
}

export function toolFamily(tool: string): ToolFamily {
  if (isAgentTool(tool)) return 'agent';
  if (isShellTool(tool)) return 'shell';
  const kind = toolKind(humanizeToolName(tool));
  switch (kind) {
    case 'read':
      return 'read';
    case 'search':
      return 'search';
    case 'edit':
    case 'create':
      return 'edit';
    case 'delete':
      return 'delete';
    case 'shell':
      return 'shell';
    case 'web':
      return 'web';
    case 'task':
      return 'agent';
    default:
      return 'other';
  }
}

/** The tool result as an object when it is one (or a JSON string of one). */
function resultObject(result: unknown): Record<string, unknown> | null {
  if (result && typeof result === 'object' && !Array.isArray(result)) return result as Record<string, unknown>;
  if (typeof result === 'string') {
    const s = result.trim();
    if (s.length > 20_000 || !s.startsWith('{')) return null;
    try {
      const parsed: unknown = JSON.parse(s);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Did a completed call fail? The provider's `is_error` flag (`block.error`)
 * is authoritative; the in-process browser tools answer with an
 * `{ ok: false, error }` envelope instead, so that shape counts too.
 */
export function toolCallFailed(block: ToolCallBlock): boolean {
  if (block.error) return true;
  const env = resultObject(block.result);
  return !!env && env['ok'] === false && typeof env['error'] === 'string';
}

/** The first line of whatever the failed call said, for the row. */
export function toolErrorMessage(block: ToolCallBlock): string | undefined {
  const env = resultObject(block.result);
  const fromEnv = env?.['error'] ?? env?.['message'];
  const raw =
    typeof fromEnv === 'string'
      ? fromEnv
      : typeof block.result === 'string'
        ? block.result
        : Array.isArray(env?.['content'])
          ? (env!['content'] as Array<{ text?: unknown }>).map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n')
          : '';
  const line = raw.trim().split('\n').find((l) => l.trim().length > 0) ?? '';
  if (!line) return undefined;
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

/** A screenshot the agent took — `screenshot_page` and friends answer with the artifact path. */
export function screenshotOf(result: unknown): ScreenshotRef | undefined {
  const env = resultObject(result);
  if (!env || env['ok'] === false) return undefined;
  const p = env['artifactPath'];
  if (typeof p !== 'string' || !/\.(png|jpe?g|webp)$/i.test(p)) return undefined;
  if (env['artifactType'] != null && env['artifactType'] !== 'browser_screenshot') return undefined;
  const base = p.split(/[\\/]/).pop() ?? p;
  return { relativePath: p, label: base };
}

/** A name for an `Agent` call: its description, type, or the prompt's first line. */
export function agentNameOf(args: unknown): string {
  if (!args || typeof args !== 'object') return 'Sub-agent';
  const a = args as Record<string, unknown>;
  for (const key of ['description', 'name', 'subagent_type', 'agent', 'prompt', 'task']) {
    const v = a[key];
    if (typeof v === 'string' && v.trim()) {
      const line = v.trim().split('\n')[0]!.trim();
      return line.length > 48 ? `${line.slice(0, 47)}…` : line;
    }
  }
  return 'Sub-agent';
}

function metaOf(args: unknown, fileOp: ToolFileOp | undefined): string | null {
  if (fileOp) return `+${fileOp.additions} −${fileOp.deletions}`;
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  if (typeof a['startLine'] === 'number' && typeof a['endLine'] === 'number') {
    return `lines ${a['startLine']}–${a['endLine']}`;
  }
  if (typeof a['offset'] === 'number' && typeof a['limit'] === 'number') {
    return `lines ${a['offset']}–${a['offset'] + a['limit']}`;
  }
  return null;
}

/** Is the turn parked on the human rather than the model? */
export function awaitsUserDecision(blocks: readonly StreamBlock[] | undefined): 'permission' | 'question' | 'plan' | null {
  if (!blocks) return null;
  // Most urgent first: a permission prompt stops the agent mid-call.
  if (blocks.some((b) => b.type === 'permission' && b.status === 'pending')) return 'permission';
  if (blocks.some((b) => b.type === 'question' && b.status === 'pending')) return 'question';
  if (blocks.some((b) => b.type === 'plan' && b.status === 'awaiting_review')) return 'plan';
  return null;
}

// ── Step cache ───────────────────────────────────────────────────
//
// Blocks are immutable (the reducer replaces a block to change it), so a
// block's identity plus the turn-level status is everything a step depends
// on — except its children, which stream in after the parent. A step whose
// anchor, status and children are unchanged IS the previous step, which is
// what lets a memoised row bail out during a live turn.

interface StepCacheEntry {
  status: StepStatus;
  step: ToolStep;
}

const stepCache = new WeakMap<ToolCallBlock, StepCacheEntry>();

function sameChildren(a: readonly ToolStep[] | undefined, b: readonly ToolStep[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return (a?.length ?? 0) === (b?.length ?? 0);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function internStep(fresh: ToolStep): ToolStep {
  const cached = stepCache.get(fresh.block);
  if (cached && cached.status === fresh.status && sameChildren(cached.step.children, fresh.children)) {
    return cached.step;
  }
  stepCache.set(fresh.block, { status: fresh.status, step: fresh });
  return fresh;
}

function buildStep(block: ToolCallBlock, idPrefix: string, status: StepStatus): ToolStep {
  const family = toolFamily(block.tool);
  const shortName = humanizeToolName(block.tool);
  const fileOp = block.fileOp;
  const summary = toolSummary(block.args);
  const step: ToolStep = {
    id: `${idPrefix}tool-${block.blockId}`,
    callId: block.callId,
    block,
    tool: block.tool,
    label: family === 'agent' ? 'Agent' : family === 'other' && block.tool.startsWith('mcp__') ? shortName : toolLabel(shortName),
    family,
    kind: toolKind(shortName),
    target: summary ?? '',
    meta: metaOf(block.args, fileOp),
    status,
  };
  if (fileOp) step.fileOp = fileOp;
  if (family === 'shell') step.shell = rowFromToolCall(block);
  if (family === 'agent') step.agentName = agentNameOf(block.args);
  if (block.status === 'complete') {
    const image = screenshotOf(block.result);
    if (image) step.image = image;
  }
  if (status === 'failed') {
    const message = toolErrorMessage(block);
    if (message) step.errorMessage = message;
  }
  return step;
}

// ── Grouping ─────────────────────────────────────────────────────

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const LABELS: Record<ToolFamily, { many: (n: number) => string; live: string }> = {
  read: { many: (n) => `Read ${plural(n, 'file')}`, live: 'Reading files' },
  search: { many: (n) => `Searched ${plural(n, 'time')}`, live: 'Searching' },
  edit: { many: (n) => `Edited ${plural(n, 'file')}`, live: 'Editing files' },
  delete: { many: (n) => `Deleted ${plural(n, 'file')}`, live: 'Deleting files' },
  shell: { many: (n) => `Ran ${plural(n, 'command')}`, live: 'Running commands' },
  web: { many: (n) => `Fetched ${plural(n, 'page')}`, live: 'Fetching' },
  agent: { many: (n) => plural(n, 'sub-agent'), live: 'Sub-agents running' },
  other: { many: (n) => plural(n, 'tool call'), live: 'Calling tools' },
};

export function groupStatus(steps: readonly ToolStep[]): StepStatus {
  if (steps.some((s) => s.status === 'running')) return 'running';
  if (steps.some((s) => s.status === 'waiting')) return 'waiting';
  if (steps.some((s) => s.status === 'pending')) return 'pending';
  if (steps.some((s) => s.status === 'failed')) return 'failed';
  return 'done';
}

function countTargets(steps: readonly ToolStep[]): number {
  const s = new Set<string>();
  for (const st of steps) if (st.target.trim()) s.add(st.target.trim());
  return s.size;
}

/** Distinct targets, newest first, capped so the sub-line stays one line. */
function summarize(steps: readonly ToolStep[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const t = basename(steps[i]!.target.trim());
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 3) break;
  }
  const rest = countTargets(steps) - out.length;
  return rest > 0 ? `${out.join(', ')} +${rest} more` : out.join(', ');
}

function basename(target: string): string {
  if (!target || /\s/.test(target) || /^[a-z]+:\/\//i.test(target)) return target;
  const parts = target.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? target;
}

function buildGroup(steps: ToolStep[], idPrefix: string): StepGroup {
  const family = steps[0]!.family;
  const status = groupStatus(steps);
  const failed = steps.filter((s) => s.status === 'failed').length;
  const labels = LABELS[family];
  const distinct = family === 'read' || family === 'edit' ? countTargets(steps) || steps.length : steps.length;
  // A run of one MCP tool is named after that tool ("navigate_page ×3").
  const sameVerb =
    family === 'other' && steps.every((s) => s.label === steps[0]!.label) ? steps[0]!.label : null;
  const label =
    status === 'running'
      ? sameVerb
        ? `${sameVerb} · running (${steps.length})`
        : `${labels.live} (${steps.length})`
      : sameVerb
        ? `${sameVerb} ×${steps.length}`
        : labels.many(distinct);
  let fileOps: StepGroup['fileOps'];
  if (family === 'edit') {
    const files = new Set<string>();
    let additions = 0;
    let deletions = 0;
    for (const s of steps) {
      if (!s.fileOp) continue;
      files.add(s.fileOp.filePath);
      additions += s.fileOp.additions;
      deletions += s.fileOp.deletions;
    }
    if (files.size > 0) fileOps = { files: files.size, additions, deletions };
  }
  return {
    id: `${idPrefix}group-${steps[0]!.id}`,
    family,
    steps,
    label,
    summary: summarize(steps),
    status,
    failed,
    ...(fileOps ? { fileOps } : {}),
  };
}

// ── Derivation ───────────────────────────────────────────────────

export function deriveTimeline(
  blocks: readonly StreamBlock[] | undefined,
  opts: DeriveTimelineOptions = { active: false },
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const prefix = opts.idPrefix ?? '';
  const gate = opts.awaitingDecision === undefined ? awaitsUserDecision(blocks) : opts.awaitingDecision ? 'permission' : null;
  const awaiting = gate !== null;

  /** Consecutive top-level steps not yet emitted. */
  let run: ToolStep[] = [];
  const flushRun = (): void => {
    if (run.length === 0) return;
    if (run.length >= MIN_GROUP) {
      const group = buildGroup(run, prefix);
      rows.push({ kind: 'group', id: group.id, group });
    } else {
      for (const step of run) rows.push({ kind: 'tool', id: step.id, step });
    }
    run = [];
  };

  const stepByCallId = new Map<string, ToolStep>();
  /** Fresh (un-interned) steps that still need their children settled. */
  const pendingParents: ToolStep[] = [];

  const list = blocks ?? [];
  const lastIndex = list.length - 1;

  for (let i = 0; i < list.length; i += 1) {
    const b = list[i]!;
    // Shape-checked rather than switched on: the block reaches mobile from
    // client-core's reducer and must render even before the union names it.
    const scm = asScmResultBlock(b);
    if (scm) {
      flushRun();
      rows.push({ kind: 'scm_result', id: `${prefix}scm-${scm.blockId}`, block: scm });
      continue;
    }
    switch (b.type) {
      case 'thinking': {
        if (!b.text.trim()) break;
        flushRun();
        const live = opts.active && !b.isComplete;
        rows.push({ kind: 'thinking', id: `${prefix}think-${b.blockId}`, block: b, live });
        break;
      }
      case 'text': {
        if (!b.content) break;
        flushRun();
        rows.push({ kind: 'text', id: `${prefix}text-${b.blockId}`, block: b, live: opts.active && i === lastIndex });
        break;
      }
      case 'tool_call': {
        const status: StepStatus =
          b.status === 'complete'
            ? toolCallFailed(b)
              ? 'failed'
              : 'done'
            : awaiting
              ? 'waiting'
              : opts.active
                ? 'running'
                : 'pending';
        const step = buildStep(b, prefix, status);
        stepByCallId.set(b.callId, step);
        const parent = b.parentCallId ? stepByCallId.get(b.parentCallId) : undefined;
        if (parent) {
          (parent.children ??= []).push(step);
          break;
        }
        if (step.family === 'agent') {
          flushRun();
          pendingParents.push(step);
          rows.push({ kind: 'tool', id: step.id, step });
          break;
        }
        if (!GROUPABLE.has(step.family)) {
          flushRun();
          rows.push({ kind: 'tool', id: step.id, step });
          break;
        }
        if (run.length > 0 && run[0]!.family !== step.family) flushRun();
        run.push(step);
        break;
      }
      case 'system': {
        flushRun();
        const tone: SystemTone =
          b.category === 'error'
            ? 'danger'
            : b.category === 'warning'
              ? 'warning'
              : b.category === 'subagent'
                ? 'info'
                : 'neutral';
        rows.push({ kind: 'system', id: `${prefix}sys-${b.blockId}`, block: b, tone });
        break;
      }
      case 'widget': {
        flushRun();
        if (b.status !== 'closed') rows.push({ kind: 'widget', id: `${prefix}widget-${b.instanceId}`, block: b });
        break;
      }
      case 'plan':
      case 'question':
      case 'permission':
        // Decisions are pinned cards above the composer, not rows.
        break;
    }
  }
  flushRun();

  // Intern every step post-order (children before parents) so a memoised
  // row can never miss a new child, then re-point rows/groups at the interned
  // objects.
  const intern = (step: ToolStep): ToolStep => {
    if (step.children) step.children = step.children.map(intern);
    return internStep(step);
  };
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (row.kind === 'tool') {
      const step = intern(row.step);
      if (step !== row.step) rows[i] = { kind: 'tool', id: row.id, step };
    } else if (row.kind === 'group') {
      row.group.steps = row.group.steps.map(intern);
    }
  }

  if (awaiting && gate) rows.push({ kind: 'waiting', id: `${prefix}waiting`, gate });
  if (opts.stopped) rows.push({ kind: 'stopped', id: `${prefix}stopped` });
  for (const hook of opts.hooks ?? []) rows.push({ kind: 'hook', id: `${prefix}hook-${hook.id}`, hook });
  if (opts.usage) rows.push({ kind: 'usage', id: `${prefix}usage`, usage: opts.usage });
  return rows;
}

/**
 * Two rows render identically? Used by the row component's `React.memo`
 * comparator: a derivation builds fresh row objects every time, but the
 * blocks and (interned) steps they wrap do not change unless the content
 * did, so this is what makes a settled row skip a render during a live turn.
 */
export function rowsEqual(a: TimelineRow, b: TimelineRow): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind || a.id !== b.id) return false;
  switch (a.kind) {
    case 'thinking':
    case 'text':
      return a.block === (b as typeof a).block && a.live === (b as typeof a).live;
    case 'tool':
      return a.step === (b as typeof a).step;
    case 'group': {
      const g = (b as typeof a).group;
      if (a.group.status !== g.status || a.group.steps.length !== g.steps.length) return false;
      for (let i = 0; i < g.steps.length; i += 1) if (a.group.steps[i] !== g.steps[i]) return false;
      return true;
    }
    case 'system':
    case 'widget':
      return a.block === (b as typeof a).block;
    case 'waiting':
      return a.gate === (b as typeof a).gate;
    case 'stopped':
      return true;
    case 'hook':
      return a.hook === (b as typeof a).hook;
    case 'usage':
      return a.usage === (b as typeof a).usage;
    case 'scm_result':
      return a.block === (b as typeof a).block;
    default:
      return false;
  }
}

/** Count every step, nested ones included — for "Agent: x (n steps)". */
export function countSteps(steps: readonly ToolStep[] | undefined): number {
  if (!steps) return 0;
  let n = 0;
  for (const s of steps) n += 1 + countSteps(s.children);
  return n;
}

/**
 * A structural signature of a stream's blocks: changes when a block is
 * added, settles or fails, but NOT when text streams into a live block. The
 * chat screen re-derives rows on this rather than on the blocks array, so a
 * token landing re-renders exactly one row (the live one, which subscribes
 * to its own block) and nothing above it.
 */
export function blocksSignature(blocks: readonly StreamBlock[] | undefined): string {
  if (!blocks || blocks.length === 0) return '';
  let out = '';
  for (const b of blocks) {
    const scm = asScmResultBlock(b);
    if (scm) {
      out += `g${scm.blockId}${scm.result.status}|`;
      continue;
    }
    switch (b.type) {
      case 'thinking':
        out += `t${b.blockId}${b.isComplete ? 'c' : 'l'}${b.text ? '' : 'e'}|`;
        break;
      case 'text':
        out += `x${b.blockId}${b.content ? '' : 'e'}|`;
        break;
      case 'tool_call':
        out += `c${b.blockId}${b.status === 'complete' ? (b.error ? 'f' : 'd') : 'r'}${b.fileOp ? 'o' : ''}${b.result === undefined ? '' : 'R'}|`;
        break;
      case 'system':
        out += `s${b.blockId}|`;
        break;
      case 'widget':
        out += `w${b.blockId}${b.status}|`;
        break;
      case 'plan':
        out += `p${b.blockId}${b.status}|`;
        break;
      case 'question':
      case 'permission':
        out += `q${b.blockId}${b.status}|`;
        break;
    }
  }
  return out;
}

/** Cache-miss hint (web's UsageChip rule, minus the persisted ledger). */
export function cacheMissHint(usage: StreamUsage, previous: StreamUsage | null | undefined): string | null {
  const read = usage.cacheReadTokens ?? 0;
  const write = usage.cacheWriteTokens ?? 0;
  if (read > 0) return null;
  // Only a scope that has proven it caches can miss.
  const proven = (previous?.cacheReadTokens ?? 0) > 0 || (previous?.cacheWriteTokens ?? 0) > 0;
  if (!proven) return null;
  const prompt = usage.inputTokens + write;
  if (prompt < 1_000) return null;
  return `Prompt cache was cold this turn — ${compactTokens(prompt)} input tokens billed at the full rate.`;
}

export function compactTokens(n: number | undefined): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
