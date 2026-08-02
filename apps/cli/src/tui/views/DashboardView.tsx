// DashboardView — overview with server health, recent activity, quick stats

import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../hooks/useStore.js';

export function DashboardView(): React.JSX.Element {
  const chats = useStore((s) => s.chats);
  const workflows = useStore((s) => s.workflows);
  const runs = useStore((s) => s.runs);
  const serverStatus = useStore((s) => s.serverStatus);
  const recentEvents = useStore((s) => s.recentEvents);

  const activeChats = chats.filter((c) => c.status === 'active').length;
  const activeRuns = runs.filter((r) => r.status === 'starting' || r.status === 'created').length;

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">  Dashboard</Text>
      <Text dimColor>  {'─'.repeat(50)}</Text>

      <Box marginTop={1} gap={4}>
        <Box flexDirection="column" width="50%">
          <Text bold>  Quick Stats</Text>
          <Text>  💬 Active Chats: <Text color="green">{activeChats}</Text> / {chats.length}</Text>
          <Text>  ⚙  Workflows:    <Text color="cyan">{workflows.length}</Text></Text>
          <Text>  ▶  Active Runs:  <Text color="yellow">{activeRuns}</Text> / {runs.length}</Text>
          <Text>  🔌 Server:       <Text color={serverStatus === 'connected' ? 'green' : 'red'}>{serverStatus}</Text></Text>
        </Box>

        <Box flexDirection="column" width="50%">
          <Text bold>  Recent Activity</Text>
          {recentEvents.length === 0 ? (
            <Text dimColor>  No recent events</Text>
          ) : (
            recentEvents.slice(0, 8).map((event, i) => (
              <Text key={i} dimColor>
                {'  '}{String(event.kind).padEnd(25)} {new Date(event.timestamp).toLocaleTimeString()}
              </Text>
            ))
          )}
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>  Quick Actions</Text>
        <Text dimColor>  Press 2 for Chats  │  3 for Workflows  │  4 for Runs  │  ? for Help</Text>
      </Box>
    </Box>
  );
}
