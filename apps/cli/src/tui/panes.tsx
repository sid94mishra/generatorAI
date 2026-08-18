// ────────────────────────────────────────────────────────────────
// Panes — one renderer per kind of thing the workbench can show.
//
// Every pane receives its content descriptor and its own id, and reads
// everything else from the store. Nothing here fetches; the store's loader
// and the stream reconciler own that, so a pane rendered twice (split view)
// does not open two sockets or issue two requests.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import {
  epochOr,
  formatDuration,
  formatRelative,
  fit,
  shortId,
  statusTone,
  type ColumnSpec,
  type PaneContent,
  type TimelineItem,
} from '@generatorai/cli-core';
import {
  CodeBlock,
  ContextGauge,
  Dag,
  DiffView,
  EmptyState,
  JsonView,
  Markdown,
  Panel,
  Spinner,
  StatusPill,
  Table,
  Tree,
  VirtualList,
  parseDiffLines,
  statusStyle,
  useTerminalSize,
  useTheme,
} from '@generatorai/tui-kit';
import { NO_ROWS, useTui, type DataKey } from './store.js';

export interface PaneProps {
  paneId: string;
  content: PaneContent;
  focused: boolean;
  height: number;
}

// ── Column definitions, shared with the binary surface's tables ────

const COLUMNS: Partial<Record<DataKey, ColumnSpec[]>> = {
  chats: [
    { key: 'name', header: 'Name', priority: 0 },
    { key: 'status', header: 'Status', format: 'status', priority: 0 },
    { key: 'model', header: 'Model', priority: 2 },
    { key: 'updatedAt', header: 'Updated', format: 'relative', priority: 1 },
    { key: 'id', header: 'ID', format: 'id', priority: 4 },
  ],
  workflows: [
    { key: 'name', header: 'Name', priority: 0 },
    { key: 'version', header: 'Ver', format: 'number', priority: 3 },
    { key: 'sessionMode', header: 'Session', priority: 2 },
    { key: 'updatedAt', header: 'Updated', format: 'relative', priority: 1 },
    { key: 'id', header: 'ID', format: 'id', priority: 4 },
  ],
  runs: [
    { key: 'name', header: 'Name', priority: 1 },
    { key: 'status', header: 'Status', format: 'status', priority: 0 },
    { key: 'workflowDefinitionId', header: 'Workflow', format: 'id', priority: 3 },
    { key: 'createdAt', header: 'Started', format: 'relative', priority: 0 },
    { key: 'id', header: 'ID', format: 'id', priority: 4 },
  ],
  automations: [
    { key: 'name', header: 'Name', priority: 0 },
    { key: 'triggerType', header: 'Trigger', priority: 1 },
    { key: 'inputMode', header: 'Input', priority: 2 },
    { key: 'enabled', header: 'On', format: 'boolean', priority: 0 },
    { key: 'schedule', header: 'Schedule', priority: 3 },
  ],
  projects: [
    { key: 'name', header: 'Name', priority: 0 },
    { key: 'description', header: 'Description', priority: 2 },
    { key: 'createdAt', header: 'Created', format: 'relative', priority: 3 },
    { key: 'id', header: 'ID', format: 'id', priority: 4 },
  ],
  workspaces: [
    { key: 'ownerType', header: 'Owner', priority: 0 },
    { key: 'status', header: 'Status', format: 'status', priority: 0 },
    { key: 'sizeBytes', header: 'Size', format: 'bytes', priority: 2 },
    { key: 'createdAt', header: 'Created', format: 'relative', priority: 1 },
    { key: 'id', header: 'ID', format: 'id', priority: 3 },
  ],
  agents: [
    { key: 'name', header: 'Name', priority: 0 },
    { key: 'scope', header: 'Scope', priority: 1 },
    { key: 'role', header: 'Role', priority: 2 },
    { key: 'enabled', header: 'On', format: 'boolean', priority: 0 },
  ],
  scripts: [
    { key: 'name', header: 'Name', priority: 0 },
    { key: 'description', header: 'Description', priority: 1 },
    { key: 'path', header: 'Path', priority: 3 },
  ],
  extensions: [
    { key: 'name', header: 'Name', priority: 0 },
    { key: 'version', header: 'Version', priority: 2 },
    { key: 'scope', header: 'Scope', priority: 2 },
    { key: 'enabled', header: 'On', format: 'boolean', priority: 0 },
  ],
};

