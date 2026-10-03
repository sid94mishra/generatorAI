// Pull request (04 §2.11, D-31 / MD-36; `/projects/[id]/codebases/[cid]/pull-requests/[number]`): Header `detail`
// with the Projects › <project> breadcrumb and "#n"; the title, the state badge (Draft / Open / Merged / Closed —
// neutral, MD-25), "#n · head → base · author · updated", the diff stat, mergeability and checks as glyph + word,
// labels; "Review in chat" (the sheet: optional instructions → `POST …/review-chat` → the new chat) and GitHub; the
// description; Files / Comments tabs — each file a row (change letter, mono path, +/−) that expands into the patch
// drawn with kit CodeLines (both line numbers, the diff font preference), comments with author, time, path:line and
// the rendered body.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { router, useLocalSearchParams } from 'expo-router';
import { CHANGE_KIND, type PullRequestComment, type PullRequestFile } from '@generatorai/shared';

import { AssistantText } from '../../blocks/AssistantText';
import { checksSummaryLabel, checksTone, mergeability, prStateLabel } from '../../blocks/CommitSheet/model/prModel';
import { buildRows, gutterWidthFor, languageForPath, parsePatch, useDiffPrefs } from '../../blocks/DiffView';
import { PROJECTS_HREF, chatHref, projectHref } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { ListSection } from '../../ui/layout/ListSection';
import { Screen } from '../../ui/layout/Screen';
import { TabRow } from '../../ui/layout/TabRow';
import { errorText, formatRelativeShort } from '../../ui/lib/format';
import { Header } from '../../ui/native/router/Header';
import { useSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { CodeLine } from '../../ui/primitives/CodeLine';
import { DiffStat } from '../../ui/primitives/DiffStat';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { Pressable } from '../../ui/primitives/Pressable';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { toast } from '../../ui/primitives/Toast';
import { usePullRequest, usePullRequestComments, usePullRequestFiles, useProject, useReviewPullRequest } from './queries';

type Href = Parameters<typeof router.push>[0];
type Tab = 'files' | 'comments';

const TONE_ICON = { success: 'check', warning: 'warning', danger: 'x', info: 'info', primary: 'info', neutral: 'info' } as const;
const TONE_TEXT = { success: 'ok', warning: 'warn', danger: 'err', info: 'fg-2', primary: 'fg-2', neutral: 'fg-2' } as const;

function Mark({ tone, label }: { tone: keyof typeof TONE_ICON; label: string }): React.ReactElement {
  return (
    <View className="flex-row items-center gap-1.5">
      <Icon concept={TONE_ICON[tone]} size={14} tone={TONE_TEXT[tone]} />
      <Text role="footnote" tone="fg-2">
        {label}
      </Text>
    </View>
  );
}

function PatchView({ file }: { file: PullRequestFile }): React.ReactElement {
  const prefs = useDiffPrefs();
  const rows = useMemo(() => buildRows(parsePatch(file.patch ?? '')), [file.patch]);
  const max = rows.reduce((m, r) => (r.type === 'line' ? Math.max(m, r.row.oldNumber ?? 0, r.row.newNumber ?? 0) : m), 1);
  const gutter = gutterWidthFor(max, prefs.fontSize);
  const language = languageForPath(file.path);
  if (!file.patch) {
    return (
      <Text role="footnote" tone="fg-3" className="px-4 py-3">
        No patch for this file: it is binary or too large to show.
      </Text>
    );
  }
  return (
    <View className="bg-sunken py-1">
      {rows.map((r) =>
        r.type === 'line' ? (
          <CodeLine key={r.key} text={r.row.content} kind={r.row.kind} language={language} {...(r.row.oldNumber !== undefined ? { oldNumber: r.row.oldNumber } : {})} {...(r.row.newNumber !== undefined ? { newNumber: r.row.newNumber } : {})} gutterWidth={gutter} dualGutter fontSize={prefs.fontSize} wrap={prefs.wrap} />
        ) : (
          <Text key={r.key} role="monoSm" tone="fg-3" numberOfLines={1} className="px-3 py-1">
            {r.type === 'hunk' ? r.label : r.text}
          </Text>
        ),
      )}
    </View>
  );
}

function FileRow({ file }: { file: PullRequestFile }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const kind = CHANGE_KIND[file.status as keyof typeof CHANGE_KIND] ?? CHANGE_KIND.modified;
  const path = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
  return (
    <View>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        frame="none"
        haptic="selection"
        accessibilityRole="button"
        accessibilityLabel={`${kind.label} ${path}, ${file.additions} added, ${file.deletions} removed`}
        accessibilityState={{ expanded: open }}
        className="min-h-item flex-row items-center gap-2.5 px-4 py-2"
        testID={`pr-file-${file.path}`}
      >
        <Icon concept={open ? 'chevron-down' : 'chevron-right'} size={14} tone="fg-3" />
        <Text role="monoSm" weight={600} tone={kind.tone === 'fg-3' ? 'fg-3' : kind.tone}>
          {kind.letter}
        </Text>
        <Text role="monoSm" numberOfLines={2} className="flex-1">
          {path}
        </Text>
        <DiffStat additions={file.additions} deletions={file.deletions} />
      </Pressable>
      {open ? <PatchView file={file} /> : null}
    </View>
  );
}

function CommentRow({ comment }: { comment: PullRequestComment }): React.ReactElement {
  return (
    <View className="gap-1.5 px-4 py-3" testID={`pr-comment-${comment.id}`}>
      <View className="flex-row items-center gap-2">
        <Icon concept="message" size={14} tone="fg-3" />
        <Text role="subhead" weight={600} className="flex-1" numberOfLines={1}>
          {comment.author}
        </Text>
        <Text role="footnote" tone="fg-3">
          {formatRelativeShort(String(comment.createdAt))}
        </Text>
      </View>
      {comment.path ? (
        <Text role="monoSm" tone="fg-3" numberOfLines={1}>
          {comment.path}
          {comment.line ? `:${comment.line}` : ''}
        </Text>
      ) : null}
      <AssistantText text={comment.body} />
    </View>
  );
}

function ReviewForm({ onStart, busy }: { onStart: (instructions: string) => void; busy: boolean }): React.ReactElement {
  const [instructions, setInstructions] = useState('');
  return (
    <View className="gap-4 pb-4">
      <Text role="subhead" tone="fg-2">
        Creates a chat with this pull request's branch checked out and sends the review prompt. Anything you add is appended to it.
      </Text>
      <Textarea label="Extra instructions (optional)" value={instructions} onChangeText={setInstructions} placeholder="Focus on the migration and the error paths" minRows={3} testID="pr-review-instructions" />
      <Button label="Start the review" size="lg" fullWidth loading={busy} onPress={() => onStart(instructions)} testID="pr-review-start" />
    </View>
  );
}

export default function PullRequestScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id: string; cid: string; number: string }>();
  const projectId = String(params.id ?? '');
  const codebaseId = String(params.cid ?? '');
  const number = Number(params.number);
  const onBack = useHeaderBack();
  const project = useProject(projectId);
  const crumbs = useMemo(() => [{ label: 'Projects', href: PROJECTS_HREF }, ...(project.data ? [{ label: project.data.name, href: projectHref(projectId) }] : [])], [project.data, projectId]);
  const breadcrumb = useBreadcrumb(crumbs);
  const pr = usePullRequest(projectId, codebaseId, number);
  const files = usePullRequestFiles(projectId, codebaseId, number, pr.isSuccess);
  const comments = usePullRequestComments(projectId, codebaseId, number, pr.isSuccess);
  const sheet = useSheet();
  const [tab, setTab] = useState<Tab>('files');
  const review = useReviewPullRequest(projectId, codebaseId, number, {
    onSuccess: (res) => {
      sheet.dismiss();
      haptic('success');
      if (res?.chat?.id) router.push(chatHref(res.chat.id) as Href);
    },
    onError: (e) => toast({ kind: 'error', message: errorText(e) }),
  });
  const d = pr.data;
  const openReview = (): void => sheet.present(<ReviewForm busy={review.isPending} onStart={(i) => review.mutate(i)} />, { title: 'Review in chat', detents: ['medium', 'large'], testID: 'pr-review-sheet' });

  const state = pr.isLoading ? { kind: 'loading' as const, skeleton: <Skeleton preset="list" count={4} /> } : pr.isError || !d ? { kind: 'error' as const, error: pr.error, onRetry: () => void pr.refetch(), title: "Couldn't load this pull request" } : { kind: 'ready' as const };
  const merge = d ? mergeability(d) : null;
  const checks = d ? checksSummaryLabel(d.checks) : null;

  return (
    <Screen header={<Header role="detail" title={`#${Number.isFinite(number) ? number : ''}`} breadcrumb={breadcrumb} onBack={onBack} />} state={state} onRefresh={async () => void (await Promise.all([pr.refetch(), files.refetch(), comments.refetch()]))} testID="pull-request">
      {d ? (
        <View className="gap-5 pb-8 pt-2">
          <View className="gap-2 px-4">
            <View className="flex-row items-start gap-2">
              <Text role="title" weight={600} className="flex-1">
                {d.title}
              </Text>
              <Badge label={prStateLabel(d.state, d.draft)} icon="pr" size="sm" />
            </View>
            <Text role="footnote" tone="fg-3">
              #{d.number} ·{' '}
              <Text role="monoSm" tone="fg-2">
                {d.head} → {d.base}
              </Text>
              {d.author ? ` · ${d.author}` : ''}
              {d.updatedAt ? ` · updated ${formatRelativeShort(String(d.updatedAt))} ago` : ''}
            </Text>
            <DiffStat files={d.changedFiles} additions={d.additions} deletions={d.deletions} />
            <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
              {merge ? <Mark tone={merge.tone} label={merge.label} /> : null}
              {checks ? <Mark tone={checksTone(d.checks)} label={checks} /> : null}
            </View>
            {d.labels.length ? (
              <View className="flex-row flex-wrap gap-1.5">
                {d.labels.map((l) => (
                  <Badge key={l} label={l} tone="outline" size="sm" />
                ))}
              </View>
            ) : null}
            <View className="flex-row gap-3 pt-1">
              <View className="flex-1">
                <Button label="Review in chat" icon="wand" fullWidth onPress={openReview} testID="pr-review" />
              </View>
              <Button label="GitHub" icon="external-link" variant="secondary" onPress={() => void WebBrowser.openBrowserAsync(d.url)} accessibilityLabel="Open this pull request on GitHub" testID="pr-github" />
            </View>
          </View>

          {d.body?.trim() ? (
            <ListSection title="Description">
              <View className="px-4 py-3">
                <AssistantText text={d.body} />
              </View>
            </ListSection>
          ) : null}

          <TabRow
            tabs={[
              { id: 'files', label: 'Files', count: d.changedFiles },
              { id: 'comments', label: 'Comments', ...(comments.data ? { count: comments.data.length } : {}) },
            ]}
            active={tab}
            onSelect={(id) => setTab(id as Tab)}
            accessibilityLabel="Pull request sections"
            testID="pr-tab"
          />

          {tab === 'files' ? (
            files.isLoading ? (
              <Skeleton preset="list" count={3} />
            ) : files.isError ? (
              <ErrorState title="Couldn't load the changed files" error={files.error} onRetry={() => void files.refetch()} />
            ) : (files.data ?? []).length === 0 ? (
              <EmptyState compact icon="files" title="No file changes" />
            ) : (
              <ListSection>
                {(files.data ?? []).map((f) => (
                  <FileRow key={f.path} file={f} />
                ))}
              </ListSection>
            )
          ) : comments.isLoading ? (
            <Skeleton preset="list" count={2} />
          ) : comments.isError ? (
            <ErrorState title="Couldn't load the comments" error={comments.error} onRetry={() => void comments.refetch()} />
          ) : (comments.data ?? []).length === 0 ? (
            <EmptyState compact icon="message" title="No comments yet" />
          ) : (
            <ListSection>
              {(comments.data ?? []).map((c) => (
                <CommentRow key={c.id} comment={c} />
              ))}
            </ListSection>
          )}
        </View>
      ) : null}
    </Screen>
  );
}
