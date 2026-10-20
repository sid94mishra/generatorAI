// ────────────────────────────────────────────────────────────────
// A reviewer on another provider (D-156). In the workflow evaluation a
// Codex reviewer approved Codex's fixes on the first pass three times out of
// three — once with a test that passed on the buggy code — while Claude
// reviewers found real defects every time.
//
// A stage with `reviewOf` that pins no agent, provider or model of its own
// (nor does the workflow or the run name a provider or agent), has no
// per-stage model for this run, and would run on the provider of the stage
// it reviews, gets the default model of another ready provider as its
// per-stage model for the run. The plan preview and the run show it; a
// person's per-stage pick wins. A model whose id two ready providers share
// is never picked (routing by model could land on either). With no other
// provider ready nothing changes.
// ────────────────────────────────────────────────────────────────

import { resolveSessionSpec, type SessionSpec, type WorkflowGraph } from '@generatorai/workflow-spec';
import type { StageProviderResolver } from '../WorkflowRunService.js';

export interface ReviewerModel {
  id: string;
  provider?: string | undefined;
  isDefault?: boolean | undefined;
}

/** Providers tried first for a reviewer, in order; any other ready one after them. */
const REVIEWER_PROVIDERS = ['claude-agent', 'codex', 'copilot'];

export interface CrossProviderInput {
  stageOverrides: ReadonlyArray<{ stageKey: string; model?: string | undefined }>;
  runOverrides: { model?: string | undefined; harnessType?: string | undefined };
  projectId?: string | undefined;
}

/** The per-stage models to add, each with the stage it reviews. */
export async function crossProviderReviewers(
  graph: WorkflowGraph,
  v: CrossProviderInput,
  deps: { providerOf: StageProviderResolver; models: () => Promise<ReviewerModel[]> },
): Promise<Array<{ stageKey: string; model: string; reviewOf: string }>> {
  const reviewers = graph.stages.filter((s) => s.kind === 'agent' && s.reviewOf);
  if (reviewers.length === 0) return [];
  const runLayer: SessionSpec = {
    ...(v.runOverrides.model ? { model: v.runOverrides.model } : {}),
    ...(v.runOverrides.harnessType ? { harnessType: v.runOverrides.harnessType as SessionSpec['harnessType'] } : {}),
  };
  const modelOf = (key: string) => v.stageOverrides.find((o) => o.stageKey === key)?.model;
  const providerOfStage = async (key: string): Promise<string | undefined> => {
    const stage = graph.stages.find((s) => s.key === key);
    if (stage?.kind !== 'agent') return undefined;
    const model = modelOf(key);
    const session = resolveSessionSpec(graph.workflow.session, runLayer, stage.session, model ? { model } : undefined);
    return deps.providerOf({ session, ...(v.projectId ? { projectId: v.projectId } : {}) }).catch(() => undefined);
  };

  let catalog: ReviewerModel[] | undefined;
  const out: Array<{ stageKey: string; model: string; reviewOf: string }> = [];
  for (const s of reviewers) {
    if (s.kind !== 'agent' || !s.reviewOf) continue;
    // A provider or agent named anywhere above the stage is kept: a per-stage model cannot outrank it.
    const ws = graph.workflow.session;
    if (modelOf(s.key) || s.session?.agentRef || s.session?.harnessType || s.session?.model || ws.agentRef || ws.harnessType || v.runOverrides.harnessType) continue;
    const [mine, theirs] = await Promise.all([providerOfStage(s.key), providerOfStage(s.reviewOf)]);
    if (!mine || !theirs || mine !== theirs) continue;
    catalog ??= await deps.models().catch(() => []);
    const pick = reviewerModel(catalog, theirs);
    if (pick) out.push({ stageKey: s.key, model: pick, reviewOf: s.reviewOf });
  }
  return out;
}

/** The default model of the first other ready provider (see the file header). */
export function reviewerModel(models: readonly ReviewerModel[], avoid: string): string | undefined {
  const owners = new Map<string, Set<string>>();
  for (const m of models) if (m.provider) owners.set(m.id, (owners.get(m.id) ?? new Set()).add(m.provider));
  const usable = models.filter((m) => m.provider && m.provider !== avoid && owners.get(m.id)!.size === 1);
  const providers = [...new Set(usable.map((m) => m.provider!))].sort((a, b) => rank(a) - rank(b));
  for (const p of providers) {
    const own = usable.filter((m) => m.provider === p);
    const pick = own.find((m) => m.isDefault) ?? own[0];
    if (pick) return pick.id;
  }
  return undefined;
}

function rank(provider: string): number {
  const i = REVIEWER_PROVIDERS.indexOf(provider);
  return i < 0 ? REVIEWER_PROVIDERS.length : i;
}
