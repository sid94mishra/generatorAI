import { describe, expect, it } from 'vitest';
import { approvedPlanText, notePlanCaptureMiss } from '../src/providers/claude-agent/ClaudeAgentProvider.js';

describe('approvedPlanText (Claude ExitPlanMode approval)', () => {
  it('appends the reviewer notes to the approved plan the tool result echoes', () => {
    expect(approvedPlanText('# Plan\n\nWP0, WP1\n', '## Reviewer notes\nOnly WP0.')).toBe('# Plan\n\nWP0, WP1\n\n## Reviewer notes\nOnly WP0.\n');
  });
  it('returns the plan unchanged without notes', () => {
    expect(approvedPlanText('# Plan', undefined)).toBe('# Plan');
    expect(approvedPlanText('# Plan', '   ')).toBe('# Plan');
  });
});

describe('notePlanCaptureMiss (ExitPlanMode before the plan is written)', () => {
  it('stays quiet for the misses the model corrects itself, warns once on the third in a row', () => {
    const phase = { phase: 'planning' as const, postApprovalPolicy: 'acceptEdits' as const, planText: '' };
    expect([notePlanCaptureMiss(phase), notePlanCaptureMiss(phase), notePlanCaptureMiss(phase), notePlanCaptureMiss(phase)]).toEqual([false, false, true, false]);
  });
  it('a captured plan resets the run', () => {
    const phase = { phase: 'planning' as const, postApprovalPolicy: 'acceptEdits' as const, planText: '', captureMisses: 2 };
    phase.captureMisses = 0;
    expect(notePlanCaptureMiss(phase)).toBe(false);
    expect(notePlanCaptureMiss(undefined)).toBe(false);
  });
});
