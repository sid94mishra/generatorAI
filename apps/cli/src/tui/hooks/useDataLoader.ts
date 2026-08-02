// useDataLoader hook — periodic data refresh for TUI views

import { useEffect, useRef } from 'react';
import { useStore, useActions } from './useStore.js';

export function useDataLoader(intervalMs = 5000): void {
  const actions = useActions();
  const client = useStore((s) => s.client);
  const currentView = useStore((s) => s.currentView);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!client) return;

    const loadData = async () => {
      try {
        actions.setServerStatus('connected');

        // Load view-specific data
        switch (currentView) {
          case 'dashboard':
          case 'chats':
          case 'chat-detail': {
            const chats = await client.listChats();
            actions.setChats(chats);
            break;
          }
          case 'workflows':
          case 'workflow-detail': {
            const workflows = await client.listDefinitions();
            actions.setWorkflows(workflows);
            break;
          }
          case 'runs':
          case 'run-detail': {
            const runs = await client.listRuns();
            actions.setRuns(runs);
            break;
          }
        }
      } catch {
        actions.setServerStatus('disconnected');
      }
    };

    // Initial load
    loadData();

    // Periodic refresh
    timerRef.current = setInterval(loadData, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [client, currentView, intervalMs]);
}
