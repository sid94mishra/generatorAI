// ────────────────────────────────────────────────────────────────
// Pull request detail.
//
// Header, mergeability and checks, the description (the same markdown
// renderer the transcript uses), the changed files with their patches, and
// the review comments. Files and comments are separate requests, so a large
// PR renders its header immediately and fills in underneath.
//
// Two actions: "Open on GitHub" hands the URL to the browser, and "Review in
// chat" creates a chat on the PR head branch with the review prompt plus
// whatever extra instructions the user typed, then opens it. Reviewing is
// the one thing a phone is genuinely good at here — reading a diff on the
// train and telling an agent what to look at.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitPullRequest,
  MessageSquare,
  Sparkles,
} from 'lucide-react-native';
import type { PullRequestComment, PullRequestFile } from '@generatorai/shared';

import { Markdown } from '../../../../../../src/components/markdown/Markdown';
import { relativeTime } from '../../../../../../src/components/runs/formatTime';
import { Badge, Card, SectionHeader } from '../../../../../../src/components/ui/primitives';
import { Button } from '../../../../../../src/components/ui/Button';
import { Field } from '../../../../../../src/components/ui/Form';
import { PlainScroll } from '../../../../../../src/components/ui/Screen';
import { Sheet } from '../../../../../../src/components/ui/Sheet';
import { ErrorState } from '../../../../../../src/components/ui/States';
import { SkeletonList } from '../../../../../../src/components/ui/Skeleton';
import { Touchable } from '../../../../../../src/components/ui/Touchable';
import { useToast } from '../../../../../../src/components/ui/Toast';
import { scmKeys } from '../../../../../../src/components/scm/api';
import { useScmApi } from '../../../../../../src/components/scm/useScmApi';
import {
  checksSummaryLabel,
  checksTone,
  diffStatLabel,
  fileStat,
  fileStatusLetter,
  fileStatusTone,
  mergeability,
  parsePatchRows,
  prStateLabel,
  prStateTone,
} from '../../../../../../src/components/scm/prModel';
import { useTheme } from '../../../../../../src/theme/ThemeProvider';

export default function PullRequestDetailScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id: string; cid: string; number: string }>();
  const projectId = String(params.id);
  const codebaseId = String(params.cid);
  const number = Number(params.number);
  const navigation = useNavigation();
  const scm = useScmApi();
  const toast = useToast();
  const { colors } = useTheme();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [instructions, setInstructions] = useState('');

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: `Pull request #${number}` });
  }, [navigation, number]);

  const pr = useQuery({
    queryKey: scmKeys.pullRequest(projectId, codebaseId, number),
    queryFn: () => scm.pullRequest(projectId, codebaseId, number),
  });

  const files = useQuery({
    queryKey: scmKeys.pullRequestFiles(projectId, codebaseId, number),
    queryFn: () => scm.pullRequestFiles(projectId, codebaseId, number),
    enabled: pr.isSuccess,
  });

  const comments = useQuery({
    queryKey: scmKeys.pullRequestComments(projectId, codebaseId, number),
    queryFn: () => scm.pullRequestComments(projectId, codebaseId, number),
    enabled: pr.isSuccess,
  });

  const review = useMutation({
    mutationFn: () =>
      scm.reviewChat(projectId, codebaseId, number, {
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      }),
    onSuccess: (response) => {
      setReviewOpen(false);
      setInstructions('');
      if (response?.chat?.id) router.push(`/chats/${response.chat.id}`);
      else toast({ message: 'The review chat was created.', variant: 'success' });
    },
    onError: (err) =>
      toast({
        message: err instanceof Error && err.message ? err.message : 'Could not start a review chat',
        variant: 'danger',
      }),
  });

  if (pr.isLoading) {
    return (
      <View className="p-4">
        <SkeletonList rows={4} />
      </View>
    );
  }
  if (pr.isError || !pr.data) {
    return <ErrorState message="Could not load this pull request." onRetry={() => void pr.refetch()} />;
  }

  const detail = pr.data;
  const merge = mergeability(detail);
  const checks = checksSummaryLabel(detail.checks);

  return (
    <>
      <PlainScroll onRefresh={() => void pr.refetch()} refreshing={pr.isFetching}>
        <Card className="gap-2 p-4">
          <View className="flex-row items-start gap-2.5">
            <GitPullRequest size={18} color={colors.primary} />
            <Text className="flex-1 text-lg font-semibold text-foreground">{detail.title}</Text>
            <Badge label={prStateLabel(detail.state, detail.draft)} tone={prStateTone(detail.state)} />
          </View>
          <Text className="text-xs text-muted-foreground">
            #{detail.number} · {detail.head} → {detail.base}
            {detail.author ? ` · ${detail.author}` : ''}
            {detail.updatedAt ? ` · updated ${relativeTime(detail.updatedAt)}` : ''}
          </Text>
          <Text className="text-xs text-muted-foreground">{diffStatLabel(detail)}</Text>
          <View className="flex-row flex-wrap gap-1.5 pt-1">
            <Badge label={merge.label} tone={merge.tone} />
            {checks ? <Badge label={checks} tone={checksTone(detail.checks)} /> : null}
            {detail.labels.map((label) => (
              <Badge key={label} label={label} />
            ))}
          </View>
          <View className="flex-row gap-2 pt-2">
            <Button
              grow
              label="Review in chat"
              icon={<Sparkles size={16} color={colors['primary-foreground']} />}
              onPress={() => setReviewOpen(true)}
            />
            <Button
              label="GitHub"
              variant="secondary"
              icon={<ExternalLink size={16} color={colors.foreground} />}
              accessibilityLabel="Open this pull request on GitHub"
              onPress={() => void Linking.openURL(detail.url)}
            />
          </View>
        </Card>

        {detail.body?.trim() ? (
          <>
            <SectionHeader title="Description" />
            <Card className="px-3.5 py-3">
              <Markdown content={detail.body} />
            </Card>
          </>
        ) : null}

        <SectionHeader title={`Files (${detail.changedFiles})`} />
        {files.isLoading ? (
          <SkeletonList rows={3} />
        ) : files.isError ? (
          <ErrorState message="Could not load the changed files." onRetry={() => void files.refetch()} />
        ) : (files.data ?? []).length === 0 ? (
          <Text className="px-1 text-xs text-muted-foreground">No file changes were reported.</Text>
        ) : (
          <View className="gap-2">
            {(files.data ?? []).map((file) => (
              <FileCard key={file.path} file={file} />
            ))}
          </View>
        )}

        <SectionHeader title={`Comments (${comments.data?.length ?? 0})`} />
        {comments.isLoading ? (
          <SkeletonList rows={2} />
        ) : (comments.data ?? []).length === 0 ? (
          <Text className="px-1 text-xs text-muted-foreground">No comments yet.</Text>
        ) : (
          <View className="gap-2">
            {(comments.data ?? []).map((comment) => (
              <CommentCard key={comment.id} comment={comment} />
            ))}
          </View>
        )}
      </PlainScroll>

      <Sheet
        visible={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Review in chat"
        detents={[0.6]}
        fitContent
      >
        <View className="gap-4 px-4 pb-8 pt-4">
          <Text className="text-xs leading-relaxed text-muted-foreground">
            Creates a chat with this pull request's branch checked out and sends the review prompt.
            Anything you add here is appended to it.
          </Text>
          <Field
            label="Extra instructions (optional)"
            placeholder="e.g. focus on the migration and the error paths"
            value={instructions}
            onChangeText={setInstructions}
            multiline
            style={{ minHeight: 96, textAlignVertical: 'top' }}
            accessibilityLabel="Extra review instructions"
          />
          <Button
            label="Start the review"
            full
            loading={review.isPending}
            onPress={() => review.mutate()}
          />
        </View>
      </Sheet>
    </>
  );
}

