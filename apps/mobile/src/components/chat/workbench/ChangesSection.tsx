// ────────────────────────────────────────────────────────────────
// Workbench › Changes — the mobile form of web's ChangesSurface.
//
// Web renders every file as a collapsed header in one long virtualised
// column and expands them in place. That works because the column is ~400pt
// wide and permanently on screen. On a phone the same layout puts a two-line
// header above two visible lines of diff, so the list and the diff are
// separate views: tap a file, read it full width, come back.
//
// Everything else from the web toolbar is kept, because each control answers
// a question nothing else can:
//   base picker   "what changed since the agent's last checkpoint?"
//   wrap          a 200-column line is unreadable at 393pt without it
//   discard       the only destructive action here, so it is two-step
//   checkpoints   the undo history, and the way back from a bad discard
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileDiff,
  History,
  Maximize2,
  RefreshCw,
  Undo2,
  WrapText,
} from 'lucide-react-native';
import {
  parseUnifiedDiff,
  queryKeys,
  toDiffList,
  type ChangeFileEntry,
  type DiffListItem,
} from '@generatorai/client-core';

import { Touchable } from '../../ui/Touchable';
import { Button, IconButton } from '../../ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../../ui/States';
import { SkeletonList } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';
import { haptics } from '../../ui/haptics';
import { useApi } from '../../../api/useApi';
import { useTheme } from '../../../theme/ThemeProvider';

/** Web's STATUS_STYLE, letter for letter. */
const STATUS_TONE: Record<ChangeFileEntry['status'], string> = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger',
  renamed: 'text-info',
};

const STATUS_BG: Record<ChangeFileEntry['status'], string> = {
  added: 'bg-success-muted',
  modified: 'bg-warning-muted',
  deleted: 'bg-danger-muted',
  renamed: 'bg-info-muted',
};

const STATUS_LETTER: Record<ChangeFileEntry['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

const STATUS_TITLE: Record<ChangeFileEntry['status'], string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
};

/** Web's checkpoint-kind wording, so both apps name the same snapshot alike. */
const CHECKPOINT_LABEL: Record<string, string> = {
  baseline: 'Session start',
  turn: 'Chat turn',
  stage: 'Stage',
  autorun: 'Automation',
  manual: 'Manual snapshot',
  pre_restore: 'Before rewind',
};

type Row = ChangeFileEntry & { alias: string };

/** The section toolbar band. Mirrors web's `px-2 py-1.5` + bottom border. */
export function Toolbar({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <View className="min-h-11 flex-row items-center gap-2 border-b border-border-muted px-3 py-1.5">
      {children}
    </View>
  );
}

