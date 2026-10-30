// An expanded step group lists its steps once; it never renders the same group inside itself.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { deriveTimeline, type StreamBlock } from '@generatorai/client-core';
import { StepList } from '../index.js';

afterEach(cleanup);

const read = (blockId: number, path: string): StreamBlock => ({
  type: 'tool_call',
  blockId,
  callId: `c${blockId}`,
  tool: 'Read',
  args: { file_path: path },
  status: 'complete',
});

describe('step group expansion', () => {
  it('shows the grouped steps as rows, not another group', () => {
    const blocks = [read(1, 'src/a.ts'), read(2, 'src/b.ts'), read(3, 'src/c.ts')];
    render(
      <MemoryRouter>
        <StepList steps={deriveTimeline(blocks, { active: false })} />
      </MemoryRouter>,
    );
    expect(screen.getAllByTestId('step-group')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('step-group-row'));
    const children = screen.getByTestId('step-group-children');
    expect(within(children).queryByTestId('step-group')).toBeNull();
    expect(screen.getAllByTestId('step-group')).toHaveLength(1);
    expect(within(children).getByText(/b\.ts/)).toBeInTheDocument();
  });
});
