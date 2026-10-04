import { describe, expect, it } from 'vitest';
import { approvedPlanText } from '../src/providers/claude-agent/ClaudeAgentProvider.js';

describe('approvedPlanText (Claude ExitPlanMode approval)', () => {
  it('appends the reviewer notes to the approved plan the tool result echoes', () => {
    expect(approvedPlanText('# Plan\n\nWP0, WP1\n', '## Reviewer notes\nOnly WP0.')).toBe('# Plan\n\nWP0, WP1\n\n## Reviewer notes\nOnly WP0.\n');
  });
  it('returns the plan unchanged without notes', () => {
    expect(approvedPlanText('# Plan', undefined)).toBe('# Plan');
    expect(approvedPlanText('# Plan', '   ')).toBe('# Plan');
  });
});
