// ────────────────────────────────────────────────────────────────
// workflowRuns — the chat ↔ run bridge, seen from a client (P06 WP-6.2).
//
// A chat whose agent calls `run_workflow` gets a RUN CARD: status, the stage
// running now, n of m stages done, a link to the run page, and — once the
// run finalizes — its summary and pull request. Its truth is the REST list
// (`GET /chats/:id/workflow-runs`, which survives a reload); the four
// `chat.workflow_run.*` session events move it live in between refetches.
// `foldWorkflowRunEvent` is that live half, pure, so web and mobile patch
// their query caches with one implementation.
//
// The card sits where the agent started the run: under its `run_workflow`
// tool call. `workflowToolCard` reads that call's result (an object, its
// JSON text, or MCP text content — whatever the provider handed back), and
// likewise the `create_workflow_draft` result the DRAFT card is drawn from.
//
// Platform-free: no React, no store.
// ────────────────────────────────────────────────────────────────

import type { ChatWorkflowRunCard } from '@generatorai/workflow-spec';

/** A card as a client holds it: the REST card plus what only the finalize event carries. */
export interface WorkflowRunCardView extends ChatWorkflowRunCard {
  /** The last stage's summary (or the run's error), from `chat.workflow_run.finalized`. */
  summary?: string;
  /** The pull request post-processing opened, from `chat.workflow_run.finalized`. */
  prUrl?: string;
}

export type WorkflowRunPendingApproval = ChatWorkflowRunCard['pendingApprovals'][number];

/** The four session events, as the router hands them to a host. */
export interface WorkflowRunCardEvent {
  kind:
    | 'chat.workflow_run.linked'
    | 'chat.workflow_run.progress'
    | 'chat.workflow_run.awaiting_approval'
    | 'chat.workflow_run.finalized';
  data: Record<string, unknown>;
}

export const WORKFLOW_RUN_CARD_EVENTS: ReadonlySet<string> = new Set([
  'chat.workflow_run.linked',
  'chat.workflow_run.progress',
  'chat.workflow_run.awaiting_approval',
  'chat.workflow_run.finalized',
]);

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL.has(status);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Fold one event into a chat's cards. Returns the ORIGINAL array when the
 * event changes nothing (or names a run the list does not hold and cannot
 * create — only `linked` creates a card).
 *
 * A terminal status is never walked back: a late throttled progress event
 * must not turn a finished run's card back to "running".
 */
export function foldWorkflowRunEvent(
  cards: readonly WorkflowRunCardView[] | undefined,
  event: WorkflowRunCardEvent,
): WorkflowRunCardView[] {
  const list = (cards ?? []) as WorkflowRunCardView[];
  const d = event.data;
  const runId = str(d['runId']);
  if (!runId) return list;
  const index = list.findIndex((c) => c.runId === runId);
  const prior = index === -1 ? undefined : list[index]!;

  let next: WorkflowRunCardView | undefined;
  switch (event.kind) {
    case 'chat.workflow_run.linked': {
      const base: WorkflowRunCardView = prior ?? {
        runId,
        workflowId: str(d['workflowId']) ?? '',
        workflowName: str(d['workflowName']) ?? 'Workflow run',
        toolCallId: str(d['toolCallId']) ?? null,
        status: str(d['status']) ?? 'starting',
        stagesDone: 0,
        stagesTotal: 0,
        pendingApprovals: [],
        link: str(d['link']) ?? '',
        createdAt: new Date().toISOString(),
      };
      next = {
        ...base,
        ...(str(d['workflowId']) ? { workflowId: str(d['workflowId'])! } : {}),
        ...(str(d['workflowName']) ? { workflowName: str(d['workflowName'])! } : {}),
        ...(str(d['toolCallId']) ? { toolCallId: str(d['toolCallId'])! } : {}),
        ...(str(d['link']) ? { link: str(d['link'])! } : {}),
        status: settle(base.status, str(d['status'])),
      };
      break;
    }
    case 'chat.workflow_run.progress': {
      if (!prior) return list;
      const status = settle(prior.status, str(d['status']));
      next = {
        ...prior,
        status,
        ...(str(d['currentStage']) ? { currentStage: str(d['currentStage'])! } : {}),
        stagesDone: num(d['stagesDone']) ?? prior.stagesDone,
        stagesTotal: num(d['stagesTotal']) ?? prior.stagesTotal,
        // A finished run has nothing left to answer.
        ...(isTerminalRunStatus(status) ? { pendingApprovals: [] } : {}),
      };
      break;
    }
    case 'chat.workflow_run.awaiting_approval': {
      if (!prior) return list;
      const instanceId = str(d['instanceId']);
      if (!instanceId || isTerminalRunStatus(prior.status)) return list;
      const approval: WorkflowRunPendingApproval = {
        instanceId,
        stageKey: str(d['stageKey']) ?? '',
        stageName: str(d['stageName']) ?? str(d['stageKey']) ?? 'Stage',
        decision: str(d['decision']) ?? 'stage_completion_review',
        answerableByAgent: d['answerableByAgent'] === true,
      };
      next = {
        ...prior,
        pendingApprovals: [...prior.pendingApprovals.filter((p) => p.instanceId !== instanceId), approval],
      };
      break;
    }
    case 'chat.workflow_run.finalized': {
      if (!prior) return list;
      next = {
        ...prior,
        status: str(d['status']) ?? prior.status,
        pendingApprovals: [],
        ...(str(d['summary']) ? { summary: str(d['summary'])! } : {}),
        ...(str(d['prUrl']) ? { prUrl: str(d['prUrl'])! } : {}),
        ...(str(d['link']) ? { link: str(d['link'])! } : {}),
      };
      break;
    }
  }
  if (!next) return list;
  if (index === -1) return [...list, next];
  const out = list.slice();
  out[index] = next;
  return out;
}