const LIST_KIND_TO_DATA: Partial<Record<PaneContent['kind'], DataKey>> = {
  chats: 'chats',
  workflows: 'workflows',
  runs: 'runs',
  automations: 'automations',
  projects: 'projects',
  workspaces: 'workspaces',
  agents: 'agents',
  scripts: 'scripts',
  extensions: 'extensions',
};

// ── Dispatcher ────────────────────────────────────────────────────

export function Pane(props: PaneProps): React.JSX.Element {
  switch (props.content.kind) {
    case 'dashboard':
      return <DashboardPane {...props} />;
    case 'chat':
      return <ChatPane {...props} />;
    case 'run':
      return <RunPane {...props} />;
    case 'workflow':
      return <WorkflowPane {...props} />;
    case 'changes':
      return <ChangesPane {...props} />;
    case 'inspector':
      return <InspectorPane {...props} />;
    case 'settings':
      return <SettingsPane {...props} />;
    case 'terminal':
      return <TerminalPane {...props} />;
    case 'browser':
      return <BrowserPane {...props} />;
    case 'computer':
      return <ComputerPane {...props} />;
    default:
      return <ListPane {...props} />;
  }
}

// ── List ──────────────────────────────────────────────────────────

export function ListPane({ paneId, content, focused, height }: PaneProps): React.JSX.Element {
  const dataKey = LIST_KIND_TO_DATA[content.kind];
  const rows = useTui((s) => (dataKey ? s.data[dataKey] : NO_ROWS));
  const loading = useTui((s) => (dataKey ? Boolean(s.loading[dataKey]) : false));
  const error = useTui((s) => (dataKey ? s.errors[dataKey] : undefined));
  const selected = useTui((s) => s.selection[paneId] ?? 0);
  const query = useTui((s) => s.search[paneId] ?? '');

  const filtered = useMemo(() => {
    if (!query) return rows;
    const needle = query.toLowerCase();
    return rows.filter((row) =>
      Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(needle)),
    );
  }, [rows, query]);

  const columns = (dataKey ? COLUMNS[dataKey] : undefined) ?? [
    { key: 'id', header: 'ID', format: 'id', priority: 0 },
  ];

  return (
    <Panel
      title={content.title}
      subtitle={query ? `filter: ${query}` : `${filtered.length}`}
      focused={focused}
      flexGrow={1}
    >
      {error ? (
        <EmptyState title="Could not load" hint={error} action="Press r to retry" />
      ) : loading && rows.length === 0 ? (
        <Spinner label="Loading…" />
      ) : (
        <Table
          rows={filtered}
          columns={columns}
          selectedIndex={selected}
          height={height - 3}
          emptyMessage={query ? 'Nothing matches that filter.' : `No ${content.kind} yet.`}
        />
      )}
    </Panel>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────

function DashboardPane({ content, focused, height }: PaneProps): React.JSX.Element {
  const theme = useTheme();
  const data = useTui((s) => s.data);
  const connection = useTui((s) => s.connection);

  const activeRuns = data.runs.filter((r) => statusTone(String(r['status'])) === 'running');
  const activeChats = data.chats.filter((c) => String(c['status']) === 'active');

  const recent = useMemo(
    () =>
      [...data.runs]
        .sort((a, b) => epochOr(b['createdAt'] as string) - epochOr(a['createdAt'] as string))
        .slice(0, Math.max(3, height - 12)),
    [data.runs, height],
  );

  return (
    <Panel title={content.title} focused={focused} flexGrow={1}>
      <Box marginBottom={1}>
        <Stat label="Chats" value={`${activeChats.length}/${data.chats.length}`} tone="running" />
        <Stat label="Workflows" value={String(data.workflows.length)} />
        <Stat label="Runs" value={`${activeRuns.length}/${data.runs.length}`} tone={activeRuns.length ? 'running' : 'idle'} />
        <Stat label="Automations" value={String(data.automations.length)} />
        <Stat label="Projects" value={String(data.projects.length)} />
      </Box>

      <Text bold color={theme.c('muted')}>
        Recent runs
      </Text>
      <VirtualList
        items={recent}
        selectedIndex={-1}
        height={Math.max(1, height - 10)}
        emptyMessage="No runs yet — press g w to pick a workflow."
        renderItem={(run) => {
          const status = String(run['status'] ?? '');
          const { color, glyph } = statusStyle(theme, statusTone(status));
          // Laid out as flex columns rather than padded strings: the name has
          // to take whatever width the pane actually has, which a fixed
          // `fit(…, 28)` throws away on a wide terminal.
          return (
            <Box width="100%">
              <Box flexShrink={0} width={13}>
                <Text color={color}>
                  {glyph} {fit(status, 10)}
                </Text>
              </Box>
              <Box flexGrow={1} overflow="hidden">
                <Text wrap="truncate-end">
                  {String(run['name'] ?? shortId(String(run['id'])))}
                </Text>
              </Box>
              <Box flexShrink={0} marginLeft={1}>
                <Text color={theme.c('muted')}>{formatRelative(run['createdAt'] as string)}</Text>
              </Box>
            </Box>
          );
        }}
      />

      <Box marginTop={1}>
        <Text color={theme.c('muted')}>
          {connection
            ? `${connection.label} · ${connection.endpoint} · ${connection.state}`
            : 'No connection — run `generatorai connect add <url>`'}
        </Text>
      </Box>
    </Panel>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'running' | 'success' | 'failure' | 'warning' | 'idle' | 'neutral';
}): React.JSX.Element {
  const theme = useTheme();
  const { color } = statusStyle(theme, tone);
  return (
    <Box marginRight={3} flexDirection="column">
      <Text color={theme.c('muted')}>{label}</Text>
      <Text bold color={color ?? theme.c('foreground')}>
        {value}
      </Text>
    </Box>
  );
}

// ── Chat ──────────────────────────────────────────────────────────

function ChatPane({ paneId, content, focused, height }: PaneProps): React.JSX.Element {
  const theme = useTheme();
  const timeline = useTui((s) => s.timelines[paneId]);
  const showThinking = useTui((s) => s.showThinking);
  const all = timeline?.items ?? [];
  const items = useMemo(
    () => (showThinking ? all : all.filter((item) => item.kind !== 'thinking')),
    [all, showThinking],
  );

  // A transcript is not a list. Messages have wildly different heights — a
  // single reply can be thousands of lines — so rendering them all and hoping
  // the container clips produces stale cells and text written over borders.
  // Walk back from the newest and keep only what fits.
  const { columns } = useTerminalSize();
  const viewport = Math.max(1, height - 3);
  const textWidth = Math.max(20, columns - 6);
  // Number of newest items held back, so scrollback is a window on the same
  // fitting algorithm rather than a second, divergent renderer.
  const scrollBack = Math.max(0, Number((content.state as { scrollBack?: number } | undefined)?.scrollBack ?? 0));
  const windowed = useMemo(
    () => (scrollBack > 0 ? items.slice(0, Math.max(1, items.length - scrollBack)) : items),
    [items, scrollBack],
  );
  const visible = useMemo(() => {
    // The indicators are rows too. Budgeting only the messages overfills the
    // box by one or two lines, and the overflow paints across the row above —
    // which is how "↑ 3 earlier messages" ends up reading "assistanter
    // messages". Reserve first, and reserve again once we know the top
    // indicator is needed.
    const footer = scrollBack > 0 ? 1 : 0;
    const first = selectVisible(windowed, Math.max(1, viewport - footer), textWidth);
    if (first.hiddenCount === 0) return first;
    return selectVisible(windowed, Math.max(1, viewport - footer - 1), textWidth);
  }, [windowed, viewport, textWidth, scrollBack]);

  return (
    <Panel
      title={content.title}
      subtitle={scrollBack > 0 ? `scrollback -${scrollBack}` : (timeline?.runStatus ?? undefined)}
      focused={focused}
      flexGrow={1}
    >
      {items.length === 0 ? (
        <EmptyState title="No messages yet." hint="Type below and press Enter to start." />
      ) : (
        <Box flexDirection="column" height={viewport} overflow="hidden">
          {/* Pinned like the rows: a shrinkable child in a full box is given
              zero height by Yoga but still painted, so its text lands on the
              row below and the two overwrite each other. */}
          {visible.hiddenCount > 0 ? (
            <Box flexShrink={0}>
              <Text color={theme.c('muted')} wrap="truncate-end">
                {`↑ ${visible.hiddenCount} earlier message${visible.hiddenCount === 1 ? '' : 's'}`}
              </Text>
            </Box>
          ) : null}
          {visible.items.map((entry) => (
            <TimelineRow key={entry.item.id} item={entry.item} maxLines={entry.maxLines} />
          ))}
          {scrollBack > 0 ? (
            <Box flexShrink={0}>
              <Text color={theme.c('warning')} wrap="truncate-end">
                {`↓ ${scrollBack} newer — Esc to follow again`}
              </Text>
            </Box>
          ) : null}
        </Box>
      )}

      {timeline?.usage && timeline.usage.totalTokens > 0 ? (
        <Box marginTop={1}>
          <Text color={theme.c('muted')}>
            {timeline.usage.totalTokens.toLocaleString()} tokens
            {timeline.usage.costUsd > 0 ? ` · $${timeline.usage.costUsd.toFixed(3)}` : ''}
          </Text>
        </Box>
      ) : null}
    </Panel>
  );
}

/**
 * Chooses the newest items that fit in `viewport` rows.
 *
 * The oldest surviving item is allowed to be clipped rather than dropped, so
 * the view always fills and never jumps when one long message arrives.
 */
function selectVisible(
  items: TimelineItem[],
  viewport: number,
  width: number,
): { items: Array<{ item: TimelineItem; maxLines: number }>; hiddenCount: number } {
  const chosen: Array<{ item: TimelineItem; maxLines: number }> = [];
  let used = 0;

  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!;
    if (used >= viewport) return { items: chosen, hiddenCount: index + 1 };
    const wanted = estimateLines(item, width);
    const budget = viewport - used;
    const maxLines = Math.min(wanted, budget);
    chosen.unshift({ item, maxLines });
    used += maxLines;
  }
  return { items: chosen, hiddenCount: 0 };
}

