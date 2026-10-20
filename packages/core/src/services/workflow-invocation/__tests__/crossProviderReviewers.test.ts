import { parseGraph, type WorkflowGraphInput } from '@generatorai/workflow-spec';
import { describe, expect, it } from 'vitest';
import { crossProviderReviewers, reviewerModel } from '../crossProviderReviewers.js';

const MODELS = [
  { id: 'gpt-5.6-terra', provider: 'codex', isDefault: true },
  { id: 'gpt-5.6-luna', provider: 'codex' },
  { id: 'claude-sonnet-5-5', provider: 'claude-agent', isDefault: true },
  { id: 'claude-opus-5-5', provider: 'claude-agent' },
  { id: 'shared-model', provider: 'copilot' },
  { id: 'shared-model', provider: 'opencode' },
];
/** Routing by model, else Claude (the default provider). */
const providerOf = async ({ session }: { session: { model?: string; harnessType?: string } }) =>
  session.harnessType ?? MODELS.find((m) => m.id === session.model)?.provider ?? 'claude-agent';

function graph(review: Record<string, unknown> = {}, workflowSession: Record<string, unknown> = {}) {
  return parseGraph({
    formatVersion: 2,
    workflow: { name: 't', session: workflowSession },
    stages: [
      { key: 'fix', name: 'Fix', kind: 'agent', prompts: [{ label: 'p', text: 'fix' }] },
      { key: 'review', name: 'Review', kind: 'agent', reviewOf: 'fix', prompts: [{ label: 'p', text: 'review' }], ...review },
    ],
    edges: [{ from: 'fix', to: 'review' }],
  } as unknown as WorkflowGraphInput);
}

const run = (stageOverrides: Array<{ stageKey: string; model?: string }> = [], runOverrides: { model?: string; harnessType?: string } = {}) => ({ stageOverrides, runOverrides });
const deps = { providerOf, models: async () => MODELS };

describe('crossProviderReviewers', () => {
  it('moves a reviewer off its fixer\'s provider to another ready one', async () => {
    expect(await crossProviderReviewers(graph(), run([], { model: 'gpt-5.6-terra' }), deps)).toEqual([{ stageKey: 'review', model: 'claude-sonnet-5-5', reviewOf: 'fix' }]);
    expect(await crossProviderReviewers(graph(), run(), deps)).toEqual([{ stageKey: 'review', model: 'gpt-5.6-terra', reviewOf: 'fix' }]);
  });

  it('leaves a reviewer already on another provider, or pinned by the stage, the workflow or the person', async () => {
    expect(await crossProviderReviewers(graph(), run([{ stageKey: 'fix', model: 'gpt-5.6-luna' }]), deps)).toEqual([]);
    expect(await crossProviderReviewers(graph({ session: { model: 'claude-opus-5-5' } }), run(), deps)).toEqual([]);
    expect(await crossProviderReviewers(graph({}, { harnessType: 'codex' }), run(), deps)).toEqual([]);
    expect(await crossProviderReviewers(graph(), run([{ stageKey: 'review', model: 'claude-opus-5-5' }]), deps)).toEqual([]);
  });

  it('changes nothing when no other provider is ready', async () => {
    expect(await crossProviderReviewers(graph(), run(), { providerOf, models: async () => MODELS.filter((m) => m.provider === 'claude-agent') })).toEqual([]);
  });
});

describe('reviewerModel', () => {
  it('prefers the default model and never a model two providers share', () => {
    expect(reviewerModel(MODELS, 'claude-agent')).toBe('gpt-5.6-terra');
    expect(reviewerModel(MODELS.filter((m) => m.provider !== 'codex'), 'claude-agent')).toBeUndefined();
  });
});
