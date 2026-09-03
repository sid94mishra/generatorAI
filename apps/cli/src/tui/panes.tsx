// ────────────────────────────────────────────────────────────────
// Panes — one renderer per kind of thing the workbench can show.
//
// Every pane receives its content descriptor and its own id, and reads
// everything else from the store. Nothing here fetches; the store's loader
// and the stream reconciler own that, so a pane rendered twice (split view)
// does not open two sockets or issue two requests.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import {
  epochOr,
  formatDuration,
  formatRelative,
  fit,
  shortId,
  statusTone,
  type ColumnSpec,
  type PaneContent,
  type SettingRow,
  type TimelineItem,
} from '@generatorai/cli-core';
import {
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
  VirtualList,
  parseDiffLines,
  statusStyle,
  useTerminalSize,
  useTheme,
} from '@generatorai/tui-kit';
import { NO_ROWS, useActions, useTui, type DataKey } from './store.js';
import { TerminalScreen, useTerminalScreen, type TerminalLine } from './terminalRender.js';
import { buildWorkspaceTree, type TreeRow } from './workspaceTree.js';

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
  // Phase 4 item 7 — "unseen output" tab indicator. `Pane` is only ever
  // invoked for a leaf that is ACTUALLY on screen right now (the active
  // tab's leaves, both sides of a split included) — so every render of it
  // is proof this pane has been seen. No dependency array: this must
  // re-fire on every render, not just on mount, because a background pane
  // that goes unseen while its tab is inactive needs clearing the moment
  // the user switches back to it and it starts rendering again, not only
  // the first time it was ever created. `markSeen` itself is a no-op once
  // there is nothing left to clear, so this does not loop.
  const actions = useActions();
  useEffect(() => {
    actions.markSeen(props.paneId);
  });

  switch (props.content.kind) {
    case 'dashboard':
      return <DashboardPane {...props} />;
    case 'chat':
      return <ChatPane {...props} />;
    case 'run':
      return <RunPane {...props} />;
    case 'automation':
      return <AutomationPane {...props} />;
    case 'workflow':
      return <WorkflowPane {...props} />;
    case 'changes':
      return <ChangesPane {...props} />;
    case 'workspace':
      return <WorkspacePane {...props} />;
    case 'command':
      return <CommandPane {...props} />;
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
  // Phase 6 item 3 — chat-scoped HITL banner (plan review / clarifying
  // question), visually matching `RunPane`'s existing stage-approval box
  // rather than inventing a second style for the same "something needs a
  // human decision" concept. Read before `viewport` so the transcript
  // budget below actually reserves room for it — the banner is 3-4 rows
  // (border + text + hint), same reasoning as `RunPane`'s own `pending`
  // height reservation.
  const pendingInteraction = timeline?.pendingInteraction;

  // A transcript is not a list. Messages have wildly different heights — a
  // single reply can be thousands of lines — so rendering them all and hoping
  // the container clips produces stale cells and text written over borders.
  // Walk back from the newest and keep only what fits.
  const { columns } = useTerminalSize();
  const viewport = Math.max(1, height - 3 - (pendingInteraction ? 4 : 0));
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
      {pendingInteraction ? (
        <Box
          borderStyle={theme.borderStyle}
          borderColor={theme.c('warning')}
          paddingX={1}
          marginBottom={1}
          flexDirection="column"
        >
          {pendingInteraction.kind === 'plan' ? (
            <>
              <Text bold color={theme.c('warning')}>
                {theme.glyphs.warning} Plan review: {pendingInteraction.title}
              </Text>
              <Text wrap="wrap">{pendingInteraction.summary}</Text>
            </>
          ) : (
            <>
              <Text bold color={theme.c('warning')}>
                {theme.glyphs.warning}{' '}
                {pendingInteraction.questions.length === 1
                  ? pendingInteraction.questions[0]?.question
                  : `${pendingInteraction.questions.length} questions`}
              </Text>
            </>
          )}
          <Text color={theme.c('muted')}>{`alt+g to answer ${theme.glyphs.neutral} waiting for you`}</Text>
        </Box>
      ) : null}

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

      {timeline?.contextUsage || (timeline?.usage && timeline.usage.totalTokens > 0) ? (
        <Box marginTop={1}>
          <Text color={theme.c('muted')}>
            {/* `contextUsage` (a real provider-reported snapshot) is
                preferred when available — accumulated `usage` deltas answer
                a different question ("tokens spent so far") and do not fall
                back down after a compaction, which reads as the gauge being
                stuck full forever on a long conversation. */}
            {`${(timeline?.contextUsage?.currentTokens ?? timeline?.usage.totalTokens ?? 0).toLocaleString()} tokens`}
            {timeline?.usage && timeline.usage.costUsd > 0 ? ` · $${timeline.usage.costUsd.toFixed(3)}` : ''}
          </Text>
        </Box>
      ) : null}
    </Panel>
  );
}

