// StatusBar — bottom bar showing server status, current view, keyboard hints

import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../hooks/useStore.js';

export function StatusBar(): React.JSX.Element {
  const currentView = useStore((s) => s.currentView);
  const serverStatus = useStore((s) => s.serverStatus);
  const isLoading = useStore((s) => s.isLoading);

  const statusColor = serverStatus === 'connected' ? 'green'
    : serverStatus === 'connecting' ? 'yellow'
    : 'red';

  const statusIcon = serverStatus === 'connected' ? '●'
    : serverStatus === 'connecting' ? '◎'
    : '○';

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Box width="30%">
        <Text color={statusColor}>{statusIcon} {serverStatus}</Text>
        {isLoading && <Text color="yellow"> ⟳</Text>}
      </Box>
      <Box width="40%" justifyContent="center">
        <Text bold>{viewLabel(currentView)}</Text>
      </Box>
      <Box width="30%" justifyContent="flex-end">
        <Text dimColor>? help  Esc back  ^C quit</Text>
      </Box>
    </Box>
  );
}

function viewLabel(view: string): string {
  switch (view) {
    case 'dashboard': return '📊 Dashboard';
    case 'chats': return '💬 Chats';
    case 'chat-detail': return '💬 Chat Detail';
    case 'workflows': return '⚙ Workflows';
    case 'workflow-detail': return '⚙ Workflow Detail';
    case 'runs': return '▶ Runs';
    case 'run-detail': return '▶ Run Detail';
    case 'settings': return '⚙ Settings';
    default: return view;
  }
}
