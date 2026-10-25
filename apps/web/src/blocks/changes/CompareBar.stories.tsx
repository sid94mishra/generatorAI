import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';
import { CompareBar, type CompareBarProps } from './CompareBar.js';
import type { CompareOption } from './compareChoices.js';

const OPTIONS: CompareOption[] = [
  { value: 'head', label: 'Uncommitted changes', meta: 'since last commit' },
  { value: 'baseline', label: 'This chat', meta: 'since it started' },
  { value: 'turn:t4', label: 'Last turn', meta: '14:05' },
];

const LIST: Omit<CompareBarProps, 'base' | 'onBaseChange' | 'options'> = {
  hiddenWorkspaceFiles: 2,
  showWorkspaceFiles: false,
  onToggleWorkspaceFiles: fn(),
  files: 5,
  keptCount: 1,
  bulkBusy: null,
  onKeepAll: fn(),
  onUndoAll: fn(),
};

function Stateful({ options = OPTIONS, initial = 'head', ...rest }: Partial<CompareBarProps> & { initial?: string }) {
  const [base, setBase] = useState(initial);
  const [shown, setShown] = useState(false);
  return (
    <div className="w-150 border border-line-soft bg-surface">
      <CompareBar
        {...LIST}
        showWorkspaceFiles={shown}
        onToggleWorkspaceFiles={() => setShown((v) => !v)}
        {...rest}
        base={base}
        onBaseChange={setBase}
        options={options}
      />
      <output className="block px-3 py-1 font-mono text-micro text-fg-3">{base}</output>
    </div>
  );
}

const meta = {
  component: CompareBar,
  tags: ['vrt-themes'],
  args: { base: 'head', onBaseChange: fn(), options: OPTIONS, ...LIST },
  render: () => <Stateful />,
} satisfies Meta<typeof CompareBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A chat opens on what is not committed yet; the picker lists the three choices (D-162). */
export const Default: Story = {
  play: async ({ canvas }) => {
    const picker = canvas.getByRole('combobox', { name: 'Compare against' });
    await expect(picker).toHaveTextContent('Uncommitted changes');
    await userEvent.click(picker);
    const listbox = await screen.findByRole('listbox');
    await expect(within(listbox).getAllByRole('option')).toHaveLength(3);
    await userEvent.click(within(listbox).getByRole('option', { name: /Last turn/ }));
    await waitFor(() => expect(canvas.getByText('turn:t4')).toBeInTheDocument());
  },
};

/** An older turn picked on the checkpoint timeline shows as its own labelled entry. */
export const OlderTurn: Story = {
  render: () => (
    <Stateful initial="turn:t2" options={[...OPTIONS, { value: 'turn:t2', label: 'Since turn 2', meta: '14:02' }]} />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox', { name: 'Compare against' })).toHaveTextContent('Since turn 2');
  },
};

/** No git repository: there is no last commit, so the session is the default. */
export const NoGit: Story = {
  render: () => <Stateful initial="baseline" options={OPTIONS.slice(1, 2)} files={0} hiddenWorkspaceFiles={0} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox', { name: 'Compare against' })).toHaveTextContent('This chat');
    await expect(canvas.queryByTestId('keep-all')).toBeNull();
  },
};

/** The list actions: workspace-files chip, Keep all, Undo all (D-28). */
export const ListActions: Story = {
  play: async ({ canvas }) => {
    const chip = canvas.getByTestId('changes-workspace-files-toggle');
    await expect(chip).toHaveTextContent('+2 workspace files');
    await userEvent.click(chip);
    await expect(canvas.getByTestId('changes-workspace-files-toggle')).toHaveTextContent('Hide workspace files');
    await expect(canvas.getByTestId('keep-all')).toBeEnabled();
    await expect(canvas.getByTestId('undo-all')).toBeEnabled();
  },
};

/** Everything kept, and an Undo all in flight. */
export const Busy: Story = {
  render: () => <Stateful hiddenWorkspaceFiles={0} files={3} keptCount={3} bulkBusy="undo" />,
  play: async ({ canvas }) => {
    await expect(canvas.queryByTestId('changes-workspace-files-toggle')).toBeNull();
    await expect(canvas.getByTestId('keep-all')).toBeDisabled();
    await expect(canvas.getByTestId('undo-all')).toBeDisabled();
  },
};
