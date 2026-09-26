import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { RunDialog } from '@/components/workflow/RunDialog.js';
import { renderWithProviders } from '../helpers/renderWithProviders.js';

describe('workflow file selection', () => {
  it('retains selected files after clearing the live native file picker', async () => {
    const started = vi.fn();
    const { platform } = renderWithProviders(
      <RunDialog open onClose={() => {}} onStarted={started}
        variables={[]} workflowName="Upload audit" stages={[{ key: 'review', name: 'Review' }]}
        target={{ kind: 'definition', workflowDefinitionId: '00000000-0000-4000-8000-000000000001' }} />,
    );
    platform.invokeWorkflow.mockResolvedValue({ runId: 'r1', workflowDefinitionId: 'd1' } as never);
    fireEvent.click(screen.getByRole('button', { name: 'skills' }));
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const liveFiles = [new File(['skill'], 'review.md', { type: 'text/markdown' })];
    Object.defineProperty(input, 'files', { configurable: true, get: () => liveFiles });
    Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: () => { liveFiles.length = 0; } });
    fireEvent.change(input);
    expect(liveFiles).toHaveLength(0);
    expect(screen.getByText('review.md')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start Run' }));
    await waitFor(() => expect(started).toHaveBeenCalled());
    expect(platform.invokeWorkflow.mock.calls[0]?.[1]?.files?.skills?.[0]?.name).toBe('review.md');
  });
});
