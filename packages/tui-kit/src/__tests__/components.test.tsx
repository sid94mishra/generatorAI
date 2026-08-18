import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString, Text } from 'ink';
import { detectTerminal } from '@generatorai/cli-core';
import {
  ThemeProvider,
  StatusPill,
  Badge,
  EmptyState,
  Table,
  VirtualList,
  Tree,
  ProgressBar,
  ContextGauge,
  Panel,
  Tabs,
  StatusBar,
  Overlay,
  KeyHints,
  prettyChord,
  Markdown,
  CodeBlock,
  DiffView,
  parseDiffLines,
  Dag,
  JsonView,
} from '../index.js';

const WIDTHS = [80, 120, 200];
const LADDERS = ['truecolor', 'ansi256', 'ansi16', 'none'] as const;

const COLOR_ENV: Record<(typeof LADDERS)[number], NodeJS.ProcessEnv> = {
  truecolor: { COLORTERM: 'truecolor', TERM_PROGRAM: 'ghostty' },
  ansi256: { TERM: 'xterm-256color' },
  ansi16: { TERM: 'xterm' },
  none: { NO_COLOR: '1' },
};

function draw(
  node: React.ReactNode,
  columns = 120,
  ladder: (typeof LADDERS)[number] = 'truecolor',
): string {
  const capabilities = detectTerminal({
    env: COLOR_ENV[ladder],
    stdout: { isTTY: true, columns, rows: 40 },
    stdin: { isTTY: true },
    platform: 'linux',
  });
  return renderToString(
    <ThemeProvider capabilities={capabilities} theme="tokyo-night" appearance="dark">
      {node}
    </ThemeProvider>,
    { columns },
  );
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;]*m/g;
const plain = (frame: string): string => frame.replace(ANSI, '');

/** Nothing may exceed the terminal width, or the layout wraps and tears. */
function expectFits(frame: string, columns: number): void {
  for (const line of plain(frame).split('\n')) {
    expect(line.length, JSON.stringify(line)).toBeLessThanOrEqual(columns);
  }
}

const rows = Array.from({ length: 40 }, (_, i) => ({
  id: `run-${i}`,
  name: `nightly-${i}`,
  status: i % 3 === 0 ? 'running' : i % 3 === 1 ? 'completed' : 'failed',
}));

const columns = [
  { key: 'id', header: 'ID', width: 12 },
  { key: 'name', header: 'Name' },
  { key: 'status', header: 'Status' },
];

describe('status primitives', () => {
  it.each(['running', 'completed', 'failed', 'paused', 'pending', 'cancelled'])(
    'renders %s with a glyph so colour is never the only signal',
    (status) => {
      const frame = plain(draw(<StatusPill status={status} />, 80, 'none'));
      expect(frame.trim().length).toBeGreaterThan(0);
    },
  );

  it('does not crash on a null status', () => {
    expect(() => draw(<StatusPill status={null} />)).not.toThrow();
  });

  it('renders a badge with its label', () => {
    expect(draw(<Badge>v2</Badge>)).toContain('v2');
  });
});

describe('EmptyState', () => {
  it('shows the title, hint and action', () => {
    const frame = plain(draw(<EmptyState title="No runs yet" hint="Try run start" action="run start" />));
    expect(frame).toContain('No runs yet');
    expect(frame).toContain('Try run start');
  });
});

describe('Table', () => {
  it.each(WIDTHS)('fits within %i columns', (width) => {
    expectFits(draw(<Table rows={rows} columns={columns} height={9} />, width), width);
  });

  it.each(LADDERS)('renders on the %s ladder', (ladder) => {
    const frame = draw(<Table rows={rows} columns={columns} height={5} />, 120, ladder);
    expect(plain(frame)).toContain('nightly-0');
    if (ladder === 'none') expect(frame).not.toContain('\u001B[');
  });

  it('renders headers and the visible window only', () => {
    const frame = plain(draw(<Table rows={rows} columns={columns} height={6} />));
    expect(frame).toContain('Name');
    expect(frame).toContain('nightly-0');
    // Virtualised: 40 rows must not all be drawn into a 6-row viewport.
    expect(frame).not.toContain('nightly-39');
  });

  it('scrolls the window to keep the selection visible', () => {
    const frame = plain(draw(<Table rows={rows} columns={columns} height={6} selectedIndex={39} />));
    expect(frame).toContain('nightly-39');
  });

  it('truncates rather than wrapping a long cell', () => {
    const wide = [{ id: 'x', name: 'n'.repeat(400), status: 'running' }];
    expectFits(draw(<Table rows={wide} columns={columns} height={3} />, 80), 80);
  });

  it('falls back to an empty state with no rows', () => {
    const frame = plain(draw(<Table rows={[]} columns={columns} height={5} emptyMessage="No runs." />));
    expect(frame).toContain('No runs.');
  });
});

