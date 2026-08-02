// HelpOverlay — keyboard shortcut reference overlay

import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../hooks/useStore.js';

const SHORTCUTS = [
  { key: '1-5', action: 'Navigate to view' },
  { key: 'Esc / Ctrl+B', action: 'Go back' },
  { key: 'Enter', action: 'Select / Open' },
  { key: 'n', action: 'New item (context-dependent)' },
  { key: '/', action: 'Search' },
  { key: 'r', action: 'Refresh data' },
  { key: '?', action: 'Toggle this help' },
  { key: 'Ctrl+C', action: 'Quit' },
];

export function HelpOverlay(): React.JSX.Element | null {
  const showHelp = useStore((s) => s.showHelp);

  if (!showHelp) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginX={4}
      marginY={1}
    >
      <Text bold color="cyan">  Keyboard Shortcuts</Text>
      <Text dimColor>  {'─'.repeat(30)}</Text>
      {SHORTCUTS.map((s) => (
        <Box key={s.key} gap={2}>
          <Box width={16}>
            <Text bold>{s.key}</Text>
          </Box>
          <Text>{s.action}</Text>
        </Box>
      ))}
      <Text dimColor>{'\n  '}Press ? to close</Text>
    </Box>
  );
}
