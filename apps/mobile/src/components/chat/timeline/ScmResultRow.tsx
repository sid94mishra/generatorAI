// ────────────────────────────────────────────────────────────────
// ScmResultRow — what the platform committed on the agent's behalf.
//
// Agent-native chats commit after every completed turn, and the server says
// what happened on the session scope (`chat.scm.result`). This row is that
// sentence: "Committed abc1234 · pushed · PR #12", tappable through to the
// pull request; or the reason it was blocked; or the conflict card with the
// same three ways out the Changes pane offers.
//
// Isolated on purpose — nothing else in the transcript knows the block
// exists (`scmResultBlock.ts` narrows it), so this file is the only thing to
// change when the shape moves.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  ExternalLink,
  GitCommitHorizontal,
  GitMerge,
  Play,
  TriangleAlert,
  Undo2,
} from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';
import { useTheme } from '../../../theme/ThemeProvider';
import { scmKeys } from '../../scm/api';
import { useScmApi } from '../../scm/useScmApi';
import {
  blockedReason,
  describeFlowResult,
  mobileReason,
  stepLabel,
  summarizeFlow,
} from '../../scm/scmModel';
import { RowFrame, type RowTone } from './RowFrame';
import { useTimelineActions } from './TimelineActions';
import type { ScmResultBlock } from './scmResultBlock';

export function ScmResultRow({ block }: { block: ScmResultBlock }): React.ReactElement {
  const { colors } = useTheme();
  // Conflicts open expanded: they are a question addressed to the user, and
  // a collapsed row would hide the only three answers.
  const [expanded, setExpanded] = useState(block.result.status === 'conflicts');
  const { workspaceId, chatId: chatFromScreen } = useTimelineActions();
  const toast = useToast();
  const scm = useScmApi();
  const queryClient = useQueryClient();

  const result = block.result;
  // The block names the turn, not the chat; the screen knows which chat it is.
  const chatId = block.chatId ?? chatFromScreen ?? null;
  const outcome = describeFlowResult(result);
  const pr = result.pullRequest;
  const conflicts = result.conflicts;

  const invalidate = (): void => {
    if (!workspaceId) return;
    void queryClient.invalidateQueries({ queryKey: scmKeys.readiness(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.changes(workspaceId) });
  };

  const act = useMutation({
    mutationFn: async (action: 'agent' | 'continue' | 'abort') => {
      if (!workspaceId) throw new Error('This chat has no workspace.');
      const alias = result.alias;
      if (action === 'agent') {
        if (!chatId) throw new Error('This result is not attached to a chat.');
        await scm.resolveConflictsWithAgent(workspaceId, { alias, chatId });
        return 'Asked the agent to resolve the conflicts. Review, then Continue.';
      }
      if (action === 'continue') {
        await scm.continueConflicts(workspaceId, { alias });
        return 'Merge committed.';
      }
      await scm.abortConflicts(workspaceId, { alias });
      return 'Merge aborted. Nothing was changed.';
    },
    onSuccess: (msg) => {
      invalidate();
      toast({ message: msg, variant: 'info' });
    },
    onError: (err) =>
      toast({
        message: err instanceof Error && err.message ? err.message : 'That did not work',
        variant: 'danger',
      }),
  });

  if (result.status === 'conflicts' && conflicts) {
    return (
      <RowFrame
        icon={<GitMerge size={16} color={colors.warning} />}
        title={`Merge conflicts in ${conflicts.files.length} ${conflicts.files.length === 1 ? 'file' : 'files'}`}
        detail={`Merging ${conflicts.base} into ${conflicts.head}. Nothing was pushed.`}
        tone="warning"
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        accessibilityLabel={`Merge conflicts in ${conflicts.files.length} files`}
      >
        <View className="gap-2 px-3 py-2.5">
          <View className="gap-1">
            {conflicts.files.slice(0, 8).map((file) => (
              <Text key={file} numberOfLines={1} className="font-mono text-xs text-muted-foreground">
                {file}
              </Text>
            ))}
            {conflicts.files.length > 8 ? (
              <Text className="text-xs text-muted-foreground">
                … and {conflicts.files.length - 8} more
              </Text>
            ) : null}
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Ask the agent"
              size="sm"
              icon={<Bot size={14} color={colors['primary-foreground']} />}
              disabled={act.isPending || !chatId}
              onPress={() => act.mutate('agent')}
            />
            <Button
              label="Continue"
              size="sm"
              variant="secondary"
              icon={<Play size={14} color={colors.foreground} />}
              disabled={act.isPending}
              onPress={() => act.mutate('continue')}
            />
            <Button
              label="Abort"
              size="sm"
              variant="ghost"
              icon={<Undo2 size={14} color={colors.primary} />}
              disabled={act.isPending}
              onPress={() => act.mutate('abort')}
            />
          </View>
        </View>
      </RowFrame>
    );
  }

  if (result.status === 'blocked' || result.status === 'failed') {
    return (
      <RowFrame
        icon={<TriangleAlert size={16} color={result.status === 'failed' ? colors.danger : colors.warning} />}
        title={result.status === 'failed' ? 'Could not commit' : 'Nothing was committed'}
        detail={mobileReason(blockedReason(result), result.readiness)}
        tone={result.status === 'failed' ? 'danger' : 'warning'}
      />
    );
  }

  return (
    <RowFrame
      icon={<GitCommitHorizontal size={16} color={colors.success} />}
      title={summarizeFlow(result)}
      {...(result.branch ? { subtitle: result.branch } : {})}
      {...(pr ? { detail: pr.title } : {})}
      tone={toneFor(outcome.tone)}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      accessibilityLabel={summarizeFlow(result)}
    >
      <View className="gap-2 px-3 py-2.5">
        {result.steps.map((step) => (
          <Text key={step.id} numberOfLines={2} className="text-xs text-muted-foreground">
            {stepLabel(step.id)} — {step.detail ?? step.status}
          </Text>
        ))}
        {pr ? (
          <Button
            label={`Open PR #${pr.number}`}
            size="sm"
            variant="secondary"
            icon={<ExternalLink size={14} color={colors.foreground} />}
            accessibilityLabel={`Open pull request ${pr.number} in the browser`}
            onPress={() => void Linking.openURL(pr.url)}
          />
        ) : null}
      </View>
    </RowFrame>
  );
}

function toneFor(tone: ReturnType<typeof describeFlowResult>['tone']): RowTone {
  if (tone === 'success') return 'success';
  if (tone === 'danger') return 'danger';
  if (tone === 'warning') return 'warning';
  return 'info';
}
