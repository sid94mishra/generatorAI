// NavBar — top navigation bar with view tabs

import React from 'react';
import { Box, Text } from 'ink';
import { useStore, useActions } from '../hooks/useStore.js';
import type { TUIView } from '../stores/appStore.js';

interface NavItem {
  key: string;
  label: string;
  view: TUIView;
}

const NAV_ITEMS: NavItem[] = [
  { key: '1', label: 'Dashboard', view: 'dashboard' },
  { key: '2', label: 'Chats', view: 'chats' },
  { key: '3', label: 'Workflows', view: 'workflows' },
  { key: '4', label: 'Runs', view: 'runs' },
  { key: '5', label: 'Settings', view: 'settings' },
];

export function NavBar(): React.JSX.Element {
  const currentView = useStore((s) => s.currentView);

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} gap={2}>
      <Text bold color="cyan">GeneratorAI</Text>
      <Text dimColor>│</Text>
      {NAV_ITEMS.map((item) => {
        const isActive = currentView === item.view || currentView.startsWith(item.view.replace('s', '-'));
        return (
          <Box key={item.key}>
            <Text dimColor>{item.key}:</Text>
            <Text bold={isActive} color={isActive ? 'cyan' : undefined}>
              {' '}{item.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
