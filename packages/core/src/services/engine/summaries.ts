// ────────────────────────────────────────────────────────────────
// Stage summaries (P07 WP-7.1, W-49): what a successor in context mode
// `summary` reads, at the lowest model cost the stage's policy allows.
//
//   none  no summary; a summary reader falls back to the output text.
//   auto  deterministic, no model turn: a json stage's own `summary` field
//         or its output keys; a text stage's first ~1,200 characters plus
//         the headings of the rest. The executor pays one summary turn only
//         when a successor reads the summary AND the output is over 6,000
//         characters (`needsSummaryTurn`).
//   llm   written after the stage completes, in a tool-less one-turn
//         conversation on the workflow summary model (`SummaryEffects`,
//         the `summarize` effect); only the successors that read it wait
//         for `summary_ready`. A failed summary falls back to the
//         deterministic one, so a reader never waits forever.
// ────────────────────────────────────────────────────────────────

import type { AgentEvent, ILogger } from '@generatorai/shared';
import type { AgentStage } from '@generatorai/workflow-spec';
import type { EngineStores } from '../../domain/ports/IEngineStore.js';
import type { IAgentHarness } from '../../domain/ports/IAgentHarness.js';
import type { IWorkflowRunRepository } from '../../domain/ports/IWorkflowRunRepository.js';
import type { RunMessage, Usage } from '../../domain/scheduler/types.js';
import type { RunDefinitionReader } from '../definitions/RunDefinitionReader.js';
import { stageSessionSpec } from './StageExecutor.js';

/** Characters of a text output an `auto` summary keeps verbatim. */
export const AUTO_SUMMARY_CHARS = 1200;
/** Above this many characters a summary reader gets a model-written summary under `auto`. */
export const AUTO_SUMMARY_TURN_THRESHOLD = 6000;

/** A json stage's summary: its own `summary` field, else the keys it produced. */
export function jsonSummary(name: string, data: unknown): string {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const own = (data as Record<string, unknown>)['summary'];
    if (typeof own === 'string' && own.trim().length > 0) return own.trim();
    const keys = Object.keys(data);
    if (keys.length > 0) return `Stage "${name}" completed. Produced structured output with keys: ${keys.join(', ')}.`;
  }
  return `Stage "${name}" completed.`;
}

/** A text stage's deterministic summary: the head of the output plus the headings of the rest. */
export function textDigest(text: string, chars = AUTO_SUMMARY_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= chars) return trimmed;
  // Cut at a line boundary when one is close, so the head does not end mid-word.
  const nl = trimmed.lastIndexOf('\n', chars);
  const cut = nl > chars * 0.6 ? nl : chars;
  const head = trimmed.slice(0, cut).trimEnd();
  const headings = trimmed
    .slice(cut)
    .split(/\r?\n/)
    .filter((l) => /^#{1,6}\s+\S/.test(l))
    .map((l) => l.trim())
    .slice(0, 40);
  return `${head}\n… (${trimmed.length - cut} more characters)${headings.length ? `\n\nFurther sections:\n${headings.join('\n')}` : ''}`;
}

/** The deterministic summary of an output under `auto` (and the `llm` fallback). */
export function autoSummary(name: string, format: 'text' | 'json', data: unknown, text: string): string | undefined {
  if (format === 'json') return jsonSummary(name, data);
  return text.trim().length > 0 ? textDigest(text) : undefined;
}

/** The prompt of a model-written summary turn (in the stage's own conversation, or the `llm` one-shot). */
export function summaryPrompt(name: string): string {
  return (
    `Provide a concise summary (max 500 words) of the work you just completed in this stage named "${name}". ` +
    'Include key actions, files created or modified, decisions and outputs. It is handed to later workflow stages as context.'
  );
}

export interface SummaryEffectsDeps {
  stores: EngineStores;
  runRepo: IWorkflowRunRepository;
  definitions: RunDefinitionReader;
  harness: IAgentHarness;
  post: (runId: string, msg: RunMessage) => void;
  /** The workflow summary model (engine settings); undefined uses the stage's own model. */
  summaryModel?: (() => string | null | undefined) | undefined;
  logger?: ILogger | undefined;
}

