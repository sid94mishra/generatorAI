import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, within } from 'storybook/test';
import type { ReviewThread } from '@/types/review.js';
import { ReviewSendDialog } from './ReviewSendDialog.js';

function thread(id: string, path: string, line: number, body: string, intent: 'fix' | 'question'): ReviewThread {
  return {
    id,
    workspaceId: 'w1',
    scope: 'chat',
    scopeId: 'c1',
    repoAlias: 'pulse',
    path,
    baseCheckpointId: 'b',
    headCheckpointId: 'h',
    side: 'additions',
    startLine: line,
    endLine: line,
    anchorText: '',
    anchorHash: '',
    status: 'pending',
    reviewRound: 1,
    createdAt: '2026-10-24T10:00:00Z',
    updatedAt: '2026-10-24T10:00:00Z',
    comments: [{ id: `${id}-c`, threadId: id, author: 'user', body, intent, createdAt: '2026-10-24T10:00:00Z', updatedAt: '2026-10-24T10:00:00Z' }],
  } as ReviewThread;
}

const THREADS = [
  thread('t1', 'packages/shared/src/slug.ts', 4, 'Strip accents before lowercasing.', 'fix'),
  thread('t2', 'packages/shared/test/slug.test.ts', 18, 'Is an empty string a valid slug?', 'question'),
];

const meta = {
  component: ReviewSendDialog,
  tags: ['vrt-themes'],
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    onOpenChange: fn(),
    threads: THREADS,
    onJump: fn(),
    onDelete: fn(),
    onSend: fn(),
    onPreview: fn(),
    previewPrompt: '<review_feedback>\n<comment path="packages/shared/src/slug.ts" line="4">Strip accents before lowercasing.</comment>\n</review_feedback>',
    onClosePreview: fn(),
  },
} satisfies Meta<typeof ReviewSendDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The comments, a note, the exact message and one Send (D-164). */
export const Default: Story = {
  play: async ({ args }) => {
    const dialog = await screen.findByRole('dialog', { name: 'Send review to the agent' });
    await expect(within(dialog).getByText('2 comments')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Note for the agent/ }), 'Run the tests.');
    await userEvent.click(within(dialog).getByTestId('review-preview-toggle'));
    await expect(args.onPreview).toHaveBeenCalledWith('Run the tests.');
    await expect(await within(dialog).findByTestId('review-preview')).toHaveTextContent('review_feedback');
    await userEvent.click(within(dialog).getByTestId('review-send'));
    await expect(args.onSend).toHaveBeenCalledWith('Run the tests.');
  },
};

/** Nowhere to send (a finished run): the comments stay, Send is off and the footer says why. */
export const CannotSend: Story = {
  args: { onSend: undefined, onPreview: undefined, disabledReason: 'Focus a running stage to send comments to it.' },
  play: async () => {
    const dialog = await screen.findByRole('dialog');
    await expect(within(dialog).getByTestId('review-send')).toBeDisabled();
    await expect(within(dialog).getByText('Focus a running stage to send comments to it.')).toBeInTheDocument();
  },
};
