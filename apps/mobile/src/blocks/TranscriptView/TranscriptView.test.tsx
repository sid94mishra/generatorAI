import React from 'react';
import { screen, userEvent } from '@testing-library/react-native';
import type { StreamBlock } from '@generatorai/client-core';

import { renderThemed } from '../../ui/__tests__/themed';
import { TurnBody } from './parts/TurnBody';
import { TranscriptActionsContext } from './transcriptContext';

const tool = (blockId: number, callId: string, tool: string, args: unknown, extra: Partial<Extract<StreamBlock, { type: 'tool_call' }>> = {}): StreamBlock =>
  ({ type: 'tool_call', blockId, callId, tool, args, status: 'complete', result: 'ok', ...extra }) as StreamBlock;

describe('TurnBody (MB-07 / MB-13)', () => {
  it('folds tool calls into one tool block that expands in place and opens a step', async () => {
    const onOpenStep = jest.fn();
    const user = userEvent.setup();
    const blocks: StreamBlock[] = [
      tool(1, 'c1', 'Read', { file_path: 'src/a.ts' }),
      tool(2, 'c2', 'Read', { file_path: 'src/b.ts' }),
      tool(3, 'c3', 'Bash', { command: 'pnpm test' }),
      { type: 'text', blockId: 4, content: 'All green.' } as StreamBlock,
    ];
    await renderThemed(
      <TranscriptActionsContext.Provider value={{ agent: null, model: null, onOpenStep }}>
        <TurnBody blocks={blocks} active={false} />
      </TranscriptActionsContext.Provider>,
    );
    const block = screen.getByRole('button', { name: /^Tool steps, Read 2 files, ran 1 command/ });
    expect(block.props.accessibilityState).toMatchObject({ expanded: false });
    await user.press(block);
    await user.press(screen.getByTestId('step-row-c3'));
    expect(onOpenStep).toHaveBeenCalledWith('c3');
    expect(screen.getByText('All green.')).toBeTruthy();
  });

  it('renders a gate through the screen when it provides a renderer, else the settled outcome', async () => {
    const permission = { type: 'permission', blockId: 1, interactionId: 'i1', toolName: 'Bash', permissionType: 'shell_exec', description: '', inputSummary: 'ls', permissionMode: 'default', status: 'denied' } as StreamBlock;
    await renderThemed(
      <TranscriptActionsContext.Provider value={{ agent: null, model: null }}>
        <TurnBody blocks={[permission]} active={false} />
      </TranscriptActionsContext.Provider>,
    );
    expect(screen.getByText('Denied Bash')).toBeTruthy();
  });
});