export function ChangesSection({
  workspaceId,
  detail,
  onOpenFile,
}: {
  workspaceId: string;
  detail: { path: string; alias?: string } | null;
  onOpenFile: (path: string, alias?: string) => void;
}): React.ReactElement {
  const api = useApi();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const toast = useToast();

  const [base, setBase] = useState('baseline');
  const [wrap, setWrap] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  /** Files whose diff is open inline, keyed `alias:path` (web parity). */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const changes = useQuery({
    queryKey: [...queryKeys.changes(workspaceId), base],
    queryFn: () => api.workspaces.changes(workspaceId, { base, head: 'working' }),
    staleTime: 10_000,
  });

  const checkpoints = useQuery({
    queryKey: queryKeys.checkpoints(workspaceId),
    queryFn: () => api.workspaces.checkpoints(workspaceId),
    staleTime: 30_000,
  });

  // Discard is a single-path checkpoint restore, not a reverse patch — the
  // same call web makes, and undoable because the server snapshots first.
  const restore = useMutation({
    mutationFn: (vars: { checkpointId: string; paths: string[] }) =>
      api.workspaces.restoreCheckpoint(workspaceId, vars.checkpointId, { paths: vars.paths }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.changes(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceTree(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.checkpoints(workspaceId) });
      toast({ message: 'Discarded — a snapshot was saved first', tone: 'success' });
    },
    onError: (err) =>
      toast({
        message: err instanceof Error ? err.message : 'Could not discard',
        tone: 'error',
      }),
  });

  const rows = useMemo<Row[]>(
    () =>
      (changes.data?.repos ?? []).flatMap((repo) =>
        repo.files.map((file) => ({ ...file, alias: repo.alias })),
      ),
    [changes.data],
  );

  const baseCheckpointId = useMemo(() => {
    if (base.startsWith('checkpoint:')) return base.slice('checkpoint:'.length);
    return checkpoints.data?.checkpoints.find((c) => c.kind === 'baseline')?.id ?? null;
  }, [base, checkpoints.data]);

  const baseLabel = useMemo(() => {
    if (base === 'baseline') return 'session start';
    const found = checkpoints.data?.checkpoints.find((c) => `checkpoint:${c.id}` === base);
    if (!found) return 'a checkpoint';
    return `${CHECKPOINT_LABEL[found.kind] ?? found.label ?? found.kind} · ${new Date(
      found.createdAt,
    ).toLocaleTimeString()}`;
  }, [base, checkpoints.data]);

  const discard = useCallback(
    (row: Row) => {
      if (!baseCheckpointId) return;
      const target = row.alias === '.' ? row.path : `${row.alias}/${row.path}`;
      haptics.warn();
      restore.mutate({ checkpointId: baseCheckpointId, paths: [target] });
      setConfirmDiscard(null);
    },
    [baseCheckpointId, restore],
  );

  if (detail) {
    const entry = rows.find((r) => r.path === detail.path);
    return (
      <DiffView
        workspaceId={workspaceId}
        path={detail.path}
        base={base}
        wrap={wrap}
        onToggleWrap={() => setWrap((w) => !w)}
        {...(detail.alias ? { alias: detail.alias } : {})}
        {...(entry?.oldBlob ? { oldBlob: entry.oldBlob } : {})}
        {...(entry?.newBlob ? { newBlob: entry.newBlob } : {})}
      />
    );
  }

  const stats = changes.data?.stats;
  const allExpanded = rows.length > 0 && expanded.size >= rows.length;

  return (
    <View className="flex-1">
      <Toolbar>
        <FileDiff size={14} color={colors['muted-foreground']} />
        <Text className="text-sm font-medium text-foreground">
          {stats?.files ?? 0} {stats?.files === 1 ? 'change' : 'changes'}
        </Text>
        {stats && (stats.additions > 0 || stats.deletions > 0) ? (
          <Text className="font-mono text-xs">
            <Text className="text-success">+{stats.additions}</Text>{' '}
            <Text className="text-danger">−{stats.deletions}</Text>
          </Text>
        ) : null}
        <View className="flex-1" />
        {!showCheckpoints && rows.length > 0 ? (
          <IconButton
            accessibilityLabel={allExpanded ? 'Collapse all files' : 'Expand all files'}
            icon={
              allExpanded ? (
                <ChevronsDownUp size={16} color={colors['muted-foreground']} />
              ) : (
                <ChevronsUpDown size={16} color={colors['muted-foreground']} />
              )
            }
            onPress={() =>
              setExpanded(
                allExpanded ? new Set() : new Set(rows.map((r) => `${r.alias}:${r.path}`)),
              )
            }
          />
        ) : null}
        {!showCheckpoints ? (
          <IconButton
            accessibilityLabel={wrap ? 'Stop wrapping long lines' : 'Wrap long lines'}
            selected={wrap}
            icon={<WrapText size={16} color={wrap ? colors.primary : colors['muted-foreground']} />}
            onPress={() => setWrap((w) => !w)}
          />
        ) : null}
        <IconButton
          accessibilityLabel={showCheckpoints ? 'Hide checkpoints' : 'Checkpoints and rewind'}
          selected={showCheckpoints}
          icon={
            <History
              size={16}
              color={showCheckpoints ? colors.primary : colors['muted-foreground']}
            />
          }
          onPress={() => setShowCheckpoints((v) => !v)}
        />
        <IconButton
          accessibilityLabel="Refresh changes"
          icon={
            <RefreshCw
              size={16}
              color={changes.isFetching ? colors.primary : colors['muted-foreground']}
            />
          }
          onPress={() => void changes.refetch()}
          disabled={changes.isFetching}
        />
      </Toolbar>

      {/* The base a diff is taken against is chosen from the checkpoint list
          behind the history icon. A permanent strip of checkpoint chips cost
          a whole band of vertical space to duplicate what that list already
          says, on the surface with the least room to spare. */}
      {base !== 'baseline' && !showCheckpoints ? (
        <View className="flex-row items-center gap-2 border-b border-border-muted bg-subtle px-3 py-1.5">
          <History size={12} color={colors['muted-foreground']} />
          <Text numberOfLines={1} className="flex-1 text-xs text-muted-foreground">
            Comparing against {baseLabel}
          </Text>
          <Touchable
            accessibilityLabel="Compare against session start"
            haptic="select"
            onPress={() => setBase('baseline')}
            className="rounded-full px-2 py-0.5"
          >
            <Text className="text-xs font-medium text-primary">Reset</Text>
          </Touchable>
        </View>
      ) : null}

      {showCheckpoints ? (
        <CheckpointList
          workspaceId={workspaceId}
          onCompare={(id) => {
            setBase(`checkpoint:${id}`);
            setShowCheckpoints(false);
          }}
        />
      ) : changes.isLoading ? (
        <View className="p-4">
          <SkeletonList rows={4} />
        </View>
      ) : changes.isError ? (
        <ErrorState message="Could not load changes." onRetry={() => void changes.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No changes yet"
          message="Files the agent creates or edits show up here as it works."
          icon={<FileDiff size={22} color={colors['muted-foreground']} />}
        />
      ) : (
        <LegendList
          data={rows}
          keyExtractor={(row) => `${row.alias}:${row.path}`}
          estimatedItemSize={62}
          // Rows close over `expanded`, `wrap` and the discard state, none of
          // which are in `data`. Without this the list keeps the rows it
          // already built and expanding a file does nothing on screen.
          extraData={`${expanded.size}:${[...expanded].join()}|${wrap}|${confirmDiscard ?? ''}`}
          contentContainerStyle={{ paddingBottom: 32 }}
          renderItem={({ item }) => {
            const id = `${item.alias}:${item.path}`;
            return (
              <FileRow
                row={item}
                workspaceId={workspaceId}
                base={base}
                wrap={wrap}
                expanded={expanded.has(id)}
                onToggle={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (!next.delete(id)) next.add(id);
                    return next;
                  })
                }
                canDiscard={Boolean(baseCheckpointId)}
                confirming={confirmDiscard === id}
                discarding={restore.isPending}
                onOpen={() => onOpenFile(item.path, item.alias)}
                onAskDiscard={() => setConfirmDiscard(id)}
                onCancelDiscard={() => setConfirmDiscard(null)}
                onConfirmDiscard={() => discard(item)}
              />
            );
          }}
        />
      )}
    </View>
  );
}

