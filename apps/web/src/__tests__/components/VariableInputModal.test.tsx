import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VariableInputModal } from '@/components/workflow/VariableInputModal.js';

describe('workflow file selection', () => {
  it('retains selected files after clearing the live native file picker', () => {
    const submit = vi.fn();
    render(<VariableInputModal open onClose={() => {}} onSubmit={submit}
      variables={[]} workflowName="Upload audit" stageNames={['Review']} />);
    fireEvent.click(screen.getByRole('button', { name: 'skills' }));
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const liveFiles = [new File(['skill'], 'review.md', { type: 'text/markdown' })];
    Object.defineProperty(input, 'files', { configurable: true, get: () => liveFiles });
    Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: () => { liveFiles.length = 0; } });
    fireEvent.change(input);
    expect(liveFiles).toHaveLength(0);
    expect(screen.getByText('review.md')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start Run' }));
    expect(submit.mock.calls[0]?.[1].skills[0].name).toBe('review.md');
  });
});
