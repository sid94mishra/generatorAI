// TUI entry point — launches the Ink-based terminal UI

import React from 'react';
import { render } from 'ink';
import { TUIApp } from './TUIApp.js';
import { createTUIStore } from './stores/appStore.js';
import { setGlobalStore } from './hooks/useStore.js';
import { createClient } from '../platform/createClient.js';
import { loadCLIConfig } from '../config/loadConfig.js';

export async function launchTUI(options?: {
  serverUrl?: string;
  apiKey?: string;
}): Promise<void> {
  // Create store
  const store = createTUIStore();
  setGlobalStore(store);

  // Load config and connect
  const config = await loadCLIConfig();
  const serverUrl = options?.serverUrl ?? config.server.url;

  if (options?.apiKey ?? config.server.apiKey) {
    process.env['GENERATORAI_API_KEY'] = options?.apiKey ?? config.server.apiKey;
  }

  try {
    store.getState().setServerStatus('connecting');
    const { client } = await createClient({ mode: 'auto', serverUrl });
    store.getState().setClient(client);
    store.getState().setServerStatus('connected');
  } catch (error) {
    store.getState().setServerStatus('disconnected');
    store.getState().setError(error instanceof Error ? error.message : 'Failed to connect');
  }

  // Render Ink app
  const { waitUntilExit } = render(React.createElement(TUIApp));
  await waitUntilExit();
}
