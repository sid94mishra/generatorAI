// ────────────────────────────────────────────────────────────────
// Settings → Source Control.
//
// The device flow is the part worth pinning: it is the only sign-in method
// with a timer in it, and getting the poll wrong is invisible (a code that
// never resolves) rather than loud. These tests drive the whole loop
// against a mocked platform — start, show the code, poll at the interval
// the SERVER asked for, stop on completion.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PlatformContext } from '@/providers/PlatformProvider.js';
import { SourceControlSection } from '@/components/settings/sections/SourceControl.js';
import type { IPlatformClient } from '@generatorai/shared';

// The model picker's catalog comes from `fetch('/api/harness/providers')`,
// not the platform client; stub it so it never reaches the network.
const harnessResponse = { providers: [], primary: 'copilot', stale: false };

function makePlatform(overrides: Record<string, unknown> = {}) {
  return {
    getSourceControlSettings: vi.fn().mockResolvedValue({
      settings: {
        accounts: [
          {
            id: 'acc-1',
            provider: 'github',
            label: 'octocat @ github.com',
            login: 'octocat',
            authMethod: 'token',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
        defaultAccountId: 'acc-1',
        generation: { provider: null, model: null },
        editor: { defaultEditor: null },
        defaultBase: null,
      },
      providers: [{ id: 'github', name: 'GitHub', loginMethods: ['device', 'token', 'gh-cli'] }],
      editors: [
        { id: 'vscode', name: 'VS Code', available: true, scheme: 'vscode' },
        { id: 'cursor', name: 'Cursor', available: false, scheme: 'cursor' },
      ],
    }),
    updateSourceControlSettings: vi.fn().mockResolvedValue({}),
    addSourceControlAccount: vi.fn().mockResolvedValue({}),
    removeSourceControlAccount: vi.fn().mockResolvedValue(undefined),
    startSourceControlDeviceLogin: vi.fn().mockResolvedValue({
      loginId: 'login-1',
      userCode: 'WXYZ-1234',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5,
    }),
    getSourceControlDeviceLogin: vi.fn().mockResolvedValue({ loginId: 'login-1', status: 'pending' }),
    ...overrides,
  };
}

function renderSection(platform: ReturnType<typeof makePlatform>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <PlatformContext.Provider value={platform as unknown as IPlatformClient}>
        <MemoryRouter>
          <SourceControlSection />
        </MemoryRouter>
      </PlatformContext.Provider>
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => harnessResponse }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Settings → Source Control', () => {
  it('lists connected accounts with their host, method and the default badge', async () => {
    renderSection(makePlatform());
    expect(await screen.findByText('octocat')).toBeInTheDocument();
    expect(screen.getByText(/github\.com · Paste a token/)).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('offers exactly the sign-in methods the server reports', async () => {
    renderSection(makePlatform());
    expect(await screen.findByTestId('scm-connect-device')).toBeInTheDocument();
    expect(screen.getByTestId('scm-connect-token')).toBeInTheDocument();
    expect(screen.getByTestId('scm-connect-gh-cli')).toBeInTheDocument();
  });

  it('hides a method the server cannot run', async () => {
    const platform = makePlatform();
    const base = await platform.getSourceControlSettings();
    platform.getSourceControlSettings.mockResolvedValue({
      ...base,
      providers: [{ id: 'github', name: 'GitHub', loginMethods: ['token'] }],
    });
    renderSection(platform);
    expect(await screen.findByTestId('scm-connect-token')).toBeInTheDocument();
    expect(screen.queryByTestId('scm-connect-device')).toBeNull();
  });

  it('names editors the server host does not have', async () => {
    renderSection(makePlatform());
    // The reason this is worth a test: a default editor that silently never
    // launches is indistinguishable from a broken button.
    const trigger = await screen.findByRole('combobox', { name: 'Default editor' });
    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    });
    expect(
      screen.getByRole('option', { name: /Cursor — not found on this machine/ }),
    ).toBeInTheDocument();
  });

  it('runs the device flow: start, show the code, poll, finish', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const platform = makePlatform();
    renderSection(platform);

    fireEvent.click(await screen.findByTestId('scm-connect-device'));
    fireEvent.click(await screen.findByTestId('scm-device-start'));

    // The user code and the link the user has to open.
    expect(await screen.findByTestId('scm-device-code')).toHaveTextContent('WXYZ-1234');
    expect(screen.getByTestId('scm-device-link')).toHaveAttribute(
      'href',
      'https://github.com/login/device',
    );
    await waitFor(() => expect(platform.getSourceControlDeviceLogin).toHaveBeenCalledTimes(1));

    // Polls again only after the interval the SERVER asked for — polling
    // faster than GitHub's `interval` earns a slow_down and restarts the clock.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await waitFor(() => expect(platform.getSourceControlDeviceLogin).toHaveBeenCalledTimes(2));

    platform.getSourceControlDeviceLogin.mockResolvedValue({
      loginId: 'login-1',
      status: 'complete',
      account: { id: 'acc-2', provider: 'github', label: 'octo2 @ github.com', authMethod: 'device', createdAt: 'x' },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    // Completion closes the panel — and stops the timer.
    await waitFor(() => expect(screen.queryByTestId('scm-device-panel')).toBeNull());
    const callsAtCompletion = platform.getSourceControlDeviceLogin.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(platform.getSourceControlDeviceLogin.mock.calls.length).toBe(callsAtCompletion);
  });

  it('stops polling and explains itself when the code expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const platform = makePlatform({
      getSourceControlDeviceLogin: vi.fn().mockResolvedValue({ loginId: 'login-1', status: 'expired' }),
    });
    renderSection(platform);

    fireEvent.click(await screen.findByTestId('scm-connect-device'));
    fireEvent.click(await screen.findByTestId('scm-device-start'));

    expect(await screen.findByText(/The code expired/)).toBeInTheDocument();
    const calls = (platform.getSourceControlDeviceLogin as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect((platform.getSourceControlDeviceLogin as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  });

  it('sends a pasted token with its optional host and label', async () => {
    const platform = makePlatform();
    renderSection(platform);

    fireEvent.click(await screen.findByTestId('scm-connect-token'));
    fireEvent.change(screen.getByLabelText('Personal access token'), {
      target: { value: 'ghp_secret' },
    });
    fireEvent.change(screen.getByLabelText(/Enterprise host/), {
      target: { value: 'https://ghe.example.com' },
    });
    fireEvent.click(screen.getByTestId('scm-token-submit'));

    await waitFor(() =>
      expect(platform.addSourceControlAccount).toHaveBeenCalledWith({
        provider: 'github',
        method: 'token',
        token: 'ghp_secret',
        host: 'https://ghe.example.com',
      }),
    );
  });

  it('sets the default account through the settings endpoint', async () => {
    const platform = makePlatform();
    const base = await platform.getSourceControlSettings();
    platform.getSourceControlSettings.mockResolvedValue({
      ...base,
      settings: {
        ...base.settings,
        accounts: [
          ...base.settings.accounts,
          { id: 'acc-2', provider: 'github', label: 'other @ github.com', login: 'other', authMethod: 'gh-cli', createdAt: 'x' },
        ],
      },
    });
    renderSection(platform);

    fireEvent.click(await screen.findByRole('button', { name: 'Set default' }));
    await waitFor(() =>
      expect(platform.updateSourceControlSettings).toHaveBeenCalledWith({ defaultAccountId: 'acc-2' }),
    );
  });
});
