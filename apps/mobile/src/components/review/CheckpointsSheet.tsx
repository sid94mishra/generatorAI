// ────────────────────────────────────────────────────────────────
// CheckpointsSheet — browse workspace snapshots, compare, rewind, undo.
//
// Every checkpoint is a git tree reachable only from a private ref, so
// listing and restoring never touch the user's branches. Restoring is
// presented as recoverable rather than destructive — the server writes a
// `pre_restore` "Redo point" first — but it still moves the working tree
// under a running agent, so it confirms through a destructive-tone sheet
// and reports what happened per mount, mirroring web's CheckpointTimeline.
//
// "Compare" hands the group's revision selector back (`turn:<id>` or
// `checkpoint:<id>`) so the Changes surface diffs against that point.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Ellipsis, GitCompare, History, RotateCcw } from 'lucide-react-native';
import { queryKeys, type RestoreResult } from '@generatorai/client-core';

import { useApi } from '../../api/useApi';
import { useTheme } from '../../theme/ThemeProvider';
import { Sheet } from '../ui/Sheet';
import { Button, IconButton } from '../ui/Button';
import { Touchable } from '../ui/Touchable';
import { ActionSheet, ConfirmSheet } from '../ui/ActionSheet';
import { Badge } from '../ui/primitives';
import { EmptyState, ErrorState, LoadingState } from '../ui/States';
import { useToast } from '../ui/Toast';
import { haptics } from '../ui/haptics';
import { useWorkspaceExtras, type CheckpointRow } from '../changes/api';
import {
  checkpointTime,
  describePrompt,
  formatAliasList,
  groupCheckpoints,
  type CheckpointGroup,
} from './checkpointGroups';
import { useCapability } from './useScopes';

export interface CheckpointsSheetProps {
  visible: boolean;
  onClose: () => void;
  workspaceId: string;
  /** The base currently compared against, to mark the active row. */
  currentBase?: string;
  onCompare?: (revisionSelector: string) => void;
}

interface RewindReport {
  group: CheckpointGroup;
  perMount: Array<{ alias: string; result?: RestoreResult; error?: string }>;
}

export function useWorkspaceCheckpoints(workspaceId: string | null | undefined, active = true) {
  const extras = useWorkspaceExtras();
  return useQuery({
    queryKey: queryKeys.checkpoints(workspaceId ?? ''),
    queryFn: () => extras.checkpoints(workspaceId!),
    enabled: Boolean(workspaceId),
    staleTime: 15_000,
    subscribed: active,
  });
}

