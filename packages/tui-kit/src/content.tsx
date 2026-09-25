// ────────────────────────────────────────────────────────────────
// Content rendering: markdown, code, diffs, DAGs.
//
// The two-tier markdown strategy is the important part. While tokens are
// streaming the text is passed through raw; only once the turn completes is
// it parsed and formatted. Re-parsing markdown on every token reflows the
// whole message tens of times a second, which reads as the text jittering,
// and it is what every mature agentic TUI ends up doing instead.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { marked, type Token, type Tokens } from 'marked';
import { highlight, supportsLanguage } from 'cli-highlight';
import {
  layoutDag,
  toTree,
  type DagEdge,
  type DagStage,
  type TreeLine,
} from '@generatorai/cli-core';
import { useTheme, type Theme } from './theme.js';
import { useTerminalSize } from './hooks.js';
import { Tree } from './data.js';

// ── Markdown ──────────────────────────────────────────────────────

export interface MarkdownProps {
  content: string;
  /** While true the content is emitted verbatim — no parsing, no reflow. */
  streaming?: boolean;
  width?: number;
}

export function Markdown({ content, streaming = false, width }: MarkdownProps): React.JSX.Element {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const available = width ?? columns - 4;

  const tokens = useMemo(() => {
    if (streaming) return null;
    try {
      return marked.lexer(content);
    } catch {
      // Malformed markdown mid-generation is normal; showing the raw text is
      // strictly better than showing a parser error.
      return null;
    }
  }, [content, streaming]);

  if (!tokens) {
    return <Text wrap="wrap">{content}</Text>;
  }

  return (
    <Box flexDirection="column">
      {tokens.map((token, index) => (
        <MarkdownToken key={index} token={token} theme={theme} width={available} />
      ))}
    </Box>
  );
}

function MarkdownToken({
  token,
  theme,
  width,
}: {
  token: Token;
  theme: Theme;
  width: number;
}): React.JSX.Element | null {
  switch (token.type) {
    case 'heading': {
      const heading = token as Tokens.Heading;
      return (
        <Box marginTop={1}>
          <Text bold color={heading.depth <= 2 ? theme.c('primary') : theme.c('foreground')}>
            {'#'.repeat(heading.depth)} {heading.text}
          </Text>
        </Box>
      );
    }

    case 'paragraph': {
      const paragraph = token as Tokens.Paragraph;
      return (
        <Box marginBottom={1}>
          <Text wrap="wrap">{renderInline(paragraph.tokens ?? [], theme)}</Text>
        </Box>
      );
    }

    case 'code': {
      const code = token as Tokens.Code;
      return <CodeBlock code={code.text} language={code.lang ?? undefined} width={width} />;
    }

    case 'list': {
      const list = token as Tokens.List;
      return (
        <Box flexDirection="column" marginBottom={1}>
          {list.items.map((item, index) => (
            <Text key={index} wrap="wrap">
              <Text color={theme.c('primary')}>
                {list.ordered ? `${(list.start || 1) + index}.` : theme.glyphs.bullet}{' '}
              </Text>
              {renderInline(item.tokens ?? [], theme)}
            </Text>
          ))}
        </Box>
      );
    }

    case 'blockquote': {
      const quote = token as Tokens.Blockquote;
      return (
        <Box marginBottom={1}>
          <Text color={theme.c('muted')}>
            {theme.glyphs.treeVertical}
            {quote.text}
          </Text>
        </Box>
      );
    }

    case 'hr':
      return (
        <Box marginY={1}>
          <Text color={theme.c('borderMuted')}>{'─'.repeat(Math.min(width, 60))}</Text>
        </Box>
      );

    case 'table': {
      const table = token as Tokens.Table;
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={theme.c('muted')}>
            {table.header.map((cell) => cell.text).join('  ')}
          </Text>
          {table.rows.map((row, index) => (
            <Text key={index}>{row.map((cell) => cell.text).join('  ')}</Text>
          ))}
        </Box>
      );
    }

    case 'space':
      return null;

    default:
      return (
        <Text wrap="wrap">{'raw' in token ? String((token as { raw: string }).raw) : ''}</Text>
      );
  }
}

