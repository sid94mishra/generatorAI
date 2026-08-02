// TUIApp — root component that assembles nav, views, and status bar

import React from 'react';
import { Box } from 'ink';
import { useStore } from './hooks/useStore.js';
import { useKeyboard } from './hooks/useKeyboard.js';
import { useDataLoader } from './hooks/useDataLoader.js';
import { NavBar } from './components/NavBar.js';
import { StatusBar } from './components/StatusBar.js';
import { HelpOverlay } from './components/HelpOverlay.js';
import { DashboardView } from './views/DashboardView.js';
import { ChatsView } from './views/ChatsView.js';
import { WorkflowsView } from './views/WorkflowsView.js';
import { RunsView } from './views/RunsView.js';
import { SettingsView } from './views/SettingsView.js';

function ViewRouter(): React.JSX.Element {
  const currentView = useStore((s) => s.currentView);

  switch (currentView) {
    case 'dashboard': return <DashboardView />;
    case 'chats':
    case 'chat-detail': return <ChatsView />;
    case 'workflows':
    case 'workflow-detail': return <WorkflowsView />;
    case 'runs':
    case 'run-detail': return <RunsView />;
    case 'settings': return <SettingsView />;
    default: return <DashboardView />;
  }
}

export function TUIApp(): React.JSX.Element {
  useKeyboard();
  useDataLoader();

  return (
    <Box flexDirection="column" minHeight={20}>
      <NavBar />
      <Box flexDirection="column" flexGrow={1}>
        <HelpOverlay />
        <ViewRouter />
      </Box>
      <StatusBar />
    </Box>
  );
}
