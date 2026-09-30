import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { Markdown } from './Markdown.js';

const PROSE = `The build failed because \`pnpm test\` could not find the **fixture** directory. I moved the
fixtures next to the test file and updated the import, so the suite now runs in *under a second*.

See the [Vitest docs](https://vitest.dev/config/) for the \`root\` option.`;

const HEADINGS = `# Migration plan

## Phase 1 — tokens

### Colour roles

#### Syntax roles

Body text under the last heading.`;

const LISTS = `Steps:

1. Install the dependency
2. Replace the renderer
   - keep the copy button
   - drop the worker
3. Run the checks

- [x] typecheck
- [ ] bundle budget`;

const TABLE = `| File | Status | Lines |
| --- | --- | ---: |
| \`src/App.tsx\` | modified | 42 |
| \`src/lib/markdown.ts\` | deleted | 310 |
| \`src/ui/patterns/Markdown/Markdown.tsx\` | added | 220 |`;

const QUOTE = `> A quotation, not a callout: the colour steps down to fg-2.
>
> A second paragraph inside the same quote.

---

After the rule.`;

const CODE = `TypeScript:

\`\`\`ts src/greet.ts
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

Shell:

\`\`\`bash
pnpm --filter @generatorai/web build && pnpm check:bundle
\`\`\`

Python:

\`\`\`python
def greet(name: str) -> str:
    return f"Hello, {name}!"
\`\`\`

No language (indented):

    plain text block
    second line`;

const INCOMPLETE_BOLD = `Here is the fix. The **important part is the guard`;

const INCOMPLETE_FENCE = `Here is the fix:

\`\`\`ts
if (!user) {
  return null;`;

const meta = {
  component: Markdown,
  tags: ['vrt-themes'],
  args: { children: PROSE },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Markdown>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Transcript prose: 14/1.6, inline code, emphasis, an external link. */
export const Prose: Story = {
  play: async ({ canvas }) => {
    const link = canvas.getByRole('link', { name: 'Vitest docs' });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noreferrer');
    await expect(canvas.getByText('pnpm test').tagName).toBe('CODE');
  },
};

/** `compact`: text-small for cards and previews (inline code drops to text-micro). */
export const Compact: Story = {
  args: { size: 'compact' },
};

export const Headings: Story = {
  args: { children: HEADINGS },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Migration plan' })).toBeInTheDocument();
    await expect(canvas.getByRole('heading', { level: 4, name: 'Syntax roles' })).toBeInTheDocument();
  },
};

/** Ordered, nested unordered and GFM task lists. */
export const Lists: Story = {
  args: { children: LISTS },
};

/** GFM table; wide tables scroll inside their own box. */
export const Table: Story = {
  args: { children: TABLE },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('table')).toBeInTheDocument();
    await expect(canvas.getAllByRole('columnheader')).toHaveLength(3);
  },
};

export const BlockquoteAndRule: Story = {
  args: { children: QUOTE },
};

/** Fenced code in several languages → kit CodeBlock (language header, copy, lazy Shiki). */
export const FencedCode: Story = {
  args: { children: CODE },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('src/greet.ts')).toBeInTheDocument();
    await expect(canvas.getAllByRole('button', { name: 'Copy' })).toHaveLength(4);
    // Shiki loads its grammar on first use; under three parallel appearance projects that can take >10 s.
    await waitFor(() => expect(canvasElement.innerHTML).toContain('--syntax-'), { timeout: 30_000 });
  },
};

/**
 * Streaming: an unterminated `**bold` is repaired (no literal asterisks) and
 * the 2px caret sits right after the last word, inside the bold run.
 */
export const StreamingIncompleteBold: Story = {
  args: { children: INCOMPLETE_BOLD, streaming: true },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvasElement.textContent).not.toContain('**');
    const strong = canvas.getByText(/important part is the guard/).closest('strong');
    await expect(strong).not.toBeNull();
    await expect(strong!.querySelector('span[aria-hidden="true"].bg-fg')).not.toBeNull();
  },
};

/** Streaming: an unterminated fence renders as a (not yet highlighted) code block, caret below it. */
export const StreamingIncompleteFence: Story = {
  args: { children: INCOMPLETE_FENCE, streaming: true },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent).not.toContain('```');
    await expect(canvasElement.querySelector('pre')?.textContent).toContain('return null;');
    await expect(canvasElement.querySelector('span[aria-hidden="true"].bg-fg')).not.toBeNull();
  },
};

const STREAM_SOURCE = `${PROSE}\n\n${LISTS}\n\n${CODE}`;

function LiveStream() {
  const [length, setLength] = useState(0);
  useEffect(() => {
    if (length >= STREAM_SOURCE.length) return;
    const id = setTimeout(() => setLength((n) => Math.min(STREAM_SOURCE.length, n + 6)), 16);
    return () => clearTimeout(id);
  }, [length]);
  const done = length >= STREAM_SOURCE.length;
  return <Markdown streaming={!done}>{STREAM_SOURCE.slice(0, length)}</Markdown>;
}

/** Tokens arriving over time; settles into the static (single-parse) render when done. */
export const Streaming: Story = {
  render: () => <LiveStream />,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.textContent).toContain('second line'), { timeout: 30_000 });
    await waitFor(() => expect(canvasElement.querySelector('span[aria-hidden="true"].bg-fg')).toBeNull());
  },
};

/** Empty source renders nothing (while streaming: just the caret). */
export const Empty: Story = {
  args: { children: '' },
};

export const EmptyStreaming: Story = {
  args: { children: '', streaming: true },
};