/**
 * The `summarize` effect: a one-turn, tool-less conversation that writes a
 * completed stage's `llm` summary from its output, then `summary_ready`.
 * Idempotent (the actor drops a second `summary_ready`); never throws.
 */
export class SummaryEffects {
  constructor(private readonly deps: SummaryEffectsDeps) {}

  async summarize(runId: string, stageRunId: string): Promise<void> {
    const { stores, harness } = this.deps;
    const inst = stores.runStore.loadRunState(runId)?.instances.find((i) => i.id === stageRunId);
    if (!inst) return;
    let stage: AgentStage | undefined;
    let fallback = 'The stage completed.';
    const usage: Usage = {};
    const conversationId = `summary-${stageRunId}`;
    let unsubscribe: (() => void) | undefined;
    try {
      const run = await this.deps.runRepo.getById(runId);
      const graph = await this.deps.definitions.get(run.definitionVersionId);
      const found = graph.stages.find((s) => s.key === inst.stageKey);
      if (found?.kind !== 'agent') return;
      stage = found;
      const text = typeof inst.output === 'string' ? inst.output : inst.output !== null && inst.output !== undefined ? JSON.stringify(inst.output, null, 2) : '';
      fallback = autoSummary(stage.name, stage.output.format, inst.output, text) ?? fallback;
      if (text.trim().length === 0) {
        this.deps.post(runId, { type: 'summary_ready', stageRunId, summary: fallback });
        return;
      }
      const spec = stageSessionSpec(graph, stage, run).merged;
      const model = this.deps.summaryModel?.() || spec.model;
      await harness.createConversation({
        conversationId,
        ...(model ? { model } : {}),
        ...(spec.harnessType ? { harnessType: spec.harnessType } : {}),
        workingDirectory: run.systemVars?.workingDirectory ?? process.cwd(),
        streaming: false,
        permissionMode: 'plan',
        availableTools: [],
        excludedTools: ['*'],
        maxTurns: 1,
        systemMessage: { mode: 'append', content: 'You summarize the output of an automated workflow stage. You have no tools.' },
      });
      unsubscribe = harness.onConversationEvent(conversationId, (event: AgentEvent) => {
        if (event.kind !== 'harness.usage') return;
        const d = (event.data ?? {}) as Record<string, unknown>;
        const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        usage.turns = (usage.turns ?? 0) + 1;
        usage.inputTokens = (usage.inputTokens ?? 0) + n(d['inputTokens']);
        usage.outputTokens = (usage.outputTokens ?? 0) + n(d['outputTokens']);
        const cost = d['cost'] ?? d['costUsd'];
        if (typeof cost === 'number' && Number.isFinite(cost)) usage.costUsd = (usage.costUsd ?? 0) + cost;
      });
      // A tool-less one-shot over a finished output: nothing to replay; a lost one is written again by recovery.
      const response = await harness.sendPromptAndWait( // durability-ok: tool-less summary of a completed stage, re-derived on recovery
        conversationId,
        `${summaryPrompt(stage.name)}\n\n<generatorai:stage-output trust="untrusted">\n${text.slice(0, 100_000)}\n</generatorai:stage-output>`,
      );
      const summary = response?.content?.trim();
      this.deps.post(runId, { type: 'summary_ready', stageRunId, summary: summary || fallback, ...(usage.turns ? { usage } : {}) });
    } catch (err) {
      this.deps.logger?.warn(`[SummaryEffects] summarizing ${stageRunId} failed; the deterministic summary is used: ${String(err)}`);
      this.deps.post(runId, { type: 'summary_ready', stageRunId, summary: fallback, ...(usage.turns ? { usage } : {}) });
    } finally {
      unsubscribe?.();
      await harness.deleteConversation(conversationId).catch(() => undefined);
    }
  }
}