describe('VirtualList', () => {
  const render = (selectedIndex: number, height = 10, width = 120): string =>
    plain(
      draw(
        <VirtualList
          items={rows}
          height={height}
          selectedIndex={selectedIndex}
          renderItem={(r) => <Text>{r.name}</Text>}
        />,
        width,
      ),
    );

  it('renders only a window of a long list', () => {
    const frame = render(0);
    expect(frame).toContain('nightly-0');
    expect(frame).not.toContain('nightly-39');
  });

  it('scrolls the window to keep the selection visible', () => {
    expect(render(39)).toContain('nightly-39');
  });

  it.each(WIDTHS)('fits within %i columns', (width) => {
    expectFits(render(2, 8, width), width);
  });

  it('shows an empty state for no items', () => {
    const frame = plain(
      draw(
        <VirtualList
          items={[]}
          height={5}
          selectedIndex={0}
          renderItem={() => <Text> </Text>}
          emptyMessage="Nothing."
        />,
      ),
    );
    expect(frame).toContain('Nothing.');
  });
});

describe('layout', () => {
  it.each(WIDTHS)('Panel fits within %i columns', (width) => {
    expectFits(draw(<Panel title="Changes"><Text>body</Text></Panel>, width), width);
  });

  it('Panel shows its title and subtitle', () => {
    const frame = plain(
      draw(
        <Panel title="Changes" subtitle="3 files">
          <Text>body</Text>
        </Panel>,
      ),
    );
    expect(frame).toContain('Changes');
    expect(frame).toContain('3 files');
  });

  it('Tabs numbers tabs to match the jump bindings', () => {
    const frame = plain(
      draw(<Tabs items={[{ id: 'a', label: 'Chat' }, { id: 'b', label: 'Run' }]} activeId="a" />),
    );
    expect(frame).toContain('Chat');
    expect(frame).toContain('Run');
    expect(frame).toContain('1');
  });

  it('Tabs elides rather than wrapping when there are too many', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, label: `tab-${i}` }));
    const frame = draw(<Tabs items={many} activeId="t0" />, 80);
    expectFits(frame, 80);
    // Wrapping would change the bar's height and shift the whole layout.
    expect(plain(frame).split('\n').filter((l) => l.trim()).length).toBeLessThanOrEqual(2);
  });

  it.each(WIDTHS)('StatusBar fits within %i columns', (width) => {
    expectFits(
      draw(
        <StatusBar
          left={[{ text: 'connected', tone: 'success' }]}
          right={[{ text: 'ctrl+k palette' }]}
        />,
        width,
      ),
      width,
    );
  });

  it('StatusBar truncates rather than wrapping on overflow', () => {
    expectFits(
      draw(
        <StatusBar left={[{ text: 'x'.repeat(200) }]} right={[{ text: 'y'.repeat(200) }]} />,
        80,
      ),
      80,
    );
  });

  it.each(WIDTHS)('Overlay fits within %i columns', (width) => {
    expectFits(draw(<Overlay title="Help"><Text>content</Text></Overlay>, width), width);
  });

  it('KeyHints renders each chord and label', () => {
    const frame = plain(draw(<KeyHints hints={[{ keys: 'ctrl+k', label: 'Palette' }]} />));
    expect(frame).toContain('Palette');
  });
});

describe('prettyChord', () => {
  it('renders a readable form of each chord', () => {
    expect(prettyChord('ctrl+k')).toMatch(/k/i);
    expect(prettyChord('shift+r')).toMatch(/r/i);
    expect(prettyChord('escape').length).toBeGreaterThan(0);
  });
});

describe('content', () => {
  const md = [
    '# Heading',
    '',
    'Some **bold** and `code`.',
    '',
    '- one',
    '- two',
    '',
    '```ts',
    'const x: number = 1;',
    '```',
  ].join('\n');

  it('renders markdown headings, lists and code', () => {
    const frame = plain(draw(<Markdown content={md} width={100} />));
    expect(frame).toContain('Heading');
    expect(frame).toContain('one');
    expect(frame).toContain('const x');
  });

  it('emits text verbatim while streaming', () => {
    // Re-flowing markdown on every token makes the pane jitter.
    const frame = plain(draw(<Markdown content="partial **bo" streaming width={80} />));
    expect(frame).toContain('partial');
  });

  it('shows raw text rather than a parser error on malformed markdown', () => {
    const frame = plain(draw(<Markdown content={'```ts\nconst broken = ('} width={80} />));
    expect(frame.length).toBeGreaterThan(0);
  });

  it.each(WIDTHS)('markdown fits within %i columns', (width) => {
    expectFits(draw(<Markdown content={md} width={width - 4} />, width), width);
  });

  it('renders a highlighted code block', () => {
    expect(plain(draw(<CodeBlock code="const x = 1;" language="ts" />))).toContain('const');
  });

  it('renders line numbers when asked', () => {
    const frame = plain(draw(<CodeBlock code={'a\nb'} language="ts" showLineNumbers startLine={7} />));
    expect(frame).toContain('7');
  });

  it('does not throw on an unknown language', () => {
    expect(() => draw(<CodeBlock code="???" language="not-a-language" />)).not.toThrow();
  });

  it('renders JSON', () => {
    expect(plain(draw(<JsonView value={{ a: 1, b: [2, 3] }} />))).toContain('a');
  });

  it('renders a value JSON cannot serialise', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => draw(<JsonView value={cyclic} />)).not.toThrow();
  });
});