/**
 * Rows an item will occupy, counting wrapping.
 *
 * Counting newlines alone under-reports badly: one 600-character paragraph is
 * a single "line" but five rows on screen, and the excess pushes the frame
 * past the bottom of the terminal, which scrolls the whole UI.
 */
function estimateLines(item: TimelineItem, width: number): number {
  if (item.kind === 'tool') return 1;
  if (!item.text) return 3;
  let rows = 0;
  for (const line of item.text.split('\n')) {
    rows += Math.max(1, Math.ceil(displayWidth(line) / width));
    if (rows > 400) break;
  }
  // Role header plus the trailing gap.
  return Math.min(rows, 400) + 2;
}

/** Approximates terminal cells, counting emoji and CJK as two. */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    width +=
      code > 0x1100 &&
      (code <= 0x115f ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0x1f300 && code <= 0x1f9ff))
        ? 2
        : 1;
  }
  return width;
}

/**
 * Keeps the newest `limit` *rendered rows* of a message.
 *
 * Counting newlines is not enough: the tail of a wrapped paragraph still
 * overflows its budget and pushes content past the pane border.
 */
function clipLines(text: string, limit?: number, width = 100): string {
  if (!text) return '';
  if (limit === undefined) return text;

  const lines = text.split('\n');
  const kept: string[] = [];
  let rows = 0;

  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!;
    const cost = Math.max(1, Math.ceil(displayWidth(line) / width));
    if (rows + cost > limit) {
      return [`… ${index + 1} earlier lines`, ...kept].join('\n');
    }
    kept.unshift(line);
    rows += cost;
  }
  return kept.join('\n');
}

