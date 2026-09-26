// ────────────────────────────────────────────────────────────────
// Project summary hook (G-13) — `useProjects({ includeSummary: true })`
// threads the flag to `platform.listProjects`, which appends
// `?include=summary` (HttpPlatformClient). A plain `useProjects()` call must
// not ask for it, so pickers stay on the cheap, uncached-summary path.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { IPlatformClient, Project } from '@generatorai/shared';

import { PlatformContext } from '@/providers/PlatformProvider.js';
import { useProject, useProjects } from '@/hooks/projectQueries.js';

const PROJECT: Project = {
  id: 'proj-1',
  name: 'Demo',
  settings: {},
  rootPath: '/tmp/demo',
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  summary: {
    codebases: 2,
    activeChats: 3,
    needsYou: 1,
    worktrees: { active: 1, orphaned: 0 },
    runs: 5,
  },
};

function setup() {
  const platform = {
    listProjects: vi.fn().mockResolvedValue([PROJECT]),
    getProject: vi.fn().mockResolvedValue(PROJECT),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <PlatformContext.Provider value={platform as unknown as IPlatformClient}>{children}</PlatformContext.Provider>
    </QueryClientProvider>
  );
  return { platform, wrapper };
}

describe('useProjects', () => {
  it('does not request the summary by default', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(platform.listProjects).toHaveBeenCalledWith(undefined);
  });

  it('passes includeSummary through to the platform client', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useProjects({ includeSummary: true }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(platform.listProjects).toHaveBeenCalledWith({ includeSummary: true });
    expect(result.current.data?.[0]?.summary).toEqual(PROJECT.summary);
  });
});

describe('useProject', () => {
  it('passes includeSummary through to getProject', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useProject('proj-1', { includeSummary: true }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(platform.getProject).toHaveBeenCalledWith('proj-1', { includeSummary: true });
  });
});
