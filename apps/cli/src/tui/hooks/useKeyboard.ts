// useKeyboard hook — global keyboard shortcuts for TUI navigation

import { useInput } from 'ink';
import { useStore, useActions } from './useStore.js';

export function useKeyboard(): void {
  const actions = useActions();
  const currentView = useStore((s) => s.currentView);
  const showHelp = useStore((s) => s.showHelp);

  useInput((input, key) => {
    // Help toggle
    if (input === '?' || (key.ctrl && input === 'h')) {
      actions.toggleHelp();
      return;
    }

    // Global navigation shortcuts
    if (!showHelp) {
      if (input === 'd' && key.ctrl) { actions.navigate('dashboard'); return; }
      if (input === '1') { actions.navigate('dashboard'); return; }
      if (input === '2') { actions.navigate('chats'); return; }
      if (input === '3') { actions.navigate('workflows'); return; }
      if (input === '4') { actions.navigate('runs'); return; }
      if (input === '5') { actions.navigate('settings'); return; }

      // Back
      if (key.escape || (input === 'b' && key.ctrl)) {
        actions.goBack();
        return;
      }
    }
  });
}
