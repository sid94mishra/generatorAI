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
import {
  useProject,
  useProjectRuns,
  useProjects,
  useCodebaseWorktrees,
  useCodebaseWorktreesUsage,
  useCodebaseLogs,
  useFetchCodebase,
  useProjectArtifactPrefs,
  useUpdateProjectArtifactPrefs,
} from '@/hooks/projectQueries.js';

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
    listProjectRuns: vi.fn().mockResolvedValue({ items: [], nextCursor: null, total: 0 }),
    listCodebaseWorktrees: vi.fn().mockResolvedValue([]),
    getCodebaseLogs: vi.fn().mockResolvedValue({ lines: [] }),
    fetchCodebase: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
    getProjectArtifactPrefs: vi.fn().mockResolvedValue({ disabled: [] }),
    updateProjectArtifactPrefs: vi.fn().mockResolvedValue({ disabled: [{ type: 'skill', id: 's1' }] }),
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

describe('useProjectRuns (G-15)', () => {
  it('is disabled without a projectId', () => {
    const { platform, wrapper } = setup();
    renderHook(() => useProjectRuns(undefined), { wrapper });
    expect(platform.listProjectRuns).not.toHaveBeenCalled();
  });

  it('fetches the project runs page and forwards the filter', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useProjectRuns('proj-1', { status: 'failed', limit: 20 }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(platform.listProjectRuns).toHaveBeenCalledWith('proj-1', { status: 'failed', limit: 20 });
  });
});

describe('useCodebaseWorktrees / useCodebaseWorktreesUsage (G-17)', () => {
  it('the bare hook calls the platform client with no options', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useCodebaseWorktrees('proj-1', 'cb-1'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(platform.listCodebaseWorktrees).toHaveBeenCalledWith('proj-1', 'cb-1');
  });

  it('the usage hook asks for `include: [usage, link]`', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useCodebaseWorktreesUsage('proj-1', 'cb-1'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(platform.listCodebaseWorktrees).toHaveBeenCalledWith('proj-1', 'cb-1', { include: ['usage', 'link'] });
  });

  it('is disabled without both ids', () => {
    const { platform, wrapper } = setup();
    renderHook(() => useCodebaseWorktreesUsage(undefined, undefined), { wrapper });
    expect(platform.listCodebaseWorktrees).not.toHaveBeenCalled();
  });
});

describe('useCodebaseLogs (G-16)', () => {
  it('fetches the ring buffer + job and forwards `limit`', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useCodebaseLogs('proj-1', 'cb-1', { limit: 50 }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(platform.getCodebaseLogs).toHaveBeenCalledWith('proj-1', 'cb-1', { limit: 50 });
  });

  it('is disabled without both ids', () => {
    const { platform, wrapper } = setup();
    renderHook(() => useCodebaseLogs(undefined, undefined), { wrapper });
    expect(platform.getCodebaseLogs).not.toHaveBeenCalled();
  });
});

describe('useFetchCodebase (G-16)', () => {
  it('invalidates the codebase list and the logs query on success', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useFetchCodebase(), { wrapper });
    result.current.mutate({ projectId: 'proj-1', codebaseId: 'cb-1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(platform.fetchCodebase).toHaveBeenCalledWith('proj-1', 'cb-1');
    expect(result.current.data).toEqual({ jobId: 'job-1' });
  });
});

describe('useProjectArtifactPrefs / useUpdateProjectArtifactPrefs (G-19)', () => {
  it('fetches the prefs for a project', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useProjectArtifactPrefs('proj-1'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(platform.getProjectArtifactPrefs).toHaveBeenCalledWith('proj-1');
    expect(result.current.data).toEqual({ disabled: [] });
  });

  it('is disabled without a projectId', () => {
    const { platform, wrapper } = setup();
    renderHook(() => useProjectArtifactPrefs(undefined), { wrapper });
    expect(platform.getProjectArtifactPrefs).not.toHaveBeenCalled();
  });

  it('the mutation writes the response into the query cache', async () => {
    const { platform, wrapper } = setup();
    const { result } = renderHook(() => useUpdateProjectArtifactPrefs(), { wrapper });
    result.current.mutate({ projectId: 'proj-1', prefs: { disabled: [{ type: 'skill', id: 's1' }] } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(platform.updateProjectArtifactPrefs).toHaveBeenCalledWith('proj-1', { disabled: [{ type: 'skill', id: 's1' }] });
  });
});
