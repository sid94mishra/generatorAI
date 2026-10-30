// Smoke test of the builder canvas against the store: the empty prompt, the
// store's node types rendering as stage and group nodes, the Add stage
// split button, the A shortcut opening the kind palette, and Delete / undo.

import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlatformContext } from '@/providers/PlatformProvider.js';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import { BuilderCanvas } from './BuilderCanvas.js';

/** Every platform call resolves empty. */
const platform = new Proxy({}, { get: (_t, key) => (key === 'then' ? undefined : async () => []) });

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <PlatformContext.Provider value={platform as never}>
        <ReactFlowProvider>
          <div style={{ width: 1000, height: 700 }}>{node}</div>
        </ReactFlowProvider>
      </PlatformContext.Provider>
    </QueryClientProvider>,
  );
}

describe('BuilderCanvas', () => {
  beforeEach(() => {
    useWorkflowBuilderStore.getState().resetBuilder();
  });

  it('shows the empty prompt and adds the default stage from both Add buttons', () => {
    const onAddStage = vi.fn();
    wrap(<BuilderCanvas onAddStage={onAddStage} onAddedTemplate={vi.fn()} />);
    expect(screen.getByTestId('rf__wrapper')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Add first stage/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Add stage$/i }));
    expect(onAddStage).toHaveBeenCalledTimes(2);
    expect(onAddStage).toHaveBeenCalledWith();
  });

  it('renders stage and group nodes with their summaries, markers and tags', async () => {
    const store = useWorkflowBuilderStore.getState();
    const agent = store.addStage();
    const loop = store.addStage(undefined, { kind: 'loop' });
    wrap(<BuilderCanvas onAddStage={vi.fn()} onAddedTemplate={vi.fn()} nodeTags={{ [agent]: 'changed' }} />);
    await waitFor(() => expect(screen.getAllByLabelText(/^Stage: /).length).toBeGreaterThanOrEqual(2));
    expect(screen.getByLabelText(/^Loop: /)).toBeTruthy();
    expect(screen.getAllByText('0 prompts').length).toBeGreaterThan(0);
    expect(screen.getByText('Changed')).toBeTruthy();
    expect(screen.getByText(loop)).toBeTruthy();
  });

  it('opens the kind palette on A, and deletes / undoes the selected stage', async () => {
    const store = useWorkflowBuilderStore.getState();
    const key = store.addStage();
    wrap(<BuilderCanvas onAddStage={vi.fn()} onAddedTemplate={vi.fn()} />);

    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Search stage kinds' })).toBeTruthy());

    act(() => useWorkflowBuilderStore.getState().selectNode(key));
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(useWorkflowBuilderStore.getState().nodes).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(useWorkflowBuilderStore.getState().nodes.map((n) => n.id)).toEqual([key]);
  });
});