/**
 * Real in-transcript search (Phase 4 item 7) — finds a case-insensitive
 * substring match in a chat/terminal transcript and returns the
 * `scrollBack` value that brings it into view, instead of `app.search`'s
 * existing row-FILTER behavior (which only applies to list panes and
 * hides everything else, wrong for a transcript you want to keep reading
 * around the match).
 *
 * Searches strictly OLDER than `afterScrollBack` first (so repeated
 * search-again presses walk backward through matches one at a time), then
 * wraps to the newest match if nothing older matches — the same
 * "keep going, then wrap" convention terminal/editor search already uses.
 * Returns `null` when the query matches nothing at all.
 */
export function findTranscriptMatch(
  items: TimelineItem[],
  query: string,
  afterScrollBack = -1,
): number | null {
  const q = query.trim().toLowerCase();
  if (!q || items.length === 0) return null;

  // scrollBack N means "hide the N newest" — the item at array index i
  // (oldest-first) is the LAST one shown when scrollBack === items.length-1-i.
  // "Older than the current position" is therefore a SMALLER index.
  const currentIndex = items.length - 1 - afterScrollBack;
  const olderBound = Math.min(currentIndex - 1, items.length - 1);

  for (let i = olderBound; i >= 0; i--) {
    if (items[i]!.text.toLowerCase().includes(q)) return items.length - 1 - i;
  }
  for (let i = items.length - 1; i > olderBound; i--) {
    if (items[i]!.text.toLowerCase().includes(q)) return items.length - 1 - i;
  }
  return null;
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

/**
 * Terminal cells a line occupies.
 *
 * Audit §6.4: "Width calculations use multiple algorithms, creating
 * emoji/CJK disagreement." This file hand-rolled an approximation over a
 * handful of codepoint RANGES, while everything that actually PAINTS
 * (`tui-kit`'s `Table`/`Composer`/`Select`, and `Renderer.ts`) used
 * `string-width`. The two disagreed on ZWJ emoji sequences (one glyph, many
 * codepoints — the range list counted each as 2), combining marks (zero
 * width, counted as 1), variation selectors, and several CJK blocks the list
 * omitted. So `estimateLines` and `clipLines` budgeted a different number of
 * rows than the renderer then drew — which is exactly how a message ends up
 * written over a pane border.
 *
 * One algorithm now, and it is the renderer's.
 */
function displayWidth(text: string): number {
  return stringWidth(text);
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
        {timeline?.contextUsage || timeline?.usage.totalTokens ? (
          <ContextGauge
            used={timeline?.contextUsage?.currentTokens ?? timeline?.usage.totalTokens ?? 0}
            // 200_000 was a hardcoded stand-in for every model's real
            // context window; `totalContextWindow`/`promptTokenLimit` are
            // the provider's own reported numbers when a snapshot has
            // arrived (`harness.context_usage`) — falls back to the old
            // constant only when no snapshot has arrived yet at all.
            total={
              timeline?.contextUsage?.totalContextWindow ??
              timeline?.contextUsage?.promptTokenLimit ??
              200_000
            }
            {...(timeline?.contextUsage?.compactionThreshold !== undefined
              ? { compactionThreshold: timeline.contextUsage.compactionThreshold }
              : {})}
          />
        ) : null}
      </Box>
    </Panel>
  );
}

// ── Automation (Phase 6 item 6) ─────────────────────────────────────
//
// Previously a static `JsonView` dump of `automations.get()` with no live
// stream at all. There is no automation-WIDE stream scope to attach to —
// the real server-side bridge (`apps/server/src/composition-root.ts`)
// republishes `automation_execution.*` events to `scope:'automation',
// id:<executionId>`, per EXECUTION, not per automation — so this pane
// attaches to whichever execution `open.ts` found still running/pending at
// open time (if any) and shows its live log; the executions LIST itself
// (below) is the REST-fetched snapshot from `open.ts`'s `build()`/history,
// refreshed by `App.tsx` after any action that changes it (cancel).