describe('DiffView', () => {
  const patch = [
    'diff --git a/src/auth.ts b/src/auth.ts',
    '--- a/src/auth.ts',
    '+++ b/src/auth.ts',
    '@@ -1,4 +1,5 @@',
    ' import x from "y";',
    '-const key: string = "";',
    '+const key: CryptoKey = k;',
    '+const thumb = "";',
    ' export {};',
  ].join('\n');

  const lines = parseDiffLines(patch);

  it('parses added, removed, context and hunk lines', () => {
    expect(lines.some((l) => l.type === 'add')).toBe(true);
    expect(lines.some((l) => l.type === 'remove')).toBe(true);
    expect(lines.some((l) => l.type === 'context')).toBe(true);
    expect(lines.some((l) => l.type === 'hunk')).toBe(true);
  });

  it('numbers old and new sides from the hunk header', () => {
    const added = lines.find((l) => l.type === 'add');
    const removed = lines.find((l) => l.type === 'remove');
    expect(added?.newLine).toBeGreaterThan(0);
    expect(removed?.oldLine).toBeGreaterThan(0);
  });

  it('renders the change', () => {
    expect(plain(draw(<DiffView lines={lines} />))).toContain('CryptoKey');
  });

  it.each(WIDTHS)('unified fits within %i columns', (width) => {
    expectFits(draw(<DiffView lines={lines} />, width), width);
  });

  it('renders split layout on a wide terminal', () => {
    expectFits(draw(<DiffView lines={lines} layout="split" />, 200), 200);
  });

  it('handles an empty patch', () => {
    expect(parseDiffLines('')).toEqual([]);
    expect(() => draw(<DiffView lines={[]} />)).not.toThrow();
  });
});

describe('Dag', () => {
  const stages = [
    { id: 's1', name: 'plan', status: 'completed' },
    { id: 's2', name: 'build', status: 'running' },
    { id: 's3', name: 'test', status: 'pending' },
  ];
  const edges = [
    { fromStageId: 's1', toStageId: 's2', edgeType: 'on_success' },
    { fromStageId: 's2', toStageId: 's3', edgeType: 'on_success' },
  ];

  it('renders every stage name on a wide terminal', () => {
    const frame = plain(draw(<Dag stages={stages} edges={edges} height={20} />, 160));
    for (const s of stages) expect(frame).toContain(s.name);
  });

  it.each(WIDTHS)('fits within %i columns', (width) => {
    expectFits(draw(<Dag stages={stages} edges={edges} height={20} />, width), width);
  });

  it('falls back to an indented tree below 100 columns', () => {
    const frame = draw(<Dag stages={stages} edges={edges} height={20} />, 80);
    expectFits(frame, 80);
    expect(plain(frame)).toContain('plan');
  });

  it('handles an empty graph', () => {
    expect(() => draw(<Dag stages={[]} edges={[]} height={10} />)).not.toThrow();
  });

  it('reports a cycle instead of spinning on it', () => {
    const cyclic = [
      { fromStageId: 's1', toStageId: 's2', edgeType: 'always' },
      { fromStageId: 's2', toStageId: 's1', edgeType: 'always' },
    ];
    const frame = plain(draw(<Dag stages={stages.slice(0, 2)} edges={cyclic} height={10} />, 80));
    expect(frame.toLowerCase()).toContain('cycle');
  });
});

describe('gauges', () => {
  it.each([0, 0.5, 1])('ProgressBar renders at %s', (value) => {
    expect(() => draw(<ProgressBar value={value} width={40} />)).not.toThrow();
  });

  it('clamps an out-of-range progress value', () => {
    expectFits(draw(<ProgressBar value={5} width={40} />, 80), 80);
    expectFits(draw(<ProgressBar value={-5} width={40} />, 80), 80);
  });

  it('survives a zero max', () => {
    expect(() => draw(<ProgressBar value={1} max={0} width={20} />)).not.toThrow();
  });

  it('ContextGauge renders a percentage', () => {
    expect(plain(draw(<ContextGauge used={42_000} total={100_000} />))).toContain('42');
  });

  it('ContextGauge survives a zero total', () => {
    expect(() => draw(<ContextGauge used={0} total={0} />)).not.toThrow();
  });
});

describe('Tree', () => {
  it('renders nested nodes', () => {
    const frame = plain(
      draw(
        <Tree
          nodes={[
            { id: 'a', label: 'src', depth: 0, isLast: false },
            { id: 'b', label: 'auth.ts', depth: 1, isLast: true },
          ]}
          height={10}
        />,
      ),
    );
    expect(frame).toContain('src');
    expect(frame).toContain('auth.ts');
  });
});