function FileCard({ file }: { file: PullRequestFile }): React.ReactElement {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const rows = open ? parsePatchRows(file.patch) : [];

  return (
    <Card className="overflow-hidden">
      <Touchable
        accessibilityLabel={`${file.path}, ${fileStat(file)}`}
        accessibilityHint={open ? 'Collapse the diff' : 'Expand the diff'}
        haptic="select"
        scale="none"
        onPress={() => setOpen((v) => !v)}
      >
        <View className="flex-row items-center gap-2.5 px-3.5 py-3">
          {open ? (
            <ChevronDown size={16} color={colors['muted-foreground']} />
          ) : (
            <ChevronRight size={16} color={colors['muted-foreground']} />
          )}
          <Badge label={fileStatusLetter(file.status)} tone={fileStatusTone(file.status)} />
          <Text numberOfLines={2} className="flex-1 font-mono text-xs text-foreground">
            {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
          </Text>
          <Text className="text-xs text-muted-foreground">{fileStat(file)}</Text>
        </View>
      </Touchable>

      {open ? (
        file.patch ? (
          <View className="border-t border-border-muted bg-raised py-1">
            {rows.map((row, index) => (
              <Text
                // Patch rows have no identity of their own; the index is the line.
                key={index}
                numberOfLines={1}
                className={`px-3 font-mono text-xs ${PATCH_CLASS[row.kind]}`}
              >
                {row.text || ' '}
              </Text>
            ))}
          </View>
        ) : (
          <View className="border-t border-border-muted px-3.5 py-3">
            <Text className="text-xs text-muted-foreground">
              No patch for this file — it is binary or too large to diff.
            </Text>
          </View>
        )
      ) : null}
    </Card>
  );
}

const PATCH_CLASS: Record<ReturnType<typeof parsePatchRows>[number]['kind'], string> = {
  hunk: 'text-info',
  add: 'text-success',
  del: 'text-danger',
  meta: 'text-muted-foreground',
  context: 'text-muted-foreground',
};

function CommentCard({ comment }: { comment: PullRequestComment }): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Card className="gap-1.5 p-3.5">
      <View className="flex-row items-center gap-2">
        <MessageSquare size={14} color={colors['muted-foreground']} />
        <Text className="flex-1 text-sm font-medium text-foreground">{comment.author}</Text>
        <Text className="text-xs text-muted-foreground">{relativeTime(comment.createdAt)}</Text>
      </View>
      {comment.path ? (
        <Text numberOfLines={1} className="font-mono text-xs text-muted-foreground">
          {comment.path}
          {comment.line ? `:${comment.line}` : ''}
        </Text>
      ) : null}
      <Markdown content={comment.body} />
    </Card>
  );
}
