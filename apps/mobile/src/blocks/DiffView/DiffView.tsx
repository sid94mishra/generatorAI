// MB-24 DiffView (MPaneDiff; MD-39, MD-61): one file's diff as virtualised kit CodeLines — old / new number gutters,
// +/− signs, add / del fills, bounded token colours — with hunk headers that fold, Wrap (a Chip), pinch for the font
// size (10–18, a `fontStep` haptic per step), sideways scroll as one plane while unwrapped. Tap the gutter (or
// "Comment" with a line selected) to open the InlineCommentComposer under the line: intent chips from the shared
// review enum, the comment, "Add to review" and "Send to agent". Long-press a line: Comment for <agent>, Copy line.
// Existing threads draw inline with their status (pending → resolved / outdated).
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { STATUS_MAPS, REVIEW_INTENTS, REVIEW_INTENT_LABELS, reviewLineLabel, type ReviewIntent, type StatusState } from '@generatorai/shared';
import type { DiffRow, ReviewThread } from '@generatorai/client-core';

import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { LegendList } from '../../ui/lib/styled';
import { useSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { Chip } from '../../ui/primitives/Chip';
import { CodeLine, codeLineHeight } from '../../ui/primitives/CodeLine';
import { DiffStat } from '../../ui/primitives/DiffStat';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { IconButton } from '../../ui/primitives/IconButton';
import { Pressable } from '../../ui/primitives/Pressable';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { StatusBadge } from '../../ui/primitives/StatusBadge';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { changeLetter, changeTone, type ChangeStatus } from '../ChangesPanel/model/changeKinds';
import { useFilePatch, type ReviewThreadsApi } from './DiffView.queries';
import { anchorKey, diffItems, openThreadCounts, type DiffItem, type LineAnchor } from './model/diffItems';
import { anchorFor, anchorText, buildRows, clampFont, contentWidthFor, gutterWidthFor, languageForPath, longestLine, maxLineNumber, parsePatch } from './model/diffModel';
import { getDiffPrefs, setDiffFontSize, setDiffWrap, useDiffPrefs } from './model/diffPrefs';

export interface DiffFile {
  path: string;
  alias: string;
  oldBlob?: string;
  newBlob?: string;
  lang?: string;
  status?: ChangeStatus;
  additions?: number;
  deletions?: number;
  isBinary?: boolean;
  isTooLarge?: boolean;
}

export interface DiffViewProps {
  workspaceId: string;
  file: DiffFile;
  /** The compare base (`baseline`, `turn:<id>`, `ref:<sha>`, `checkpoint:<id>`). */
  base: string;
  review: ReviewThreadsApi;
  /** This mount's resolved base / head checkpoint ids, which new threads anchor to. */
  revisions: { base: string; head: string };
  /** "Comment for <agent>". */
  agentName?: string | null;
  testID?: string;
}

const statusOf = (status: string): { state: StatusState; label?: string } => {
  const m = (STATUS_MAPS as unknown as Record<string, Record<string, { state: StatusState; label?: string } | null>>).reviewThread?.[status];
  return m ?? { state: 'queued', label: status };
};

function ThreadRow({ thread, review }: { thread: ReviewThread; review: ReviewThreadsApi }): React.ReactElement {
  const settled = thread.status === 'resolved' || thread.status === 'outdated';
  return (
    <View className="mx-3 my-1.5 gap-2 rounded-card border border-line-soft bg-raised p-3" accessibilityLabel={`Review comment on ${reviewLineLabel(thread.startLine, thread.endLine)}`}>
      <View className="flex-row items-center gap-2">
        <Icon concept="message" size={14} tone="fg-3" />
        <Text role="monoSm" tone="fg-3">
          {reviewLineLabel(thread.startLine, thread.endLine)}
        </Text>
        <View className="flex-1" />
        <StatusBadge {...statusOf(thread.status)} size="sm" />
      </View>
      {thread.comments.map((c) => (
        <View key={c.id} className="gap-0.5">
          <Text role="caption" weight={600} tone="fg-2">
            {c.author === 'agent' ? 'Agent' : 'You'}
            {c.intent ? ` · ${REVIEW_INTENT_LABELS[c.intent as ReviewIntent] ?? c.intent}` : ''}
          </Text>
          <Text role="footnote" selectable>
            {c.body}
          </Text>
        </View>
      ))}
      {review.canWrite ? (
        <View className="flex-row justify-end gap-2">
          {thread.status === 'pending' || thread.status === 'draft' ? (
            <Button label="Delete" variant="ghost" size="sm" onPress={() => review.remove.mutate(thread.id)} />
          ) : null}
          <Button
            label={settled ? 'Reopen' : 'Resolve'}
            variant="secondary"
            size="sm"
            onPress={() => review.setStatus.mutate({ threadId: thread.id, status: settled ? 'pending' : 'resolved' })}
          />
        </View>
      ) : null}
    </View>
  );
}

function InlineCommentComposer({
  anchor,
  agentName,
  canSend,
  busy,
  onClose,
  onSubmit,
}: {
  anchor: LineAnchor;
  agentName?: string | null;
  canSend: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: string, intent: ReviewIntent, send: boolean) => void;
}): React.ReactElement {
  const [intent, setIntent] = useState<ReviewIntent>('fix');
  const [body, setBody] = useState('');
  const ready = body.trim().length > 0 && !busy;
  return (
    <View testID="diff-comment-composer" className="mx-3 my-2 gap-3 rounded-card-lg border border-line bg-raised p-4">
      <View className="flex-row items-center gap-2">
        <Icon concept="message" size={16} tone="fg-2" />
        <Text role="subhead" weight={600} numberOfLines={1} className="shrink">
          {agentName ? `Comment for ${agentName}` : 'Comment for the agent'}
        </Text>
        <Text role="monoSm" tone="fg-3">
          {reviewLineLabel(anchor.line, anchor.line)}
        </Text>
        <View className="flex-1" />
        <IconButton icon="x" label="Close comment" size="sm" onPress={onClose} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
        {REVIEW_INTENTS.map((value) => (
          <Chip key={value} label={REVIEW_INTENT_LABELS[value]} selected={intent === value} onPress={() => setIntent(value)} testID={`diff-comment-intent-${value}`} />
        ))}
      </ScrollView>
      <Textarea label="Comment" value={body} onChangeText={setBody} placeholder="What should change here?" minRows={2} presentation="standalone" autoFocus testID="diff-comment-body" />
      <View className="flex-row justify-end gap-2">
        <Button label="Add to review" variant={canSend ? 'secondary' : 'primary'} disabled={!ready} onPress={() => onSubmit(body.trim(), intent, false)} testID="diff-comment-add" />
        {canSend ? <Button label="Send to agent" variant="primary" icon="send" loading={busy} disabled={!ready} onPress={() => onSubmit(body.trim(), intent, true)} testID="diff-comment-send" /> : null}
      </View>
    </View>
  );
}

