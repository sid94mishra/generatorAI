// ────────────────────────────────────────────────────────────────
// CommitBar — commit / pull request, bottom of the Changes pane.
//
// Mirrors web's ChangesSurface toolbar: "Commit" stages everything and
// commits with a message (`POST /workspaces/:id/commit`), "Create PR"
// appears only when the source-control provider reports itself usable
// (`GET /source-control/status`), the same probe web makes. Both need
// `write:workspaces`; without it the bar says so instead of 403ing.
//
// Push is not a separate control because the server has no push route:
// `createPullRequest` pushes the branch as part of opening the PR.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, GitCommitHorizontal, GitPullRequest } from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { useTheme } from '../../theme/ThemeProvider';
import { Sheet } from '../ui/Sheet';
import { Button, IconButton } from '../ui/Button';
import { Field, Switch } from '../ui/Form';
import { useToast } from '../ui/Toast';
import { haptics } from '../ui/haptics';
import { useCapability } from '../review/useScopes';
import { useWorkspaceExtras } from './api';

export function CommitBar({
  workspaceId,
  fileCount,
  active = true,
}: {
  workspaceId: string;
  fileCount: number;
  active?: boolean;
}): React.ReactElement | null {
  const extras = useWorkspaceExtras();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { colors } = useTheme();
  const commitCap = useCapability('commit');
  const [sheet, setSheet] = useState<'commit' | 'pr' | null>(null);

  const scm = useQuery({
    queryKey: ['source-control', 'status'],
    queryFn: () => extras.sourceControlStatus(),
    enabled: commitCap.available,
    staleTime: 60_000,
    subscribed: active,
    // A phone without `read:projects` gets a 403 here; that just means no PR button.
    retry: false,
  });
  const scmEnabled = scm.data?.enabled ?? false;

  const prs = useQuery({
    queryKey: ['workspaces', workspaceId, 'pull-requests'],
    queryFn: () => extras.pullRequests(workspaceId),
    enabled: commitCap.available && scmEnabled,
    staleTime: 30_000,
    subscribed: active,
    retry: false,
  });
  const openPr = prs.data?.pullRequests.find((p) => p.state === 'open') ?? prs.data?.pullRequests[0];

  const commit = useMutation({
    mutationFn: (message: string) => extras.commit(workspaceId, message || undefined),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.changes(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.checkpoints(workspaceId) });
      toast({ message: result.committed ? 'Committed' : 'Nothing to commit', tone: result.committed ? 'success' : 'info' });
      setSheet(null);
    },
    onError: (err) => toast({ message: err instanceof Error ? err.message : 'Commit failed', tone: 'error' }),
  });

  const createPr = useMutation({
    mutationFn: (body: { title: string; body?: string; draft?: boolean }) => extras.createPullRequest(workspaceId, body),
    onSuccess: (pr) => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'pull-requests'] });
      toast({
        message: `Pull request #${pr.number} opened`,
        tone: 'success',
        action: { label: 'Open', onPress: () => void Linking.openURL(pr.url) },
      });
      setSheet(null);
    },
    onError: (err) => toast({ message: err instanceof Error ? err.message : 'Could not open a pull request', tone: 'error' }),
  });

  if (!commitCap.available) {
    if (fileCount === 0) return null;
    return (
      <View className="border-t border-border-muted bg-card px-4 py-2">
        <Text className="text-xs text-muted-foreground">{commitCap.reason}</Text>
      </View>
    );
  }

  // Nothing to commit and no open PR to reach: the bar is furniture. It used
  // to persist with a dead outlined button parked in its left corner, which
  // read as unfinished rather than as "there is nothing to do here".
  if (fileCount === 0 && !openPr) return null;

  return (
    <>
      <View className="flex-row items-center gap-2 border-t border-border bg-card px-3 py-2.5">
        {fileCount > 0 ? (
          <Button
            grow
            label={`Commit ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`}
            icon={<GitCommitHorizontal size={16} color={colors['primary-foreground']} />}
            onPress={() => setSheet('commit')}
          />
        ) : null}
        {scmEnabled && fileCount > 0 ? (
          <IconButton
            accessibilityLabel="Create a pull request"
            variant="secondary"
            icon={<GitPullRequest size={18} color={colors.foreground} />}
            onPress={() => setSheet('pr')}
          />
        ) : null}
        {openPr ? (
          <Button
            {...(fileCount === 0 ? { grow: true } : {})}
            label={`PR #${openPr.number}`}
            size={fileCount === 0 ? 'md' : 'sm'}
            variant="secondary"
            icon={<ExternalLink size={14} color={colors.primary} />}
            accessibilityLabel={`Open pull request ${openPr.number}: ${openPr.title}`}
            onPress={() => void Linking.openURL(openPr.url)}
          />
        ) : null}
      </View>

      <CommitSheet
        visible={sheet === 'commit'}
        onClose={() => setSheet(null)}
        fileCount={fileCount}
        busy={commit.isPending}
        onSubmit={(message) => {
          haptics.success();
          commit.mutate(message);
        }}
      />
      <PullRequestSheet
        visible={sheet === 'pr'}
        onClose={() => setSheet(null)}
        busy={createPr.isPending}
        onSubmit={(body) => createPr.mutate(body)}
      />
    </>
  );
}

function CommitSheet({
  visible,
  onClose,
  fileCount,
  busy,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  fileCount: number;
  busy: boolean;
  onSubmit: (message: string) => void;
}): React.ReactElement | null {
  const [message, setMessage] = useState('');
  if (!visible) return null;
  return (
    <Sheet visible={visible} onClose={onClose} title="Commit changes" detents={[0.5]} fitContent>
      <View className="gap-4 px-4 pt-4 pb-6">
        <Text className="text-xs text-muted-foreground">
          Stages every change ({fileCount} {fileCount === 1 ? 'file' : 'files'}) and commits on the workspace branch.
        </Text>
        <Field
          label="Message"
          placeholder="Describe the change (optional — the server writes one if empty)"
          value={message}
          onChangeText={setMessage}
          multiline
          autoFocus
        />
        <Button label="Commit" full loading={busy} onPress={() => onSubmit(message.trim())} />
      </View>
    </Sheet>
  );
}

function PullRequestSheet({
  visible,
  onClose,
  busy,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  busy: boolean;
  onSubmit: (body: { title: string; body?: string; draft?: boolean }) => void;
}): React.ReactElement | null {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  if (!visible) return null;
  const trimmed = title.trim();
  return (
    <Sheet visible={visible} onClose={onClose} title="Create pull request" detents={[0.7]} fitContent>
      <View className="gap-4 px-4 pt-4 pb-6">
        <Field label="Title" value={title} onChangeText={setTitle} autoFocus error={trimmed ? null : 'A title is required.'} />
        <Field label="Description" value={body} onChangeText={setBody} multiline style={{ minHeight: 96, textAlignVertical: 'top' }} />
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-foreground">Open as draft</Text>
          <Switch value={draft} onValueChange={setDraft} accessibilityLabel="Open as draft" />
        </View>
        <Button
          label="Create pull request"
          full
          loading={busy}
          disabled={!trimmed}
          onPress={() => onSubmit({ title: trimmed, ...(body.trim() ? { body: body.trim() } : {}), ...(draft ? { draft } : {}) })}
        />
      </View>
    </Sheet>
  );
}