export function TimelineRow({
  item,
  maxLines,
}: {
  item: TimelineItem;
  maxLines?: number;
}): React.JSX.Element {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const width = Math.max(20, columns - 6);
  // One line for the role header, one for the trailing gap.
  const bodyBudget = maxLines === undefined ? undefined : Math.max(1, maxLines - 2);

  switch (item.kind) {
    case 'user':
      return (
        // Without `flexShrink={0}` Yoga squeezes the row to fit the fixed
        // height of the transcript box and the role header is the line it
        // drops, so every turn runs into the last one.
        <Box flexDirection="column" marginBottom={1} flexShrink={0}>
          <Text bold color={theme.c('primary')}>
            you
          </Text>
          <Text wrap="wrap">{clipLines(item.text, bodyBudget, width)}</Text>
        </Box>
      );

    case 'assistant':
      return (
        <Box flexDirection="column" marginBottom={1} flexShrink={0}>
          <Text bold color={theme.c('success')}>
            assistant
            {!item.complete ? <Text color={theme.c('muted')}> {theme.glyphs.running}</Text> : null}
          </Text>
          <Markdown content={clipLines(item.text, bodyBudget, width)} streaming={!item.complete} />
        </Box>
      );

    case 'thinking':
      return (
        <Box marginBottom={1} flexShrink={0}>
          <Text color={theme.c('muted')} wrap="wrap" dimColor>
            {clipLines(item.text, bodyBudget, width)}
          </Text>
        </Box>
      );

    case 'tool': {
      const tool = item.tool;
      if (!tool) return <Text />;
      const tone =
        tool.status === 'error' ? 'failure' : tool.status === 'running' ? 'running' : 'success';
      const { color, glyph } = statusStyle(theme, tone);
      const duration = tool.endedAt ? formatDuration(tool.endedAt - tool.startedAt) : '';
      return (
        <Text color={color}>
          {'  '}
          {glyph} {tool.tool}
          {duration ? <Text color={theme.c('muted')}>{`  ${duration}`}</Text> : null}
          {tool.error ? <Text color={theme.c('danger')}>{`  ${tool.error}`}</Text> : null}
        </Text>
      );
    }

    case 'stage': {
      const { color, glyph } = statusStyle(theme, item.complete ? 'success' : 'running');
      return (
        <Text bold color={color}>
          {glyph} {item.text}
        </Text>
      );
    }

    case 'error':
      return (
        <Text color={theme.c('danger')} wrap="wrap">
          {theme.glyphs.failure} {item.text}
        </Text>
      );

    case 'notice':
      return (
        <Text color={theme.c('warning')} wrap="wrap">
          {theme.glyphs.warning} {item.text}
        </Text>
      );

    default:
      return <Text wrap="wrap">{item.text}</Text>;
  }
}

