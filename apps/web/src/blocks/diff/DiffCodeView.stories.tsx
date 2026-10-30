import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import type { DiffSource } from '@/blocks/changes/diffTypes.js';
import type { ReviewThread } from '@/types/review.js';
import { DiffCodeView } from './DiffCodeView.js';
import { DiffProviders } from './DiffProviders.js';
import { ReviewThreadCard } from './review/ReviewThreadCard.js';

const OLD_APPLY = `export async function applyCoupon(code: string) {
  const cart = useCart.getState();
  await api.applyCoupon(code);
  const totals = await api.getTotals(cart.id);
  setTotals(totals);
  track('coupon_applied', { code });
}
`;

const NEW_APPLY = `export async function applyCoupon(code: string) {
  const cart = useCart.getState();
  const { discount } = await api.applyCoupon(code);
  setTotals(recalculate(cart, discount));
  track('coupon_applied', { code });
}
`;

const NEW_TEST = `import { recalculate } from './applyCoupon';

describe('recalculate', () => {
  it('applies the discount', () => {
    const cart = cartWith([30, 60]);
    expect(recalculate(cart, 9).total).toBe(81);
  });
});
`;

const THREAD: ReviewThread = {
  id: 't1',
  workspaceId: 'ws-1',
  scope: 'chat',
  scopeId: 'chat-1',
  repoAlias: 'app',
  path: 'src/cart/applyCoupon.ts',
  baseCheckpointId: 'cp-1',
  headCheckpointId: 'cp-2',
  side: 'additions',
  startLine: 4,
  endLine: 4,
  anchorText: 'setTotals(recalculate(cart, discount));',
  anchorHash: 'h',
  status: 'pending',
  reviewRound: 0,
  createdAt: '',
  updatedAt: '',
  comments: [
    {
      id: 'c1',
      threadId: 't1',
      author: 'user',
      intent: 'fix',
      body: 'Keep d = 0, but assert on it in recalculate.test.ts so a missing coupon fails loudly.',
      createdAt: '',
      updatedAt: '',
    },
  ],
};

const SOURCES: DiffSource[] = [
  {
    id: 'app::src/cart/applyCoupon.ts',
    alias: 'app',
    path: 'src/cart/applyCoupon.ts',
    oldContents: OLD_APPLY,
    newContents: NEW_APPLY,
    lang: 'typescript',
    cacheKey: 'story-a:story-b',
  },
  {
    id: 'app::src/cart/recalculate.test.ts',
    alias: 'app',
    path: 'src/cart/recalculate.test.ts',
    oldContents: '',
    newContents: NEW_TEST,
    lang: 'typescript',
    cacheKey: 'story-0:story-c',
  },
];

const WITH_THREAD: DiffSource[] = [
  { ...SOURCES[0]!, annotations: [{ side: 'additions', lineNumber: 4, metadata: { threadId: 't1' } }] },
  SOURCES[1]!,
];

const HEADER_HEIGHT = 32;
/** The CodeView needs a bounded height to virtualize against. */
const FRAME = { height: 440 };

/** The consumer's file row (the Changes panel renders ChangeFileRow here). */
function Header({ path }: { path: string }) {
  return (
    <div className="flex h-control-lg items-center border-b border-line-soft bg-raised px-3 font-mono text-small text-fg-2" data-testid="story-diff-header">
      {path}
    </div>
  );
}

const meta = {
  component: DiffCodeView,
  tags: ['vrt-themes'],
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <DiffProviders>
        <div className="flex w-180 flex-col overflow-hidden rounded-card border border-line" style={FRAME}>
          <Story />
        </div>
      </DiffProviders>
    ),
  ],
  args: {
    sources: SOURCES,
    className: 'min-h-0 flex-1',
    headerHeight: HEADER_HEIGHT,
    renderHeader: (item) => <Header path={item.path} />,
  },
} satisfies Meta<typeof DiffCodeView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Unified, word-level highlights; syntax colours from `var(--syntax-*)`, add/delete from ok/err. */
export const Unified: Story = {
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getAllByTestId('story-diff-header')).toHaveLength(2));
  },
};

/** Split view; the new file renders in a single column. */
export const Split: Story = {
  args: { viewMode: 'split' },
};

/** Wrapped long lines. */
export const Wrap: Story = {
  args: { wrapLines: true },
};

/** An inline review thread under line 4, with gutter selection on. */
export const WithThread: Story = {
  args: {
    sources: WITH_THREAD,
    enableSelection: true,
    onSelectRange: fn(),
    renderAnnotation: () => <ReviewThreadCard thread={THREAD} defaultExpanded onResolve={fn()} onDelete={fn()} onReply={fn()} onSend={fn()} />,
  },
};

/** No sources: the caller's empty state. */
export const Empty: Story = {
  args: {
    sources: [],
    emptyState: <p className="m-auto text-ui text-fg-3">No changes yet</p>,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No changes yet')).toBeVisible();
  },
};
