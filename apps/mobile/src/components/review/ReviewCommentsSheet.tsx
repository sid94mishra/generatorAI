// ────────────────────────────────────────────────────────────────
// ReviewCommentsSheet — compose a comment, read the threads, send the batch.
//
// Two faces of one sheet:
//   compose  long-press a diff line → intent pills + body → "Add" or
//            "Add & send"; the anchor lines are quoted so the reviewer can
//            see what the comment will attach to after the keyboard rises.
//   threads  every thread in scope, grouped by file (or one file when
//            opened from a gutter marker), with reply / edit / resolve /
//            delete / send per thread and the batch bar at the bottom.
//
// The batch bar is the point of the feature: one instruction for the whole
// review instead of N re-plans. Its body is `buildReviewBatch` — the same
// shape web posts to `POST /workspaces/:id/review/submit`.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Check, Eye, MessageSquare, Pencil, Send, Trash2 } from 'lucide-react-native';
import type { ReviewThread } from '@generatorai/client-core';

import { useTheme } from '../../theme/ThemeProvider';
import { Sheet } from '../ui/Sheet';
import { Button, IconButton } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Field } from '../ui/Form';
import { Badge, type Tone } from '../ui/primitives';
import { ConfirmSheet } from '../ui/ActionSheet';
import { EmptyState, LoadingState, LockedState } from '../ui/States';
import { haptics } from '../ui/haptics';
import { splitPath } from '../changes/statusStyle';
import type { DiffSide } from '../changes/diffModel';
import { REVIEW_INTENTS, THREAD_STATUS_LABEL, batchSummary, countThreads, isPendingThread, type ReviewIntent } from './reviewBatch';
import type { ReviewThreadsApi } from './useReviewThreads';

export interface ReviewDraft {
  path: string;
  alias: string;
  side: DiffSide;
  startLine: number;
  endLine: number;
  anchorText: string;
}

export interface ReviewFocus {
  path: string;
  alias: string;
  side?: DiffSide;
  line?: number;
}

export interface ReviewCommentsSheetProps {
  visible: boolean;
  onClose: () => void;
  review: ReviewThreadsApi;
  /** Start in compose mode for these lines. */
  draft?: ReviewDraft | null;
  /** Show only this file's threads (from a gutter marker or file badge). */
  focus?: ReviewFocus | null;
  /** Revision ids the summary was taken against — stored on new threads. */
  checkpoints: { base: string; head: string };
}

const STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral',
  pending: 'warning',
  submitted: 'info',
  addressed: 'success',
  resolved: 'success',
  outdated: 'neutral',
};

export function ReviewCommentsSheet({
  visible,
  onClose,
  review,
  draft,
  focus,
  checkpoints,
}: ReviewCommentsSheetProps): React.ReactElement | null {
  const [composing, setComposing] = useState<ReviewDraft | null>(draft ?? null);

  // Re-seed on open: the sheet stays mounted between targets.
  useEffect(() => {
    if (visible) setComposing(draft ?? null);
  }, [visible, draft]);

  if (!visible) return null;

  const title = composing
    ? `Comment · ${splitPath(composing.path).name}`
    : focus
      ? `Comments · ${splitPath(focus.path).name}`
      : 'Review comments';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      detents={[0.6, 0.92]}
      initialDetent={composing ? 0 : 1}
      scrollable={false}
    >
      {!review.canRead ? (
        <LockedState title="Review comments are not enabled" reason={review.readReason ?? ''} />
      ) : composing ? (
        <Composer
          draft={composing}
          busy={review.create.isPending || review.submit.isPending}
          canSend={review.canSend}
          onCancel={() => (draft ? onClose() : setComposing(null))}
          onSubmit={(body, intent, sendNow) => {
            review.create.mutate(
              { ...composing, body, intent, baseCheckpointId: checkpoints.base, headCheckpointId: checkpoints.head },
              {
                onSuccess: (created) => {
                  haptics.success();
                  if (sendNow) review.submit.mutate({ onlyIds: [created.id] });
                  onClose();
                },
              },
            );
          }}
        />
      ) : (
        <ThreadList review={review} focus={focus ?? null} />
      )}
    </Sheet>
  );
}

// ── Compose ──────────────────────────────────────────────────────

