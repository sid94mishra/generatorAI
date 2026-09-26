import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { FileTree, type FileTreeStatusEntry } from './FileTree.js';

const STATUSES: FileTreeStatusEntry[] = [
  { path: 'src/cart/applyCoupon.ts', status: 'modified' },
  { path: 'src/cart/cartTotals.ts', status: 'renamed' },
  { path: 'src/cart/legacyTotals.ts', status: 'deleted' },
  { path: 'src/cart/recalculate.test.ts', status: 'added' },
  { path: 'tests/checkout.spec.ts', status: 'modified' },
];

/** The dock's tree column, 224 wide and a fixed height (story scaffolding). */
const TREE_BOX = { height: 320 };

function treeRoot(canvasElement: HTMLElement): ShadowRoot | null {
  return canvasElement.querySelector('file-tree-container')?.shadowRoot ?? null;
}

const meta = {
  component: FileTree,
  args: {
    paths: STATUSES.map((s) => s.path),
    statuses: STATUSES,
    activePath: null,
    onSelect: fn(),
    onActivate: fn(),
    filterPlaceholder: 'Filter changed files…',
  },
  decorators: [
    (Story) => (
      <div className="w-56 border border-line-soft bg-surface" style={TREE_BOX}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FileTree>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The changed files, folders rolled up, one change letter per file. */
export const Changes: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(treeRoot(canvasElement)?.querySelectorAll('[role="treeitem"][data-item-type="file"]')).toHaveLength(5),
    );
    const input = treeRoot(canvasElement)?.querySelector<HTMLInputElement>('[data-file-tree-search-input]');
    await waitFor(() => expect(input?.placeholder).toBe('Filter changed files…'));
  },
};

/** The file open in the diff is selected and scrolled into view. */
export const ActivePath: Story = {
  args: { activePath: 'tests/checkout.spec.ts' },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(
        treeRoot(canvasElement)?.querySelector('[role="treeitem"][data-item-path="tests/checkout.spec.ts"]'),
      ).toHaveAttribute('aria-selected', 'true'),
    );
  },
};

/** Several mounts: the alias is the top folder. */
export const MultiMount: Story = {
  args: {
    paths: ['api/src/server.ts', 'api/src/routes.ts', 'web/src/app.tsx'],
    statuses: [
      { path: 'api/src/server.ts', status: 'modified' },
      { path: 'api/src/routes.ts', status: 'added' },
      { path: 'web/src/app.tsx', status: 'modified' },
    ],
  },
};

/** No filter row (a short, fixed list). */
export const NoFilter: Story = {
  args: { filter: false },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(treeRoot(canvasElement)?.querySelector('[role="treeitem"]')).not.toBeNull());
    await expect(treeRoot(canvasElement)?.querySelector('[data-file-tree-search-input]')).toBeNull();
  },
};
