// ────────────────────────────────────────────────────────────────
// Merge conflicts — the three ways out.
//
// The flow reports conflicts without touching the working tree
// (`mergeStarted: false`), so nothing has happened yet when this sheet
// opens. The user picks:
//
//   • Ask the agent  — starts the merge and sends the chat a prompt naming
//                      the conflicted files. A normal turn: watchable,
//                      stoppable, rewindable. It does not push.
//   • Continue       — the merge is resolved; commit it and finish the
//                      remaining steps (push / PR).
//   • Abort          — `git merge --abort`, nothing lost.
//
// "Ask the agent" needs a chat that owns the mount; without one the action
// says so instead of offering a button that 400s.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { Bot, GitMerge, Play, Undo2 } from 'lucide-react-native';
import type { ScmConflictReport } from '@generatorai/shared';

import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { useTheme } from '../../theme/ThemeProvider';

export function ConflictSheet({
  visible,
  onClose,
  conflicts,
  chatId,
  busy,
  onAskAgent,
  onContinue,
  onAbort,
}: {
  visible: boolean;
  onClose: () => void;
  conflicts: ScmConflictReport;
  /** The chat that owns the mount; without it the agent cannot be asked. */
  chatId: string | null;
  busy: boolean;
  onAskAgent: () => void;
  onContinue: () => void;
  onAbort: () => void;
}): React.ReactElement | null {
  const { colors } = useTheme();
  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={onClose} title="Merge conflicts" detents={[0.8]} fitContent>
      <View className="gap-4 px-4 pb-8 pt-4">
        <View className="flex-row items-center gap-2">
          <GitMerge size={14} color={colors.warning} />
          <Text className="flex-1 text-xs text-muted-foreground">
            Merging {conflicts.base} into {conflicts.head} conflicts in{' '}
            {conflicts.files.length} {conflicts.files.length === 1 ? 'file' : 'files'}.
            {conflicts.mergeStarted
              ? ' The merge is applied to the working tree — conflict markers are in the files.'
              : ' Nothing has been changed yet.'}
          </Text>
        </View>

        <View className="gap-1 rounded-2xl border border-border bg-subtle p-3">
          {conflicts.files.slice(0, 20).map((file) => (
            <Text key={file} numberOfLines={1} className="font-mono text-xs text-foreground">
              {file}
            </Text>
          ))}
          {conflicts.files.length > 20 ? (
            <Text className="text-xs text-muted-foreground">
              … and {conflicts.files.length - 20} more
            </Text>
          ) : null}
        </View>

        <View className="gap-2">
          <Button
            label="Ask the agent"
            full
            icon={<Bot size={16} color={colors['primary-foreground']} />}
            disabled={!chatId || busy}
            onPress={onAskAgent}
            accessibilityHint="Sends this chat a prompt listing the conflicted files. It resolves, you review, then Continue."
          />
          {!chatId ? (
            <Text className="text-xs text-muted-foreground">
              Open the Changes pane from a chat to ask an agent to resolve these.
            </Text>
          ) : null}
          <Button
            label="Continue"
            full
            variant="secondary"
            icon={<Play size={16} color={colors.foreground} />}
            disabled={busy}
            onPress={onContinue}
            accessibilityHint="Commits the resolved merge and finishes the remaining steps."
          />
          <Button
            label="Abort the merge"
            full
            variant="ghost"
            icon={<Undo2 size={16} color={colors.primary} />}
            disabled={busy}
            onPress={onAbort}
          />
        </View>
      </View>
    </Sheet>
  );
}
