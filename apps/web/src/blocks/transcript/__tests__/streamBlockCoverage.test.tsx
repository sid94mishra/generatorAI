// P4-07 acceptance: the transcript renders EVERY StreamBlock kind.
//
// `SAMPLES` is a `{ [K in StreamBlock['type']]: … }` map, so adding a kind to
// the client-core union is a compile error here until it has a sample and an
// expectation — and the render below proves the transcript draws it.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { deriveSegments, type StreamBlock } from '@generatorai/client-core';
import { TranscriptProvider, TurnBody } from '../index.js';

afterEach(cleanup);

type Kind = StreamBlock['type'];

const SAMPLES: { [K in Kind]: Extract<StreamBlock, { type: K }> } = {
  thinking: { type: 'thinking', blockId: 1, text: 'weighing two fixes', isComplete: true },
  text: { type: 'text', blockId: 2, content: 'The answer text' },
  tool_call: { type: 'tool_call', blockId: 3, callId: 'c1', tool: 'Read', args: { file_path: 'src/a.ts' }, status: 'complete' },
  system: { type: 'system', blockId: 4, message: 'MCP server "github" failed to start', category: 'warning' },
  widget: {
    type: 'widget',
    blockId: 5,
    instanceId: 'w1',
    descriptorId: 'd',
    extensionId: 'e',
    component: 'Counter',
    surface: 'inline',
    assetsBase: '',
    entry: '',
    props: {},
    status: 'active',
  },
  plan: {
    type: 'plan',
    blockId: 6,
    planId: 'p1',
    revision: 2,
    title: 'Refactor the router',
    summary: 'Move routes',
    status: 'awaiting_review',
    actions: ['implement_interactive'],
  },
  question: {
    type: 'question',
    blockId: 7,
    interactionId: 'q1',
    status: 'pending',
    questions: [{ id: 'a', header: 'Scope', question: 'Which package?', options: [{ label: 'web' }], multiSelect: false, allowFreeform: false }],
  },
  permission: {
    type: 'permission',
    blockId: 8,
    interactionId: 'perm1',
    toolName: 'Bash',
    permissionType: 'shell_exec',
    description: 'Run a shell command',
    inputSummary: 'git push',
    permissionMode: 'default',
    status: 'pending',
  },
  background_task: {
    type: 'background_task',
    blockId: 9,
    taskId: 'chat-w1',
    taskName: 'Update snapshot tests',
    status: 'running',
    toolCalls: 2,
    startedAt: 0,
  },
  scm_result: {
    type: 'scm_result',
    blockId: 10,
    turnId: 't1',
    result: { status: 'committed' } as unknown as Extract<StreamBlock, { type: 'scm_result' }>['result'],
  },
};

/** What proves each kind was drawn. */
const EXPECT: { [K in Kind]: () => void } = {
  thinking: () => expect(screen.getByTestId('thought-pill')).toBeInTheDocument(),
  text: () => expect(screen.getByText('The answer text')).toBeInTheDocument(),
  tool_call: () => expect(screen.getByText('a.ts')).toBeInTheDocument(),
  system: () => expect(screen.getByText('MCP server "github" failed to start')).toBeInTheDocument(),
  widget: () => expect(screen.getByTestId('slot-widget')).toHaveTextContent('Counter'),
  plan: () => expect(screen.getByTestId('plan-card')).toHaveTextContent('Refactor the router'),
  question: () => expect(screen.getByTestId('question-card')).toHaveTextContent('Which package?'),
  permission: () => expect(screen.getByTestId('permission-card')).toHaveTextContent('git push'),
  background_task: () => expect(screen.getByText('Update snapshot tests')).toBeInTheDocument(),
  scm_result: () => expect(screen.getByTestId('slot-scm')).toHaveTextContent('committed'),
};

describe('TurnBody renders every StreamBlock kind', () => {
  it.each(Object.keys(SAMPLES) as Kind[])('%s', (kind) => {
    const blocks: StreamBlock[] = [SAMPLES[kind]];
    render(
      <MemoryRouter>
        <TranscriptProvider
          value={{
            renderWidget: (b) => <span data-testid="slot-widget">{b.component}</span>,
            renderScmResult: (b) => <span data-testid="slot-scm">{b.result.status}</span>,
          }}
        >
          <TurnBody segments={deriveSegments(blocks, { active: false })} />
        </TranscriptProvider>
      </MemoryRouter>,
    );
    EXPECT[kind]();
  });
});