export function CheckpointsSheet({
  visible,
  onClose,
  workspaceId,
  currentBase,
  onCompare,
}: CheckpointsSheetProps): React.ReactElement | null {
  const api = useApi();
  const extras = useWorkspaceExtras();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { colors } = useTheme();
  const restoreCap = useCapability('restoreCheckpoints');
  const [confirm, setConfirm] = useState<CheckpointGroup | null>(null);
  const [menuFor, setMenuFor] = useState<CheckpointGroup | null>(null);
  const [report, setReport] = useState<RewindReport | null>(null);

  const checkpoints = useWorkspaceCheckpoints(workspaceId, visible);
  const groups = useMemo(() => groupCheckpoints(checkpoints.data?.checkpoints ?? []), [checkpoints.data]);

  const invalidateWorkspace = () => {
    void queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId] });
  };

  /**
   * Rewind every mount the group touched, in sequence, reporting each
   * outcome: a rewind that restored two of three sources must say so.
   */
  const rewind = useMutation({
    mutationFn: async (group: CheckpointGroup): Promise<RewindReport> => {
      const perMount: RewindReport['perMount'] = [];
      for (const target of group.restoreTargets) {
        try {
          const result = await api.workspaces.restoreCheckpoint(workspaceId, target.id);
          perMount.push({ alias: target.repoAlias, result });
        } catch (err) {
          perMount.push({ alias: target.repoAlias, error: err instanceof Error ? err.message : 'Rewind failed' });
        }
      }
      return { group, perMount };
    },
    onSuccess: (result) => {
      invalidateWorkspace();
      setReport(result);
      const failures = result.perMount.filter((m) => m.error).length;
      if (failures === 0) haptics.success();
      else haptics.warn();
    },
  });

  const snapshot = useMutation({
    mutationFn: () => extras.createCheckpoint(workspaceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.checkpoints(workspaceId) });
      toast({ message: 'Snapshot saved', tone: 'success' });
    },
    onError: (err) => toast({ message: err instanceof Error ? err.message : 'Could not snapshot', tone: 'error' }),
  });

  if (!visible) return null;

  const undoTarget = report ? latestRedoPoint(checkpoints.data?.checkpoints ?? [], report) : null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Checkpoints"
      // Opens at the SMALL detent and is dragged up. A session usually has
      // two or three checkpoints, and opening full-screen for two rows left
      // most of the sheet empty.
      detents={[0.6, 0.92]}
      initialDetent={0}
      scrollable={false}
      keyboardAware={false}
      action={
        restoreCap.available ? (
          <IconButton
            accessibilityLabel="Save a manual snapshot"
            icon={<Camera size={18} color={colors.foreground} />}
            disabled={snapshot.isPending}
            onPress={() => snapshot.mutate()}
          />
        ) : undefined
      }
    >
      {checkpoints.isLoading ? (
        <LoadingState label="Loading checkpoints…" />
      ) : checkpoints.isError ? (
        <ErrorState message="Could not load checkpoints." onRetry={() => void checkpoints.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No checkpoints yet"
          message="A snapshot is written before each turn, so you can always compare or rewind."
          icon={<History size={22} color={colors['muted-foreground']} />}
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          {report ? (
            <RewindResult
              report={report}
              undoable={Boolean(undoTarget)}
              undoing={rewind.isPending}
              onUndo={() => {
                if (undoTarget) rewind.mutate(undoTarget);
              }}
              onDismiss={() => setReport(null)}
            />
          ) : null}
          {!restoreCap.available ? (
            <View className="mx-4 mt-3 rounded-xl bg-subtle px-3 py-2">
              <Text className="text-xs text-muted-foreground">{restoreCap.reason}</Text>
            </View>
          ) : null}
          {groups.map((group) => {
            const active = currentBase === group.compareValue;
            const time = new Date(group.createdAt);
            return (
              // The ROW is the compare action; rewind lives behind the
              // trailing menu. Two peer buttons of different weights — a
              // bordered "Compare" beside a bare "Rewind" link — implied the
              // heavier-looking one was the more consequential, which was
              // exactly backwards.
              //
              // The menu button is a SIBLING of the row's pressable, never a
              // child: a nested pressable is invalid DOM on web and leaves
              // the inner control unreachable to a screen reader on both
              // platforms.
              <View key={group.key} className="flex-row items-start border-b border-border-muted">
                <Touchable
                  accessibilityLabel={`${group.label}${
                    group.promptExcerpt ? `. ${describePrompt(group.promptExcerpt)}` : ''
                  }`}
                  accessibilityHint={onCompare ? 'Compares the working tree against this point' : undefined}
                  accessibilityState={{ selected: active }}
                  haptic="tap"
                  scale="none"
                  disabled={!onCompare}
                  className="flex-1"
                  onPress={() => {
                    if (!onCompare) return;
                    onCompare(group.compareValue);
                    onClose();
                  }}
                >
                  <View className="gap-1.5 py-3 pl-4 pr-2">
                    <View className="flex-row items-center gap-2">
                      <History size={14} color={active ? colors.primary : colors['muted-foreground']} />
                      <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>
                        {group.label}
                      </Text>
                      {active ? <Badge label="Comparing" tone="primary" /> : null}
                      <Text className="text-xs text-muted-foreground">
                        {time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                    {group.promptExcerpt ? (
                      <Text numberOfLines={2} className="text-xs text-muted-foreground">
                        {describePrompt(group.promptExcerpt)}
                      </Text>
                    ) : null}
                    <View className="flex-row flex-wrap items-center gap-2">
                      {group.aliases.length > 1 || group.aliases[0] !== '.' ? (
                        <Text className="text-xs text-muted-foreground">{formatAliasList(group.aliases)}</Text>
                      ) : null}
                      {group.fileCount > 0 ? (
                        <Text className="font-mono text-xs text-muted-foreground">
                          {group.fileCount} {group.fileCount === 1 ? 'file' : 'files'}{' '}
                          <Text className="text-success">+{group.additions}</Text>{' '}
                          <Text className="text-danger">−{group.deletions}</Text>
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </Touchable>

                {restoreCap.available && group.restoreTargets.length > 0 ? (
                  <View className="pr-2 pt-3">
                    <IconButton
                      compact
                      accessibilityLabel={`Actions for ${group.label}`}
                      icon={<Ellipsis size={16} color={colors['muted-foreground']} />}
                      disabled={rewind.isPending}
                      onPress={() => setMenuFor(group)}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}

      <ActionSheet
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor?.label ?? ''}
        actions={
          menuFor
            ? [
                ...(onCompare
                  ? [
                      {
                        label: 'Compare against this',
                        icon: <GitCompare size={18} color={colors.foreground} />,
                        onPress: () => {
                          onCompare(menuFor.compareValue);
                          onClose();
                        },
                      },
                    ]
                  : []),
                {
                  label: menuFor.undoesTurn ? 'Rewind to before this turn' : 'Rewind to this point',
                  icon: <RotateCcw size={18} color={colors.foreground} />,
                  onPress: () => setConfirm(menuFor),
                },
              ]
            : []
        }
      />

      <ConfirmSheet
        visible={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.undoesTurn ? 'Rewind to before this turn?' : 'Rewind to this checkpoint?'}
        message={
          confirm
            ? `${formatAliasList(confirm.aliases)} ${confirm.aliases.length > 1 ? 'go' : 'goes'} back to ${
                confirm.undoesTurn ? 'the state the prompt was written against' : 'this snapshot'
              }. Current work is saved to a "Redo point" first, so you can undo it.`
            : undefined
        }
        confirmLabel={
          confirm && confirm.restoreTargets.length > 1
            ? `Rewind ${confirm.restoreTargets.length} sources`
            : 'Confirm rewind'
        }
        onConfirm={() => {
          if (confirm) {
            haptics.warn();
            rewind.mutate(confirm);
          }
          setConfirm(null);
        }}
      />
    </Sheet>
  );
}

/**
 * The redo point the last rewind wrote, as a one-target group, so "Undo"
 * is just another rewind. The server does not return the pre_restore id, so
 * it is the newest `pre_restore` per restored mount.
 */
function latestRedoPoint(rows: readonly CheckpointRow[], report: RewindReport): CheckpointGroup | null {
  const restored = new Set(report.perMount.filter((m) => m.result).map((m) => m.alias));
  if (restored.size === 0) return null;
  const targets: CheckpointRow[] = [];
  for (const alias of restored) {
    const redo = rows
      .filter((c) => c.kind === 'pre_restore' && c.repoAlias === alias)
      .sort((a, b) => checkpointTime(b.createdAt) - checkpointTime(a.createdAt))[0];
    if (redo) targets.push(redo);
  }
  if (targets.length === 0) return null;
  return {
    key: 'undo',
    kind: 'pre_restore',
    label: 'Redo point',
    createdAt: checkpointTime(targets[0]!.createdAt),
    aliases: targets.map((t) => t.repoAlias),
    restoreTargets: targets,
    undoesTurn: false,
    fileCount: 0,
    additions: 0,
    deletions: 0,
    compareValue: `checkpoint:${targets[0]!.id}`,
  };
}

function RewindResult({
  report,
  undoable,
  undoing,
  onUndo,
  onDismiss,
}: {
  report: RewindReport;
  undoable: boolean;
  undoing: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}): React.ReactElement {
  const failures = report.perMount.filter((m) => m.error);
  const successes = report.perMount.filter((m) => m.result);
  return (
    <View className={`mx-4 mt-3 gap-2 rounded-2xl border p-3 ${failures.length ? 'border-warning bg-warning-muted' : 'border-success bg-success-muted'}`}>
      <Text className="text-sm font-semibold text-foreground">
        {failures.length === 0
          ? report.group.undoesTurn
            ? 'Rewound to before the turn'
            : 'Rewound'
          : `Rewound ${successes.length} of ${report.perMount.length} sources`}
      </Text>
      {report.perMount.map((entry) => (
        <Text key={entry.alias} className="text-xs text-foreground">
          {entry.alias === '.' ? 'workspace' : entry.alias}
          {entry.result
            ? ` — ${entry.result.restored} restored, ${entry.result.removed} removed${
                entry.result.skipped?.length ? `, ${entry.result.skipped.length} skipped` : ''
              }`
            : ` — ${entry.error}`}
        </Text>
      ))}
      <View className="flex-row items-center gap-2">
        {undoable ? (
          <Button label="Undo rewind" size="sm" variant="secondary" loading={undoing} onPress={onUndo} />
        ) : null}
        <View className="flex-1" />
        <Button label="Dismiss" size="sm" variant="ghost" onPress={onDismiss} />
      </View>
    </View>
  );
}
