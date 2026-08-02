// ChatsView — list of chat conversations with selection

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore, useActions } from '../hooks/useStore.js';

export function ChatsView(): React.JSX.Element {
  const chats = useStore((s) => s.chats);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const actions = useActions();

  useInput((input, key) => {
    if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
    if (key.downArrow && selectedIndex < chats.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }
    if (key.return && chats[selectedIndex]) {
      actions.navigate('chat-detail', chats[selectedIndex]!.id);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">  💬 Chats ({chats.length})</Text>
      <Text dimColor>  {'─'.repeat(50)}</Text>
      <Text dimColor>  ↑↓ navigate  Enter select  n new</Text>

      <Box flexDirection="column" marginTop={1}>
        {chats.length === 0 ? (
          <Text dimColor>  No chats yet. Press n to create one.</Text>
        ) : (
          chats.map((chat, i) => {
            const isSelected = i === selectedIndex;
            const statusColor = chat.status === 'active' ? 'green' : 'gray';
            return (
              <Box key={chat.id}>
                <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                  {isSelected ? ' ▸ ' : '   '}
                  {chat.name.padEnd(25)}
                </Text>
                <Text color={statusColor}>{chat.status.padEnd(10)}</Text>
                <Text dimColor>{chat.id.slice(0, 8)}</Text>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