/** Inline emphasis, code spans and links. */
function renderInline(tokens: Token[], theme: Theme): React.ReactNode {
  return tokens.map((token, index) => {
    switch (token.type) {
      case 'strong':
        return (
          <Text key={index} bold>
            {(token as Tokens.Strong).text}
          </Text>
        );
      case 'em':
        return (
          <Text key={index} italic>
            {(token as Tokens.Em).text}
          </Text>
        );
      case 'codespan':
        return (
          <Text key={index} color={theme.c('primary')}>
            {(token as Tokens.Codespan).text}
          </Text>
        );
      case 'link': {
        const link = token as Tokens.Link;
        return (
          <Text key={index} color={theme.c('info')} underline>
            {link.text || link.href}
          </Text>
        );
      }
      case 'del':
        return (
          <Text key={index} strikethrough>
            {(token as Tokens.Del).text}
          </Text>
        );
      case 'br':
        return '\n';
      default:
        return 'text' in token ? String((token as { text: string }).text) : '';
    }
  });
}

// ── Code ──────────────────────────────────────────────────────────

export function CodeBlock({
  code,
  language,
  width,
  showLineNumbers = false,
  startLine = 1,
}: {
  code: string;
  language?: string | undefined;
  width?: number;
  showLineNumbers?: boolean;
  startLine?: number;
}): React.JSX.Element {
  const theme = useTheme();

  const highlighted = useMemo(() => {
    if (theme.ladder === 'none') return code;
    try {
      // `supportsLanguage` first: highlight.js falls back to auto-detection
      // for an unknown language, which is slow and frequently wrong for the
      // short fragments an agent emits.
      if (language && supportsLanguage(language)) {
        return highlight(code, { language, ignoreIllegals: true });
      }
      return code;
    } catch {
      return code;
    }
  }, [code, language, theme.ladder]);

  const lines = highlighted.replace(/\n$/, '').split('\n');
  const gutterWidth = showLineNumbers ? String(startLine + lines.length).length : 0;

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      paddingX={1}
      borderStyle={theme.borderStyle}
      borderColor={theme.c('borderMuted')}
      {...(width ? { width } : {})}
    >
      {language ? (
        <Text color={theme.c('muted')}>{language}</Text>
      ) : null}
      {lines.map((line, index) => (
        <Text key={index}>
          {showLineNumbers ? (
            <Text color={theme.c('muted')}>{String(startLine + index).padStart(gutterWidth)} </Text>
          ) : null}
          {line}
        </Text>
      ))}
    </Box>
  );
}

// ── Diff ──────────────────────────────────────────────────────────

export interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'hunk' | 'meta';
  content: string;
  oldLine?: number | undefined;
  newLine?: number | undefined;
}

export interface DiffViewProps {
  lines: DiffLine[];
  /** Side-by-side needs roughly 160 columns to stay readable. */
  layout?: 'unified' | 'split';
  height?: number;
  /** First line to paint. Clamped, so callers can seek past the end freely. */
  scrollTop?: number;
  showLineNumbers?: boolean;
  /**
   * Index of the line the cursor is on (open question #21).
   *
   * `-1` (the default) means no cursor, which is every caller that only
   * reads a diff. A caller that COMMENTS on a line needs one: `review
   * create`'s `startLine` is required server-side, and without a cursor the
   * only honest way to supply it was to ask the user to type a number.
   */
  selectedIndex?: number;
}

export function DiffView({
  lines,
  layout = 'unified',
  height,
  scrollTop = 0,
  showLineNumbers = true,
  selectedIndex = -1,
}: DiffViewProps): React.JSX.Element {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  // Falling back rather than honouring `split` on a narrow terminal: a
  // side-by-side diff at 80 columns is two 38-column ribbons in which no line
  // of real code is legible.
  const effective = layout === 'split' && columns >= 160 ? 'split' : 'unified';

  if (effective === 'split') return <SplitDiff lines={lines} />;

  // Painting every line of a 4000-line patch into a 20-row box leaves the
  // overflow written over the surrounding chrome, so the window is explicit.
  const window = height && height > 0 ? height : lines.length;
  const first = Math.max(0, Math.min(scrollTop, Math.max(0, lines.length - window)));
  const visible = lines.slice(first, first + window);

  return (
    <Box flexDirection="column">
      {visible.map((line, index) => {
        const { colour, marker } = diffStyle(theme, line.type);
        const isCursor = first + index === selectedIndex;
        return (
          // `inverse` rather than a colour: the row already carries add/
          // remove colour, and overriding it would hide the one thing a
          // diff row is meant to say.
          <Text key={first + index} color={colour} wrap="truncate-end" inverse={isCursor}>
            {showLineNumbers ? (
              <Text color={isCursor ? colour : theme.c('muted')}>
                {String(line.oldLine ?? '').padStart(4)}
                {String(line.newLine ?? '').padStart(5)}{' '}
              </Text>
            ) : null}
            {marker}
            {line.content}
          </Text>
        );
      })}
      {lines.length === 0 ? <Text color={theme.c('muted')}>No changes.</Text> : null}
    </Box>
  );
}