function AutomationPane({ paneId, content, focused, height }: PaneProps): React.JSX.Element {
  const theme = useTheme();
  const timeline = useTui((s) => s.timelines[paneId]);
  const state = (content.state ?? {}) as {
    automation?: { enabled?: boolean; triggerType?: string };
    executions?: Array<Record<string, unknown>>;
    selectedExecutionIndex?: number;
  };
  const executions = state.executions ?? [];
  const selected = Math.min(Math.max(0, state.selectedExecutionIndex ?? 0), Math.max(0, executions.length - 1));
  const items = timeline?.items ?? [];
  const listHeight = Math.min(8, Math.max(2, Math.floor(height / 3)));

  return (
    <Panel
      title={content.title}
      subtitle={`${state.automation?.enabled ? 'enabled' : 'disabled'} ${theme.glyphs.neutral} ${state.automation?.triggerType ?? ''}`}
      focused={focused}
      flexGrow={1}
    >
      <Box flexDirection="column" height={listHeight}>
        <VirtualList
          items={executions}
          selectedIndex={selected}
          height={listHeight}
          emptyMessage="No executions yet."
          renderItem={(exec, _index, isSelected) => {
            const e = exec as Record<string, unknown>;
            const completed = Number(e['completedIterations'] ?? 0);
            const failed = Number(e['failedIterations'] ?? 0);
            const total = Number(e['totalIterations'] ?? 0);
            return (
              <Text color={isSelected ? theme.c('primary') : undefined} wrap="truncate-end">
                {isSelected ? theme.glyphs.arrowRight : ' '} {shortId(String(e['id'] ?? ''))}{' '}
                <StatusPill status={String(e['status'] ?? '')} />{' '}
                {`${completed + failed}/${total} runs`}
                {failed > 0 ? ` (${failed} failed)` : ''}
              </Text>
            );
          }}
        />
      </Box>

      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {items.length > 0 ? (
          <VirtualList
            items={items}
            selectedIndex={items.length - 1}
            height={Math.max(1, height - listHeight - 4)}
            emptyMessage=""
            renderItem={(item) => <TimelineRow item={item} />}
          />
        ) : (
          <EmptyState
            title="No live activity."
            hint="Live only while an execution is running or pending; finished executions show only in the list above."
          />
        )}
      </Box>

      <Text color={theme.c('muted')}>
        ctrl+n/p executions {theme.glyphs.neutral} ⏎ open run {theme.glyphs.neutral} c cancel
      </Text>
    </Panel>
  );
}

// ── Workflow (DAG) ────────────────────────────────────────────────

function WorkflowPane({ content, focused, height }: PaneProps): React.JSX.Element {
  const theme = useTheme();
  const detail = (content.state ?? {}) as {
    stages?: Array<
      Record<string, unknown> & { id: string; name: string; status?: string | null }
    >;
    edges?: Array<{ id?: string; fromStageId: string; toStageId: string; edgeType?: string }>;
    variables?: Record<string, unknown>;
    selectedStageId?: string | null;
  };

  if (!detail.stages) {
    return (
      <Panel title={content.title} focused={focused} flexGrow={1}>
        <Spinner label="Loading definition…" />
      </Panel>
    );
  }

  const stages = detail.stages;
  const selected = stages.find((stage) => stage.id === detail.selectedStageId) ?? stages[0];
  // Phase 7 item 5 — the graph already had a wide/narrow split (`Dag` falls
  // back to an indented dependency tree under 100 columns); what it never
  // had was a CURSOR, so nothing could act on "the selected stage" and every
  // authoring command was unreachable from here.
  const edgesOnSelected = (detail.edges ?? []).filter(
    (edge) => edge.fromStageId === selected?.id || edge.toStageId === selected?.id,
  );
  const variableCount = Object.keys(
    (selected?.['variables'] as Record<string, unknown> | undefined) ?? {},
  ).length;
  const hookCount = ((selected?.['hooks'] as unknown[] | undefined) ?? []).length;
  const condition = selected?.['condition'] as { type?: string; expression?: string } | undefined;

  // The detail strip and the hint line are real rows — budgeting only the
  // graph overflows the panel and paints across the border, the same
  // reservation `ChatPane` makes for its own banner.
  const detailRows = selected ? 3 : 0;

  return (
    <Panel
      title={content.title}
      subtitle={`${stages.length} stages ${theme.glyphs.neutral} ${(detail.edges ?? []).length} edges`}
      focused={focused}
      flexGrow={1}
    >
      <Dag
        stages={stages}
        edges={detail.edges ?? []}
        height={Math.max(1, height - 5 - detailRows)}
        {...(selected ? { selectedId: selected.id } : {})}
      />

      {selected ? (
        <Box flexDirection="column" marginTop={1} flexShrink={0}>
          <Text bold color={theme.c('primary')} wrap="truncate-end">
            {selected.name}
            <Text color={theme.c('muted')}>{`  ${shortId(selected.id)}`}</Text>
          </Text>
          <Text color={theme.c('muted')} wrap="truncate-end">
            {`${edgesOnSelected.length} edge(s) ${theme.glyphs.neutral} ${variableCount} variable(s) ${theme.glyphs.neutral} ${hookCount} hook(s)`}
            {condition?.type ? ` ${theme.glyphs.neutral} runs ${condition.type}` : ''}
            {selected['agentRef'] ? ` ${theme.glyphs.neutral} agent ${String(selected['agentRef'])}` : ''}
          </Text>
        </Box>
      ) : (
        <EmptyState title="No stages yet." hint="Press n to add the first one." />
      )}

      <Text color={theme.c('muted')} wrap="truncate-end">
        {`ctrl+n/p stage ${theme.glyphs.neutral} n new ${theme.glyphs.neutral} e edit ${theme.glyphs.neutral} E/D edge ${theme.glyphs.neutral} v vars ${theme.glyphs.neutral} h hooks ${theme.glyphs.neutral} V validate ${theme.glyphs.neutral} r run`}
      </Text>
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
    /** Open question #21 — index of the diff row the line cursor is on. */
    lineCursor?: number;
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
            height={Math.max(1, height - listHeight - 5)}
            scrollTop={state.scrollTop ?? 0}
            selectedIndex={state.lineCursor ?? -1}
          />
        ) : (
          <EmptyState title="Select a file to see its diff." />
        )}
      </Box>

      {/* Phase 7 item 2 — the SCM half. Every one of these was a real,
          tested command with nothing bound to it before. */}
      <Text color={theme.c('muted')} wrap="truncate-end">
        {`↑↓ line ${theme.glyphs.neutral} c comment ${theme.glyphs.neutral} p checkpoints ${theme.glyphs.neutral} C commit ${theme.glyphs.neutral} P pr ${theme.glyphs.neutral} T threads ${theme.glyphs.neutral} S submit`}
      </Text>
    </Panel>
  );
}

