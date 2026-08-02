// RunsView — list of workflow runs with status indicators

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore, useActions } from '../hooks/useStore.js';

const STATUS_ICONS: Record<string, string> = {
  running: '⟳',
  completed: '✓',
  failed: '✗',
  cancelled: '⊘',
  pending: '○',
  queued: '○',
  paused: '⏸',
};

const STATUS_COLORS: Record<string, string> = {
  running: 'cyan',
  completed: 'green',
  failed: 'red',
  cancelled: 'red',
  pending: 'yellow',
  queued: 'yellow',
  paused: 'yellow',
};

export function RunsView(): React.JSX.Element {
  const runs = useStore((s) => s.runs);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const actions = useActions();

  useInput((input, key) => {
    if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
    if (key.downArrow && selectedIndex < runs.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }
    if (key.return && runs[selectedIndex]) {
      actions.navigate('run-detail', runs[selectedIndex]!.id);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">  ▶ Runs ({runs.length})</Text>
      <Text dimColor>  {'─'.repeat(50)}</Text>
      <Text dimColor>  ↑↓ navigate  Enter select  n new</Text>

      <Box flexDirection="column" marginTop={1}>
        {runs.length === 0 ? (
          <Text dimColor>  No workflow runs.</Text>
        ) : (
          runs.map((run, i) => {
            const isSelected = i === selectedIndex;
            const icon = STATUS_ICONS[run.status] ?? '·';
            const color = STATUS_COLORS[run.status] ?? undefined;
            return (
              <Box key={run.id}>
                <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                  {isSelected ? ' ▸ ' : '   '}
                </Text>
                <Text color={color}>{icon} </Text>
                <Text color={isSelected ? 'cyan' : undefined}>
                  {run.id.slice(0, 8).padEnd(10)}
                </Text>
                <Text color={color}>{run.status.padEnd(12)}</Text>
                <Text dimColor>
                  {run.createdAt ? new Date(run.createdAt).toLocaleString() : '—'}
                </Text>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
