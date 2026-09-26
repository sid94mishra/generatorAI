// ────────────────────────────────────────────────────────────────
// CheckOutput — what a check stage's command printed (P05).
//
// A check runs a command with no agent session, so the inline transcript has
// nothing to show; its verdict, exit code and output tails are the whole
// story.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';

import { checkLabel, checkResultOf, type RunStage } from './loopModel';

export function CheckOutput({ stage }: { stage: RunStage }): React.ReactElement {
  const result = checkResultOf(stage);
  if (!result) {
    return <Text className="text-sm text-muted-foreground">No result yet.</Text>;
  }
  const tail = (label: string, text: string) =>
    text.trim() ? (
      <View className="gap-1">
        <Text className="text-xs font-medium text-muted-foreground">{label}</Text>
        <Text numberOfLines={12} className="rounded-xl bg-raised p-2 font-mono text-xs text-foreground">
          {text.trimEnd()}
        </Text>
      </View>
    ) : null;
  return (
    <View className="gap-2 pt-1">
      <Text className={`text-sm font-medium ${result.passed ? 'text-success' : 'text-danger'}`}>{checkLabel(result)}</Text>
      {tail('stdout', result.stdoutTail)}
      {tail('stderr', result.stderrTail)}
    </View>
  );
}
