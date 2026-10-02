// MB-23 CommitSheet (MPaneCommit, MPaneCommitDone; `/workspaces/[workspaceId]/commit`; MD-85, D-68): one sheet for the
// whole commit → push → pull request flow (`POST …/scm/flow`). Form: the mount (more than one), "into <branch>",
// the message (empty → the server writes one; "Generate"), Push and "Open a pull request" switches — each with its
// reason when unavailable, never a dead switch — and the pull request (base as a text field, head, title, description,
// "Open as draft"). One `lg` primary whose label follows the switches. Working: the planned steps, not dismissible.
// Done: Committed (sha · message), Pushed, the pull request card + "Open in browser" / "Copy link". Conflicts: the
// three ways out (ask the chat's agent, Continue, Abort). Errors: the reason + "Try again".
import React, { useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, scmKeys } from '@generatorai/client-core';
import type { RepoReadiness, ScmFlowResult } from '@generatorai/shared';

import { useConflictActions, useScmReadiness } from '../ChangesPanel/ChangesPanel.queries';
import { useApi } from '../../services/api/useApi';
import type { RemovalSource } from '../../ui/layout/DirtyGuard/DirtyGuard.types';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { RouteSheet } from '../../ui/native/Sheet';
import { Select } from '../../ui/native/Select';
import { haptic } from '../../ui/platform/haptics';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { Input } from '../../ui/primitives/Input';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Spinner } from '../../ui/primitives/Spinner';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { toast } from '../../ui/primitives/Toast';
import {
  actionReason,
  buildFlowRequest,
  describeFlowResult,
  emptyFlowForm,
  pickRepo,
  plannedSteps,
  resumeAfterConflictsRequest,
  runLabel,
  shortSha,
  stepLabel,
  type ScmFlowForm,
} from './model/scmModel';

export interface CommitSheetProps {
  workspaceId: string;
  /** The mount the Changes tab was showing. */
  alias?: string | null;
  /** The chat that owns the workspace (asks its agent to resolve conflicts). */
  chatId?: string | null;
  onClose: () => void;
  /** Opens Settings › Source control (a host that is not connected). */
  onOpenSourceControl?: () => void;
  navigation?: RemovalSource;
}

type Phase = { kind: 'form' } | { kind: 'working' } | { kind: 'done'; result: ScmFlowResult } | { kind: 'error'; message: string };

