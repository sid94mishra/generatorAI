// WorkflowsView — list of workflow definitions with selection

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore, useActions } from '../hooks/useStore.js';

export function WorkflowsView(): React.JSX.Element {
  const workflows = useStore((s) => s.workflows);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const actions = useActions();

  useInput((input, key) => {
    if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
    if (key.downArrow && selectedIndex < workflows.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }
    if (key.return && workflows[selectedIndex]) {
      actions.navigate('workflow-detail', workflows[selectedIndex]!.id);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">  ⚙ Workflows ({workflows.length})</Text>
      <Text dimColor>  {'─'.repeat(50)}</Text>
      <Text dimColor>  ↑↓ navigate  Enter select  n new</Text>

      <Box flexDirection="column" marginTop={1}>
        {workflows.length === 0 ? (
          <Text dimColor>  No workflow definitions.</Text>
        ) : (
          workflows.map((wf, i) => {
            const isSelected = i === selectedIndex;
            return (
              <Box key={wf.id}>
                <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                  {isSelected ? ' ▸ ' : '   '}
                  {wf.name.padEnd(25)}
                </Text>
                <Text dimColor>{`v${wf.version}`.padEnd(6)}</Text>
                <Text dimColor>{wf.sessionMode.padEnd(12)}</Text>
                <Text dimColor>{wf.id.slice(0, 8)}</Text>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