function FileRow({
  row,
  workspaceId,
  base,
  wrap,
  expanded,
  onToggle,
  canDiscard,
  confirming,
  discarding,
  onOpen,
  onAskDiscard,
  onCancelDiscard,
  onConfirmDiscard,
}: {
  row: Row;
  workspaceId: string;
  base: string;
  wrap: boolean;
  expanded: boolean;
  onToggle: () => void;
  canDiscard: boolean;
  confirming: boolean;
  discarding: boolean;
  onOpen: () => void;
  onAskDiscard: () => void;
  onCancelDiscard: () => void;
  onConfirmDiscard: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const name = row.path.slice(row.path.lastIndexOf('/') + 1);
  const dir = row.path.slice(0, row.path.lastIndexOf('/'));
  const readable = !row.isBinary && !row.isTooLarge;

  return (
    <View className="border-b border-border-muted">
      <View className="flex-row items-center">
        <Touchable
          accessibilityLabel={`${STATUS_TITLE[row.status]} ${row.path}`}
          accessibilityHint={readable ? 'Shows the diff below' : undefined}
          accessibilityState={{ expanded }}
          haptic="tap"
          scale="none"
          onPress={readable ? onToggle : onOpen}
          className="min-h-14 flex-1 flex-row items-center gap-2.5 py-2 pl-3"
        >
          {readable ? (
            expanded ? (
              <ChevronDown size={14} color={colors['muted-foreground']} />
            ) : (
              <ChevronRight size={14} color={colors['muted-foreground']} />
            )
          ) : (
            <View className="w-3.5" />
          )}
          <View className={`h-5 w-5 items-center justify-center rounded ${STATUS_BG[row.status]}`}>
            <Text className={`font-mono text-xs font-bold ${STATUS_TONE[row.status]}`}>
              {STATUS_LETTER[row.status]}
            </Text>
          </View>
          <View className="flex-1">
            <Text numberOfLines={1} className="text-sm font-medium text-foreground">
              {row.oldPath ? (
                <Text className="text-muted-foreground line-through">
                  {row.oldPath.slice(row.oldPath.lastIndexOf('/') + 1)}{' → '}
                </Text>
              ) : null}
              {name}
            </Text>
            <Text numberOfLines={1} className="text-xs text-muted-foreground">
              {row.alias !== '.' ? `${row.alias}/` : ''}
              {dir || '·'}
            </Text>
          </View>
          {row.isBinary ? (
            <Text className="text-xs text-muted-foreground">binary</Text>
          ) : row.isTooLarge ? (
            <Text className="text-xs text-muted-foreground">too large</Text>
          ) : (
            <View className="flex-row gap-1.5">
              <Text className="font-mono text-xs text-success">+{row.additions}</Text>
              <Text className="font-mono text-xs text-danger">−{row.deletions}</Text>
            </View>
          )}
        </Touchable>
        {readable ? (
          <IconButton
            accessibilityLabel={`Open ${row.path} full screen`}
            icon={<Maximize2 size={14} color={colors['muted-foreground']} />}
            onPress={onOpen}
          />
        ) : null}
        {canDiscard && !confirming ? (
          <IconButton
            accessibilityLabel={`Discard changes to ${row.path}`}
            icon={<Undo2 size={15} color={colors['muted-foreground']} />}
            onPress={onAskDiscard}
          />
        ) : null}
      </View>

      {expanded && readable ? (
        <InlineDiff
          workspaceId={workspaceId}
          path={row.path}
          base={base}
          wrap={wrap}
          {...(row.alias ? { alias: row.alias } : {})}
          {...(row.oldBlob ? { oldBlob: row.oldBlob } : {})}
          {...(row.newBlob ? { newBlob: row.newBlob } : {})}
        />
      ) : null}

      {confirming ? (
        <View className="flex-row items-center gap-2 bg-warning-muted px-3 py-2">
          <Text className="flex-1 text-xs text-foreground">Discard this file&apos;s changes?</Text>
          <Button label="Cancel" variant="ghost" size="sm" onPress={onCancelDiscard} />
          <Button
            label="Discard"
            variant="danger"
            size="sm"
            loading={discarding}
            onPress={onConfirmDiscard}
          />
        </View>
      ) : null}
    </View>
  );
}

/** How many diff lines an inline expansion renders before deferring. */
const INLINE_DIFF_LIMIT = 400;

/**
 * A file's diff, opened in place under its row.
 *
 * Capped rather than virtualised: a nested virtual list inside an outer one
 * cannot measure itself, and a change set is mostly small files. Anything
 * past the cap says so and points at the full-screen view.
 */
function InlineDiff({
  workspaceId,
  path,
  alias,
  base,
  wrap,
  oldBlob,
  newBlob,
}: {
  workspaceId: string;
  path: string;
  alias?: string;
  base: string;
  wrap: boolean;
  oldBlob?: string;
  newBlob?: string;
}): React.ReactElement {
  const api = useApi();

  const patch = useQuery({
    queryKey: [...queryKeys.changeFile(workspaceId, path, oldBlob, newBlob), base, 'inline'],
    queryFn: () =>
      api.workspaces.filePatch(workspaceId, {
        path,
        base,
        head: 'working',
        ...(alias ? { alias } : {}),
        ...(oldBlob ? { oldBlob } : {}),
        ...(newBlob ? { newBlob } : {}),
      }),
  });

  const lines = useMemo<DiffListItem[]>(
    () => (patch.data?.patch ? toDiffList(parseUnifiedDiff(patch.data.patch)) : []),
    [patch.data],
  );

  if (patch.isLoading) {
    return (
      <View className="px-3 py-2">
        <SkeletonList rows={3} />
      </View>
    );
  }
  if (patch.isError) {
    return (
      <View className="px-3 py-2">
        <ErrorState message="Could not load this diff." onRetry={() => void patch.refetch()} />
      </View>
    );
  }
  if (lines.length === 0) {
    return (
      <Text className="px-3 py-2 text-xs text-muted-foreground">No textual diff for this file.</Text>
    );
  }

  const shown = lines.slice(0, INLINE_DIFF_LIMIT);
  return (
    <View className="border-t border-border-muted bg-canvas-bg">
      <DiffLines lines={shown} wrap={wrap} truncated={patch.data?.truncated ?? false} scroll={false} />
      {lines.length > shown.length ? (
        <Text className="px-3 py-1.5 text-xs text-muted-foreground">
          {lines.length - shown.length} more lines — open full screen to read the rest.
        </Text>
      ) : null}
    </View>
  );
}

function CheckpointList({
  workspaceId,
  onCompare,
}: {
  workspaceId: string;
  onCompare: (id: string) => void;
}): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();
  const checkpoints = useQuery({
    queryKey: queryKeys.checkpoints(workspaceId),
    queryFn: () => api.workspaces.checkpoints(workspaceId),
  });

  if (checkpoints.isLoading) return <LoadingState label="Loading checkpoints…" />;
  const list = (checkpoints.data?.checkpoints ?? []).filter((c) => c.kind !== 'live');
  if (list.length === 0) {
    return (
      <EmptyState
        title="No checkpoints yet"
        message="A snapshot is written before each turn, so you can always compare or rewind."
        icon={<History size={22} color={colors['muted-foreground']} />}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      {list.map((c) => (
        <Touchable
          key={c.id}
          accessibilityLabel={`Compare against ${CHECKPOINT_LABEL[c.kind] ?? c.kind}`}
          haptic="tap"
          onPress={() => onCompare(c.id)}
          className="min-h-14 flex-row items-center gap-3 border-b border-border-muted px-3 py-2.5"
        >
          <History size={15} color={colors['muted-foreground']} />
          <View className="flex-1">
            <Text className="text-sm font-medium text-foreground">
              {CHECKPOINT_LABEL[c.kind] ?? c.label ?? c.kind}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {new Date(c.createdAt).toLocaleString()}
            </Text>
          </View>
          <ChevronRight size={16} color={colors['muted-foreground']} />
        </Touchable>
      ))}
    </ScrollView>
  );
}

/**
 * One file's unified diff.
 *
 * The query key carries the blob pair, not just the path: with a path-only
 * key and any staleTime, editing a file leaves the previous diff on screen
 * because the key never changed.
 */
function DiffView({
  workspaceId,
  path,
  alias,
  base,
  wrap,
  onToggleWrap,
  oldBlob,
  newBlob,
}: {
  workspaceId: string;
  path: string;
  alias?: string;
  base: string;
  wrap: boolean;
  onToggleWrap: () => void;
  oldBlob?: string;
  newBlob?: string;
}): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();

  const patch = useQuery({
    queryKey: [...queryKeys.changeFile(workspaceId, path, oldBlob, newBlob), base],
    queryFn: () =>
      api.workspaces.filePatch(workspaceId, {
        path,
        base,
        head: 'working',
        ...(alias ? { alias } : {}),
        ...(oldBlob ? { oldBlob } : {}),
        ...(newBlob ? { newBlob } : {}),
      }),
  });

  const lines = useMemo<DiffListItem[]>(
    () => (patch.data?.patch ? toDiffList(parseUnifiedDiff(patch.data.patch)) : []),
    [patch.data],
  );

  const body = ((): React.ReactElement => {
    if (patch.isLoading) return <LoadingState label="Loading diff…" />;
    if (patch.isError) {
      return <ErrorState message="Could not load this diff." onRetry={() => void patch.refetch()} />;
    }
    if (lines.length === 0) {
      return <EmptyState title="Nothing to show" message="This file has no textual diff." />;
    }
    return <DiffLines lines={lines} wrap={wrap} truncated={patch.data?.truncated ?? false} />;
  })();

  return (
    <View className="flex-1">
      <Toolbar>
        <Text numberOfLines={1} className="flex-1 font-mono text-xs text-muted-foreground">
          {path}
        </Text>
        <IconButton
          accessibilityLabel={wrap ? 'Stop wrapping long lines' : 'Wrap long lines'}
          selected={wrap}
          icon={<WrapText size={16} color={wrap ? colors.primary : colors['muted-foreground']} />}
          onPress={onToggleWrap}
        />
      </Toolbar>
      {body}
    </View>
  );
}

