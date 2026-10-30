// ────────────────────────────────────────────────────────────────
// renderChatPage — mounts the page under test at a `/chats/:id` route inside
// the app's provider tree (Theme, React Query, Platform, MemoryRouter), with a
// location probe and a navigate bridge so a test can switch chats WITHOUT
// remounting (React Router reuses ChatPage across `/chats/:id`).
//
// Kept apart from `chatPageFakes.ts` because this file imports app modules
// that the vi.mock factories must never load (see that file's header).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { act, render, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import type { IPlatformClient } from '@generatorai/shared';
import { PlatformContext } from '@/providers/PlatformProvider.js';
import { ThemeProvider } from '@/providers/ThemeProvider.js';
import { MockPlatformClient } from '../../helpers/MockPlatformClient.js';
import { CHAT_ID } from './chatPageFakes.js';

// ── Render ──────────────────────────────────────────────────────

let currentPath = '';
function LocationProbe() {
  const loc = useLocation();
  currentPath = loc.pathname;
  return <div data-testid="location-probe" data-path={loc.pathname} />;
}

/** The pathname the MemoryRouter is on right now. */
export function currentLocation(): string {
  return currentPath;
}

export interface RenderChatPageResult extends RenderResult {
  platform: MockPlatformClient;
  queryClient: QueryClient;
  /** Navigate the SAME mounted router to another path (React Router reuses ChatPage). */
  navigateTo: (path: string) => void;
}

let navigateRef: ((path: string) => void) | null = null;
function NavigateBridge() {
  // react-router's useNavigate, exposed so a test can switch chats without
  // remounting — exactly how the app moves between /chats/:id routes.
  const navigate = useNavigate();
  navigateRef = (path: string) => navigate(path);
  return null;
}

/**
 * Mount the page under test at `path` inside the app's provider tree.
 * `Page` is passed in so the import of the component under test stays in the
 * test file (the one line P4 changes).
 */
export function renderChatPage(Page: React.ComponentType, path = `/chats/${CHAT_ID}`): RenderChatPageResult {
  const platform = new MockPlatformClient();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const result = render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <PlatformContext.Provider value={platform as unknown as IPlatformClient}>
          <MemoryRouter initialEntries={[path]}>
            <LocationProbe />
            <NavigateBridge />
            <Routes>
              <Route path="/" element={<div>Home route</div>} />
              <Route path="/chats" element={<Page />} />
              <Route path="/chats/:id" element={<Page />} />
            </Routes>
          </MemoryRouter>
        </PlatformContext.Provider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return {
    ...result,
    platform,
    queryClient,
    navigateTo: (to: string) => act(() => navigateRef?.(to)),
  };
}
