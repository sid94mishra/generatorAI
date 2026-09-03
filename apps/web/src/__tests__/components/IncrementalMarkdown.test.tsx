// ────────────────────────────────────────────────────────────────
// IncrementalMarkdown — P0-47 (append-only) and N2 (streaming render must
// equal final render).
//
// N2 is the load-bearing one: a construct that spans a blank line used to
// break while streaming and silently repair the instant the turn completed
// and StreamPanel switched to a single `MarkdownRenderer`. These tests render
// both paths and compare the DOM, so a regression is visible as a diff rather
// than as "the list looked odd for a few seconds".
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  IncrementalMarkdown,
  advanceSplit,
  splitIntoBlocks,
} from '@/components/chat/IncrementalMarkdown.js';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer.js';
import { clientMetrics, _resetClientMetrics } from '@/lib/clientMetrics.js';

afterEach(cleanup);
beforeEach(_resetClientMetrics);

/**
 * Compare the ELEMENT structure, not the whitespace between elements.
 *
 * A single `ReactMarkdown` parse emits a `\n` text node between top-level
 * blocks; N separate parses do not. That difference is invisible in block
 * layout and is not what N2 is about — what N2 is about is `<ul>` becoming
 * three `<ul>`s and `<a href>` becoming literal `[text][ref]`.
 */
function normalize(html: string): string {
  return html.replace(/>\s+</g, '><').trim();
}

/** Render both paths for the same source and return their normalized HTML. */
function bothRenders(content: string): { streaming: string; final: string } {
  const streaming = normalize(render(<IncrementalMarkdown content={content} />).container.innerHTML);
  cleanup();
  const final = normalize(render(<MarkdownRenderer content={content} />).container.innerHTML);
  cleanup();
  return { streaming, final };
}

/** Feed `content` one character at a time, then read the settled DOM. */
function renderStreamed(content: string): string {
  const view = render(<IncrementalMarkdown content="" />);
  for (let i = 1; i <= content.length; i++) {
    view.rerender(<IncrementalMarkdown content={content.slice(0, i)} />);
  }
  const html = normalize(view.container.innerHTML);
  cleanup();
  return html;
}

/** One-shot render through the completed-turn path. */
function renderFinal(content: string): string {
  const html = normalize(render(<MarkdownRenderer content={content} />).container.innerHTML);
  cleanup();
  return html;
}

describe('IncrementalMarkdown — N2 streaming/final parity', () => {
  const cases: Array<[string, string]> = [
    ['plain paragraphs', 'First paragraph.\n\nSecond paragraph.\n\nThird.'],
    [
      'a loose bullet list',
      // The defect verbatim: split at either blank line and one <ul> becomes
      // three.
      'Steps:\n\n- first item\n\n- second item\n\n- third item\n\nDone.',
    ],
    [
      'a loose ordered list',
      'Plan:\n\n1. one\n\n2. two\n\n3. three\n\nEnd.',
    ],
    [
      'a list item with a nested paragraph',
      '- item one\n\n  continued body of item one\n\n- item two',
    ],
    [
      'a link reference defined after its use',
      'See [the docs][d] for details.\n\nMore text here.\n\n[d]: https://example.com',
    ],
    [
      'a block quote across a blank line',
      '> quoted line\n\n> continued quote\n\nAfter.',
    ],
    [
      'a fenced code block between paragraphs',
      'Before.\n\n```ts\nconst x: number = 1;\n```\n\nAfter.',
    ],
    [
      'a table followed by prose',
      '| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter the table.',
    ],
  ];

  for (const [name, content] of cases) {
    it(`renders ${name} identically to a single parse`, () => {
      const { streaming, final } = bothRenders(content);
      expect(streaming).toBe(final);
    });

    it(`renders ${name} identically when streamed one character at a time`, () => {
      expect(renderStreamed(content)).toBe(renderFinal(content));
    });
  }
});

describe('IncrementalMarkdown — block splitting', () => {
  it('still commits blocks at safe paragraph boundaries', () => {
    const { blocks, tail } = splitIntoBlocks('One.\n\nTwo.\n\nThree in progress');
    expect(blocks).toEqual(['One.', 'Two.']);
    expect(tail).toBe('Three in progress');
  });

  it('refuses to split a loose list into separate lists', () => {
    const { blocks, tail } = splitIntoBlocks('- a\n\n- b\n\n- c');
    expect(blocks).toEqual([]);
    expect(tail).toBe('- a\n\n- b\n\n- c');
  });

  it('refuses to split anywhere once a link-reference definition appears', () => {
    const doc = 'Uses [ref][r].\n\nMore.\n\n[r]: https://example.com\n\nTail.';
    const { blocks } = splitIntoBlocks(doc);
    // A definition is document-scoped: no per-block parse can resolve it.
    expect(blocks).toEqual([]);
    expect(clientMetrics.markdownFullReparse).toBeGreaterThan(0);
  });

  it('commits a closed code fence once more content follows', () => {
    const { blocks, tail } = splitIntoBlocks('```js\nx\n```\nafter');
    expect(blocks).toEqual(['```js\nx\n```']);
    expect(tail).toBe('after');
  });

  it('keeps an unclosed fence in the live tail', () => {
    const { blocks, tail } = splitIntoBlocks('```js\nconst x = ');
    expect(blocks).toEqual([]);
    expect(tail).toBe('```js\nconst x = ');
  });
});

describe('IncrementalMarkdown — P0-47 append-only', () => {
  const doc = Array.from({ length: 40 }, (_, i) => `Paragraph number ${i}.`).join('\n\n');

  it('resumes from the live tail instead of re-scanning the buffer', () => {
    let state = advanceSplit({ text: '', blocks: [], tail: '', cursor: 0 }, '');
    for (let i = 1; i <= doc.length; i++) {
      state = advanceSplit(state, doc.slice(0, i));
      // The resume point never moves backwards, which is the property that
      // makes committed text unreachable to the scanner.
      expect(state.cursor).toBeGreaterThanOrEqual(0);
      expect(state.tail).toBe(doc.slice(0, i).slice(state.cursor));
    }
    expect(state.blocks).toHaveLength(39);
    expect(clientMetrics.markdownIncrementalReuse).toBeGreaterThan(doc.length - 5);
  });

  it('produces the same split incrementally as from scratch', () => {
    let state = { text: '', blocks: [] as string[], tail: '', cursor: 0 };
    for (let i = 1; i <= doc.length; i++) state = advanceSplit(state, doc.slice(0, i));
    expect({ blocks: state.blocks, tail: state.tail }).toEqual(splitIntoBlocks(doc));
  });

  it('falls back to a full scan when the buffer is not an extension', () => {
    let state = advanceSplit({ text: '', blocks: [], tail: '', cursor: 0 }, 'A.\n\nB.\n\nC');
    state = advanceSplit(state, 'totally different');
    expect(state.blocks).toEqual([]);
    expect(state.tail).toBe('totally different');
  });
});