// ── Workspace tree (Phase 7 item 1) ────────────────────────────────
//
// One flat, filterable list combining three real, separately-fetched
// sources (`open.ts`'s ad-hoc opener) rather than a nested directory-drill
// UI: `workspaces.tree()` (git-TRACKED files, across the main repo and
// every worktree, already tagged by `alias`) and `workspaces.files()`'s
// `artifactFiles` (the one route that walks the filesystem directly, so it
// catches artifacts — generated output, never git-tracked, and therefore
// invisible to `tree()`). No existing pane in this codebase renders a
// hierarchical tree; a flat searchable list reuses `ListPane`'s own
// filter convention (`s.search[paneId]`) instead of inventing one.
export interface WorkspaceRow {
  alias: string;
  relPath: string;
  kind: 'file' | 'artifact';
}

/** Stable reference — `state.rows ?? []` would create a fresh array every render, defeating the `useMemo` below. */
const EMPTY_WORKSPACE_ROWS: WorkspaceRow[] = [];

function WorkspacePane({ paneId, content, focused, height }: PaneProps): React.JSX.Element {
  const theme = useTheme();
  const selected = useTui((s) => s.selection[paneId] ?? 0);
  const query = useTui((s) => s.search[paneId] ?? '');
  const state = (content.state ?? {}) as {
    rootPath?: string;
    workingDirectory?: string;
    worktrees?: Array<{ alias: string; worktreePath: string }>;
    rows?: WorkspaceRow[];
    loading?: boolean;
    /** Open question #26 — a real directory tree, derived from the paths. */
    view?: 'tree' | 'flat';
    collapsed?: string[];
  };

  const rows = state.rows ?? EMPTY_WORKSPACE_ROWS;
  // A filter switches to the FLAT view regardless of mode: a tree filtered to
  // three files is mostly empty directory scaffolding, and "find the file
  // called X" is what the filter is for.
  const asTree = (state.view ?? 'tree') === 'tree' && !query;

  const filtered = useMemo(() => {
    if (!query) return rows;
    const needle = query.toLowerCase();
    return rows.filter((r) => r.relPath.toLowerCase().includes(needle) || r.alias.toLowerCase().includes(needle));
  }, [rows, query]);

  const tree = useMemo(
    () => (asTree ? buildWorkspaceTree(rows, new Set(state.collapsed ?? [])) : []),
    [asTree, rows, state.collapsed],
  );

  const glyphFor = (item: TreeRow): string => {
    if (item.kind === 'file') return theme.glyphs.bullet;
    if (item.kind === 'artifact') return theme.glyphs.warning;
    return item.collapsed ? '▸' : '▾';
  };

  return (
    <Panel
      title={content.title}
      subtitle={
        query
          ? `filter: ${query} (${filtered.length}/${rows.length})`
          : `${rows.length} entries ${theme.glyphs.neutral} ${asTree ? 'tree' : 'flat'}`
      }
      focused={focused}
      flexGrow={1}
    >
      {state.loading ? (
        <Spinner label="Loading workspace…" />
      ) : asTree ? (
        <VirtualList
          items={tree}
          selectedIndex={selected}
          height={height - 3}
          emptyMessage="No files found."
          renderItem={(item, _index, isSelected) => (
            <Text color={isSelected ? theme.c('primary') : undefined} wrap="truncate-end">
              {isSelected ? theme.glyphs.arrowRight : ' '}
              {'  '.repeat(item.depth)}
              <Text
                color={
                  item.kind === 'artifact'
                    ? theme.c('warning')
                    : item.kind === 'file'
                      ? undefined
                      : theme.c('muted')
                }
              >
                {glyphFor(item)} {item.label}
              </Text>
              {item.collapsed && item.fileCount ? (
                <Text color={theme.c('muted')}>{` (${item.fileCount})`}</Text>
              ) : null}
            </Text>
          )}
        />
      ) : (
        <VirtualList
          items={filtered}
          selectedIndex={selected}
          height={height - 3}
          emptyMessage={query ? 'Nothing matches that filter.' : 'No files found.'}
          renderItem={(row, _index, isSelected) => (
            <Text color={isSelected ? theme.c('primary') : undefined} wrap="truncate-end">
              {isSelected ? theme.glyphs.arrowRight : ' '}{' '}
              <Text color={row.kind === 'artifact' ? theme.c('warning') : theme.c('muted')}>
                {row.alias === '.' ? 'main' : row.alias}
              </Text>{' '}
              {theme.glyphs.neutral} {row.relPath}
            </Text>
          )}
        />
      )}
      <Text color={theme.c('muted')} wrap="truncate-end">
        {`e edit ${theme.glyphs.neutral} d download ${theme.glyphs.neutral} u upload ${theme.glyphs.neutral} t ${asTree ? 'flat' : 'tree'} ${theme.glyphs.neutral} ←→ fold ${theme.glyphs.neutral} / filter`}
      </Text>
    </Panel>
  );
}