// ── Run ───────────────────────────────────────────────────────────

function RunPane({ paneId, content, focused, height }: PaneProps): React.JSX.Element {
  const theme = useTheme();
  const timeline = useTui((s) => s.timelines[paneId]);
  const runs = useTui((s) => s.data.runs);
  const run = runs.find((r) => r['id'] === content.entityId);

  const items = timeline?.items ?? [];
  const pending = timeline?.pendingApproval;

  return (
    <Panel
      title={content.title}
      subtitle={String(run?.['status'] ?? timeline?.runStatus ?? '')}
      focused={focused}
      flexGrow={1}
    >
      {pending ? (
        <Box
          borderStyle={theme.borderStyle}
          borderColor={theme.c('warning')}
          paddingX={1}
          marginBottom={1}
          flexDirection="column"
        >
          <Text bold color={theme.c('warning')}>
            {theme.glyphs.warning} {pending.stageName} is waiting for approval
          </Text>
          {pending.prompt ? <Text wrap="wrap">{pending.prompt}</Text> : null}
          <Text color={theme.c('muted')}>a approve {theme.glyphs.neutral} x reject</Text>
        </Box>
      ) : null}

      <VirtualList
        items={items}
        selectedIndex={items.length - 1}
        height={Math.max(1, height - (pending ? 8 : 4))}
        emptyMessage="Waiting for events…"
        renderItem={(item) => <TimelineRow item={item} />}
      />

      <Box marginTop={1} justifyContent="space-between">
        <Text color={theme.c('muted')}>
          p pause {theme.glyphs.neutral} r resume {theme.glyphs.neutral} c cancel{' '}
          {theme.glyphs.neutral} R retry
        </Text>
        {timeline?.usage.totalTokens ? (
          <ContextGauge used={timeline.usage.totalTokens} total={200_000} />
        ) : null}
      </Box>
    </Panel>
  );
}