function Section({ icon, title, trailing, children }: { icon: 'commit' | 'pr'; title: string; trailing?: string | null; children: React.ReactNode }): React.ReactElement {
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2 px-4">
        <Icon concept={icon} size={18} tone="fg-2" />
        <Text role="headline" accessibilityRole="header" className="flex-1">
          {title}
        </Text>
        {trailing ? (
          <Text role="monoSm" tone="fg-3" numberOfLines={1} className="shrink">
            {trailing}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function FlowForm({ workspaceId, repo, repos, form, setForm, onAlias }: { workspaceId: string; repo: RepoReadiness; repos: readonly RepoReadiness[]; form: ScmFlowForm; setForm: React.Dispatch<React.SetStateAction<ScmFlowForm>>; onAlias: (alias: string) => void }): React.ReactElement {
  const api = useApi();
  const pushReason = actionReason(repo, 'push');
  const prReason = actionReason(repo, 'pullRequest');
  const commitReason = actionReason(repo, 'commit');
  const generate = useMutation({
    mutationFn: (kind: 'commit' | 'pull_request') => api.scm.generate(workspaceId, { alias: form.alias, kind, ...(form.base.trim() ? { base: form.base.trim() } : {}) }),
    onSuccess: (out) =>
      setForm((prev) => (out.kind === 'commit' ? { ...prev, message: out.message ?? prev.message } : { ...prev, title: out.title ?? prev.title, body: out.body ?? prev.body })),
    onError: () => toast({ kind: 'error', message: "Couldn't write that for you. Type it instead." }),
  });
  const branch = repo.detached ? 'detached HEAD' : (repo.branch ?? null);
  return (
    <View className="gap-6 pb-2">
      {repos.length > 1 ? (
        <View className="px-4">
          <Select label="Source" presentation="field" value={repo.alias} onValueChange={onAlias} options={repos.map((r) => ({ value: r.alias, label: r.alias === '.' ? 'Workspace' : r.alias, ...(r.can.commit ? {} : { description: 'Nothing to commit' }) }))} testID="commit-mount" />
        </View>
      ) : null}
      <Section icon="commit" title="Commit" trailing={branch ? `into ${branch}` : null}>
        {commitReason ? (
          <View className="px-4">
            <Callout tone="warn" title={commitReason} />
          </View>
        ) : null}
        <View className="gap-2 px-4">
          <Textarea label="Message" value={form.message} onChangeText={(message) => setForm((prev) => ({ ...prev, message }))} placeholder="Empty uses a generated message" minRows={2} presentation="standalone" testID="commit-message" />
          <View className="flex-row items-center gap-3">
            <Text role="footnote" tone="fg-3" className="flex-1">
              {`Commits all ${repo.changedFiles} ${repo.changedFiles === 1 ? 'file' : 'files'}.`}
            </Text>
            <Button label="Generate" variant="ghost" size="sm" icon="wand" loading={generate.isPending && generate.variables === 'commit'} onPress={() => generate.mutate('commit')} />
          </View>
        </View>
        <ListSection>
          <ListRow
            kind="toggle"
            title="Push"
            subtitle={pushReason ?? 'Push the work branch to the remote.'}
            switchValue={(form.push || form.pullRequest) && !pushReason}
            disabled={Boolean(pushReason)}
            onValueChange={(push) => setForm((prev) => ({ ...prev, push, ...(push ? {} : { pullRequest: false }) }))}
            testID="commit-push"
          />
          <ListRow
            kind="toggle"
            title="Open pull request"
            subtitle={prReason ?? 'Opens one against the base branch, or reuses the open one.'}
            switchValue={form.pullRequest && !prReason}
            disabled={Boolean(prReason)}
            // A pull request implies a push.
            onValueChange={(pullRequest) => setForm((prev) => ({ ...prev, pullRequest, push: pullRequest ? true : prev.push }))}
            testID="commit-pr"
          />
        </ListSection>
      </Section>
      {form.pullRequest ? (
        <Section icon="pr" title="Pull request">
          <View className="gap-3 px-4">
            <View className="flex-row items-end gap-2">
              <View className="flex-1">
                <Input label="Base branch" kind="mono" presentation="standalone" value={form.base} onChangeText={(base) => setForm((prev) => ({ ...prev, base }))} placeholder={repo.defaultBranch ?? 'The repository default'} testID="commit-pr-base" />
              </View>
              <Icon concept="back" size={16} tone="fg-3" />
              {branch ? <Badge label={branch} icon="branch" mono size="sm" /> : null}
            </View>
            <Input label="Title" presentation="standalone" value={form.title} onChangeText={(title) => setForm((prev) => ({ ...prev, title }))} placeholder="Generated from the commits when empty" testID="commit-pr-title" />
            <Textarea label="Description" value={form.body} onChangeText={(body) => setForm((prev) => ({ ...prev, body }))} minRows={3} presentation="standalone" testID="commit-pr-body" />
            <View className="flex-row justify-end">
              <Button label="Generate" variant="ghost" size="sm" icon="wand" loading={generate.isPending && generate.variables === 'pull_request'} onPress={() => generate.mutate('pull_request')} />
            </View>
          </View>
          <ListSection>
            <ListRow kind="toggle" title="Open as draft" subtitle="Reviewers aren't requested until it's ready." switchValue={form.draft} onValueChange={(draft) => setForm((prev) => ({ ...prev, draft }))} />
          </ListSection>
        </Section>
      ) : null}
    </View>
  );
}

function Working({ form }: { form: ScmFlowForm }): React.ReactElement {
  const steps = plannedSteps(buildFlowRequest(form));
  return (
    <View className="gap-3 px-4 pb-2" accessibilityLiveRegion="polite" accessibilityLabel="Committing">
      {steps.map((id) => (
        <View key={id} className="min-h-row flex-row items-center gap-3">
          <Spinner size={16} />
          <Text role="body">{stepLabel(id)}</Text>
        </View>
      ))}
    </View>
  );
}

function Done({ result }: { result: ScmFlowResult }): React.ReactElement {
  const pr = result.pullRequest;
  const files = result.readiness.changedFiles;
  return (
    <View className="gap-4 px-4 pb-2">
      <View className="gap-1 rounded-card bg-raised">
        {result.commit ? (
          <View className="min-h-row-2 flex-row items-center gap-3 px-3 py-2">
            <Icon concept="status-succeeded" size={20} tone="ok" />
            <View className="flex-1 gap-0.5">
              <Text role="body">{files > 0 ? `Committed ${files} ${files === 1 ? 'file' : 'files'}` : 'Committed'}</Text>
              <Text role="monoSm" tone="fg-3" numberOfLines={1}>
                {`${shortSha(result.commit.sha)} · ${result.commit.message}`}
              </Text>
            </View>
          </View>
        ) : null}
        {result.pushed ? (
          <View className="min-h-row-2 flex-row items-center gap-3 px-3 py-2">
            <Icon concept="status-succeeded" size={20} tone="ok" />
            <View className="flex-1 gap-0.5">
              <Text role="body">Pushed</Text>
              {result.branch ? (
                <Text role="monoSm" tone="fg-3" numberOfLines={1}>
                  {`origin/${result.branch}`}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
      {pr ? (
        <View className="gap-1.5 rounded-card border border-line-soft p-3">
          <View className="flex-row items-center gap-2">
            <Icon concept="pr" size={18} tone="ok" />
            <Text role="subhead" weight={600} className="flex-1">{`PR #${pr.number} opened`}</Text>
            {pr.draft ? <Badge label="Draft" size="sm" /> : null}
          </View>
          <Text role="body">{pr.title}</Text>
          <Text role="monoSm" tone="fg-3" numberOfLines={1}>{`${pr.base} ← ${pr.head}`}</Text>
          <Text role="monoSm" tone="fg-3" numberOfLines={1}>
            {pr.url.replace(/^https?:\/\//, '')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function CommitSheet({ workspaceId, alias = null, chatId = null, onClose, onOpenSourceControl, navigation }: CommitSheetProps): React.ReactElement {
  const api = useApi();
  const client = useQueryClient();
  const readiness = useScmReadiness(workspaceId);
  const conflicts = useConflictActions(workspaceId, chatId);
  const repos = useMemo(() => readiness.data?.repos ?? [], [readiness.data]);
  const [picked, setPicked] = useState<string | null>(alias);
  const repo = pickRepo(repos, picked);
  const [form, setForm] = useState<ScmFlowForm | null>(null);
  const current = form ?? (repo ? emptyFlowForm(repo.alias, repo.can.push) : null);
  const update: React.Dispatch<React.SetStateAction<ScmFlowForm>> = (next) => setForm((prev) => {
    const base = prev ?? current!;
    return typeof next === 'function' ? next(base) : next;
  });
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [copied, setCopied] = useState(false);

  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: scmKeys.readiness(workspaceId) });
    void client.invalidateQueries({ queryKey: queryKeys.changes(workspaceId) });
    void client.invalidateQueries({ queryKey: queryKeys.checkpoints(workspaceId) });
  };
  const run = useMutation({
    mutationFn: (request: ReturnType<typeof buildFlowRequest>) => api.scm.flow(workspaceId, request),
    onMutate: () => setPhase({ kind: 'working' }),
    onSuccess: (result) => {
      refresh();
      const outcome = describeFlowResult(result);
      if (result.status === 'ok') {
        haptic('success');
        setPhase({ kind: 'done', result });
      } else if (outcome.conflicts) {
        haptic('warning');
        setPhase({ kind: 'done', result });
      } else {
        haptic('error');
        setPhase({ kind: 'error', message: outcome.message });
      }
    },
    onError: (err) => {
      haptic('error');
      setPhase({ kind: 'error', message: err instanceof Error && err.message ? err.message : 'The flow failed.' });
    },
  });

  const dirty = phase.kind === 'form' && Boolean(form && (form.message.trim() || form.title.trim() || form.body.trim()));
  const result = phase.kind === 'done' ? phase.result : null;
  const conflicted = result?.status === 'conflicts';

  let body: React.ReactNode;
  let footer: React.ReactNode = null;
  if (readiness.isLoading) {
    body = (
      <View className="px-4">
        <Skeleton preset="list" count={3} />
      </View>
    );
  } else if (readiness.isError || !repo || !current) {
    body = <ErrorState title="Couldn't read the repository" error={readiness.error ?? new Error('No git repository in this workspace.')} onRetry={() => void readiness.refetch()} />;
  } else if (phase.kind === 'working') {
    body = <Working form={current} />;
  } else if (phase.kind === 'error') {
    const connect = /Settings › Source control/.test(phase.message);
    body = (
      <View className="gap-3 px-4 pb-2">
        <Callout tone="err" title="The commit did not finish" body={phase.message} />
        {connect && onOpenSourceControl ? <Button label="Open Source control settings" variant="ghost" onPress={onOpenSourceControl} /> : null}
      </View>
    );
    footer = <Button label="Try again" variant="primary" size="lg" fullWidth onPress={() => setPhase({ kind: 'form' })} testID="commit-retry" />;
  } else if (result && conflicted) {
    const target = result.alias;
    body = (
      <View className="gap-3 px-4 pb-2">
        <Callout tone="warn" title={describeFlowResult(result).message} body="Nothing has been pushed. Ask the agent to resolve them, or resolve them yourself and continue." />
        <Button label="Ask the agent" icon="agents" fullWidth disabled={!chatId || conflicts.busy} onPress={() => conflicts.askAgent.mutate(target, { onSuccess: onClose })} />
        <Button label="Abort the merge" variant="ghost" fullWidth disabled={conflicts.busy} onPress={() => conflicts.abortMerge.mutate(target, { onSuccess: () => setPhase({ kind: 'form' }) })} />
      </View>
    );
    footer = (
      <Button
        label="Continue"
        variant="primary"
        size="lg"
        fullWidth
        loading={conflicts.continueMerge.isPending || run.isPending}
        onPress={() => conflicts.continueMerge.mutate(target, { onSuccess: () => run.mutate(resumeAfterConflictsRequest({ ...current, alias: target })) })}
      />
    );
  } else if (result) {
    body = <Done result={result} />;
    const url = result.pullRequest?.url;
    footer = url ? (
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Button
            label={copied ? 'Copied' : 'Copy link'}
            icon="copy"
            fullWidth
            onPress={() => {
              void Clipboard.setStringAsync(url);
              setCopied(true);
            }}
          />
        </View>
        <View className="flex-1">
          <Button label="Open in browser" icon="external-link" variant="primary" fullWidth onPress={() => void Linking.openURL(url)} />
        </View>
      </View>
    ) : (
      <Button label="Done" variant="primary" size="lg" fullWidth onPress={onClose} testID="commit-done" />
    );
  } else {
    body = <FlowForm workspaceId={workspaceId} repo={repo} repos={repos} form={current} setForm={update} onAlias={(next) => {
      setPicked(next);
      setForm(null);
    }} />;
    footer = (
      <Button
        label={runLabel(current)}
        variant="primary"
        size="lg"
        fullWidth
        icon={current.pullRequest ? 'pr' : 'commit'}
        disabled={Boolean(actionReason(repo, 'commit'))}
        onPress={() => run.mutate(buildFlowRequest(current))}
        testID="commit-submit"
      />
    );
  }

  return (
    <RouteSheet
      title="Commit & pull request"
      onDismiss={phase.kind === 'working' ? () => undefined : onClose}
      dirty={dirty}
      scrollable
      footer={footer}
      testID="commit-sheet"
      {...(navigation ? { navigation } : {})}
    >
      {body}
    </RouteSheet>
  );
}