// ── Command-backed administration view (Phase 8 item 5) ────────────
//
// One pane for all twelve surfaces the audit lists, driven by
// `adminViews.ts` over the command registry. Columns come from the
// command's OWN `output` spec, so a view cannot show a column the command
// does not return — and a renamed command fails a test rather than
// producing an empty pane nobody opens.
//
// `shape: 'record'` commands (`system doctor`, `security posture`) render as
// a key/value inspector instead of a table: forcing a single object into a
// one-row table is how "diagnostics" ends up as an unreadable horizontal
// scroll.

function CommandPane({ paneId, content, focused, height }: PaneProps): React.JSX.Element {
  const theme = useTheme();
  const selected = useTui((s) => s.selection[paneId] ?? 0);
  const query = useTui((s) => s.search[paneId] ?? '');
  const state = (content.state ?? {}) as {
    commandId?: string;
    rows?: Array<Record<string, unknown>>;
    record?: unknown;
    columns?: ColumnSpec[];
    shape?: 'list' | 'record';
    loading?: boolean;
    error?: string;
    description?: string;
  };

  const rows = state.rows ?? EMPTY_ROWS;
  const filtered = useMemo(() => {
    if (!query) return rows;
    const needle = query.toLowerCase();
    return rows.filter((row) =>
      Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(needle)),
    );
  }, [rows, query]);

  return (
    <Panel
      title={content.title}
      subtitle={
        state.error
          ? 'error'
          : query
            ? `filter: ${query} (${filtered.length}/${rows.length})`
            : state.shape === 'record'
              ? (state.commandId ?? '')
              : `${rows.length}`
      }
      focused={focused}
      flexGrow={1}
    >
      {state.loading ? (
        <Spinner label="Running…" />
      ) : state.error ? (
        <EmptyState title="Could not load" hint={state.error} action="Press R to retry" />
      ) : state.shape === 'record' ? (
        <JsonView value={state.record ?? {}} height={height - 4} />
      ) : (
        <Table
          rows={filtered}
          columns={state.columns ?? [{ key: 'id', header: 'ID', format: 'id', priority: 0 }]}
          selectedIndex={selected}
          height={height - 4}
          emptyMessage={query ? 'Nothing matches that filter.' : 'Nothing here.'}
        />
      )}
      <Text color={theme.c('muted')} wrap="truncate-end">
        {`⏎ inspect ${theme.glyphs.neutral} R rerun ${theme.glyphs.neutral} / filter${
          state.description ? `  ${theme.glyphs.neutral} ${state.description}` : ''
        }`}
      </Text>
    </Panel>
  );
}

/** Stable reference — a fresh `[]` per render defeats the `useMemo` above. */
const EMPTY_ROWS: Array<Record<string, unknown>> = [];

// ── Inspector ─────────────────────────────────────────────────────

function InspectorPane({ content, focused, height }: PaneProps): React.JSX.Element {
  return (
    <Panel title={content.title} focused={focused} flexGrow={1}>
      <JsonView value={content.state ?? {}} height={height - 3} />
    </Panel>
  );
}

// ── Terminal / Browser / Computer ─────────────────────────────────

/**
 * "just now" / "5m ago" / "exited (1)" — Phase 5 item 6's idle-state
 * display. The server already computes and enforces an idle timeout
 * (`TerminalService.reapIdle`, default 30 min) but surfaces it nowhere —
 * no client (web, mobile, or here) shows elapsed-since-last-activity, only
 * a post-hoc "exited" banner once the reaper (or a user) has already
 * killed the session. This is a live indicator, not a countdown/warning —
 * a real countdown would need the server's own timeout value threaded down
 * a layer it isn't exposed at today, a bigger separate piece of work.
 */
