import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { SkillSelector } from '@/components/workflow/SkillSelector.js';
import { newAgentStage } from '@/stores/workflowBuilderStore.js';
vi.mock('@/hooks/projectQueries.js', () => ({ useAvailableArtifacts: () => ({ data: [{ id: 'skill-1', name: 'testing', source: 'system' }], isLoading: false }) }));
afterEach(cleanup);

describe('stage skill additions', () => {
  it('does not claim an unstaged catalog entry is enabled', () => {
    const update = vi.fn();
    render(<SkillSelector stage={newAgentStage('stage_1', 'Stage 1')} onUpdate={update} />);
    // Role-based, so it holds for the shared Checkbox as it did for a raw input.
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('0/1 added')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ session: expect.objectContaining({ agentOverrides: expect.objectContaining({ addSkillIds: ['skill-1'] }) }) }));
  });
  it('clears stage additions without erasing unrelated runtime settings', () => {
    const update = vi.fn();
    const stage = {
      ...newAgentStage('stage_1', 'Stage 1'),
      session: { reasoningEffort: 'high' as const, agentOverrides: { addSkillIds: ['skill-1'], appendInstructions: 'Review thoroughly' } },
    };
    render(<SkillSelector stage={stage} onUpdate={update} />);
    fireEvent.click(screen.getByRole('button', { name: 'Deselect all' }));
    // Clearing the additions removes the field (the graph is saved wholesale) and keeps the rest.
    expect(update).toHaveBeenCalledWith({ session: { reasoningEffort: 'high', agentOverrides: { appendInstructions: 'Review thoroughly' } } });
  });
});
