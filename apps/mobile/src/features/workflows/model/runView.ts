// The run screen's words (M8-03; MWorkflowRun; MD-25, MD-27): the run's name until runs are numbered (MG-29), the
// lifecycle strip (Setup · Stages k/n · Finalize from the engine's phase journal), the usage line against the
// budget (cost only when a provider reported it), what needs the person (completion reviews, in-turn gates,
// approval waits, parked loops — the run's own and its sub-workflow children's), each stage row's second line, and
// what post-processing did. Pure, unit-tested.
import type { PendingDecisionView, PreprocessingResult, RunSystemVars } from '@generatorai/shared';
import type { StageSpec } from '@generatorai/workflow-spec';

import { runStamp, shortDuration } from '../../../blocks/RunRow';
import { compactCount } from '../../../blocks/DecisionCard/model/reviewModel';
import { isActive } from '../../../services/api/runActivity';
import { stageGateOf } from './stageGate';
import { waitOf, type RunStage } from './runStages';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const epoch = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : v instanceof Date ? v.getTime() : NaN);

/** "Run · Oct 3, 14:07" — a run's title until the server numbers runs (MG-29). */
export function runName(run: { startedAt?: unknown; createdAt: unknown }): string {
  const at = runStamp(run.startedAt ?? run.createdAt);
  return at ? `Run · ${at}` : 'Run';
}

export type PhaseState = 'pending' | 'running' | 'done' | 'failed';

