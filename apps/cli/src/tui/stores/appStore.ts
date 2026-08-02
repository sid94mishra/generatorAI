// TUI App Store — global state for the terminal UI using Zustand

import { createStore } from 'zustand/vanilla';
import type { CLIPlatformClient } from '../../platform/types.js';
import type { Chat, WorkflowDefinition, WorkflowRun, PersistedEvent } from '@generatorai/shared';

export type TUIView = 'dashboard' | 'chats' | 'chat-detail' | 'workflows' | 'workflow-detail' | 'runs' | 'run-detail' | 'settings';

export interface TUIState {
  // Navigation
  currentView: TUIView;
  viewStack: TUIView[];
  selectedId: string | null;

  // Data
  chats: Chat[];
  workflows: WorkflowDefinition[];
  runs: WorkflowRun[];
  recentEvents: PersistedEvent[];
  serverStatus: 'connected' | 'disconnected' | 'connecting';

  // UI
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  showHelp: boolean;

  // Client
  client: CLIPlatformClient | null;
}

export interface TUIActions {
  // Navigation
  navigate(view: TUIView, id?: string): void;
  goBack(): void;

  // Data loading
  setClient(client: CLIPlatformClient): void;
  setChats(chats: Chat[]): void;
  setWorkflows(workflows: WorkflowDefinition[]): void;
  setRuns(runs: WorkflowRun[]): void;
  addEvent(event: PersistedEvent): void;
  setServerStatus(status: 'connected' | 'disconnected' | 'connecting'): void;

  // UI
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  setSearchQuery(query: string): void;
  toggleHelp(): void;
}

export type TUIStore = TUIState & TUIActions;

export function createTUIStore() {
  return createStore<TUIStore>((set, get) => ({
    // Initial state
    currentView: 'dashboard',
    viewStack: [],
    selectedId: null,
    chats: [],
    workflows: [],
    runs: [],
    recentEvents: [],
    serverStatus: 'connecting',
    isLoading: false,
    error: null,
    searchQuery: '',
    showHelp: false,
    client: null,

    // Actions
    navigate(view, id) {
      const current = get().currentView;
      set({
        currentView: view,
        selectedId: id ?? null,
        viewStack: [...get().viewStack, current],
        error: null,
      });
    },

    goBack() {
      const stack = get().viewStack;
      if (stack.length === 0) return;
      const prev = stack[stack.length - 1]!;
      set({
        currentView: prev,
        viewStack: stack.slice(0, -1),
        selectedId: null,
        error: null,
      });
    },

    setClient(client) { set({ client }); },
    setChats(chats) { set({ chats }); },
    setWorkflows(workflows) { set({ workflows }); },
    setRuns(runs) { set({ runs }); },
    addEvent(event) {
      const events = [event, ...get().recentEvents].slice(0, 100);
      set({ recentEvents: events });
    },
    setServerStatus(status) { set({ serverStatus: status }); },
    setLoading(loading) { set({ isLoading: loading }); },
    setError(error) { set({ error }); },
    setSearchQuery(query) { set({ searchQuery: query }); },
    toggleHelp() { set({ showHelp: !get().showHelp }); },
  }));
}

export type TUIStoreInstance = ReturnType<typeof createTUIStore>;