function SplitDiff({ lines }: { lines: DiffLine[] }): React.JSX.Element {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const half = Math.floor((columns - 6) / 2);

  // Pair removals with the additions that replaced them so a modified line
  // shows old and new on the same row.
  const rows: Array<{ left?: DiffLine; right?: DiffLine }> = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.type === 'remove') {
      const removals: DiffLine[] = [];
      while (index < lines.length && lines[index]!.type === 'remove') removals.push(lines[index++]!);
      const additions: DiffLine[] = [];
      while (index < lines.length && lines[index]!.type === 'add') additions.push(lines[index++]!);
      const pairs = Math.max(removals.length, additions.length);
      for (let i = 0; i < pairs; i++) {
        rows.push({
          ...(removals[i] ? { left: removals[i] } : {}),
          ...(additions[i] ? { right: additions[i] } : {}),
        });
      }
      continue;
    }
    if (line.type === 'add') {
      rows.push({ right: line });
      index++;
      continue;
    }
    rows.push({ left: line, right: line });
    index++;
  }

  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        <Box key={i}>
          <Box width={half}>
            <Text color={row.left ? diffStyle(theme, row.left.type).colour : undefined} wrap="truncate-end">
              {row.left ? `${diffStyle(theme, row.left.type).marker}${row.left.content}` : ''}
            </Text>
          </Box>
          <Text color={theme.c('borderMuted')}>{' │ '}</Text>
          <Box width={half}>
            <Text color={row.right ? diffStyle(theme, row.right.type).colour : undefined} wrap="truncate-end">
              {row.right ? `${diffStyle(theme, row.right.type).marker}${row.right.content}` : ''}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function diffStyle(theme: Theme, type: DiffLine['type']): { colour: string | undefined; marker: string } {
  switch (type) {
    case 'add':
      return { colour: theme.c('diffAdded'), marker: '+' };
    case 'remove':
      return { colour: theme.c('diffRemoved'), marker: '-' };
    case 'hunk':
      return { colour: theme.c('info'), marker: '' };
    case 'meta':
      return { colour: theme.c('muted'), marker: '' };
    default:
      return { colour: theme.c('diffContext'), marker: ' ' };
  }
}

/** Parses a unified diff into renderable lines, tracking line numbers. */
export function parseDiffLines(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  // `''.split('\n')` is `['']`, which would otherwise render one blank
  // context row for a file with no changes.
  if (patch.length === 0) return out;

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      out.push({ type: 'hunk', content: raw });
      continue;
    }
    if (raw.startsWith('diff ') || raw.startsWith('index ') || raw.startsWith('--- ') || raw.startsWith('+++ ')) {
      out.push({ type: 'meta', content: raw });
      continue;
    }
    if (raw.startsWith('+')) {
      out.push({ type: 'add', content: raw.slice(1), newLine: newLine++ });
      continue;
    }
    if (raw.startsWith('-')) {
      out.push({ type: 'remove', content: raw.slice(1), oldLine: oldLine++ });
      continue;
    }
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    out.push({ type: 'context', content: raw.slice(1), oldLine: oldLine++, newLine: newLine++ });
  }
  return out;
}

// ── DAG ───────────────────────────────────────────────────────────

export interface DagProps {
  stages: DagStage[];
  edges: DagEdge[];
  height: number;
  selectedId?: string;
}

