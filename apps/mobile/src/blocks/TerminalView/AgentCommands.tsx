// MB-27 "Agent commands" (the read-only instance chip): the shell commands the agent ran in this chat, newest last —
// the shared status (glyph + word, MD-25) and the command (mono), the exit code, the duration; a row expands to its output (tail-capped). "Open in
// terminal" TYPES the command into a new shell (never runs it: the user presses Enter, or does not).
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { transcriptStepStatus } from '@generatorai/client-core';

import { CodeText } from '../../ui/primitives/CodeText';
import { Button } from '../../ui/primitives/Button';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { Pressable } from '../../ui/primitives/Pressable';
import { StatusBadge } from '../../ui/primitives/StatusBadge';
import { Text } from '../../ui/primitives/Text';
import type { AgentConsoleRow } from './engine/agentConsoleRows';

/** The command's state through the shared step status table (Running / Done / Failed), never a local tone map. */
function CommandStatus({ status }: { status: AgentConsoleRow['status'] }): React.ReactElement {
  const resolved = transcriptStepStatus(status === 'complete' ? 'done' : status);
  return <StatusBadge state={resolved.state} {...(resolved.label ? { label: resolved.label } : {})} size="sm" />;
}

export function AgentCommands({ rows, onOpenInTerminal }: { rows: readonly AgentConsoleRow[]; onOpenInTerminal?: (command: string) => void }): React.ReactElement {
  const [open, setOpen] = useState<string | null>(rows[rows.length - 1]?.id ?? null);
  if (rows.length === 0) return <EmptyState icon="terminal" title="No commands yet" description="Shell commands the agent runs in this chat appear here." />;
  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-2 p-3 pb-8" testID="agent-commands">
      {rows.map((row) => {
        const expanded = open === row.id;
        return (
          <View key={row.id} className="overflow-hidden rounded-card border border-line-soft bg-sunken">
            <Pressable
              frame="none"
              onPress={() => setOpen(expanded ? null : row.id)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={`${row.command}, ${row.status === 'running' ? 'running' : row.status === 'failed' ? `failed${row.exitCode !== undefined ? `, exit code ${row.exitCode}` : ''}` : 'done'}`}
              className="min-h-row flex-row items-center gap-2 px-3 py-2"
            >
              <CommandStatus status={row.status} />
              <Text role="mono" numberOfLines={expanded ? undefined : 1} className="flex-1">
                {`$ ${row.command}`}
              </Text>
              {row.exitCode !== undefined && row.exitCode !== 0 ? (
                <Text role="monoSm" tone="err">
                  {`exit ${row.exitCode}`}
                </Text>
              ) : null}
            </Pressable>
            {expanded ? (
              <View className="gap-2 px-3 pb-3">
                {row.description ? (
                  <Text role="footnote" tone="fg-3">
                    {row.description}
                  </Text>
                ) : null}
                {row.output ? <CodeText form="block" code={row.output} maxLines={40} copyable /> : <Text role="footnote" tone="fg-3">{row.status === 'running' ? 'Output arrives when the command finishes.' : 'No output.'}</Text>}
                {onOpenInTerminal ? <Button label="Open in terminal" size="sm" icon="terminal" onPress={() => onOpenInTerminal(row.command)} /> : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}
