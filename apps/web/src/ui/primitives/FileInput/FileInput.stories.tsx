import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Button } from '../Button/Button.js';
import { FileInput } from './FileInput.js';

const meta = {
  component: FileInput,
  tags: ['vrt-themes'],
  args: { onFilesSelected: () => {}, children: (open: () => void) => <Button onClick={open}>Choose files</Button> },
} satisfies Meta<typeof FileInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Clicking the trigger opens the (hidden, jsdom-mocked) native picker. */
export const Default: Story = {
  render: () => (
    <FileInput onFilesSelected={() => {}}>{(open) => <Button onClick={open}>Choose files</Button>}</FileInput>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Choose files' }));
    await expect(canvasElement.querySelector('input[type="file"]')).not.toBeNull();
  },
};

/** `directory`: the native picker selects a folder (the input carries `webkitdirectory`). */
export const Directory: Story = {
  render: () => (
    <FileInput directory onFilesSelected={() => {}}>
      {(open) => <Button onClick={open}>Upload folder</Button>}
    </FileInput>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('input[type="file"]')?.hasAttribute('webkitdirectory')).toBe(true);
  },
};