/**
 * The diff body.
 *
 * Unwrapped, the whole list scrolls horizontally as ONE surface rather than
 * per row, so the gutter cannot drift out of alignment with its code.
 */
function DiffLines({
  lines,
  wrap,
  truncated,
  scroll = true,
}: {
  lines: DiffListItem[];
  wrap: boolean;
  truncated: boolean;
  /**
   * False when the diff is expanded inline under a file row. A virtualised
   * list nested inside another one cannot measure itself, so inline diffs
   * render their (already capped) rows directly.
   */
  scroll?: boolean;
}): React.ReactElement {
  const renderLine = (item: DiffListItem): React.ReactElement =>
    item.type === 'hunk' ? (
      <View className="bg-subtle px-3 py-0.5">
        <Text className="font-mono text-xs leading-code text-info">
          {`@@ -${item.hunk.oldStart},${item.hunk.oldLines} +${item.hunk.newStart},${item.hunk.newLines} @@`}
          {item.hunk.section ? ` ${item.hunk.section}` : ''}
        </Text>
      </View>
    ) : (
      <View
        className={`flex-row ${
          item.row.kind === 'add'
            ? 'bg-success-muted'
            : item.row.kind === 'del'
              ? 'bg-danger-muted'
              : ''
        }`}
      >
        {/* Line numbers are what makes a diff quotable in a follow-up
            prompt, which is most of why anyone reads one on a phone. */}
        <Text className="w-10 px-1 text-right font-mono text-xs leading-code text-muted-foreground">
          {item.row.newNumber ?? item.row.oldNumber ?? ''}
        </Text>
        <Text
          className={`w-3 font-mono text-xs leading-code ${
            item.row.kind === 'add'
              ? 'text-success'
              : item.row.kind === 'del'
                ? 'text-danger'
                : 'text-muted-foreground'
          }`}
        >
          {item.row.kind === 'add' ? '+' : item.row.kind === 'del' ? '−' : ' '}
        </Text>
        <Text
          {...(wrap ? {} : { numberOfLines: 1 })}
          className="flex-1 pr-3 font-mono text-xs leading-code text-foreground"
        >
          {item.row.content}
        </Text>
      </View>
    );

  const list = scroll ? (
    <LegendList
      data={lines}
      keyExtractor={(line) => line.key}
      estimatedItemSize={18}
      contentContainerStyle={{ paddingVertical: 8, paddingBottom: 32 }}
      renderItem={({ item }) => renderLine(item)}
    />
  ) : (
    <View className="py-1">
      {lines.map((item) => (
        <React.Fragment key={item.key}>{renderLine(item)}</React.Fragment>
      ))}
    </View>
  );

  const banner = truncated ? (
    <View className="bg-warning-muted px-3 py-1.5">
      <Text className="text-xs text-foreground">
        The server truncated this diff because the file is very large.
      </Text>
    </View>
  ) : null;

  if (!scroll) {
    return (
      <View>
        {banner}
        {wrap ? (
          list
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ width: 760 }}>{list}</View>
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <View className="flex-1">
      {banner}
      {wrap ? (
        list
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ width: 760 }} className="flex-1">
            {list}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
