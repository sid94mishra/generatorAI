import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { SkillSelector } from '@/components/session/SkillSelector.js';
import { newAgentStage } from '@/stores/workflowBuilderStore.js';
vi.mock('@/hooks/projectQueries.js', () => ({ useAvailableArtifacts: () => ({ data: [{ id: 'skill-1', name: 'testing', source: 'system' }], isLoading: false }) }));
afterEach(cleanup);

describe('session skill additions', () => {
  it('does not claim an unstaged catalog entry is enabled', () => {
    const update = vi.fn();
    render(<SkillSelector session={newAgentStage('stage_1', 'Stage 1').session} onChange={update} />);
    // Role-based, so it holds for the shared Checkbox as it did for a raw input.
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('0/1 added')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ agentOverrides: expect.objectContaining({ addSkillIds: ['skill-1'] }) }));
  });
  it('clears stage additions without erasing unrelated runtime settings', () => {
    const update = vi.fn();
    const stage = {
      ...newAgentStage('stage_1', 'Stage 1'),
      session: { reasoningEffort: 'high' as const, agentOverrides: { addSkillIds: ['skill-1'], appendInstructions: 'Review thoroughly' } },
    };
    render(<SkillSelector session={stage.session} onChange={update} />);
    fireEvent.click(screen.getByRole('button', { name: 'Deselect all' }));
    // Clearing the additions keeps the rest of the overrides; the patch touches nothing else.
    expect(update).toHaveBeenCalledWith({ agentOverrides: { appendInstructions: 'Review thoroughly' }, skills: undefined });
  });
});
