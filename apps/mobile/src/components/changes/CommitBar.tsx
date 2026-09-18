// ────────────────────────────────────────────────────────────────
// CommitBar — the source-control bar at the bottom of the Changes pane.
//
// Driven by readiness (`GET /workspaces/:id/scm/readiness`) rather than by a
// provider probe: the bar shows the branch, how far it is ahead/behind and
// the open PR for every git-capable mount, and when commit / push / PR is
// unavailable it shows WHY (`RepoReadiness.reasons`) instead of hiding the
// control. A host that is not connected says so in the only terms a phone
// can offer — connect it from the desktop or web app.
//
// One action runs the whole flow (`POST …/scm/flow`): branch → commit →
// sync → push → pull request, with the sheet showing what each step did.
// Conflicts stop the run WITHOUT touching the working tree; the conflict
// sheet then offers the agent, Continue, or Abort.
//
// Still gated on `write:workspaces` through `useCapability('commit')`: a
// phone without it gets the reason, not a 403.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExternalLink, GitBranch, GitCommitHorizontal, TriangleAlert } from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';
import type { RepoReadiness, ScmFlowResult } from '@generatorai/shared';

import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../ui/Button';
import { Touchable } from '../ui/Touchable';
import { useToast } from '../ui/Toast';
import { useCapability } from '../review/useScopes';
import { ConflictSheet } from '../scm/ConflictSheet';
import { ScmFlowSheet } from '../scm/ScmFlowSheet';
import { scmKeys } from '../scm/api';
import { useScmApi } from '../scm/useScmApi';
import {
  actionReason,
  buildFlowRequest,
  describeFlowResult,
  emptyFlowForm,
  hasAnyAction,
  pickRepo,
  readinessLine,
  resumeAfterConflictsRequest,
  type ScmFlowForm,
} from '../scm/scmModel';