export function terminalActivityLabel(t: {
  exitCode?: number | null;
  lastActivityAt?: number;
}): string {
  if (t.exitCode !== null && t.exitCode !== undefined) return `exited (${t.exitCode})`;
  if (!t.lastActivityAt) return 'active';
  return formatRelative(t.lastActivityAt);
}

function TerminalPane({ content, focused, height }: PaneProps): React.JSX.Element {
  const theme = useTheme();
  const state = (content.state ?? {}) as {
    scrollback?: string;
    terminalId?: string;
    exitCode?: number | null;
    lastActivityAt?: number;
    /** Rows above the live tail (open question #10) — 0 means following. */
    scrollBack?: number;
  };

  // Column budget matches `ChatPane`'s own convention just above (full
  // terminal width minus 6 for `Panel`'s border+padding) rather than
  // inventing a second one. Row budget preserves the exact vertical space
  // the previous `CodeBlock`-based render used (`height - 5`, reserving
  // room for the title/border and the hint line below) — a real judgment
  // call with no established precedent to match, made to keep this
  // change's visual footprint as close to "same layout, real rendering
  // underneath" as possible.
  const { columns: termColumns } = useTerminalSize();
  const cols = Math.max(20, termColumns - 6);
  const rows = Math.max(3, height - 5);
  // Open question #10 — terminal panes had no scroll offset at all, which is
  // why `terminal.search` could not be built: a match had nowhere to jump
  // TO. The headless emulator keeps a real scrollback buffer now, and this
  // is the window into it.
  const scrollBack = Math.max(0, Number(state.scrollBack ?? 0));
  // Deliberately NOT pre-truncated to the last N lines the way the old
  // `CodeBlock` render was: a naive text-level tail on a string full of SGR
  // escape sequences can cut off the very escape that set the color/style
  // the visible tail is still using, rendering it in the wrong style. The
  // headless terminal below sees the FULL scrollback so its parser tracks
  // that state correctly, and its own bounded viewport (`rows`) is what
  // keeps only the tail on screen — the same reason `apps/web`'s real
  // xterm.js instance is never handed a pre-truncated string either.
  const { lines, scrollbackDepth } = useTerminalScreen(state.scrollback ?? '', cols, rows, scrollBack);

  return (
    <Panel
      title={content.title}
      subtitle={
        state.terminalId
          ? `#${shortId(state.terminalId)} · ${terminalActivityLabel(state)}${
              scrollBack > 0 ? ` · scrollback -${scrollBack}` : ''
            }`
          : 'not started'
      }
      focused={focused}
      flexGrow={1}
    >
      {state.scrollback ? (
        <>
          {scrollBack > 0 ? (
            <Text color={theme.c('warning')} wrap="truncate-end">
              {`↑ ${scrollBack} of ${scrollbackDepth} rows back — Esc or End to follow again`}
            </Text>
          ) : null}
          <TerminalScreen lines={lines} />
        </>
      ) : (
        <EmptyState
          title="No terminal attached."
          hint="Press n to start one, l to pick an existing one, then Enter to attach."
        />
      )}
      <Text color={theme.c('muted')} wrap="truncate-end">
        {`⏎ attach ${theme.glyphs.neutral} n new ${theme.glyphs.neutral} l switch ${theme.glyphs.neutral} d kill ${theme.glyphs.neutral} PgUp/PgDn scroll ${theme.glyphs.neutral} alt+s search ${theme.glyphs.neutral} y copy`}
      </Text>
    </Panel>
  );
}

/**
 * The plain text of a rendered terminal screen (open questions #10/#11).
 *
 * Spans exist to carry STYLE; search and clipboard want the characters. One
 * helper so the two cannot disagree about what "the visible text" is.
 */
export function terminalLinesToText(lines: TerminalLine[]): string {
  return lines.map((spans) => spans.map((span) => span.text).join('')).join('\n');
}

