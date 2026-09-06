// ────────────────────────────────────────────────────────────────
// WorkflowBuilderPage — error state + id-change reset
//
// Two bugs from the app review this covers:
//
//  1. A failed workflow load used to fall straight through to the normal
//     editor: `useWorkflowDefinition(id)` was only destructured as
//     `{ data, isLoading }`, so `error` was silently dropped and the DAG
//     canvas rendered fully editable with nothing loaded into it.
//  2. The reset effect was `if (definition) load() else if (isNew) reset()`
//     — navigating from workflow A to workflow B, when B fails to load,
//     left NEITHER branch true (`definition` is `undefined` while loading
//     AND on error, and `isNew` is false once `id` is present), so A's
//     content stayed on screen under B's URL.
//
// `DAGCanvas` is mocked out: it pulls in `@xyflow/react`'s canvas machinery
// (ResizeObserver-driven layout), which is irrelevant to what this page
// itself is responsible for — routing the loading/error/loaded states and
// resetting the builder store on navigation.
//
// `useBlocker` (used by the page for the unsaved-changes guard) only works
// inside a DATA router, not a plain `<MemoryRouter>` — so this test wires up
// its own `createMemoryRouter`/`RouterProvider`, and uses `router.navigate`
// to move between ids WITHOUT unmounting the page, exactly like a real
// client-side navigation between two `/workflows/:id/edit` routes.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlatformContext } from '@/providers/PlatformProvider.js';
import { ThemeProvider } from '@/providers/ThemeProvider.js';
import { MockPlatformClient } from '../helpers/MockPlatformClient.js';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore.js';
import type { WorkflowDefinitionWithStages } from '@generatorai/shared';

vi.mock('@/components/workflow/DAGCanvas.js', () => ({
  DAGCanvas: () => <div data-testid="dag-canvas" />,
}));

import { WorkflowBuilderPage } from '@/pages/WorkflowBuilderPage.js';

function makeDefinition(overrides: Partial<WorkflowDefinitionWithStages> = {}): WorkflowDefinitionWithStages {
  return {
    id: 'def-a',
    name: 'Definition A',
    description: '',
    sessionMode: 'auto',
    variables: [],
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    stages: [],
    edges: [],
    ...overrides,
  } as WorkflowDefinitionWithStages;
}

function renderBuilderRouter(platform: MockPlatformClient, initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [{ path: '/workflows/:id/edit', element: <WorkflowBuilderPage /> }],
    { initialEntries: [initialPath] },
  );
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <PlatformContext.Provider value={platform as unknown as never}>
          <RouterProvider router={router} />
        </PlatformContext.Provider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return router;
}

describe('WorkflowBuilderPage — failed load renders an error, not an editable canvas', () => {
  beforeEach(() => {
    useWorkflowBuilderStore.getState().resetBuilder();
  });

  it('shows a retry/back error view instead of the DAG canvas', async () => {
    const platform = new MockPlatformClient();
    platform.getDefinition.mockRejectedValue(new Error('boom'));

    renderBuilderRouter(platform, '/workflows/def-a/edit');

    await waitFor(() => {
      expect(screen.getByText(/failed to load this workflow/i)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /back to workflows/i })).toBeTruthy();
    // The editable canvas — and its Save button — must NOT be reachable.
    expect(screen.queryByTestId('dag-canvas')).toBeNull();
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
  });

  it('retry re-fetches the definition', async () => {
    const platform = new MockPlatformClient();
    platform.getDefinition.mockRejectedValueOnce(new Error('boom'));
    platform.getDefinition.mockResolvedValueOnce(makeDefinition());

    renderBuilderRouter(platform, '/workflows/def-a/edit');

    await waitFor(() => expect(screen.getByText(/failed to load this workflow/i)).toBeTruthy());
    await act(async () => {
      screen.getByRole('button', { name: /retry/i }).click();
    });

    await waitFor(() => expect(screen.getByTestId('dag-canvas')).toBeTruthy());
  });
});

describe('WorkflowBuilderPage — navigating between two ids resets the store', () => {
  beforeEach(() => {
    useWorkflowBuilderStore.getState().resetBuilder();
  });

  it('clears workflow A\'s content before workflow B (which fails) loads', async () => {
    const platform = new MockPlatformClient();
    platform.getDefinition.mockImplementation(async (id: string) => {
      if (id === 'def-a') return makeDefinition({ id: 'def-a', name: 'Definition A' });
      throw new Error('def-b failed to load');
    });

    const router = renderBuilderRouter(platform, '/workflows/def-a/edit');

    await waitFor(() => expect(screen.getByTestId('dag-canvas')).toBeTruthy());
    await waitFor(() => expect(useWorkflowBuilderStore.getState().name).toBe('Definition A'));
    expect(useWorkflowBuilderStore.getState().definitionId).toBe('def-a');

    await act(async () => {
      router.navigate('/workflows/def-b/edit');
    });

    // B fails, so the error view renders — A's canvas/content must not
    // remain on screen under B's URL.
    await waitFor(() => expect(screen.getByText(/failed to load this workflow/i)).toBeTruthy());
    expect(screen.queryByTestId('dag-canvas')).toBeNull();
    // The store itself was reset — not left holding A's name/id.
    expect(useWorkflowBuilderStore.getState().name).toBe('');
    expect(useWorkflowBuilderStore.getState().definitionId).toBeNull();
  });

  it('loads workflow B fresh when both A and B succeed', async () => {
    const platform = new MockPlatformClient();
    platform.getDefinition.mockImplementation(async (id: string) => {
      if (id === 'def-a') return makeDefinition({ id: 'def-a', name: 'Definition A' });
      return makeDefinition({ id: 'def-b', name: 'Definition B' });
    });

    const router = renderBuilderRouter(platform, '/workflows/def-a/edit');
    await waitFor(() => expect(useWorkflowBuilderStore.getState().name).toBe('Definition A'));

    await act(async () => {
      router.navigate('/workflows/def-b/edit');
    });

    await waitFor(() => expect(useWorkflowBuilderStore.getState().name).toBe('Definition B'));
    expect(useWorkflowBuilderStore.getState().definitionId).toBe('def-b');
  });
});
