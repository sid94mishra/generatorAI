// The canvas's pure pieces: a stage node's summary (lines + pills) and the
// template splice that renames colliding keys.

import { describe, expect, it } from 'vitest';
import { PRESETS } from '@generatorai/workflow-spec/presets';
import { newAgentStage, newCheckStage } from '@/stores/workflowBuilderStore.js';
import { formatDuration, stageLines, stagePills } from './stageSummary.js';
import { spliceableFragment } from './stageTemplates.js';

describe('stageSummary', () => {
  it('summarises an agent stage', () => {
    const stage = {
      ...newAgentStage('assess', 'Assess'),
      prompts: [{ label: 'Rate', text: 'Rate it.' }],
      guard: 'variables.dry_run == false',
      retry: { maxAttempts: 3, initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 60_000, jitter: true, retryOn: [], mode: 'resume' },
      session: { agentRef: 'global:auditor', model: 'claude-opus-5-5', reasoningEffort: 'high' },
    } as unknown as Parameters<typeof stagePills>[0];
    const labels = stagePills(stage, false).map((p) => p.label);
    expect(labels).toContain('1 prompt');
    expect(labels).toContain('Guard');
    expect(labels).toContain('Retry 3×');
    expect(labels).not.toContain('Fresh');
    expect(stageLines(stage, (ref) => (ref === 'global:auditor' ? { name: 'Security Auditor' } : undefined))).toEqual({
      lead: { icon: 'agents', text: 'Security Auditor' },
      detail: 'claude-opus-5-5 · high',
    });
  });

  it("shows a bound agent's own model when the stage pins none", () => {
    const stage = { ...newAgentStage('spec', 'Spec'), session: { agentRef: 'project:architect' } } as Parameters<typeof stageLines>[0];
    expect(stageLines(stage, () => ({ name: 'Architect', model: 'opus' })).detail).toBe('opus');
    expect(stageLines(stage, () => ({ name: 'Architect' })).detail).toBe('default model');
  });

  it('marks session reuse only inside a container, and names a model-only stage', () => {
    const stage = { ...newAgentStage('fix', 'Fix'), parentKey: 'loop' };
    expect(stagePills(stage, true).map((p) => p.label)).toContain('Fresh');
    expect(stageLines(stage, () => undefined).lead).toEqual({ icon: 'agents', text: 'No agent · model only', muted: true });
  });

  it('shows a check stage as its command', () => {
    const stage = newCheckStage('lint', 'Lint');
    const lines = stageLines(stage, () => undefined);
    expect(lines.lead.text).toBe('Check · no LLM');
    expect(stagePills(stage, false)[0]?.label).toBe('Admin only');
  });

  it('formats durations', () => {
    expect(formatDuration(30_000)).toBe('30s');
    expect(formatDuration(300_000)).toBe('5m');
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(5_400_000)).toBe('1h 30m');
  });
});

describe('spliceableFragment', () => {
  it('renames keys the graph already uses, and the references to them', () => {
    const fragment = PRESETS.fixReviewLoop.build();
    const { stages, edges } = spliceableFragment(fragment, new Set(['fix', 'fix_review']));
    const keys = stages.map((s) => s.key);
    expect(keys).not.toContain('fix');
    expect(keys).not.toContain('fix_review');
    expect(keys).toContain('review');
    const loop = stages.find((s) => s.kind === 'loop')!;
    for (const s of stages.filter((x) => x.kind !== 'loop')) expect(s.parentKey).toBe(loop.key);
    for (const e of edges) {
      expect(keys).toContain(e.from);
      expect(keys).toContain(e.to);
    }
  });

  it('keeps every key when nothing collides', () => {
    const fragment = PRESETS.fixReviewLoop.build();
    const { stages } = spliceableFragment(fragment, new Set());
    expect(stages.map((s) => s.key).sort()).toEqual(fragment.stages.map((s) => s.key).sort());
  });
});