// Phase 8 item 1 — the SEMANTIC browser view.
//
// `state.snapshot` was read here before and set by nothing anywhere, so this
// branch had never once rendered: every browser pane showed the same
// "this terminal cannot display images" empty state forever. It is now the
// accessibility tree from `browser.readPage` — for a terminal that is the
// primary representation of a page, not a consolation prize for not having
// pixels. `scrollTop` makes a long tree readable; without it only the first
// screenful of a real page is reachable.
function BrowserPane({ content, focused, height }: PaneProps): React.JSX.Element {
  const theme = useTheme();
  const state = (content.state ?? {}) as {
    url?: string;
    title?: string;
    snapshot?: string;
    snapshotAt?: number;
    scrollTop?: number;
  };

  const viewport = Math.max(1, height - 5);
  const lines = useMemo(() => (state.snapshot ?? '').split('\n'), [state.snapshot]);
  const top = Math.max(0, Math.min(state.scrollTop ?? 0, Math.max(0, lines.length - viewport)));
  const visible = lines.slice(top, top + viewport);

  return (
    <Panel
      title={content.title}
      subtitle={state.title ? `${state.title} ${theme.glyphs.neutral} ${state.url ?? ''}` : state.url}
      focused={focused}
      flexGrow={1}
    >
      {state.snapshot ? (
        <Box flexDirection="column" height={viewport} overflow="hidden">
          {top > 0 ? (
            <Text color={theme.c('muted')}>{`↑ ${top} earlier line${top === 1 ? '' : 's'}`}</Text>
          ) : null}
          {visible.map((line, index) => (
            <Text key={`${top + index}`} wrap="truncate-end">
              {line}
            </Text>
          ))}
          {top + viewport < lines.length ? (
            <Text color={theme.c('muted')}>{`↓ ${lines.length - top - viewport} more`}</Text>
          ) : null}
        </Box>
      ) : (
        <EmptyState
          title={state.url ? (state.title ?? state.url) : 'No browser session.'}
          hint="Press a to read the page as text — that is the view a terminal renders best."
          action="o open URL · a read page · s screenshot · c computer · i info"
        />
      )}
      <Text color={theme.c('muted')} wrap="truncate-end">
        {`a read ${theme.glyphs.neutral} s screenshot ${theme.glyphs.neutral} o url ${theme.glyphs.neutral} r reload ${theme.glyphs.neutral} c computer ${theme.glyphs.neutral} k stop`}
        {state.snapshotAt ? `  ${theme.glyphs.neutral} read ${formatRelative(state.snapshotAt)}` : ''}
      </Text>
    </Panel>
  );
}

// ── Computer use (Phase 8 items 1/3) ───────────────────────────────
//
// Was an activity table fed by `state.activity`, which nothing set — and
// which would have been permanently empty anyway, because
// `api.computer.activity` mis-typed the route's `{entries}` envelope as a
// bare array (as did `grants` and `frames`). This shows the whole security
// boundary the audit asks to be VISIBLE: what the driver is doing, what is
// waiting on a human decision, and what has been granted standing
// permission — three things a user needs together to answer "what can this
// agent do to my desktop right now?".

function ComputerPane({ paneId, content, focused, height }: PaneProps): React.JSX.Element {
  const theme = useTheme();
  const selected = useTui((s) => s.selection[paneId] ?? 0);
  const state = (content.state ?? {}) as {
    runtime?: Record<string, unknown> | null;
    pending?: Array<Record<string, unknown>>;
    grants?: Array<Record<string, unknown>>;
    activity?: Array<Record<string, unknown>>;
    section?: 'pending' | 'grants' | 'activity';
  };

  const pending = state.pending ?? EMPTY_ROWS;
  const grants = state.grants ?? EMPTY_ROWS;
  const activity = state.activity ?? EMPTY_ROWS;
  const section = state.section ?? 'pending';
  const runtimeStatus = String(state.runtime?.['status'] ?? state.runtime?.['state'] ?? 'unknown');
  const running = runtimeStatus === 'running' || state.runtime?.['running'] === true;

  const rows = section === 'pending' ? pending : section === 'grants' ? grants : activity;
  const columns: ColumnSpec[] =
    section === 'pending'
      ? [
          { key: 'appIdentity', header: 'App', priority: 0 },
          { key: 'reason', header: 'Wants to', priority: 0 },
          { key: 'requestedAt', header: 'Asked', format: 'relative', priority: 1 },
          { key: 'requestId', header: 'Request', format: 'id', priority: 2 },
        ]
      : section === 'grants'
        ? [
            { key: 'appIdentity', header: 'App', priority: 0 },
            { key: 'scopes', header: 'Scopes', format: 'list', priority: 0 },
            { key: 'grantedAt', header: 'Granted', format: 'relative', priority: 1 },
          ]
        : [
            { key: 'timestamp', header: 'When', format: 'relative', priority: 0 },
            { key: 'action', header: 'Action', priority: 0 },
            { key: 'target', header: 'Target', priority: 1 },
            { key: 'result', header: 'Result', format: 'status', priority: 0 },
          ];

  return (
    <Panel
      title={content.title}
      subtitle={`driver ${runtimeStatus}`}
      focused={focused}
      flexGrow={1}
    >
      <Box marginBottom={1}>
        <Text color={running ? theme.c('warning') : theme.c('muted')}>
          {running ? theme.glyphs.warning : theme.glyphs.bullet}{' '}
          {running ? 'The agent can control this desktop right now.' : 'The driver is not running.'}
        </Text>
      </Box>

      <Box marginBottom={1}>
        {(['pending', 'grants', 'activity'] as const).map((name) => (
          <Box key={name} marginRight={2}>
            <Text
              bold={name === section}
              color={name === section ? theme.c('primary') : theme.c('muted')}
            >
              {name}
              {name === 'pending' && pending.length > 0 ? (
                <Text color={theme.c('warning')}>{` (${pending.length})`}</Text>
              ) : (
                ` (${name === 'grants' ? grants.length : name === 'activity' ? activity.length : 0})`
              )}
            </Text>
          </Box>
        ))}
      </Box>

      <Table
        rows={rows}
        columns={columns}
        selectedIndex={selected}
        height={Math.max(1, height - 8)}
        emptyMessage={
          section === 'pending'
            ? 'Nothing is waiting for a decision.'
            : section === 'grants'
              ? 'No standing grants — every action is asked about.'
              : 'No computer-use activity recorded.'
        }
      />

      <Text color={theme.c('muted')} wrap="truncate-end">
        {`s section ${theme.glyphs.neutral} a answer ${theme.glyphs.neutral} x revoke ${theme.glyphs.neutral} R driver ${theme.glyphs.neutral} r refresh`}
      </Text>
    </Panel>
  );
}