function Composer({
  draft,
  busy,
  canSend,
  onCancel,
  onSubmit,
}: {
  draft: ReviewDraft;
  busy: boolean;
  canSend: boolean;
  onCancel: () => void;
  onSubmit: (body: string, intent: ReviewIntent, sendNow: boolean) => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const [intent, setIntent] = useState<ReviewIntent>('fix');
  const [body, setBody] = useState('');
  const trimmed = body.trim();
  const range = draft.startLine === draft.endLine ? `line ${draft.startLine}` : `lines ${draft.startLine}–${draft.endLine}`;
  const hint = REVIEW_INTENTS.find((i) => i.value === intent)?.hint;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
      <View className="gap-1">
        <Text className="text-xs text-muted-foreground">
          {draft.side === 'deletions' ? 'Removed' : 'New'} {range} · {draft.path}
        </Text>
        {draft.anchorText ? (
          <View className="rounded-xl border border-border-muted bg-canvas-bg px-3 py-2">
            <Text numberOfLines={6} className="font-mono text-xs text-foreground">
              {draft.anchorText}
            </Text>
          </View>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {REVIEW_INTENTS.map((item) => (
          <Chip
            key={item.value}
            label={item.label}
            size="sm"
            selected={intent === item.value}
            tone={intent === item.value ? 'accent' : 'neutral'}
            onPress={() => setIntent(item.value)}
            accessibilityHint={item.hint}
          />
        ))}
      </ScrollView>
      {hint ? <Text className="text-xs text-muted-foreground">{hint}</Text> : null}

      <Field
        placeholder="What should change here?"
        value={body}
        onChangeText={setBody}
        multiline
        autoFocus
        accessibilityLabel="Comment"
        style={{ minHeight: 96, textAlignVertical: 'top' }}
      />

      <View className="flex-row gap-2">
        <Button label="Cancel" variant="ghost" onPress={onCancel} />
        <View className="flex-1" />
        <Button
          label="Add"
          variant="secondary"
          icon={<MessageSquare size={16} color={colors.foreground} />}
          disabled={!trimmed}
          loading={busy}
          onPress={() => onSubmit(trimmed, intent, false)}
        />
        {canSend ? (
          <Button
            label="Add & send"
            icon={<Send size={16} color={colors['primary-foreground']} />}
            disabled={!trimmed}
            loading={busy}
            onPress={() => onSubmit(trimmed, intent, true)}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

// ── Threads ──────────────────────────────────────────────────────

function ThreadList({
  review,
  focus,
}: {
  review: ReviewThreadsApi;
  focus: ReviewFocus | null;
}): React.ReactElement {
  const { colors } = useTheme();
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const threads = useMemo(() => {
    let list = review.threads;
    if (focus) list = list.filter((t) => t.path === focus.path && t.repoAlias === focus.alias);
    if (focus?.line !== undefined && focus.side) {
      const exact = list.filter((t) => t.side === focus.side && t.endLine === focus.line);
      if (exact.length > 0) list = exact;
    }
    return list;
  }, [review.threads, focus]);

  const counts = useMemo(() => countThreads(review.threads), [review.threads]);

  if (review.isLoading) return <LoadingState label="Loading comments…" />;

  return (
    <View className="flex-1">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }}>
        {threads.length === 0 ? (
          <EmptyState
            title="No comments yet"
            message={
              review.canWrite
                ? 'Long-press a line in the diff to leave one.'
                : (review.writeReason ?? 'This device cannot leave review comments.')
            }
            icon={<MessageSquare size={22} color={colors['muted-foreground']} />}
          />
        ) : (
          threads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              review={review}
              onAskDelete={() => setConfirmDelete(thread.id)}
            />
          ))
        )}
        {preview ? (
          <View className="gap-2 rounded-2xl border border-border bg-card p-3">
            <Text className="text-xs font-semibold text-foreground">What will be sent</Text>
            <Text className="font-mono text-xs text-muted-foreground">{preview}</Text>
            <Button label="Close preview" variant="ghost" size="sm" onPress={() => setPreview(null)} />
          </View>
        ) : null}
      </ScrollView>

      {counts.pending + counts.submitted + counts.addressed > 0 ? (
        <View className="gap-2 border-t border-border bg-card px-4 pb-4 pt-3">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-xs font-medium text-foreground">{batchSummary(counts)}</Text>
            {counts.pending > 0 ? (
              <>
                <IconButton
                  accessibilityLabel="Add a note for the agent"
                  selected={showNote}
                  icon={<Pencil size={16} color={showNote ? colors.primary : colors['muted-foreground']} />}
                  onPress={() => setShowNote((v) => !v)}
                />
                <IconButton
                  accessibilityLabel="Preview what will be sent"
                  icon={<Eye size={16} color={colors['muted-foreground']} />}
                  disabled={review.submit.isPending}
                  onPress={() =>
                    review.submit.mutate(
                      { note, preview: true },
                      { onSuccess: (result) => setPreview(result.prompt) },
                    )
                  }
                />
                <Button
                  label={`Send ${counts.pending} to agent`}
                  size="sm"
                  icon={<Send size={14} color={colors['primary-foreground']} />}
                  disabled={!review.canSend}
                  loading={review.submit.isPending && !review.submit.variables?.preview}
                  onPress={() => {
                    haptics.success();
                    review.submit.mutate({ note });
                  }}
                />
              </>
            ) : null}
          </View>
          {showNote && counts.pending > 0 ? (
            <Field
              placeholder="Extra instruction appended after the comments (optional)"
              value={note}
              onChangeText={setNote}
              multiline
              accessibilityLabel="Extra instruction for the agent"
            />
          ) : null}
          {counts.pending > 0 && !review.canSend ? (
            <Text className="text-xs text-muted-foreground">
              {review.writeReason ?? 'There is no running chat to send this review to.'}
            </Text>
          ) : null}
        </View>
      ) : null}

      <ConfirmSheet
        visible={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete this thread?"
        message="Every comment in it is removed. The agent will not see it."
        confirmLabel="Delete thread"
        onConfirm={() => {
          if (confirmDelete) review.remove.mutate(confirmDelete);
          setConfirmDelete(null);
        }}
      />
    </View>
  );
}

function ThreadCard({
  thread,
  review,
  onAskDelete,
}: {
  thread: ReviewThread;
  review: ReviewThreadsApi;
  onAskDelete: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const [reply, setReply] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const range = thread.startLine === thread.endLine ? `L${thread.startLine}` : `L${thread.startLine}–${thread.endLine}`;
  const pending = isPendingThread(thread);
  const busy = review.reply.isPending || review.edit.isPending || review.setStatus.isPending;

  return (
    <View className="gap-2 rounded-2xl border border-border bg-card p-3">
      <View className="flex-row items-center gap-2">
        <Text numberOfLines={1} className="flex-1 font-mono text-xs text-muted-foreground">
          {thread.path} · {thread.side === 'deletions' ? '−' : '+'}
          {range}
        </Text>
        <Badge label={THREAD_STATUS_LABEL[thread.status] ?? thread.status} tone={STATUS_TONE[thread.status] ?? 'neutral'} />
      </View>
      {thread.anchorText ? (
        <View className="rounded-xl bg-canvas-bg px-2.5 py-1.5">
          <Text numberOfLines={4} className="font-mono text-xs text-foreground">
            {thread.anchorText}
          </Text>
        </View>
      ) : null}

      {thread.comments.map((comment) => (
        <View key={comment.id} className="gap-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-xs font-semibold text-foreground">{comment.author === 'agent' ? 'Agent' : 'You'}</Text>
            {comment.intent ? <Text className="text-xs text-muted-foreground">· {comment.intent}</Text> : null}
            <View className="flex-1" />
            {comment.author === 'user' && review.canWrite && editing?.id !== comment.id ? (
              <IconButton
                accessibilityLabel="Edit comment"
                compact
                icon={<Pencil size={14} color={colors['muted-foreground']} />}
                onPress={() => setEditing({ id: comment.id, body: comment.body })}
              />
            ) : null}
          </View>
          {editing?.id === comment.id ? (
            <View className="gap-2">
              <Field value={editing.body} onChangeText={(body) => setEditing({ id: comment.id, body })} multiline autoFocus />
              <View className="flex-row justify-end gap-2">
                <Button label="Cancel" variant="ghost" size="sm" onPress={() => setEditing(null)} />
                <Button
                  label="Save"
                  size="sm"
                  loading={review.edit.isPending}
                  disabled={!editing.body.trim()}
                  onPress={() =>
                    review.edit.mutate(
                      { threadId: thread.id, commentId: comment.id, body: editing.body.trim() },
                      { onSuccess: () => setEditing(null) },
                    )
                  }
                />
              </View>
            </View>
          ) : (
            <Text className="text-sm text-foreground">{comment.body}</Text>
          )}
        </View>
      ))}

      {review.canWrite && thread.status !== 'resolved' && thread.status !== 'outdated' ? (
        <View className="gap-2">
          <Field
            placeholder="Reply…"
            value={reply}
            onChangeText={setReply}
            multiline
            accessibilityLabel={`Reply to thread on ${thread.path}`}
          />
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Button
              label="Reply"
              variant="secondary"
              size="sm"
              disabled={!reply.trim()}
              loading={review.reply.isPending}
              onPress={() =>
                review.reply.mutate({ threadId: thread.id, body: reply.trim() }, { onSuccess: () => setReply('') })
              }
            />
            <Button
              label="Resolve"
              variant="ghost"
              size="sm"
              icon={<Check size={14} color={colors.success} />}
              disabled={busy}
              onPress={() => review.setStatus.mutate({ threadId: thread.id, status: 'resolved' })}
            />
            {pending && review.canSend ? (
              <Button
                label="Send"
                variant="ghost"
                size="sm"
                icon={<Send size={14} color={colors.primary} />}
                loading={review.submit.isPending}
                onPress={() => review.submit.mutate({ onlyIds: [thread.id] })}
              />
            ) : null}
            <View className="flex-1" />
            <IconButton
              accessibilityLabel="Delete thread"
              icon={<Trash2 size={16} color={colors.danger} />}
              onPress={onAskDelete}
            />
          </View>
        </View>
      ) : review.canWrite && thread.status === 'resolved' ? (
        <Button
          label="Reopen"
          variant="ghost"
          size="sm"
          disabled={busy}
          onPress={() => review.setStatus.mutate({ threadId: thread.id, status: 'pending' })}
        />
      ) : null}
    </View>
  );
}