/**
 * Workflow graph.
 *
 * Below 100 columns a layered graph stops being legible, so the indented tree
 * is used instead. That is a documented fallback, not a degraded graph: a
 * squeezed graph is worse than no graph.
 */
export function Dag({ stages, edges, height, selectedId }: DagProps): React.JSX.Element {
  const theme = useTheme();
  const { columns } = useTerminalSize();

  const layout = useMemo(() => layoutDag(stages, edges), [stages, edges]);
  const tree = useMemo(() => toTree(stages, edges), [stages, edges]);

  if (columns < 100) {
    return (
      <Box flexDirection="column">
        {layout.cycle.length > 0 ? (
          <Text color={theme.c('danger')}>
            {theme.glyphs.failure} This workflow contains a cycle ({layout.cycle.length} stages).
          </Text>
        ) : null}
        <Tree
          nodes={tree.map((line: TreeLine) => ({
            id: line.id,
            label: line.name,
            depth: line.depth,
            isLast: line.isLast,
            status: line.status ?? null,
            repeat: line.repeat,
            ...(line.on && line.on !== 'success' ? { detail: line.on } : {}),
          }))}
          height={height}
          selectedIndex={Math.max(0, tree.findIndex((l) => l.id === selectedId))}
        />
      </Box>
    );
  }

  const columnWidth = Math.min(24, Math.floor((columns - 4) / Math.max(1, layout.layers.length)));

  return (
    <Box flexDirection="column">
      {layout.cycle.length > 0 ? (
        <Text color={theme.c('danger')}>
          {theme.glyphs.failure} Cycle detected — {layout.cycle.length} stages cannot be scheduled.
        </Text>
      ) : null}

      <Box>
        {layout.layers.map((layerIds, layerIndex) => (
          <Box key={layerIndex} flexDirection="column" width={columnWidth} marginRight={2}>
            {layerIds.map((id) => {
              const node = layout.nodes.find((n) => n.id === id)!;
              const selected = id === selectedId;
              const outgoing = edges.filter((e) => e.from === id);
              return (
                <Box key={id} flexDirection="column" marginBottom={1}>
                  <Box
                    borderStyle={theme.borderStyle}
                    borderColor={selected ? theme.c('focusBorder') : theme.c('borderMuted')}
                    paddingX={1}
                  >
                    <Text
                      color={selected ? theme.c('primary') : undefined}
                      bold={selected}
                      wrap="truncate-end"
                    >
                      {node.status ? `${theme.glyphs[toneOf(node.status)]} ` : ''}
                      {node.name}
                    </Text>
                  </Box>
                  {outgoing.length > 0 && layerIndex < layout.layers.length - 1 ? (
                    <Text color={theme.c('borderMuted')}>
                      {'  '}
                      {outgoing.length > 1 ? `├─${outgoing.length}→` : '└──→'}
                    </Text>
                  ) : null}
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>

      {layout.orphans.length > 0 ? (
        <Text color={theme.c('warning')}>
          {theme.glyphs.warning} {layout.orphans.length} stage(s) are not connected to anything.
        </Text>
      ) : null}
    </Box>
  );
}

function toneOf(status: string): 'running' | 'success' | 'failure' | 'warning' | 'idle' | 'neutral' {
  switch (status) {
    case 'running':
    case 'starting':
      return 'running';
    case 'completed':
      return 'success';
    case 'failed':
    case 'cancelled':
      return 'failure';
    case 'paused':
    case 'awaiting_input':
      return 'warning';
    case 'pending':
    case 'queued':
      return 'idle';
    default:
      return 'neutral';
  }
}

// ── JSON ──────────────────────────────────────────────────────────

export function JsonView({ value, height }: { value: unknown; height?: number }): React.JSX.Element {
  const theme = useTheme();
  const text = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);

  const lines = text.split('\n').slice(0, height ?? 200);

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={index} color={colourJsonLine(theme, line)} wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  );
}

function colourJsonLine(theme: Theme, line: string): string | undefined {
  if (/^\s*"[^"]+":/.test(line)) return theme.c('primary');
  if (/^\s*(true|false|null|-?\d)/.test(line.replace(/^\s*"[^"]+":\s*/, ''))) {
    return theme.c('info');
  }
  return undefined;
}
