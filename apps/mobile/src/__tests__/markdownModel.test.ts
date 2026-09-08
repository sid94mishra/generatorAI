import { describe, expect, it } from 'vitest';

import {
  closeUnterminated,
  decodeEntities,
  endsInsideFence,
  estimateColumnWidths,
  inlineText,
  parseMarkdown,
  splitFenceInfo,
  TABLE_COLUMN_MAX,
  TABLE_COLUMN_MIN,
  type BlockNode,
  type InlineNode,
} from '../components/markdown/markdownModel';

function only<T extends BlockNode['type']>(content: string, type: T): Extract<BlockNode, { type: T }> {
  const tree = parseMarkdown(content);
  expect(tree).toHaveLength(1);
  const node = tree[0]!;
  expect(node.type).toBe(type);
  return node as Extract<BlockNode, { type: T }>;
}

describe('parseMarkdown — blocks', () => {
  it('maps headings h1–h6 with inline children', () => {
    for (let depth = 1; depth <= 6; depth += 1) {
      const node = only(`${'#'.repeat(depth)} Title *em*`, 'heading');
      expect(node.depth).toBe(depth);
      expect(node.children.map((c) => c.type)).toEqual(['text', 'em']);
    }
  });

  it('renders a paragraph with merged text and inline marks', () => {
    const node = only('a **b** c ~~d~~ `e`', 'paragraph');
    expect(node.children.map((c) => c.type)).toEqual(['text', 'strong', 'text', 'del', 'text', 'code']);
    expect(inlineText(node.children)).toBe('a b c d e');
  });

  it('turns a soft line break into a space, matching the web', () => {
    const node = only('line one\nline two', 'paragraph');
    expect(inlineText(node.children)).toBe('line one line two');
  });

  it('keeps a hard break (two trailing spaces) as a br node', () => {
    const node = only('line one  \nline two', 'paragraph');
    expect(node.children.map((c) => c.type)).toEqual(['text', 'br', 'text']);
  });

  it('splits fence info into language and meta', () => {
    const node = only('```ts src/app.ts\nconst a = 1;\n```', 'code');
    expect(node.lang).toBe('ts');
    expect(node.meta).toBe('src/app.ts');
    expect(node.code).toBe('const a = 1;');
  });

  it('lexes an UNTERMINATED fence as code (the streaming case)', () => {
    const node = only('```ts\nconst a = 1;', 'code');
    expect(node.lang).toBe('ts');
    expect(node.code).toBe('const a = 1;');
  });

  it('renders a horizontal rule', () => {
    expect(only('---', 'hr').type).toBe('hr');
  });

  it('keeps unknown block HTML as raw text rather than dropping it', () => {
    const node = only('<div>\nhi\n</div>', 'raw');
    expect(node.text).toBe('<div>\nhi\n</div>');
  });

  it('nests blockquote children as blocks', () => {
    const node = only('> # h\n> para\n> - li', 'blockquote');
    expect(node.children.map((c) => c.type)).toEqual(['heading', 'paragraph', 'list']);
  });

  it('never throws on pathological input', () => {
    const tree = parseMarkdown('[' .repeat(2000) + ']('.repeat(2000));
    expect(tree.length).toBeGreaterThan(0);
  });
});

describe('parseMarkdown — lists', () => {
  it('lexes ordered lists with their start number', () => {
    const node = only('3. three\n4. four', 'list');
    expect(node.ordered).toBe(true);
    expect(node.start).toBe(3);
    expect(node.items).toHaveLength(2);
    expect(node.items[0]!.children[0]).toMatchObject({ type: 'paragraph', tight: true });
  });

  it('lexes task items with checked state', () => {
    const node = only('- [ ] todo\n- [x] done', 'list');
    expect(node.items.map((i) => [i.task, i.checked])).toEqual([
      [true, false],
      [true, true],
    ]);
    expect(inlineText((node.items[0]!.children[0] as { children: InlineNode[] }).children)).toBe('todo');
  });

  it('nests a sub-list inside the parent item', () => {
    const node = only('- a\n  - b\n    - c', 'list');
    const a = node.items[0]!;
    expect(a.children.map((c) => c.type)).toEqual(['paragraph', 'list']);
    const inner = a.children[1] as Extract<BlockNode, { type: 'list' }>;
    expect(inner.items[0]!.children.map((c) => c.type)).toEqual(['paragraph', 'list']);
  });

  it('marks loose items as untight paragraphs', () => {
    const node = only('1. one\n\n   more\n2. two', 'list');
    expect(node.items[0]!.children.map((c) => c.type)).toEqual(['paragraph', 'paragraph']);
    expect(node.items[0]!.children[0]).not.toHaveProperty('tight', true);
  });

  it('keeps a fenced block inside a list item', () => {
    const node = only('- item\n\n  ```js\n  x\n  ```', 'list');
    expect(node.items[0]!.children.map((c) => c.type)).toEqual(['paragraph', 'code']);
  });

  it('flattens inline marks inside a tight item into one run', () => {
    const node = only('- **x** y', 'list');
    const para = node.items[0]!.children[0] as Extract<BlockNode, { type: 'paragraph' }>;
    expect(para.children.map((c) => c.type)).toEqual(['strong', 'text']);
  });
});

