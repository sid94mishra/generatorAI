// MB-22 ChangesPanel (MPaneOpen, MPaneChanges; MD-07): the pane's Changes tab. Toolbar: DiffStat "+18 −8 · 2 files"
// and the branch as a mono Badge; the compare bar "This turn / This chat / Branch vs main" (+ a mount Select when
// more than one mount); the CheckpointScrubber (MB-32); the pending-comments card ("Send all"); Keep all / Undo all
// (`changes-tray-keep-all` / `changes-tray-undo-all`); the groups — "Changed in this chat", "Also changed in the
// workspace" (the legacy root repo beside real codebases), "Kept"; and the commit footer ("2 files ready · into
// <branch>" + "Commit…" → MB-23; a merge left in progress, `scm-merge-in-progress`, with its three ways out).
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import type { RepoReadiness } from '@generatorai/shared';

import { useComposerCapture } from '../Composer/model/captureContext';
import { CheckpointScrubber } from '../CheckpointScrubber';
import { actionReason, hasAnyAction, pickRepo } from '../CommitSheet/model/scmModel';
import { batchSummary, countThreads, isPendingThread, useReviewThreads } from '../DiffView';
import { workspaceCommitHref, workspaceDiffHref } from '../shell/hrefs';
import { useChangesSummary } from '../WorkspacePane/WorkspacePane.queries';
import { ListSection } from '../../ui/layout/ListSection';
import { confirm } from '../../ui/native/AlertDialog';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { Select } from '../../ui/native/Select';
import { useSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { DiffStat } from '../../ui/primitives/DiffStat';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { IconButton } from '../../ui/primitives/IconButton';
import { Pressable } from '../../ui/primitives/Pressable';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { ChangeFileRow, type ChangeRowAction } from './ChangeFileRow';
import { useChangeActions, useCheckpoints, useConflictActions, useScmReadiness, useWorkspaceMounts } from './ChangesPanel.queries';
import { changeRows, fileId, type ChangeRow } from './model/changeKinds';
import { changeSections, commitSummary, compareModeOf, compareModes, type CompareMode } from './model/compareModel';
import { undoAllMessage } from './model/keptModel';

export interface ChangesPanelProps {
  workspaceId: string | null;
  /** The chat whose review threads and agent this pane serves (null on a run pane). */
  chatId?: string | null;
  /** False while the tab is hidden: queries stop chasing the server. */
  active?: boolean;
  /** The chat's rewind (CheckpointScrubber "Rewind to here"). */
  onRewind?: (turnId: string, prompt: string) => void;
  testID?: string;
}

function ConflictActions({ repo, chatId, busy, onAsk, onContinue, onAbort }: { repo: RepoReadiness; chatId: string | null; busy: boolean; onAsk: () => void; onContinue: () => void; onAbort: () => void }): React.ReactElement {
  const files = repo.conflictedFiles;
  return (
    <View className="gap-4 px-4 pb-2">
      <Text role="footnote" tone="fg-2">
        {`Merging ${repo.defaultBranch ?? 'the base'} into ${repo.branch ?? 'HEAD'} conflicts in ${files.length} ${files.length === 1 ? 'file' : 'files'}. The conflict markers are in the files.`}
      </Text>
      <View className="gap-1 rounded-code bg-sunken p-3">
        {files.slice(0, 20).map((f) => (
          <Text key={f} role="monoSm" numberOfLines={1}>
            {f}
          </Text>
        ))}
        {files.length > 20 ? (
          <Text role="footnote" tone="fg-3">
            {`… and ${files.length - 20} more`}
          </Text>
        ) : null}
      </View>
      <Button label="Ask the agent" variant="primary" fullWidth icon="agents" disabled={!chatId || busy} disabledReason={chatId ? undefined : 'Open the Changes tab from the chat to ask its agent.'} onPress={onAsk} />
      <Button label="Continue" fullWidth icon="play" disabled={busy} onPress={onContinue} />
      <Button label="Abort the merge" variant="ghost" fullWidth icon="undo" disabled={busy} onPress={onAbort} />
    </View>
  );
}

export function ChangesPanel({ workspaceId, chatId = null, active = true, onRewind, testID = 'changes-panel' }: ChangesPanelProps): React.ReactElement {
  const sheet = useSheet();
  const capture = useComposerCapture();
  const [base, setBase] = useState('baseline');
  const [mount, setMount] = useState<string>('all');
  const summary = useChangesSummary(workspaceId, { base, enabled: active || Boolean(workspaceId) });
  const mounts = useWorkspaceMounts(workspaceId);
  const checkpoints = useCheckpoints(workspaceId, active);
  const readiness = useScmReadiness(workspaceId, active);
  const actions = useChangeActions(workspaceId);
  const conflicts = useConflictActions(workspaceId, chatId);
  const review = useReviewThreads(workspaceId, chatId ? { scope: 'chat', scopeId: chatId } : null, { active, target: chatId ? { kind: 'chat', chatId } : null });

  const rows = useMemo(() => changeRows(summary.data), [summary.data]);
  const aliases = useMemo(() => [...new Set(rows.map((r) => r.alias))], [rows]);
  const multiMount = (mounts.data?.length ?? aliases.length) > 1;
  const shown = mount === 'all' ? rows : rows.filter((r) => r.alias === mount);
  const rootAliases = useMemo(() => new Set((summary.data?.repos ?? []).filter((r) => r.kind === 'root').map((r) => r.alias)), [summary.data]);
  const sections = useMemo(() => changeSections(shown, rootAliases), [shown, rootAliases]);
  const modes = useMemo(() => compareModes(mounts.data ?? [], checkpoints.data?.checkpoints ?? []), [mounts.data, checkpoints.data]);
  const mode = compareModeOf(base, modes);

  const repos = readiness.data?.repos ?? [];
  const repo = pickRepo(repos, mount === 'all' ? null : mount);
  const branch = repo?.detached ? 'detached HEAD' : (repo?.branch ?? null);
  const counts = countThreads(review.threads);
  const pending = review.threads.filter(isPendingThread);
  const commentsFor = (row: ChangeRow): number => (review.byFile.get(fileId(row.alias, row.path)) ?? []).filter((t) => t.status !== 'resolved' && t.status !== 'outdated').length;

  const openDiff = (row: Pick<ChangeRow, 'path' | 'alias'>): void => {
    if (!workspaceId) return;
    router.push(workspaceDiffHref(workspaceId, { path: row.path, alias: row.alias, base, chat: chatId }) as never);
  };
  const onRowAction = (action: ChangeRowAction, row: ChangeRow): void => {
    switch (action) {
      case 'open':
        openDiff(row);
        return;
      case 'mention':
        capture?.mentionPath(row.alias !== '.' && multiMount ? `${row.alias}/${row.path}` : row.path);
        return;
      case 'copy':
        void Clipboard.setStringAsync(row.path);
        haptic('success');
        return;
      case 'keep':
        actions.keep(row);
        return;
      case 'unkeep':
        actions.unkeep(row);
        return;
      case 'discard':
        void confirm({ title: `Discard changes to ${row.path.split('/').pop() ?? row.path}?`, message: 'The file goes back to where this comparison started. A snapshot is saved first.', confirmLabel: 'Discard', icon: 'undo' }).then((yes) => {
          if (yes) actions.discard(row);
        });
        return;
    }
  };
  const undoAll = (): void => {
    const kept = rows.filter((r) => r.kept).length;
    void confirm({ title: 'Undo all changes?', message: undoAllMessage(rows.length - kept, kept), confirmLabel: 'Undo all', icon: 'undo' }).then((yes) => {
      if (yes) actions.undoAll();
    });
  };
  const openConflicts = (target: RepoReadiness): void =>
    sheet.present(
      <ConflictActions
        repo={target}
        chatId={chatId}
        busy={conflicts.busy}
        onAsk={() => {
          sheet.dismiss();
          conflicts.askAgent.mutate(target.alias);
        }}
        onContinue={() => {
          sheet.dismiss();
          conflicts.continueMerge.mutate(target.alias);
        }}
        onAbort={() => {
          sheet.dismiss();
          conflicts.abortMerge.mutate(target.alias);
        }}
      />,
      { title: 'Merge conflicts', detents: ['content'] },
    );

  if (!workspaceId) return <EmptyState icon="changes" title="No workspace yet" description="A workspace is created the first time the agent runs here." />;

  let list: React.ReactNode;
  if (summary.isLoading) {
    list = (
      <View className="px-4" accessibilityLabel="Loading changes">
        <Skeleton preset="list" count={4} />
      </View>
    );
  } else if (summary.isError) {
    list = <ErrorState title="Couldn't load changes" error={summary.error} onRetry={() => void summary.refetch()} />;
  } else if (summary.data && !summary.data.hasGit) {
    list = <EmptyState icon="changes" title="Not a git repository" description="This workspace has no git history, so there is nothing to compare." />;
  } else if (rows.length === 0) {
    list = <EmptyState icon="changes" title={repo?.ahead ? 'No uncommitted changes' : 'No changes yet'} description={repo?.ahead ? `${repo.ahead} ${repo.ahead === 1 ? 'commit' : 'commits'} ahead on ${branch ?? 'this branch'}.` : 'Files the agent creates or edits show up here as it works.'} />;
  } else {
    list = sections.map((section) => (
      <ListSection key={section.key} title={section.title} count={section.rows.length} dividers="none">
        {section.rows.map((row) => (
          <ChangeFileRow key={row.id} row={row} showAlias={multiMount} comments={commentsFor(row)} busy={actions.busy.has(row.id)} can={{ review: actions.canReview, discard: actions.canRestore, mention: Boolean(capture) }} onAction={onRowAction} />
        ))}
      </ListSection>
    ));
  }

  const commit = repo ? commitSummary(rows.length, branch) : null;
  const commitBlocked = repo ? actionReason(repo, 'commit') : null;

  return (
    <View testID={testID} className="flex-1">
      <ScrollView className="flex-1" contentContainerClassName="gap-3 pb-4 pt-2" keyboardShouldPersistTaps="handled">
        <View className="min-h-hit flex-row items-center gap-2 px-4">
          <DiffStat additions={summary.data?.stats.additions} deletions={summary.data?.stats.deletions} files={summary.data?.stats.files} />
          <View className="flex-1" />
          {branch ? <Badge label={branch} icon="branch" mono size="sm" /> : null}
        </View>
        <View className="gap-2 px-4">
          <SegmentedControl<CompareMode>
            accessibilityLabel="Compare"
            value={(mode || 'chat') as CompareMode}
            onValueChange={(next) => {
              haptic('selection');
              if (next === 'chat') setBase('baseline');
              else if (next === 'turn' && modes.turn) setBase(modes.turn);
              else if (next === 'branch' && modes.branch) setBase(modes.branch.value);
            }}
            segments={[
              { value: 'turn', label: 'This turn', disabled: !modes.turn },
              { value: 'chat', label: 'This chat' },
              { value: 'branch', label: modes.branch?.label ?? 'Branch', disabled: !modes.branch },
            ]}
            fullWidth
            testID="changes-compare"
          />
          {multiMount && aliases.length > 1 ? (
            <Select label="Source" presentation="field" value={mount} onValueChange={setMount} options={[{ value: 'all', label: 'All sources' }, ...aliases.map((a) => ({ value: a, label: a === '.' ? 'Workspace' : a }))]} testID="changes-mount" />
          ) : null}
        </View>
        <CheckpointScrubber checkpoints={checkpoints.data?.checkpoints ?? []} base={base} onCompare={setBase} {...(onRewind ? { onRewind } : {})} />
        {pending.length > 0 ? (
          <View className="mx-4 flex-row items-center gap-3 rounded-card bg-raised px-3 py-2">
            <Icon concept="message" size={18} tone="fg-2" />
            <View className="flex-1 gap-0.5">
              <Text role="subhead" weight={600}>
                {`${pending.length} pending ${pending.length === 1 ? 'comment' : 'comments'}`}
              </Text>
              <Text role="monoSm" tone="fg-3" numberOfLines={1}>
                {batchSummary(counts)}
              </Text>
            </View>
            <IconButton icon="view" size="sm" label="Preview comments" onPress={() => openDiff({ path: pending[0]!.path, alias: pending[0]!.repoAlias })} />
            {review.canSend ? <Button label="Send all" icon="send" size="sm" loading={review.submit.isPending} onPress={() => review.submit.mutate({})} testID="changes-send-comments" /> : null}
          </View>
        ) : null}
        {rows.length > 0 ? (
          <View className="flex-row items-center justify-end gap-2 px-4">
            {actions.canReview ? <Button label="Keep all" size="sm" icon="check" disabled={actions.bulkBusy || rows.every((r) => r.kept)} onPress={actions.keepAll} testID="changes-tray-keep-all" /> : null}
            {actions.canRestore ? <Button label="Undo all" size="sm" variant="destructive" icon="undo" disabled={actions.bulkBusy} onPress={undoAll} testID="changes-tray-undo-all" /> : null}
          </View>
        ) : null}
        {list}
      </ScrollView>
      {repo?.mergeInProgress ? (
        <Pressable
          testID="scm-merge-in-progress"
          frame="none"
          onPress={() => openConflicts(repo)}
          accessibilityRole="button"
          accessibilityLabel={`Merge in progress, ${repo.conflictedFiles.length} conflicted ${repo.conflictedFiles.length === 1 ? 'file' : 'files'}. Resolve`}
          className="mx-4 mb-2"
        >
          <Callout tone="err" form="banner" title={`Merge in progress · ${repo.conflictedFiles.length} conflicted ${repo.conflictedFiles.length === 1 ? 'file' : 'files'}`} />
        </Pressable>
      ) : null}
      {repo && commit && rows.length > 0 ? (
        <View className="min-h-footer flex-row items-center gap-3 border-t border-line-soft px-4 py-2">
          <View className="flex-1 gap-0.5">
            <Text role="subhead" weight={600}>
              {commit.title}
            </Text>
            {commitBlocked ? (
              <Text role="footnote" tone="fg-3" numberOfLines={2}>
                {commitBlocked}
              </Text>
            ) : commit.subtitle ? (
              <Text role="monoSm" tone="fg-3" numberOfLines={1}>
                {commit.subtitle}
              </Text>
            ) : null}
          </View>
          <Button label="Commit…" variant="primary" icon="commit" disabled={!hasAnyAction(repo)} onPress={() => router.push(workspaceCommitHref(workspaceId, { alias: repo.alias, chat: chatId }) as never)} testID="changes-commit" />
        </View>
      ) : null}
    </View>
  );
}
