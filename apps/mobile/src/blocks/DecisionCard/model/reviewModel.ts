// MB-34 ReviewCard model (03 MB-34; MRunApproval, MWorkflowRun, MRunStageChat): what a stage parked on a completion
// review shows — "Review <stage>", the round ("round 1 of 3" from the parked payload, else the definition's
// approval), the summary the harness wrote, facts (files, usage) — and the sentence the approval prompt names
// (06 §6.3). Pure, unit-tested.

export interface ReviewInput {
  name: string;
  stageKey: string;
  interruptData?: unknown;
  summary?: string | null;
  outputText?: string | null;
  artifactManifest?: ReadonlyArray<{ path: string }> | null;
  usage?: Record<string, unknown> | null;
}

export interface ReviewView {
  title: string;
  round: string | null;
  /** What the reviewer reads first: the harness summary, else the reason it parked, else the output's opening. */
  summary: string;
  /** The approval prompt / reviewer question, when the definition set one. */
  question: string | null;
  facts: string[];
  /** "Approve Apply upgrades?" */
  promptTitle: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** 48213 → "48.2K". */
export function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/** "48.2K in · 6.1K out · $0.41" (cost only when a provider reported it). */
export function usageLine(usage: Record<string, unknown> | null | undefined): string | null {
  const u = rec(usage);
  const input = num(u['inputTokens']);
  const output = num(u['outputTokens']);
  const cost = num(u['costUsd']);
  const parts = [input !== null ? `${compactCount(input)} in` : null, output !== null ? `${compactCount(output)} out` : null, cost !== null ? `$${cost.toFixed(2)}` : null].filter((x): x is string => Boolean(x));
  return parts.length ? parts.join(' · ') : null;
}

export function reviewView(stage: ReviewInput, approval?: { maxRounds?: number; prompt?: string } | null): ReviewView {
  const d = rec(stage.interruptData);
  const round = num(d['round']);
  const max = num(d['maxRounds']) ?? approval?.maxRounds ?? null;
  const files = (stage.artifactManifest ?? []).filter((f) => !/^unnamed\.[A-Za-z0-9]+$/.test(f.path)).length;
  const usage = usageLine(stage.usage);
  const output = str(stage.outputText);
  return {
    title: `Review ${stage.name}`,
    round: round !== null ? `round ${round}${max ? ` of ${max}` : ''}` : max ? `up to ${max} rounds` : null,
    summary: str(d['summary']) ?? str(stage.summary) ?? str(d['reason']) ?? (output ? output.slice(0, 400) : 'The stage finished and waits for your review.'),
    question: str(d['prompt']) ?? approval?.prompt ?? null,
    facts: [files ? `${files} file${files === 1 ? '' : 's'}` : null, usage].filter((x): x is string => Boolean(x)),
    promptTitle: `Approve ${stage.name}?`,
  };
}
