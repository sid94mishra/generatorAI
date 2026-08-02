// SettingsView — CLI settings display and editing

import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../hooks/useStore.js';

export function SettingsView(): React.JSX.Element {
  const serverStatus = useStore((s) => s.serverStatus);
  const client = useStore((s) => s.client);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">  ⚙ Settings</Text>
      <Text dimColor>  {'─'.repeat(50)}</Text>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>  Connection</Text>
        <Text>  Server URL:   <Text color="cyan">{client?.baseUrl ?? 'unknown'}</Text></Text>
        <Text>  Status:       <Text color={serverStatus === 'connected' ? 'green' : 'red'}>{serverStatus}</Text></Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>  Configuration</Text>
        <Text dimColor>  Edit with: generatorai config edit</Text>
        <Text dimColor>  Show with: generatorai config show</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>  About</Text>
        <Text dimColor>  GeneratorAI CLI — AI workflow engine</Text>
        <Text dimColor>  https://github.com/generatorai</Text>
      </Box>
    </Box>
  );
}
