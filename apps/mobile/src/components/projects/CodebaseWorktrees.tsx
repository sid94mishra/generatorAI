// ────────────────────────────────────────────────────────────────
// Codebase › Worktrees (web: CodebaseDetailPage "Worktrees" tab).
//
// Worktrees are created by runs; the phone lists them, removes a finished
// or orphaned one (confirming — its folder and branch go), and runs the
// project-scoped cleanup. A worktree an active run is using is never offered
// for removal.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Sparkles } from 'lucide-react-native';
import type { WorktreeInfo } from '@generatorai/shared';

import { ConfirmSheet } from '../ui/ActionSheet';
import { Button } from '../ui/Button';
import { ListGroup, ListRow } from '../ui/ListRow';
import { Badge, SectionHeader } from '../ui/primitives';
import { SkeletonList } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { relativeTime } from '../runs/formatTime';
import { useFeature } from '../runs/useFeature';
import { useTheme } from '../../theme/ThemeProvider';
import { projectKeys } from './api';
import { messageOf } from './ProjectActions';
import { useProjectsApi } from './useProjectsApi';
import { canRemoveWorktree, cleanupSummary, worktreeStatusLabel, worktreeTone } from './projectEditModel';

const PREVIEW = 5;

export function CodebaseWorktrees({ projectId, codebaseId }: { projectId: string; codebaseId: string }): React.ReactElement {
  const api = useProjectsApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { colors } = useTheme();
  const feature = useFeature('projectEdit');
  const [showAll, setShowAll] = useState(false);
  const [removing, setRemoving] = useState<WorktreeInfo | null>(null);

  const worktrees = useQuery({
    queryKey: projectKeys.worktrees(projectId, codebaseId),
    queryFn: () => api.worktrees(projectId, codebaseId),
  });
  const invalidate = (): void =>
    void queryClient.invalidateQueries({ queryKey: projectKeys.worktrees(projectId, codebaseId) });

  const remove = useMutation({
    mutationFn: (worktreeId: string) => api.removeWorktree(projectId, codebaseId, worktreeId),
    onSuccess: () => {
      invalidate();
      toast({ message: 'Worktree removed.', variant: 'success' });
    },
    onError: (err) => toast({ message: messageOf(err, 'Could not remove the worktree.'), variant: 'danger' }),
  });

  const cleanup = useMutation({
    mutationFn: () => api.cleanupWorktrees(projectId, codebaseId),
    onSuccess: (result) => {
      invalidate();
      toast({ message: cleanupSummary(result), variant: 'success' });
    },
    onError: (err) => toast({ message: messageOf(err, 'Cleanup failed.'), variant: 'danger' }),
  });

  const list = worktrees.data ?? [];
  const visible = showAll ? list : list.slice(0, PREVIEW);

  return (
    <View>
      <SectionHeader
        title={list.length > 0 ? `Worktrees (${list.length})` : 'Worktrees'}
        action={
          feature.available ? (
            <Button
              label="Clean up"
              variant="ghost"
              size="sm"
              haptic="commit"
              icon={<Sparkles size={16} color={colors.primary} />}
              loading={cleanup.isPending}
              onPress={() => cleanup.mutate()}
              accessibilityHint="Removes stale and orphaned worktrees in this project"
            />
          ) : undefined
        }
      />
      {worktrees.isLoading ? (
        <SkeletonList rows={2} />
      ) : worktrees.isError ? (
        <View className="flex-row items-center justify-between gap-3 px-1 py-2">
          <Text className="flex-1 text-sm text-muted-foreground">Could not load worktrees.</Text>
          <Button label="Retry" variant="ghost" size="sm" haptic="tap" onPress={() => void worktrees.refetch()} />
        </View>
      ) : list.length === 0 ? (
        <Text className="px-1 py-2 text-sm text-muted-foreground">
          No worktrees. Runs create one when they work on this codebase.
        </Text>
      ) : (
        <>
          <ListGroup>
            {visible.map((wt) => {
              const removable = feature.available && canRemoveWorktree(wt.status);
              const tone = worktreeTone(wt.status);
              return (
                <ListRow
                  key={wt.id}
                  title={wt.branchName || wt.worktreePath}
                  subtitle={[wt.runType ? `${wt.runType} run` : null, relativeTime(wt.createdAt as unknown as string)]
                    .filter(Boolean)
                    .join(' · ')}
                  icon={<GitBranch size={18} color={colors['muted-foreground']} />}
                  chevron={Boolean(wt.runId && wt.runType === 'workflow')}
                  {...(tone !== 'success' ? { trailing: <Badge label={worktreeStatusLabel(wt.status)} tone={tone} /> } : {})}
                  {...(wt.runId && wt.runType === 'workflow'
                    ? { onPress: () => router.push(`/runs/${wt.runId}`) }
                    : {})}
                  {...(removable ? { onLongPress: () => setRemoving(wt) } : {})}
                  accessibilityHint={removable ? 'Long-press to remove this worktree' : undefined}
                />
              );
            })}
          </ListGroup>
          {list.length > PREVIEW ? (
            <Button
              label={showAll ? 'Show fewer' : `Show all ${list.length}`}
              variant="ghost"
              size="sm"
              haptic="select"
              onPress={() => setShowAll((v) => !v)}
            />
          ) : null}
        </>
      )}

      <ConfirmSheet
        visible={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.branchName ?? 'this worktree'}?`}
        message="Its folder and branch are deleted on your computer. Uncommitted work in it is lost."
        confirmLabel="Remove worktree"
        onConfirm={() => {
          const id = removing?.id;
          setRemoving(null);
          if (id) remove.mutate(id);
        }}
      />
    </View>
  );
}