describe('parseMarkdown — tables', () => {
  it('lexes header, rows, alignment and inline cell content', () => {
    const node = only('| **a** | b |\n|:--|--:|\n| `1` | 2 |', 'table');
    expect(node.align).toEqual(['left', 'right']);
    expect(node.header[0]![0]!.type).toBe('strong');
    expect(node.rows[0]![0]![0]!.type).toBe('code');
    expect(node.widths).toHaveLength(2);
  });

  it('estimates column widths from the longest cell, clamped', () => {
    const short: InlineNode[] = [{ type: 'text', text: 'a' }];
    const long: InlineNode[] = [{ type: 'text', text: 'x'.repeat(200) }];
    const mid: InlineNode[] = [{ type: 'text', text: 'ten chars.' }];
    const widths = estimateColumnWidths([short, long, mid], [[short, short, mid]]);
    expect(widths[0]).toBe(TABLE_COLUMN_MIN);
    expect(widths[1]).toBe(TABLE_COLUMN_MAX);
    expect(widths[2]).toBeGreaterThan(TABLE_COLUMN_MIN);
    expect(widths[2]).toBeLessThan(TABLE_COLUMN_MAX);
  });
});

describe('parseMarkdown — links and images', () => {
  it('classifies links against the allow-list', () => {
    const node = only('[ok](https://a.b) [bad](javascript:alert(1)) [rel](#x)', 'paragraph');
    const links = node.children.filter((c) => c.type === 'link') as Extract<InlineNode, { type: 'link' }>[];
    expect(links.map((l) => l.allowed)).toEqual([true, false, false]);
    expect(links[1]!.scheme).toBe('javascript');
  });

  it('autolinks bare URLs and e-mail addresses', () => {
    const node = only('see https://a.b/c and foo@bar.com', 'paragraph');
    const links = node.children.filter((c) => c.type === 'link') as Extract<InlineNode, { type: 'link' }>[];
    expect(links.map((l) => l.href)).toEqual(['https://a.b/c', 'mailto:foo@bar.com']);
    expect(links.every((l) => l.allowed)).toBe(true);
  });

  it('promotes a lone image paragraph to a block image', () => {
    const node = only('![alt text](https://x/y.png)', 'image');
    expect(node.alt).toBe('alt text');
    expect(node.allowed).toBe(true);
  });

  it('keeps an inline image inline when surrounded by text', () => {
    const node = only('before ![a](https://x/y.png) after', 'paragraph');
    expect(node.children.map((c) => c.type)).toEqual(['text', 'image', 'text']);
  });

  it('blocks a file: image', () => {
    expect(only('![a](file:///x.png)', 'image').allowed).toBe(false);
  });
});

describe('entities', () => {
  it('decodes the common named and numeric entities', () => {
    expect(decodeEntities('a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39; &#x2014; &#8230;')).toBe(
      'a & b < c > d "e" \'f\' — …',
    );
  });

  it('leaves unknown entities alone', () => {
    expect(decodeEntities('&bogus; &#99999999;')).toBe('&bogus; &#99999999;');
  });

  it('applies to paragraph text and code spans', () => {
    const node = only('a &amp; `b &lt; c`', 'paragraph');
    expect(inlineText(node.children)).toBe('a & b < c');
  });
});

describe('splitFenceInfo', () => {
  it('handles empty, single, and multi-word info strings', () => {
    expect(splitFenceInfo(undefined)).toEqual({ lang: null, meta: null });
    expect(splitFenceInfo('  ')).toEqual({ lang: null, meta: null });
    expect(splitFenceInfo('TS')).toEqual({ lang: 'ts', meta: null });
    expect(splitFenceInfo('ts  src/a.ts  ')).toEqual({ lang: 'ts', meta: 'src/a.ts' });
  });
});

describe('streaming auto-close', () => {
  it('detects an open fence', () => {
    expect(endsInsideFence('```ts\nconst a')).toBe(true);
    expect(endsInsideFence('```ts\nconst a\n```')).toBe(false);
    expect(endsInsideFence('~~~\nx\n~~~\n\ntext')).toBe(false);
  });

  it('does not append anything inside an open fence', () => {
    const src = 'para **bold**\n\n```ts\nconst s = "**unterminated';
    expect(closeUnterminated(src)).toBe(src);
  });

  it('closes unterminated strong / em / strike / code', () => {
    expect(closeUnterminated('some **bold')).toBe('some **bold**');
    expect(closeUnterminated('some *em')).toBe('some *em*');
    expect(closeUnterminated('some ~~gone')).toBe('some ~~gone~~');
    expect(closeUnterminated('some `code')).toBe('some `code`');
    expect(closeUnterminated('some ``co`de')).toBe('some ``co`de``');
  });

  it('closes nested marks innermost-first', () => {
    expect(closeUnterminated('**bold *and em')).toBe('**bold *and em***');
    expect(closeUnterminated('***both')).toBe('***both***');
  });

  it('leaves balanced and non-flanking delimiters alone', () => {
    expect(closeUnterminated('a **b** c')).toBe('a **b** c');
    expect(closeUnterminated('2 * 3 = 6')).toBe('2 * 3 = 6');
    expect(closeUnterminated('snake_case_name')).toBe('snake_case_name');
    expect(closeUnterminated('escaped \\*star')).toBe('escaped \\*star');
  });

  it('only inspects the in-flight paragraph', () => {
    expect(closeUnterminated('**done**\n\nnew **para')).toBe('**done**\n\nnew **para**');
  });

  it('ignores emphasis markers inside an unterminated code span', () => {
    expect(closeUnterminated('run `a ** b')).toBe('run `a ** b`');
  });

  it('is applied by parseMarkdown only in streaming mode', () => {
    const settled = only('some **bold', 'paragraph');
    expect(settled.children.map((c) => c.type)).toEqual(['text']);

    const tree = parseMarkdown('some **bold', { streaming: true });
    expect((tree[0] as Extract<BlockNode, { type: 'paragraph' }>).children.map((c) => c.type)).toEqual([
      'text',
      'strong',
    ]);
  });

  it('shares one parse between the last chunk and the settled block', () => {
    const a = parseMarkdown('plain **bold** text', { streaming: true });
    const b = parseMarkdown('plain **bold** text');
    expect(a).toBe(b);
  });
});