export interface LifecycleView {
  setup: PhaseState;
  /** "workspace", the phase in flight, or the failing phase. */
  setupDetail: string | null;
  done: number;
  total: number;
  finalize: PhaseState;
  finalizeDetail: string | null;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export function lifecycleView(run: { status: string; statusReason?: string | null; systemVars?: RunSystemVars | null }, stages: readonly RunStage[]): LifecycleView {
  const journal = Object.entries(run.systemVars?.lifecycle ?? {});
  const failed = (prefix: string) => journal.find(([k, v]) => k.startsWith(prefix) && v.status === 'failed')?.[0].split('/')[1] ?? null;
  const top = stages.filter((s) => !s.scopeId);
  const started = top.some((s) => s.status !== 'pending' && s.status !== 'ready');
  const reason = run.statusReason ?? '';
  let setup: PhaseState;
  let setupDetail: string | null = null;
  const setupFail = failed('prepare/');
  if (setupFail) {
    setup = 'failed';
    setupDetail = setupFail;
  } else if (reason.startsWith('setup:') || ((run.status === 'starting' || run.status === 'created' || run.status === 'pending') && !started)) {
    setup = run.status === 'created' || run.status === 'pending' ? 'pending' : 'running';
    setupDetail = reason.startsWith('setup:') ? reason.slice(6) : null;
  } else setup = 'done';
  const finalizeFail = failed('finalize/');
  let finalize: PhaseState;
  if (finalizeFail) finalize = 'failed';
  else if (run.status === 'finalizing') finalize = 'running';
  else if (TERMINAL.has(run.status)) finalize = 'done';
  else finalize = 'pending';
  const finalizeDetail = finalizeFail ?? (run.status === 'finalizing' && reason.startsWith('finalize:') ? reason.slice(9) : null);
  return { setup, setupDetail, done: top.filter((s) => s.status === 'completed' || s.status === 'skipped').length, total: top.length, finalize, finalizeDetail };
}

export interface UsageView {
  /** "118 turns · 1.4M tokens · $3.12 of $10". */
  line: string;
  /** 0..1 against the tightest budget, when the run has one. */
  fraction: number | null;
}

export function usageView(run: { usage?: Record<string, unknown> | null; budget?: Record<string, unknown> | null }): UsageView | null {
  const u = rec(run.usage);
  const b = rec(run.budget);
  const turns = num(u['turns']);
  const tokens = (num(u['inputTokens']) ?? 0) + (num(u['outputTokens']) ?? 0);
  const cost = num(u['costUsd']);
  const maxTurns = num(b['maxTurns']);
  const maxCost = num(b['maxCostUsd']);
  const maxTokens = num(b['maxTokens']);
  const parts = [
    turns !== null ? `${turns} turn${turns === 1 ? '' : 's'}${maxTurns ? ` of ${maxTurns}` : ''}` : null,
    tokens > 0 ? `${compactCount(tokens)} tokens${maxTokens ? ` of ${compactCount(maxTokens)}` : ''}` : null,
    cost !== null ? `$${cost.toFixed(2)}${maxCost ? ` of $${maxCost}` : ''}` : null,
  ].filter((x): x is string => Boolean(x));
  if (!parts.length) return null;
  const ratios = [turns !== null && maxTurns ? turns / maxTurns : null, maxTokens ? tokens / maxTokens : null, cost !== null && maxCost ? cost / maxCost : null].filter((x): x is number => x !== null);
  return { line: parts.join(' · '), fraction: ratios.length ? Math.min(1, Math.max(...ratios)) : null };
}

export type NeedsYouKind = 'review' | 'permission' | 'question' | 'plan' | 'approval_wait' | 'event_wait' | 'loop';

export interface NeedsYouItem {
  instanceId: string;
  name: string;
  kind: NeedsYouKind;
  /** "Completion review · round 1 of 3", "Tool permission · Bash", "Waiting for build.done". */
  detail: string;
  /** "via release › security" (a sub-workflow child's decision, answered through this run). */
  via?: string;
  /** The run's own stage (absent for a child's mirrored decision). */
  stage?: RunStage;
  /** Answered in the approval sheet (MB-50); the others answer in place (loop) or need nothing (event). */
  sheet: boolean;
}

const KIND_WORD: Record<NeedsYouKind, string> = {
  review: 'Completion review',
  permission: 'Tool permission',
  question: 'Question',
  plan: 'Plan review',
  approval_wait: 'Approval',
  event_wait: 'Waiting for an event',
  loop: 'Loop decision',
};

function itemFor(stage: RunStage): NeedsYouItem | null {
  const name = stage.name ?? stage.stageKey;
  if (stage.status === 'awaiting_input') {
    const gate = stageGateOf(stage.interruptData);
    const d = rec(stage.interruptData);
    switch (gate.kind) {
      case 'loop':
        return { instanceId: stage.id, name, kind: 'loop', detail: KIND_WORD.loop, stage, sheet: false };
      case 'permission':
        return { instanceId: stage.id, name, kind: 'permission', detail: `${KIND_WORD.permission} · ${gate.block.toolName}`, stage, sheet: true };
      case 'question':
        return { instanceId: stage.id, name, kind: 'question', detail: KIND_WORD.question, stage, sheet: true };
      case 'plan':
        return { instanceId: stage.id, name, kind: 'plan', detail: KIND_WORD.plan, stage, sheet: true };
      default: {
        const round = num(d['round']);
        const max = num(d['maxRounds']);
        return { instanceId: stage.id, name, kind: 'review', detail: [KIND_WORD.review, round !== null ? `round ${round}${max ? ` of ${max}` : ''}` : null].filter(Boolean).join(' · '), stage, sheet: true };
      }
    }
  }
  const wait = stage.status === 'waiting' ? waitOf(stage) : null;
  if (wait?.type === 'approval') return { instanceId: stage.id, name: wait.label ?? name, kind: 'approval_wait', detail: wait.prompt ?? KIND_WORD.approval_wait, stage, sheet: true };
  if (wait?.type === 'event') return { instanceId: stage.id, name: wait.label ?? name, kind: 'event_wait', detail: `${KIND_WORD.event_wait}${wait.eventKey ? ` · ${wait.eventKey}` : ''}`, stage, sheet: false };
  return null;
}

/** Everything the run waits on a person for, its own first, then its sub-workflow children's (P05 §4.2). */
export function needsYou(runId: string, stages: readonly RunStage[], pending: readonly PendingDecisionView[] = []): NeedsYouItem[] {
  const own = stages.map(itemFor).filter((x): x is NeedsYouItem => x !== null);
  const seen = new Set(own.map((i) => i.instanceId));
  const children = pending
    .filter((d) => d.runId !== runId && !seen.has(d.instanceId))
    .map((d): NeedsYouItem => {
      const kind: NeedsYouKind = d.kind === 'wait' ? (d.waitType === 'event' ? 'event_wait' : 'approval_wait') : d.kind === 'loop_decision' ? 'loop' : d.kind === 'tool_permission' ? 'permission' : d.kind === 'question' ? 'question' : d.kind === 'plan_review' ? 'plan' : 'review';
      return { instanceId: d.instanceId, name: d.name, kind, detail: KIND_WORD[kind], via: d.via.map((v) => v.name).join(' › '), sheet: kind !== 'event_wait' && kind !== 'loop' };
    });
  return [...own, ...children];
}

export interface StageRowView {
  /** "Security Auditor · attempt 1 of 3 · fresh". */
  line: string | null;
  /** "2m 10s" finished, the elapsed time of a live one. */
  duration: string | null;
  live: boolean;
}

export function stageRowView(stage: RunStage, spec: StageSpec | undefined, now = Date.now()): StageRowView {
  const who = spec?.kind === 'agent' ? (spec.session?.agentRef?.split(':').pop() ?? spec.session?.model ?? null) : spec?.kind === 'check' ? [spec.check.command, ...spec.check.args].join(' ') : null;
  const attempts = spec && 'retry' in spec && spec.retry ? spec.retry.maxAttempts : null;
  const attempt = stage.currentAttempt && stage.currentAttempt > 0 ? `attempt ${stage.currentAttempt}${attempts ? ` of ${attempts}` : ''}` : null;
  const reuse = spec?.kind === 'agent' && spec.sessionReuse ? spec.sessionReuse : null;
  const reason = stage.skipReason ? `skipped: ${stage.skipReason.replace(/_/g, ' ')}` : stage.status === 'failed' && stage.error ? stage.error.split('\n')[0]! : null;
  const live = isActive(stage.status);
  const start = epoch(stage.startedAt);
  const end = live ? now : epoch(stage.completedAt);
  return {
    line: [who, attempt, reuse, reason].filter(Boolean).join(' · ') || null,
    duration: Number.isNaN(start) || Number.isNaN(end) ? null : shortDuration(end - start),
    live,
  };
}

/** What post-processing did (commit, push, PR), once the run finalized. */
export function postProcessingResults(run: { systemVars?: RunSystemVars | null }): PreprocessingResult[] {
  return run.systemVars?.postProcessing ?? [];
}

/** The pull request a finished run opened, if any. */
export function pullRequestOf(results: readonly PreprocessingResult[]): string | null {
  for (const r of results) for (const s of r.scm ?? []) if (s.pullRequest?.url) return s.pullRequest.url;
  return null;
}