// ── Settings ──────────────────────────────────────────────────────

// ── Settings (Phase 8 item 6) ──────────────────────────────────────
//
// Was a read-only six-line summary of the connection and theme, ending in
// "Change settings with `generatorai config set …`" — i.e. it told the user
// to leave. Now every setting the schema declares is a row, editable in
// place, and each one says WHEN it takes effect: a settings screen that
// silently needs a restart for half its rows teaches people that settings do
// not work. `settingsView.ts` owns that classification and the validation, so
// the pane cannot offer a key `config set` will not write.

function SettingsPane({ paneId, content, focused, height }: PaneProps): React.JSX.Element {
  const theme = useTheme();
  const connection = useTui((s) => s.connection);
  const selected = useTui((s) => s.selection[paneId] ?? 0);
  const query = useTui((s) => s.search[paneId] ?? '');
  const state = (content.state ?? {}) as { rows?: SettingRow[]; loading?: boolean; error?: string };

  const rows = state.rows ?? EMPTY_SETTINGS;
  const filtered = useMemo(() => {
    if (!query) return rows;
    const needle = query.toLowerCase();
    return rows.filter((row) => row.key.toLowerCase().includes(needle));
  }, [rows, query]);
  const current = filtered[Math.min(selected, Math.max(0, filtered.length - 1))];

  const effectColor = (effect: SettingRow['effect']): string | undefined =>
    effect === 'live'
      ? theme.c('success')
      : effect === 'restart'
        ? theme.c('warning')
        : theme.c('muted');

  return (
    <Panel
      title={content.title}
      subtitle={
        connection ? `${connection.label} ${theme.glyphs.neutral} ${connection.state}` : 'not connected'
      }
      focused={focused}
      flexGrow={1}
    >
      {state.loading ? (
        <Spinner label="Reading configuration…" />
      ) : state.error ? (
        <EmptyState title="Could not read the configuration" hint={state.error} />
      ) : (
        <VirtualList
          items={filtered}
          selectedIndex={selected}
          height={Math.max(1, height - 6)}
          emptyMessage={query ? 'No setting matches that filter.' : 'No settings.'}
          renderItem={(row, _index, isSelected) => (
            <Box>
              <Box flexShrink={0} width={30}>
                <Text color={isSelected ? theme.c('primary') : undefined} wrap="truncate-end">
                  {isSelected ? theme.glyphs.arrowRight : ' '} {row.key}
                </Text>
              </Box>
              <Box flexGrow={1} overflow="hidden">
                <Text
                  // An overridden value is the one worth spotting: it is the
                  // only reason the app is not behaving as shipped.
                  color={row.overridden ? theme.c('warning') : theme.c('muted')}
                  wrap="truncate-end"
                >
                  {row.value || '(unset)'}
                </Text>
              </Box>
              <Box flexShrink={0} marginLeft={1}>
                <Text color={effectColor(row.effect)}>{row.effect}</Text>
              </Box>
            </Box>
          )}
        />
      )}

      {current ? (
        <Text color={theme.c('muted')} wrap="truncate-end">
          {current.overridden ? `default: ${current.defaultValue || '(none)'}` : 'at its default'}
          {current.choices ? `  ${theme.glyphs.neutral} ${current.choices.join(' / ')}` : ''}
          {current.effect === 'restart' ? `  ${theme.glyphs.neutral} needs a restart to apply` : ''}
        </Text>
      ) : null}

      <Text color={theme.c('muted')} wrap="truncate-end">
        {`e edit ${theme.glyphs.neutral} d restore default ${theme.glyphs.neutral} / filter ${theme.glyphs.neutral} device ${connection?.deviceId ? shortId(connection.deviceId) : '—'}`}
      </Text>
    </Panel>
  );
}

/** Stable reference — see `EMPTY_ROWS`. */
const EMPTY_SETTINGS: SettingRow[] = [];

export { StatusPill };
