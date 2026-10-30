import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router';
import { expect, within } from 'storybook/test';
import { deriveSegments, type StreamBlock } from '@generatorai/client-core';
import { TranscriptProvider } from '../transcriptContext.js';
import { LiveTurn } from './LiveTurn.js';

// A turn mid-stream (demo scaffolding, D-45).
const BLOCKS: StreamBlock[] = [
  { type: 'tool_call', blockId: 1, callId: 'c1', tool: 'Read', args: { file_path: 'apps/api/src/monitors/routes.ts' }, status: 'complete' },
  { type: 'tool_call', blockId: 2, callId: 'c2', tool: 'Bash', args: { command: 'pnpm --filter @pulse/api test' }, status: 'running' },
  { type: 'text', blockId: 3, content: 'The list endpoint ignores its query string today, so `sort` needs a schema of its own.' },
];

const meta = {
  component: LiveTurn,
  tags: ['vrt-themes'],
  decorators: [
    (Story) => (
      <MemoryRouter>
        <TranscriptProvider value={{}}>
          <div className="max-w-190 p-6">
            <Story />
          </div>
        </TranscriptProvider>
      </MemoryRouter>
    ),
  ],
  args: { agentName: 'Claude Code', streamKey: 'story', active: true, answerStreaming: true, thinkingLabel: 'Claude Code is thinking…' },
} satisfies Meta<typeof LiveTurn>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Sent, nothing back yet: the header and the thinking placeholder. */
export const Thinking: Story = {
  args: { thinking: true },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText('Claude Code')).toBeInTheDocument();
    await expect(c.getByTestId('thinking-placeholder')).toBeInTheDocument();
  },
};

/** A chat turn streaming: steps and answer as they arrive. */
export const Streaming: Story = {
  args: { segments: deriveSegments(BLOCKS, { active: true }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('live-turn')).toBeInTheDocument();
  },
};

/** A workflow stage's response: the same panel, signed with the stage and a bot avatar, from its split steps + answer. */
export const WorkflowStage: Story = {
  args: {
    agentName: 'Implement',
    avatar: 'bot',
    steps: deriveSegments(BLOCKS.slice(0, 2), { active: true }).flatMap((s) => (s.type === 'steps' ? s.steps : [])),
    answer: 'Sorting is in place; running the API tests now.',
    thinkingLabel: 'Implement is thinking…',
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Implement')).toBeInTheDocument();
  },
};

/** Stopped by the person after some output. */
export const Stopped: Story = {
  args: { segments: deriveSegments(BLOCKS, { active: false }), active: false, answerStreaming: false, stopped: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('stream-stopped-note')).toBeInTheDocument();
  },
};

/** A stage that failed before answering: the error in the body. */
export const Failed: Story = {
  args: { agentName: 'Implement', avatar: 'bot', active: false, answerStreaming: false, error: 'The provider stopped responding.', thinkingLabel: 'Implement is thinking…' },
};
