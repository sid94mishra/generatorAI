// ────────────────────────────────────────────────────────────────
// W27 / P0-47 — highlighting is off the main thread.
//
// The regression this pins: `rehype-highlight` ran inside the unified
// pipeline, inside React's render, on the thread that paints — once per code
// block per token of a streaming answer. Against the pre-fix renderer the
// first assertion below fails, because the markup came back already coloured
// from a synchronous highlight pass.
//
// The rest covers the pieces that pass mattered: the grammar subset (the
// explicit list that replaced highlight.js's ~190-grammar bundle), and the
// markup → token conversion that keeps model-authored content off
// `dangerouslySetInnerHTML`.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer.js';
import { resolveLanguage, GRAMMAR_NAMES } from '@/lib/highlight/languageNames.js';
import { decodeEntities, tokenizeHighlightHtml } from '@/lib/highlight/tokenize.js';
import { highlightBlock } from '@/lib/highlight/highlight.worker.js';
import { _resetHighlightClientForTests, highlightCode, peekHighlight } from '@/lib/highlight/client.js';

afterEach(() => {
  cleanup();
  _resetHighlightClientForTests();
});

const FENCE = '```ts\nconst answer: number = 42;\n```\n';

describe('P0-47 — the chat path does not highlight synchronously', () => {
  it('renders a fenced block with no highlight markup on the render pass', () => {
    const { container } = render(<MarkdownRenderer content={FENCE} />);

    // happy-dom provides no `Worker`, so highlighting can never complete here.
    // That is the point: if ANY hljs span exists, highlighting ran on this
    // thread during render — which is the defect.
    // `span`, because the <pre> wrapper carries a static `hljs-pre` styling
    // class of our own — highlight output is always spans.
    expect(container.querySelectorAll('span[class*="hljs-"]')).toHaveLength(0);
    expect(container.querySelector('code')?.className).not.toContain('hljs ');

    // …and the code itself is still fully rendered. Moving highlighting off
    // the render path must not cost the content.
    const code = container.querySelector('code');
    expect(code?.textContent).toContain('const answer: number = 42;');
    expect(code?.className).toContain('language-ts');
  });

  it('degrades to plain text when no Worker exists rather than throwing', async () => {
    // The no-Worker path must resolve, not hang: a component awaiting a
    // promise that never settles leaks a subscription per code block.
    await expect(highlightCode('typescript', 'const a = 1;')).resolves.toEqual([]);
    expect(peekHighlight('typescript', 'const a = 1;')).toBeNull();
  });

  it('still renders the language chip and copy affordance', () => {
    const { container } = render(<MarkdownRenderer content={FENCE} />);
    expect(container.textContent).toContain('ts');
    expect(container.querySelector('button[aria-label="Copy code"]')).not.toBeNull();
  });
});

describe('P0-47 — the grammar subset', () => {
  it('resolves the aliases a model actually writes', () => {
    expect(resolveLanguage('ts')).toBe('typescript');
    expect(resolveLanguage('tsx')).toBe('typescript');
    expect(resolveLanguage('  TSX ')).toBe('typescript');
    expect(resolveLanguage('yml')).toBe('yaml');
    expect(resolveLanguage('html')).toBe('xml');
    expect(resolveLanguage('sh')).toBe('bash');
  });

  it('returns null rather than guessing for a grammar we do not ship', () => {
    // `detect: true` is what guessing looked like, and it was removed on
    // purpose. Anything outside the subset renders as plain text.
    expect(resolveLanguage('brainfuck')).toBeNull();
    expect(resolveLanguage('')).toBeNull();
    expect(resolveLanguage(undefined)).toBeNull();
  });

  it('keeps the subset a subset', () => {
    // A guard against someone re-importing `highlight.js` whole: the value of
    // this list is that it is short.
    expect(GRAMMAR_NAMES.length).toBeLessThan(40);
    expect(GRAMMAR_NAMES).toContain('typescript');
  });
});

describe('P0-47 — worker-side highlighting', () => {
  it('produces class-tagged tokens for a known grammar', () => {
    const tokens = highlightBlock('typescript', 'const a = 1;');
    expect(tokens.length).toBeGreaterThan(1);
    expect(tokens.some(([cls]) => cls.includes('hljs-keyword'))).toBe(true);
    // The text must survive intact — colour is decoration, code is content.
    expect(tokens.map(([, text]) => text).join('')).toBe('const a = 1;');
  });

  it('returns nothing for an unknown grammar', () => {
    expect(highlightBlock('brainfuck', '+++.')).toEqual([]);
  });

  it('highlights a syntactically incomplete fragment', () => {
    // A fence mid-stream is almost always incomplete; throwing on those would
    // leave the most common case unhighlighted.
    const tokens = highlightBlock('typescript', 'function partial(a: number) {');
    expect(tokens.map(([, text]) => text).join('')).toBe('function partial(a: number) {');
  });
});

describe('P0-47 — markup → tokens (no innerHTML on the model-content path)', () => {
  it('flattens nested spans to a joined class chain', () => {
    expect(
      tokenizeHighlightHtml('<span class="hljs-a">x<span class="hljs-b">y</span>z</span>'),
    ).toEqual([
      ['hljs-a', 'x'],
      ['hljs-a hljs-b', 'y'],
      ['hljs-a', 'z'],
    ]);
  });

  it('decodes the entities highlight.js emits', () => {
    expect(tokenizeHighlightHtml('a &lt;b&gt; &amp; c')).toEqual([['', 'a <b> & c']]);
    expect(decodeEntities('&#x27;&#39;&quot;')).toBe(`''"`);
  });

  it('merges adjacent runs sharing a class', () => {
    expect(tokenizeHighlightHtml('a&amp;b')).toEqual([['', 'a&b']]);
  });

  it('never loses text to unbalanced markup', () => {
    // A stray close tag or an unclosed span must cost colour, never characters.
    expect(tokenizeHighlightHtml('</span>keep me').map(([, t]) => t).join('')).toBe('keep me');
    expect(tokenizeHighlightHtml('<span class="x">unclosed').map(([, t]) => t).join('')).toBe(
      'unclosed',
    );
    expect(tokenizeHighlightHtml('a < b').map(([, t]) => t).join('')).toBe('a < b');
  });

  it('round-trips real highlight.js output back to the original source', () => {
    const source = 'if (a < b && c) {\n  return "x&y";\n}\n';
    const tokens = highlightBlock('javascript', source);
    expect(tokens.map(([, text]) => text).join('')).toBe(source);
  });
});