/** Pinch → font size (10–18), one `fontStep` haptic per point (MD-78). */
export function fontPinch(): ReturnType<typeof Gesture.Pinch> {
  let start = getDiffPrefs().fontSize;
  return Gesture.Pinch()
    .runOnJS(true)
    .onBegin(() => {
      start = getDiffPrefs().fontSize;
    })
    .onUpdate((e) => {
      const next = clampFont(start * e.scale);
      if (next !== getDiffPrefs().fontSize) {
        haptic('fontStep');
        setDiffFontSize(next);
      }
    });
}

export function DiffView({ workspaceId, file, base, review, revisions, agentName, testID = 'diff-view' }: DiffViewProps): React.ReactElement {
  const sheet = useSheet();
  const { width: viewport } = useWindowDimensions();
  const { wrap, fontSize } = useDiffPrefs();
  const patch = useFilePatch(workspaceId, file, base);
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set());
  const [selected, setSelected] = useState<LineAnchor | null>(null);
  const [composer, setComposer] = useState<LineAnchor | null>(null);
  const threads = useMemo(() => review.byFile.get(`${file.alias}:${file.path}`) ?? [], [review.byFile, file.alias, file.path]);
  const counts = useMemo(() => openThreadCounts(threads), [threads]);

  const parsed = useMemo(() => (patch.data?.patch ? parsePatch(patch.data.patch) : null), [patch.data]);
  const rows = useMemo(() => (parsed ? buildRows(parsed, { collapsed, truncated: patch.data?.truncated ?? false }) : []), [parsed, collapsed, patch.data?.truncated]);
  const items = useMemo(() => diffItems(rows, threads, composer), [rows, threads, composer]);
  const language = languageForPath(file.path, file.lang);
  const gutter = useMemo(() => gutterWidthFor(parsed ? maxLineNumber(parsed) : 1, fontSize), [parsed, fontSize]);
  const contentWidth = useMemo(() => contentWidthFor({ longest: parsed ? longestLine(parsed) : 0, gutter: gutter * 2, fontSize, viewport }), [parsed, gutter, fontSize, viewport]);

  const openComposer = useCallback(
    (anchor: LineAnchor) => {
      if (!review.canWrite) return;
      setSelected(anchor);
      setComposer(anchor);
    },
    [review.canWrite],
  );
  const lineMenu = useCallback(
    (row: DiffRow) => {
      const anchor = anchorFor(row);
      haptic('longPress');
      setSelected(anchor);
      sheet.present(
        <ListSection>
          <ListRow
            kind="navigation"
            icon="message"
            title={agentName ? `Comment for ${agentName}` : 'Comment for the agent'}
            disabled={!review.canWrite}
            {...(review.writeReason ? { disabledReason: review.writeReason, subtitle: review.writeReason } : {})}
            onPress={() => {
              sheet.dismiss();
              openComposer(anchor);
            }}
          />
          <ListRow
            kind="navigation"
            icon="copy"
            title="Copy line"
            onPress={() => {
              sheet.dismiss();
              void Clipboard.setStringAsync(row.content);
            }}
          />
        </ListSection>,
        { title: `Line ${anchor.line}`, detents: ['content'] },
      );
    },
    [sheet, agentName, review.canWrite, review.writeReason, openComposer],
  );

  const submit = useCallback(
    async (body: string, intent: ReviewIntent, send: boolean) => {
      if (!composer || !parsed) return;
      try {
        const thread = await review.create.mutateAsync({
          path: file.path,
          alias: file.alias,
          side: composer.side,
          startLine: composer.line,
          endLine: composer.line,
          anchorText: anchorText(parsed, composer.side, composer.line, composer.line),
          body,
          intent,
          baseCheckpointId: revisions.base,
          headCheckpointId: revisions.head,
        });
        if (send) await review.submit.mutateAsync({ onlyIds: [(thread as { id: string }).id] });
        setComposer(null);
      } catch {
        // The mutation said why; the composer keeps the text.
      }
    },
    [composer, parsed, review, file.path, file.alias, revisions],
  );

  const pinch = useMemo(() => fontPinch(), []);

  const toggleHunk = useCallback((index: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: DiffItem }): React.ReactElement => {
      switch (item.type) {
        case 'hunk':
          return (
            <Pressable
              frame="none"
              onPress={() => toggleHunk(item.hunkIndex)}
              accessibilityRole="button"
              accessibilityLabel={item.collapsed ? `Expand ${item.label}, ${item.hiddenCount} lines hidden` : `Collapse ${item.label}`}
              accessibilityState={{ expanded: !item.collapsed }}
              className="min-h-row flex-row items-center gap-1.5 bg-sunken px-3 py-1"
            >
              <Icon concept={item.collapsed ? 'chevron-right' : 'chevron-down'} size={12} tone="fg-3" />
              <Text role="monoSm" tone="fg-3" numberOfLines={wrap ? undefined : 1} className="flex-1">
                {item.label}
              </Text>
              {item.collapsed ? (
                <Text role="caption" tone="fg-3">
                  {`${item.hiddenCount} hidden`}
                </Text>
              ) : null}
            </Pressable>
          );
        case 'notice':
          return (
            <View className="bg-sunken px-3 py-2">
              <Text role="footnote" tone={item.tone === 'warning' ? 'warn' : 'fg-3'}>
                {item.text}
              </Text>
            </View>
          );
        case 'thread':
          return <ThreadRow thread={item.thread} review={review} />;
        case 'composer':
          return <InlineCommentComposer anchor={item.anchor} agentName={agentName ?? null} canSend={review.canSend} busy={review.create.isPending || review.submit.isPending} onClose={() => setComposer(null)} onSubmit={(b, i, s) => void submit(b, i, s)} />;
        default: {
          const key = anchorKey(item.anchor);
          return (
            <CodeLine
              text={item.row.content}
              kind={item.row.kind}
              language={language}
              {...(item.row.oldNumber !== undefined ? { oldNumber: item.row.oldNumber } : {})}
              {...(item.row.newNumber !== undefined ? { newNumber: item.row.newNumber } : {})}
              dualGutter
              gutterWidth={gutter}
              fontSize={fontSize}
              wrap={wrap}
              selected={selected !== null && anchorKey(selected) === key}
              noNewline={item.row.noNewline === true}
              commentCount={counts.get(key) ?? 0}
              {...(review.canWrite ? { onPressGutter: () => openComposer(item.anchor) } : {})}
              onPressComments={() => setSelected(item.anchor)}
              onLongPress={() => lineMenu(item.row)}
              accessibilityActions={review.canWrite ? [{ name: 'comment', label: 'Comment' }] : undefined}
              onAccessibilityAction={() => openComposer(item.anchor)}
            />
          );
        }
      }
    },
    [toggleHunk, wrap, review, agentName, submit, language, gutter, fontSize, selected, counts, openComposer, lineMenu],
  );

  const toolbar = (
    <View className="min-h-hit flex-row items-center gap-2 border-b border-line-soft px-4">
      {file.status ? (
        <Text role="mono" weight={600} tone={changeTone(file.status)}>
          {changeLetter(file.status)}
        </Text>
      ) : null}
      <DiffStat {...(file.additions !== undefined ? { additions: file.additions } : {})} {...(file.deletions !== undefined ? { deletions: file.deletions } : {})} />
      {threads.length > 0 ? (
        <View className="flex-row items-center gap-1" accessible accessibilityLabel={`${threads.length} ${threads.length === 1 ? 'comment' : 'comments'}`}>
          <Icon concept="message" size={14} tone="fg-3" />
          <Text role="monoSm" tone="fg-3">
            {threads.length}
          </Text>
        </View>
      ) : null}
      <View className="flex-1" />
      {review.canWrite ? <Button label="Comment" size="sm" variant="ghost" icon="message" disabled={!selected || composer !== null} onPress={() => selected && openComposer(selected)} testID="diff-comment" /> : null}
      <Chip label="Wrap" icon="wrap" selected={wrap} onPress={() => setDiffWrap(!wrap)} testID="diff-wrap" />
    </View>
  );

  let body: React.ReactNode;
  if (file.isBinary) body = <EmptyState icon="file" title="Binary file" description="There is no text to compare for this file." />;
  else if (file.isTooLarge) body = <EmptyState icon="file" title="Too large to show here" description="Open this diff on desktop. The path is in the ⋯ menu." />;
  else if (patch.isLoading)
    body = (
      <View className="p-4" accessibilityLabel="Loading diff">
        <Skeleton preset="list" count={6} />
      </View>
    );
  else if (patch.isError) body = <ErrorState title="Couldn't load this diff" error={patch.error} onRetry={() => void patch.refetch()} />;
  else if (!parsed || rows.length === 0) body = <EmptyState icon="diff" title="No changes to show" description={file.status === 'deleted' ? 'This file was deleted.' : 'This file has no textual diff.'} />;
  else {
    const list = (
      <LegendList
        data={items}
        keyExtractor={(item: DiffItem) => item.key}
        getItemType={(item: DiffItem) => item.type}
        renderItem={renderItem}
        estimatedItemSize={codeLineHeight(fontSize)}
        extraData={`${fontSize}|${wrap}|${selected ? anchorKey(selected) : ''}|${counts.size}`}
        recycleItems
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="pb-10"
        className="flex-1"
      />
    );
    body = (
      <GestureDetector gesture={pinch}>
        <View className="flex-1">
          {wrap ? (
            list
          ) : (
            // Unwrapped, the list scrolls sideways as one plane so the gutter never drifts from its code (MD-19:
            // the horizontal scroller blocks the panel pan).
            <ScrollView horizontal directionalLockEnabled showsHorizontalScrollIndicator contentContainerClassName="grow">
              <View className="flex-1" style={{ width: contentWidth }}>
                {list}
              </View>
            </ScrollView>
          )}
        </View>
      </GestureDetector>
    );
  }

  return (
    <View testID={testID} className="flex-1 bg-surface">
      {toolbar}
      {body}
    </View>
  );
}
