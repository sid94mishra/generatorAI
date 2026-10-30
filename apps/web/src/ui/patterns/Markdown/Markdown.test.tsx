import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const codeBlockRenders = vi.hoisted(() => ({ count: 0 }));

// Count CodeBlock renders (the block-memo check below) without pulling Shiki into the unit run.
vi.mock('../CodeBlock/CodeBlock.js', () => ({
  CodeBlock: ({ children, lang, header, copy }: { children: string; lang?: string; header?: React.ReactNode; copy?: string }) => {
    codeBlockRenders.count += 1;
    return (
      <div data-testid="code-block" data-lang={lang ?? ''} data-copy={copy}>
        <div data-testid="code-header">{header}</div>
        <pre>{children}</pre>
      </div>
    );
  },
}));

import { Markdown } from './Markdown.js';

/** The old streaming caret (removed in D-160): a host mark or the bar element. */
const CARET = '[data-gai-caret], span[aria-hidden="true"].caret-stream';

describe('Markdown', () => {
  it('renders GFM prose with design-vocabulary elements', () => {
    const { container } = render(
      <Markdown>{'# Title\n\nsome `code` here and **bold**\n\n- a\n- b\n\n| h |\n| - |\n| c |'}</Markdown>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
    expect(screen.getByText('code').tagName).toBe('CODE');
    expect(screen.getByText('code').className).toContain('bg-selected');
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
    // Nothing of Streamdown's own chrome: no table copy/download controls.
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('routes fenced code to CodeBlock with the fence language, meta and copy text', () => {
    render(<Markdown>{'```ts src/a.ts\nconst a = 1;\n```'}</Markdown>);
    const block = screen.getByTestId('code-block');
    expect(block.dataset.lang).toBe('ts');
    expect(block.dataset.copy).toBe('const a = 1;');
    expect(screen.getByTestId('code-header').textContent).toBe('tssrc/a.ts');
  });

  it('opens links in a new tab without a referrer, except in-page anchors', () => {
    render(<Markdown>{'[out](https://example.com) [rel](./docs/a.md) [here](#top)'}</Markdown>);
    for (const name of ['out', 'rel']) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
    }
    expect(screen.getByRole('link', { name: 'here' })).not.toHaveAttribute('target');
  });

  it('keeps Streamdown’s sanitising: no script, no javascript: URLs, no event handlers', () => {
    const { container } = render(
      <Markdown>{'[x](javascript:alert(1))\n\n<script>alert(1)</script>\n\n<img src="a.png" onerror="alert(1)">'}</Markdown>,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.innerHTML).not.toContain('onerror');
    // rehype-harden's "[blocked]" indicator is restyled with kit classes (no palette class).
    expect(screen.getByText(/\[blocked\]/).className).toBe('text-fg-3');
  });

  it('repairs incomplete markdown while streaming, with no caret (D-160)', () => {
    const { container } = render(<Markdown streaming>{'Intro.\n\nThe **important part'}</Markdown>);
    expect(container.textContent).not.toContain('**');
    expect(container.querySelector('strong')?.textContent).toBe('important part');
    expect(container.querySelector(CARET)).toBeNull();
  });

  it('renders an unterminated fence as a plain (not yet highlighted) code block', () => {
    render(<Markdown streaming>{'```ts\nif (!user) {\n  return null;'}</Markdown>);
    const block = screen.getByTestId('code-block');
    expect(block.textContent).toContain('return null;');
    expect(block.dataset.lang).toBe('');
  });

  it('renders nothing for an empty message, streaming or not', () => {
    const streaming = render(<Markdown streaming>{''}</Markdown>);
    expect(streaming.container.textContent).toBe('');
    expect(streaming.container.querySelector(CARET)).toBeNull();
    const idle = render(<Markdown>{''}</Markdown>);
    expect(idle.container.textContent).toBe('');
  });

  it('re-renders only the tail block while streaming', () => {
    const head = 'Intro.\n\n```ts\nconst a = 1;\n```\n\n';
    const { rerender } = render(<Markdown streaming>{`${head}Tail`}</Markdown>);
    const before = codeBlockRenders.count;
    rerender(<Markdown streaming>{`${head}Tail grows`}</Markdown>);
    rerender(<Markdown streaming>{`${head}Tail grows more`}</Markdown>);
    expect(codeBlockRenders.count).toBe(before);
    expect(screen.getByText(/Tail grows more/)).toBeInTheDocument();
  });

  it('applies the compact size', () => {
    const { container } = render(<Markdown size="compact">{'text with `code`'}</Markdown>);
    expect((container.firstChild as HTMLElement).className).toContain('text-small');
    expect(screen.getByText('code').className).toContain('text-micro');
  });
});
