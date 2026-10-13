import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { CodeBlock } from './CodeBlock.js';

const TS_SNIPPET = `export function greet(name: string): string {
  // say hello
  return \`Hello, \${name}!\`;
}`;

const meta = {
  component: CodeBlock,
  tags: ['vrt-themes'],
  args: { children: TS_SNIPPET, lang: 'typescript', header: 'src/greet.ts' },
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Renders plain text first, then swaps in Shiki-highlighted HTML once the grammar chunk loads. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent).toContain('greet');
    // Highlighting swapped in once a token carries a `--syntax-*` colour (Shiki tokenizes
    // "greet" into its own <span>, so a plain textContent/getByText('greet') match alone
    // would also pass on the pre-highlight plain-text fallback).
    await waitFor(() => expect(canvasElement.innerHTML).toContain('--syntax-'), { timeout: 10_000 });
  },
};

/** No header/copy row. */
export const Bare: Story = {
  args: { header: undefined, copy: undefined },
};

/** language/path header + copy button. */
export const WithCopy: Story = {
  args: { copy: TS_SNIPPET },
};

/** Inline tool error tone. */
export const ErrorTone: Story = {
  args: { tone: 'err', lang: 'text', children: 'Error: connection refused (ECONNREFUSED)', header: undefined },
};

/** Unsupported/omitted language falls back to plain escaped text, never a blocked render. */
export const PlainText: Story = {
  args: { lang: undefined, children: 'no highlighting here — just text', header: undefined, copy: undefined },
};

/** Long lines wrap instead of scrolling horizontally. */
export const Wrap: Story = {
  args: {
    wrap: true,
    lang: 'text',
    header: undefined,
    children:
      'This is a single very long line of plain text meant to demonstrate that the wrap prop lets long content wrap onto multiple lines instead of producing a horizontal scrollbar inside the code block body.',
  },
};

/** A line-number gutter (file viewers); an alias (`ts`) resolves to the TypeScript grammar. */
export const LineNumbers: Story = {
  args: { lang: 'ts', lineNumbers: true, copy: TS_SNIPPET },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent).toContain('1\n2\n3\n4');
    await waitFor(() => expect(canvasElement.innerHTML).toContain('--syntax-'), { timeout: 10_000 });
  },
};

/** A second language (Python) gets its own lazy grammar chunk. */
export const OtherLanguage: Story = {
  args: { lang: 'python', header: 'script.py', children: 'def greet(name: str) -> str:\n    return f"Hello, {name}!"' },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent).toContain('greet');
    await waitFor(() => expect(canvasElement.innerHTML).toContain('--syntax-'), { timeout: 10_000 });
  },
};

/** `collapse`: a block taller than the cap starts clamped with a "Show all" footer; a short one shows no footer. */
export const Collapsed: Story = {
  args: {
    lang: 'text',
    header: 'build.log',
    collapse: true,
    children: Array.from({ length: 60 }, (_, i) => `step ${i + 1}: ok`).join('\n'),
  },
  play: async ({ canvasElement }) => {
    const toggle = await within(canvasElement).findByRole('button', { name: 'Show all 60 lines' });
    await userEvent.click(toggle);
    await expect(within(canvasElement).getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  },
};