export function CommitBar({
  workspaceId,
  fileCount,
  chatId = null,
  hint,
  active = true,
}: {
  workspaceId: string;
  fileCount: number;
  /** The chat that owns this workspace — needed to ask the agent to resolve conflicts. */
  chatId?: string | null;
  /** Seeds generated commit / PR text. */
  hint?: string | undefined;
  active?: boolean;
}): React.ReactElement | null {
  // The bar is the last thing on screen; keep it clear of the gesture bar.
  const bottomInset = useSafeAreaInsets().bottom;
  const scm = useScmApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { colors } = useTheme();
  const commitCap = useCapability('commit');

  const [alias, setAlias] = useState<string | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);
  const [result, setResult] = useState<ScmFlowResult | null>(null);
  const [conflicts, setConflicts] = useState<ScmFlowResult | null>(null);
  const [form, setForm] = useState<ScmFlowForm | null>(null);

  const readiness = useQuery({
    queryKey: scmKeys.readiness(workspaceId),
    queryFn: () => scm.readiness(workspaceId),
    enabled: commitCap.available,
    staleTime: 15_000,
    subscribed: active,
    // A device without `read:workspaces` gets a 403 here; that means no bar,
    // not a retry storm.
    retry: false,
  });

  const repos = readiness.data?.repos ?? [];
  const repo = pickRepo(repos, alias);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: scmKeys.readiness(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.changes(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.checkpoints(workspaceId) });
  };

  const report = (flow: ScmFlowResult): void => {
    const outcome = describeFlowResult(flow);
    if (outcome.conflicts) {
      setConflicts(flow);
      setFlowOpen(false);
      toast({ message: outcome.message, variant: 'warning' });
      return;
    }
    const url = outcome.url;
    toast({
      message: outcome.message,
      variant: outcome.tone,
      ...(url ? { action: { label: 'Open PR', onPress: () => void Linking.openURL(url) } } : {}),
    });
    if (flow.status === 'ok') setFlowOpen(false);
  };

  const flow = useMutation({
    mutationFn: (values: ScmFlowForm) => {
      setForm(values);
      return scm.flow(workspaceId, buildFlowRequest(values));
    },
    onSuccess: (flowResult) => {
      setResult(flowResult);
      invalidate();
      report(flowResult);
    },
    onError: (err) => toast({ message: errorText(err, 'The flow failed'), variant: 'danger' }),
  });

  const askAgent = useMutation({
    mutationFn: () => {
      if (!chatId) throw new Error('This workspace is not open in a chat.');
      return scm.resolveConflictsWithAgent(workspaceId, {
        alias: conflicts?.alias ?? repo?.alias ?? '.',
        chatId,
      });
    },
    onSuccess: () => {
      invalidate();
      setConflicts(null);
      toast({
        message: 'Asked the agent to resolve the conflicts. Review the changes, then Continue.',
        variant: 'info',
      });
    },
    onError: (err) => toast({ message: errorText(err, 'Could not reach the agent'), variant: 'danger' }),
  });

  const continueMerge = useMutation({
    mutationFn: async () => {
      const targetAlias = conflicts?.alias ?? repo?.alias ?? '.';
      await scm.continueConflicts(workspaceId, { alias: targetAlias });
      const resume = form ?? emptyFlowForm(targetAlias);
      return scm.flow(workspaceId, resumeAfterConflictsRequest({ ...resume, alias: targetAlias }));
    },
    onSuccess: (flowResult) => {
      setResult(flowResult);
      invalidate();
      setConflicts(null);
      report(flowResult);
    },
    onError: (err) => toast({ message: errorText(err, 'Could not finish the merge'), variant: 'danger' }),
  });

  const abortMerge = useMutation({
    mutationFn: () => scm.abortConflicts(workspaceId, { alias: conflicts?.alias ?? repo?.alias ?? '.' }),
    onSuccess: () => {
      invalidate();
      setConflicts(null);
      toast({ message: 'Merge aborted. Nothing was changed.', variant: 'info' });
    },
    onError: (err) => toast({ message: errorText(err, 'Could not abort the merge'), variant: 'danger' }),
  });

  if (!commitCap.available) {
    if (fileCount === 0) return null;
    return (
      <View className="border-t border-border-muted bg-card px-4 pt-2" style={{ paddingBottom: Math.max(bottomInset, 8) }}>
        <Text className="text-sm text-muted-foreground">{commitCap.reason}</Text>
      </View>
    );
  }

  // No git-capable mount and nothing to say about one: the bar is furniture.
  if (repos.length === 0 && fileCount === 0) return null;

  const openPr = repo?.openPullRequest ?? null;
  const commitBlocked = repo ? actionReason(repo, 'commit') : null;
  const actionable = repo ? hasAnyAction(repo) : false;

  return (
    <>
      <View className="gap-1.5 border-t border-border bg-card px-3 pt-2.5" style={{ paddingBottom: Math.max(bottomInset, 10) }}>
        {repos.map((mount) => (
          <MountLine
            key={mount.alias}
            readiness={mount}
            selected={repos.length > 1 && mount.alias === repo?.alias}
            multi={repos.length > 1}
            onPress={() => {
              setAlias(mount.alias);
              if (hasAnyAction(mount)) setFlowOpen(true);
            }}
          />
        ))}

        {repos.length === 0 ? (
          <Text className="text-xs text-muted-foreground">
            {readiness.isError
              ? 'Could not read the repository state.'
              : readiness.isLoading
                ? 'Reading the repository…'
                : 'Not a git repository — there is nothing to commit to.'}
          </Text>
        ) : null}

        {repo && !actionable ? (
          <View className="flex-row gap-2">
            <TriangleAlert size={13} color={colors.warning} />
            <Text className="flex-1 text-xs text-muted-foreground">
              {commitBlocked ?? actionReason(repo, 'push') ?? 'Nothing to do here yet.'}
            </Text>
          </View>
        ) : null}

        {repo && actionable ? (
          <View className="flex-row items-center gap-2">
            <Button
              grow
              label={fileCount > 0 ? `Commit ${fileCount} ${fileCount === 1 ? 'file' : 'files'}` : 'Commit'}
              icon={<GitCommitHorizontal size={16} color={colors['primary-foreground']} />}
              onPress={() => setFlowOpen(true)}
            />
            {openPr ? (
              <Button
                label={`PR #${openPr.number}`}
                size="sm"
                variant="secondary"
                icon={<ExternalLink size={14} color={colors.primary} />}
                accessibilityLabel={`Open pull request ${openPr.number}: ${openPr.title}`}
                onPress={() => void Linking.openURL(openPr.url)}
              />
            ) : null}
          </View>
        ) : null}
      </View>

      {repo ? (
        <ScmFlowSheet
          visible={flowOpen}
          onClose={() => setFlowOpen(false)}
          workspaceId={workspaceId}
          readiness={repo}
          hint={hint}
          busy={flow.isPending}
          result={result}
          onRun={(values) => flow.mutate(values)}
        />
      ) : null}

      {conflicts?.conflicts ? (
        <ConflictSheet
          visible
          onClose={() => setConflicts(null)}
          conflicts={conflicts.conflicts}
          chatId={chatId}
          busy={askAgent.isPending || continueMerge.isPending || abortMerge.isPending}
          onAskAgent={() => askAgent.mutate()}
          onContinue={() => continueMerge.mutate()}
          onAbort={() => abortMerge.mutate()}
        />
      ) : null}
    </>
  );
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** One mount: `api · main · ↑2 ↓1 · 3 files` with its open PR as a pill. */
function MountLine({
  readiness,
  selected,
  multi,
  onPress,
}: {
  readiness: RepoReadiness;
  selected: boolean;
  multi: boolean;
  onPress: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const pr = readiness.openPullRequest;
  const line = readinessLine(readiness);

  return (
    <Touchable
      accessibilityLabel={`${multi ? `${readiness.alias}: ` : ''}${line}`}
      haptic="select"
      scale="none"
      onPress={onPress}
      className={`flex-row items-center gap-2 rounded-2xl px-1 py-0.5 ${selected ? 'bg-accent' : ''}`}
    >
      <GitBranch size={13} color={colors['muted-foreground']} />
      <Text numberOfLines={1} className="flex-1 text-xs text-muted-foreground">
        {multi ? `${readiness.alias} · ` : ''}
        {line}
      </Text>
      {pr ? (
        <View className="rounded-full border border-primary bg-accent px-2 py-0.5">
          <Text className="text-xs font-medium text-primary">
            PR #{pr.number}
            {pr.draft ? ' · draft' : ''}
          </Text>
        </View>
      ) : null}
    </Touchable>
  );
}
