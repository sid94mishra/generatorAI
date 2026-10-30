import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button, type ButtonSize, type ButtonVariant } from './Button.js';

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'danger-ghost'];
const SIZES: ButtonSize[] = ['sm', 'md', 'lg'];

const meta = {
  component: Button,
  tags: ['vrt-themes'],
  args: { children: 'Commit', onClick: fn() },
  argTypes: {
    variant: { control: 'inline-radio', options: VARIANTS },
    size: { control: 'inline-radio', options: SIZES },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Commit' }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

/** variant × size, with and without a leading icon (Components board "Buttons"). */
export const Matrix: Story = {
  render: () => (
    <div className="grid grid-cols-4 items-center gap-3">
      {VARIANTS.map((variant) => (
        <div key={variant} className="contents">
          <span className="text-small text-fg-3">{variant}</span>
          {SIZES.map((size) => (
            <div key={size} className="flex items-center gap-2">
              <Button variant={variant} size={size}>
                {variant === 'danger' || variant === 'danger-ghost' ? 'Delete' : 'Commit'}
              </Button>
              <Button variant={variant} size={size} icon="plus">
                New chat
              </Button>
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
};

/** Trailing shortcut: on a primary button the Kbd renders on-accent. */
export const WithShortcut: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button variant="primary" icon="plus" shortcut={['Ctrl', 'N']}>
        New chat
      </Button>
      <Button shortcut={['↵']}>Allow once</Button>
      <Button variant="ghost" size="sm" shortcut={['Esc']}>
        Clear
      </Button>
      <Button trailingIcon="chevron-down">Any</Button>
    </div>
  ),
};

export const Hover: Story = {
  parameters: { pseudo: { hover: true } },
  render: Matrix.render,
};

export const FocusVisible: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByRole('button')).toHaveFocus();
  },
};

export const Pressed: Story = {
  args: { pressed: true, icon: 'plus', children: 'Add codebase' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Add codebase' })).toHaveAttribute('aria-pressed', 'true');
  },
};

export const Disabled: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {VARIANTS.map((variant) => (
        <Button key={variant} variant={variant} disabled>
          {variant}
        </Button>
      ))}
    </div>
  ),
};

/** The Spinner replaces the icon (or overlays the label: the width stays); clicks are ignored. */
export const Loading: Story = {
  args: { loading: true, variant: 'primary', children: 'Commit' },
  render: (args) => (
    <div className="flex items-center gap-3">
      <Button {...args} />
      <Button {...args} variant="secondary" icon="refresh">
        Refresh
      </Button>
    </div>
  ),
  play: async ({ canvas, args }) => {
    const button = canvas.getByRole('button', { name: 'Commit' });
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

export const LongText: Story = {
  args: { children: 'Publish the nightly dependency audit to every connected server', className: 'max-w-60' },
};

/** `render` swaps the element: here a plain anchor (router links work the same way). */
export const AsLink: Story = {
  args: { render: <a href="#chats" />, children: 'Open chats', icon: 'chats' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Open chats' })).not.toHaveAttribute('type');
  },
};

export const FullWidth: Story = {
  args: { fullWidth: true, variant: 'primary', size: 'lg', children: 'Pair this device' },
  render: (args) => (
    <div className="w-80">
      <Button {...args} />
    </div>
  ),
};

export const Compact: Story = { globals: { density: 'compact' }, render: Matrix.render };
