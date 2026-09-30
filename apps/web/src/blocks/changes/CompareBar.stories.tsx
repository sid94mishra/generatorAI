import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';
import { ChangesListBar, CompareBar } from './CompareBar.js';
import type { CompareOption } from './useChangesModel.js';

const OPTIONS: CompareOption[] = [
  { value: 'baseline', label: 'Since session start' },
  { value: 'ref:7be0d15', label: 'Branch base (main)' },
  { value: 'turn:t4', label: 'Also cover the zero-discount case · 14:05' },
  { value: 'turn:t3', label: 'Fix coupon/total race · 14:02' },
  { value: 'checkpoint:m1', label: 'Snapshot · 14:00' },
];

function Stateful({ options = OPTIONS, initial = 'baseline' }: { options?: CompareOption[]; initial?: string }) {
  const [base, setBase] = useState(initial);
  return (
    <div className="w-120 border border-line-soft bg-surface">
      <CompareBar base={base} onBaseChange={setBase} options={options} />
      <output className="block px-3 py-1 font-mono text-micro text-fg-3">{base}</output>
    </div>
  );
}

function ListBarDemo() {
  const [shown, setShown] = useState(false);
  return (
    <div className="w-120 border border-line-soft bg-surface">
      <ChangesListBar
        hiddenWorkspaceFiles={2}
        showWorkspaceFiles={shown}
        onToggleWorkspaceFiles={() => setShown((v) => !v)}
        files={5}
        keptCount={1}
        bulkBusy={null}
        onKeepAll={fn()}
        onUndoAll={fn()}
      />
    </div>
  );
}

const meta = {
  component: CompareBar,
  tags: ['vrt-themes'],
  args: { base: 'baseline', onBaseChange: fn(), options: OPTIONS },
  render: () => <Stateful />,
} satisfies Meta<typeof CompareBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** This chat = since session start; This turn = the newest turn; Branch = the first branch base. */
export const Modes: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('radio', { name: 'This chat' })).toBeChecked();
    await userEvent.click(canvas.getByRole('radio', { name: 'This turn' }));
    await expect(canvas.getByText('turn:t4')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('radio', { name: 'Branch vs main' }));
    await expect(canvas.getByText('ref:7be0d15')).toBeInTheDocument();
  },
};

/** An older turn picked from "Compare against": no quick mode is selected. */
export const OlderTurn: Story = {
  render: () => <Stateful initial="turn:t3" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox', { name: 'Compare against' })).toHaveTextContent('Fix coupon/total race');
    await expect(canvas.getByRole('radio', { name: 'This chat' })).not.toBeChecked();
    await expect(canvas.getByRole('radio', { name: 'This turn' })).not.toBeChecked();
  },
};

/** The precise picker lists every option. */
export const CompareAgainstOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('combobox', { name: 'Compare against' }));
    const listbox = await screen.findByRole('listbox');
    await expect(within(listbox).getAllByRole('option')).toHaveLength(OPTIONS.length);
    await userEvent.click(within(listbox).getByRole('option', { name: 'Snapshot · 14:00' }));
    await waitFor(() => expect(canvas.getByText('checkpoint:m1')).toBeInTheDocument());
  },
};

/** No turn yet and no branch: those modes are disabled. */
export const NewSession: Story = {
  render: () => <Stateful options={[{ value: 'baseline', label: 'Since session start' }]} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('radio', { name: 'This turn' })).toHaveAttribute('aria-disabled', 'true');
    await expect(canvas.getByRole('radio', { name: 'Branch' })).toHaveAttribute('aria-disabled', 'true');
  },
};

/** The list bar: workspace-files chip, Keep all, Undo all (D-28). */
export const ListBar: Story = {
  render: () => <ListBarDemo />,
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
export const ListBarBusy: Story = {
  render: () => (
    <div className="w-120 border border-line-soft bg-surface">
      <ChangesListBar
        hiddenWorkspaceFiles={0}
        showWorkspaceFiles={false}
        onToggleWorkspaceFiles={fn()}
        files={3}
        keptCount={3}
        bulkBusy="undo"
        onKeepAll={fn()}
        onUndoAll={fn()}
      />
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByTestId('changes-workspace-files-toggle')).toBeNull();
    await expect(canvas.getByTestId('keep-all')).toBeDisabled();
    await expect(canvas.getByTestId('undo-all')).toBeDisabled();
  },
};
