// ────────────────────────────────────────────────────────────────
// StageTranscriptInline — what a stage's agent is doing, inside the run's
// step list.
//
// The desktop run page expands a step in place to show its conversation; on
// the phone a tap used to leave the run for a separate stage screen, so
// following a live run meant bouncing between two screens. The step now
// opens where it is: the tail of the stage's transcript, rendered with the
// same rows as a chat (grouped tool calls, markdown, diffs), refreshed by the
// run stream while the stage is running. The full transcript, output and
// files stay one tap away on the stage screen.
//
// Only the tail is rendered — a long stage can hold hundreds of rows, and an
// expanded step sits inside a scrolling list of steps. Older rows are counted
// and offered through "Open stage".
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react-native';
import { queryKeys, type StageRunSummary } from '@generatorai/client-core';

import { useAdminApi } from '../../api/useAdminApi';
import { TimelineRowView } from '../chat/timeline/TimelineRow';
import { UserMessageRow } from '../chat/timeline/UserMessageRow';
import { TimelineActionsContext } from '../chat/timeline/TimelineActions';
import { Skeleton } from '../ui/Skeleton';
import { Touchable } from '../ui/Touchable';
import { useToast } from '../ui/Toast';
import { useTheme } from '../../theme/ThemeProvider';
import { isActive } from './statusStyle';
import { transcriptItems, withLiveRows } from './stageTranscript';
import { deriveTimeline } from '../chat/timeline/deriveTimeline';
import { useStageLive } from '../../stream/useStageLive';

/** Rows shown inline; the rest are behind "Open stage". */
export const INLINE_TRANSCRIPT_ROWS = 8;

export function StageTranscriptInline({
  runId,
  stage,
  workspaceId,
  connected,
  onOpenStage,
}: {
  runId: string;
  stage: StageRunSummary;
  workspaceId: string | null;
  /** The run stream is up — it refreshes this query, so polling can be slow. */
  connected: boolean;
  onOpenStage: () => void;
}): React.ReactElement {
  const admin = useAdminApi();
  const { colors } = useTheme();
  const toast = useToast();
  const sessionId = stage.sessionId ?? null;
  const live = isActive(stage.status);

  const transcript = useQuery({
    queryKey: queryKeys.stageTranscript(runId, stage.id),
    queryFn: () => admin.sessions.chat(sessionId!, stage.id),
    enabled: Boolean(sessionId),
    refetchInterval: live ? (connected ? 15_000 : 5_000) : false,
  });

  // Nothing past the prompt is saved while the stage runs; stream it instead.
  const liveState = useStageLive(runId, stage.id, live);
  const items = useMemo(() => {
    const saved = transcriptItems(transcript.data, live);
    if (!liveState?.blocks.length) return saved;
    return withLiveRows(saved, deriveTimeline(liveState.blocks, { active: true, idPrefix: `live-${stage.id}:` }));
  }, [transcript.data, live, liveState?.blocks, stage.id]);
  const tail = items.slice(-INLINE_TRANSCRIPT_ROWS);
  const hidden = items.length - tail.length;

  const actions = useMemo(
    () => ({ workspaceId, streamKey: null, toast: (message: string) => toast({ message }) }),
    [workspaceId, toast],
  );

  let body: React.ReactNode;
  if (!sessionId) {
    body = (
      <Text className="text-sm leading-relaxed text-muted-foreground">
        {live ? 'Starting — the agent has not opened a session yet.' : 'This stage ran without an agent session.'}
      </Text>
    );
  } else if (transcript.isLoading) {
    body = (
      <View className="gap-2">
        <Skeleton width="86%" height={13} />
        <Skeleton width="70%" height={13} />
        <Skeleton width="42%" height={13} />
      </View>
    );
  } else if (transcript.isError) {
    body = <Text className="text-sm text-danger">The transcript did not load. Open the stage to retry.</Text>;
  } else if (tail.length === 0) {
    body = (
      <Text className="text-sm text-muted-foreground">
        {live ? 'Waiting for the agent’s first message…' : 'No messages were recorded for this stage.'}
      </Text>
    );
  } else {
    body = (
      <View className="gap-2.5">
        {hidden > 0 ? (
          <Text className="text-xs text-muted-foreground">
            {hidden} earlier {hidden === 1 ? 'step' : 'steps'} — open the stage for the whole transcript.
          </Text>
        ) : null}
        {tail.map((item) =>
          item.kind === 'user' ? (
            <UserMessageRow key={item.id} message={item.message} />
          ) : (
            item.row.kind === 'text' && !item.row.live ? (
              <ClampedRow key={item.id}>
                <TimelineRowView row={item.row} />
              </ClampedRow>
            ) : (
              <TimelineRowView key={item.id} row={item.row} />
            )
          ),
        )}
      </View>
    );
  }

  return (
    <TimelineActionsContext.Provider value={actions}>
      <View className="gap-3 pb-1 pt-2">
        {body}
        <Touchable
          accessibilityRole="button"
          accessibilityLabel="Open stage: full transcript, output and files"
          haptic="tap"
          onPress={onOpenStage}
          className="min-h-11 flex-row items-center gap-1.5 self-start"
        >
          <Text className="text-sm font-semibold text-primary">Open stage</Text>
          <ArrowUpRight size={15} color={colors.primary} />
        </Touchable>
      </View>
    </TimelineActionsContext.Provider>
  );
}

/** Inline answers taller than this collapse behind "Show more". */
const CLAMP_HEIGHT = 240;

/**
 * A long agent answer, clamped. The run page lists every stage, and a
 * report-writing stage's answer ran past two screens inline, burying the
 * stages after it. The full text stays one tap away, as prompts do.
 */
function ClampedRow({ children }: { children: React.ReactNode }): React.ReactElement {
  const [height, setHeight] = useState(0);
  const [open, setOpen] = useState(false);
  // Some slack, so an answer barely over the line is not clamped by a hair.
  const long = height > CLAMP_HEIGHT + 60;
  return (
    <View>
      <View style={long && !open ? { maxHeight: CLAMP_HEIGHT, overflow: 'hidden' } : undefined}>
        <View onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>{children}</View>
      </View>
      {long ? (
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={open ? 'Show less of this answer' : 'Show more of this answer'}
          onPress={() => setOpen((v) => !v)}
          className="self-start py-1.5"
        >
          <Text className="text-sm font-semibold text-primary">{open ? 'Show less' : 'Show more'}</Text>
        </Touchable>
      ) : null}
    </View>
  );
}