// ── Workflow (DAG) ────────────────────────────────────────────────

function WorkflowPane({ content, focused, height }: PaneProps): React.JSX.Element {
  const detail = (content.state ?? {}) as {
    stages?: Array<{ id: string; name: string; status?: string | null }>;
    edges?: Array<{ fromStageId: string; toStageId: string; edgeType?: string }>;
  };

  if (!detail.stages) {
    return (
      <Panel title={content.title} focused={focused} flexGrow={1}>
        <Spinner label="Loading definition…" />
      </Panel>
    );
  }

  return (
    <Panel title={content.title} subtitle={`${detail.stages.length} stages`} focused={focused} flexGrow={1}>
      <Dag stages={detail.stages} edges={detail.edges ?? []} height={height - 4} />
    </Panel>
  );
}

// ── Changes / diff ────────────────────────────────────────────────

function ChangesPane({ paneId, content, focused, height }: PaneProps): React.JSX.Element {
  const theme = useTheme();
  const selected = useTui((s) => s.selection[paneId] ?? 0);
  const state = (content.state ?? {}) as {
    files?: Array<{ path: string; status?: string; additions?: number; deletions?: number }>;
    patch?: string;
    layout?: 'unified' | 'split';
    scrollTop?: number;
  };

  const files = state.files ?? [];
  const lines = useMemo(() => (state.patch ? parseDiffLines(state.patch) : []), [state.patch]);
  const listHeight = Math.min(8, Math.max(2, Math.floor(height / 3)));

  return (
    <Panel
      title={content.title}
      subtitle={`${files.length} files ${theme.glyphs.neutral} ${state.layout ?? 'unified'}`}
      focused={focused}
      flexGrow={1}
    >
      <Box flexDirection="column" height={listHeight}>
        <VirtualList
          items={files}
          selectedIndex={selected}
          height={listHeight}
          emptyMessage="No changes in this workspace."
          renderItem={(file, _index, isSelected) => (
            <Text color={isSelected ? theme.c('primary') : undefined}>
              {isSelected ? theme.glyphs.arrowRight : ' '} {(file.status ?? 'M').charAt(0)}{' '}
              {file.path}
              <Text color={theme.c('diffAdded')}>{`  +${file.additions ?? 0}`}</Text>
              <Text color={theme.c('diffRemoved')}>{` -${file.deletions ?? 0}`}</Text>
            </Text>
          )}
        />
      </Box>

      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {lines.length > 0 ? (
          <DiffView
            lines={lines}
            layout={state.layout ?? 'unified'}
            height={Math.max(1, height - listHeight - 4)}
            scrollTop={state.scrollTop ?? 0}
          />
        ) : (
          <EmptyState title="Select a file to see its diff." />
        )}
      </Box>
    </Panel>
  );
}

// ── Inspector ─────────────────────────────────────────────────────

function InspectorPane({ content, focused, height }: PaneProps): React.JSX.Element {
  return (
    <Panel title={content.title} focused={focused} flexGrow={1}>
      <JsonView value={content.state ?? {}} height={height - 3} />
    </Panel>
  );
}