/** A terminal status stays; anything else takes the newer value. */
function settle(prior: string, incoming: string | undefined): string {
  if (!incoming) return prior;
  if (isTerminalRunStatus(prior) && !isTerminalRunStatus(incoming)) return prior;
  return incoming;
}

/**
 * A fresh REST list over the cached one: the server is the truth, except for
 * what only the finalize event carried (the summary and the PR), which the
 * REST card does not repeat.
 */
export function mergeWorkflowRunCards(
  fresh: readonly ChatWorkflowRunCard[],
  prior: readonly WorkflowRunCardView[] | undefined,
): WorkflowRunCardView[] {
  if (!prior?.length) return fresh as WorkflowRunCardView[];
  const byId = new Map(prior.map((c) => [c.runId, c]));
  return fresh.map((card) => {
    const old = byId.get(card.runId) as WorkflowRunCardView | undefined;
    const f = card as WorkflowRunCardView;
    if (!old || (f.summary && f.prUrl)) return f;
    return {
      ...f,
      ...(!f.summary && old.summary ? { summary: old.summary } : {}),
      ...(!f.prUrl && old.prUrl ? { prUrl: old.prUrl } : {}),
    };
  });
}

// ── Tool results ─────────────────────────────────────────────────

/** `run_workflow` as a chat saw it return. */
export interface WorkflowRunToolCard {
  kind: 'run';
  runId: string;
  workflowName?: string;
  status?: string;
  link?: string;
  /** The call was a replay of an earlier one (same run). */
  replayed?: boolean;
}

/** `create_workflow_draft` as a chat saw it return. */
export interface WorkflowDraftToolCard {
  kind: 'draft';
  workflowId: string;
  name: string;
  reviewLink?: string;
  warnings: string[];
}

export type WorkflowToolCard = WorkflowRunToolCard | WorkflowDraftToolCard;

/**
 * The bare tool name: `mcp__generatorai-tools__run_workflow` (claude-agent's
 * in-process MCP server) and any `server.tool` / `server/tool` spelling all
 * come down to `run_workflow`.
 */
export function bareToolName(tool: string): string {
  const parts = tool.split(/__|[./:]/);
  return parts[parts.length - 1] || tool;
}

/** The result as an object: itself, its JSON text, or the JSON in MCP text content. */
export function toolResultObject(result: unknown): Record<string, unknown> | null {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj['content']) && !('runId' in obj) && !('workflowId' in obj)) {
      return toolResultObject(obj['content']);
    }
    return obj;
  }
  if (Array.isArray(result)) {
    const text = result
      .map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
      .join('');
    return text ? toolResultObject(text) : null;
  }
  if (typeof result === 'string') {
    const s = result.trim();
    if (!s.startsWith('{')) return null;
    try {
      const parsed: unknown = JSON.parse(s);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return truncatedFields(s);
    }
  }
  return null;
}

/** A result persisted truncated is no longer JSON; its leading id fields usually survive. */
function truncatedFields(s: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const key of ['runId', 'workflowId', 'name', 'status', 'link', 'reviewLink']) {
    const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(s);
    if (m) out[key] = m[1];
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The card a completed workflow tool call earns, or null: not a workflow
 * tool, not finished, refused (`{ok: false}`), or no id in the result.
 */
export function workflowToolCard(tool: string, result: unknown, failed = false): WorkflowToolCard | null {
  const name = bareToolName(tool);
  if (name !== 'run_workflow' && name !== 'create_workflow_draft') return null;
  if (failed || result === undefined || result === null) return null;
  const obj = toolResultObject(result);
  if (!obj || obj['ok'] === false) return null;
  if (name === 'run_workflow') {
    const runId = str(obj['runId']);
    if (!runId) return null;
    const plan = obj['plan'] && typeof obj['plan'] === 'object' ? (obj['plan'] as Record<string, unknown>) : undefined;
    const workflowName = str(plan?.['workflowName']) ?? str(obj['workflowName']);
    return {
      kind: 'run',
      runId,
      ...(workflowName ? { workflowName } : {}),
      ...(str(obj['status']) ? { status: str(obj['status'])! } : {}),
      ...(str(obj['link']) ? { link: str(obj['link'])! } : {}),
      ...(obj['replayed'] === true ? { replayed: true } : {}),
    };
  }
  const workflowId = str(obj['workflowId']);
  if (!workflowId) return null;
  const warnings = Array.isArray(obj['warnings'])
    ? obj['warnings']
        .map((w) => (typeof w === 'string' ? w : w && typeof w === 'object' ? str((w as { message?: unknown }).message) : undefined))
        .filter((w): w is string => !!w)
    : [];
  return {
    kind: 'draft',
    workflowId,
    name: str(obj['name']) ?? 'Workflow draft',
    ...(str(obj['reviewLink']) ? { reviewLink: str(obj['reviewLink'])! } : {}),
    warnings,
  };
}

/** A link the server built with its own origin, as an in-app path (`/workflows/…`). */
export function appPath(link: string | undefined): string | undefined {
  if (!link) return undefined;
  if (link.startsWith('/')) return link;
  try {
    const u = new URL(link);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return undefined;
  }
}

/** "Completion review", "Tool permission", … for a decision kind. */
export function decisionLabel(decision: string): string {
  const s = decision.replace(/^stage_/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