// ── Terminal / Browser / Computer ─────────────────────────────────

function TerminalPane({ content, focused, height }: PaneProps): React.JSX.Element {
  const theme = useTheme();
  const state = (content.state ?? {}) as { scrollback?: string; terminalId?: string };

  return (
    <Panel
      title={content.title}
      subtitle={state.terminalId ? `#${shortId(state.terminalId)}` : 'not started'}
      focused={focused}
      flexGrow={1}
    >
      {state.scrollback ? (
        <CodeBlock code={tail(state.scrollback, height - 5)} />
      ) : (
        <EmptyState
          title="No terminal attached."
          hint="Press n to start one, then Enter to pull its buffer. Raw interaction needs `generatorai terminal attach` in a plain shell."
        />
      )}
      <Text color={theme.c('muted')}>⏎ refresh {theme.glyphs.neutral} n new {theme.glyphs.neutral} d kill</Text>
    </Panel>
  );
}

function BrowserPane({ content, focused, height }: PaneProps): React.JSX.Element {
  const theme = useTheme();
  const state = (content.state ?? {}) as { url?: string; title?: string; snapshot?: string };

  return (
    <Panel title={content.title} subtitle={state.url} focused={focused} flexGrow={1}>
      {state.snapshot ? (
        <Text wrap="wrap">{state.snapshot.slice(0, (height - 5) * 100)}</Text>
      ) : (
        <EmptyState
          title={state.url ? (state.title ?? state.url) : 'No browser session.'}
          hint="This terminal cannot display images; s writes a screenshot to a file."
          action="o open URL · r reload · s screenshot · i info"
        />
      )}
    </Panel>
  );
}

function ComputerPane({ content, focused, height }: PaneProps): React.JSX.Element {
  const state = (content.state ?? {}) as {
    activity?: Array<{ timestamp?: string; action?: string; target?: string; result?: string }>;
  };
  const rows = state.activity ?? [];

  return (
    <Panel title={content.title} subtitle={`${rows.length} events`} focused={focused} flexGrow={1}>
      <Table
        rows={rows}
        columns={[
          { key: 'timestamp', header: 'When', format: 'relative', priority: 0 },
          { key: 'action', header: 'Action', priority: 0 },
          { key: 'target', header: 'Target', priority: 1 },
          { key: 'result', header: 'Result', format: 'status', priority: 0 },
        ]}
        height={height - 3}
        emptyMessage="No computer-use activity recorded."
      />
    </Panel>
  );
}

// ── Settings ──────────────────────────────────────────────────────

function SettingsPane({ content, focused, height }: PaneProps): React.JSX.Element {
  const theme = useTheme();
  const connection = useTui((s) => s.connection);

  const sections = [
    { label: 'Connection', value: connection ? `${connection.label} (${connection.endpoint})` : 'none' },
    { label: 'Auth state', value: connection?.state ?? 'unknown' },
    { label: 'Device', value: connection?.deviceId ? shortId(connection.deviceId) : '—' },
    { label: 'Theme', value: theme.label },
    { label: 'Colour', value: theme.ladder },
    { label: 'Glyphs', value: theme.glyphs.success === '✓' ? 'unicode' : 'ascii' },
  ];

  return (
    <Panel title={content.title} focused={focused} flexGrow={1}>
      <Tree
        nodes={sections.map((section, index) => ({
          id: section.label,
          label: `${section.label}: ${section.value}`,
          depth: 0,
          isLast: index === sections.length - 1,
        }))}
        height={height - 5}
      />
      <Box marginTop={1}>
        <Text color={theme.c('muted')}>
          Change settings with `generatorai config set &lt;key&gt; &lt;value&gt;`
        </Text>
      </Box>
    </Panel>
  );
}

/** Last N lines, so a 10k-line scrollback does not blow up the layout pass. */
function tail(text: string, lines: number): string {
  const all = text.split('\n');
  return all.slice(Math.max(0, all.length - Math.max(1, lines))).join('\n');
}

export { StatusPill };
