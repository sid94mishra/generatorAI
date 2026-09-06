// ────────────────────────────────────────────────────────────────
// PermissionCard — review finding 5.1: a blocking tool-permission prompt
// that must actually appear and be answerable, mirroring QuestionCard.
//
// Two things pinned here:
//   1. A `chat.permission.requested` event turns into a block the card can
//      render (via the same `StreamEventRouter` → `applyStreamEffects` path
//      `sseManager` drives in production), and clicking Allow posts the
//      answer through the app's existing platform client — no second HTTP
//      path.
//   2. A `chat.permission.resolved` event settles the card in place: the
//      buttons disappear and the outcome is shown, rather than leaving it
//      pending.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { StreamEventRouter, applyStreamEffects, type StreamsRecord } from '@generatorai/client-core';

import { PermissionCard } from '@/components/chat/PermissionCard.js';
import { HttpPlatformClient } from '@/platform/HttpPlatformClient.js';
import { __setAllowUnauthenticatedForTests } from '@/platform/authRuntime.js';

__setAllowUnauthenticatedForTests(true);

afterEach(cleanup);

function jsonResponse(body: unknown, status = 202): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** Runs a raw wire event through the SAME router + reducer sseManager uses
 *  live, and returns the resulting block model. */
function applyEvent(streams: StreamsRecord, kind: string, data: Record<string, unknown>): StreamsRecord {
  const router = new StreamEventRouter();
  const effects = router.handle('s1', { kind, data });
  return applyStreamEffects(streams, effects);
}

describe('PermissionCard — chat.permission.requested renders and answers', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('the requested event produces a pending permission block with the server-sent fields', () => {
    const streams = applyEvent(
      {},
      'chat.permission.requested',
      {
        chatId: 'c1',
        interactionId: 'i1',
        toolName: 'Bash',
        type: 'shell_exec',
        description: 'Run a shell command',
        inputSummary: 'rm -rf /tmp/scratch',
        permissionMode: 'default',
      },
    );
    const block = streams['s1']?.blocks[0];
    expect(block).toMatchObject({
      type: 'permission',
      interactionId: 'i1',
      toolName: 'Bash',
      status: 'pending',
      inputSummary: 'rm -rf /tmp/scratch',
    });
  });

  it('renders the tool name, description and redacted input, and clicking Allow posts {behavior:"allow"} to the answer route', async () => {
    const streams = applyEvent(
      {},
      'chat.permission.requested',
      {
        chatId: 'c1',
        interactionId: 'i1',
        toolName: 'Bash',
        type: 'shell_exec',
        description: 'Run a shell command',
        inputSummary: 'rm -rf /tmp/scratch',
        permissionMode: 'default',
      },
    );
    const block = streams['s1']!.blocks[0] as Extract<
      (typeof streams)['s1']['blocks'][number],
      { type: 'permission' }
    >;

    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}));
    const platform = new HttpPlatformClient('');

    render(
      <PermissionCard
        permission={block}
        onAnswer={(interactionId, behavior, message) =>
          void platform.respondToChatPermission('c1', interactionId, {
            behavior,
            ...(message ? { message } : {}),
          })
        }
      />,
    );

    // Tool name, description and the (already redacted) input summary render
    // as-is — no re-processing.
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('Run a shell command')).toBeInTheDocument();
    expect(screen.getByText('rm -rf /tmp/scratch')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /allow bash/i }));

    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/chats/c1/interactions/i1/permission'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ behavior: 'allow' }),
      }),
    );
  });

  it('Deny carries an optional reason in the posted body', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}));
    const platform = new HttpPlatformClient('');

    render(
      <PermissionCard
        permission={{
          type: 'permission',
          blockId: 0,
          interactionId: 'i2',
          toolName: 'WebFetch',
          permissionType: 'network',
          description: 'Fetch a URL',
          inputSummary: 'https://example.com',
          permissionMode: 'default',
          status: 'pending',
        }}
        onAnswer={(interactionId, behavior, message) =>
          void platform.respondToChatPermission('c1', interactionId, {
            behavior,
            ...(message ? { message } : {}),
          })
        }
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /deny webfetch/i }));
    fireEvent.change(screen.getByPlaceholderText(/why deny this/i), {
      target: { value: 'looks unsafe' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm deny webfetch/i }));

    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/chats/c1/interactions/i2/permission'),
      expect.objectContaining({
        body: JSON.stringify({ behavior: 'deny', message: 'looks unsafe' }),
      }),
    );
  });
});

describe('PermissionCard — chat.permission.resolved settles it in place', () => {
  it('an allow resolution disables the buttons and shows the outcome', () => {
    let streams = applyEvent(
      {},
      'chat.permission.requested',
      {
        chatId: 'c1',
        interactionId: 'i1',
        toolName: 'Bash',
        type: 'shell_exec',
        description: 'Run a shell command',
        inputSummary: 'ls',
        permissionMode: 'default',
      },
    );
    streams = applyEvent(streams, 'chat.permission.resolved', {
      chatId: 'c1',
      interactionId: 'i1',
      behavior: 'allow',
    });
    const block = streams['s1']!.blocks[0] as Extract<
      (typeof streams)['s1']['blocks'][number],
      { type: 'permission' }
    >;
    expect(block.status).toBe('allowed');

    render(<PermissionCard permission={block} onAnswer={() => undefined} />);

    // Settled: no Allow/Deny affordance left to click.
    expect(screen.queryByRole('button', { name: /allow bash/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /deny bash/i })).toBeNull();
    expect(screen.getByTestId('permission-outcome')).toHaveTextContent(/allowed/i);
  });

  it('a deny resolution shows the denial reason and disables the buttons', () => {
    let streams = applyEvent(
      {},
      'chat.permission.requested',
      {
        chatId: 'c1',
        interactionId: 'i1',
        toolName: 'Bash',
        type: 'shell_exec',
        description: 'Run a shell command',
        inputSummary: 'ls',
        permissionMode: 'default',
      },
    );
    streams = applyEvent(streams, 'chat.permission.resolved', {
      chatId: 'c1',
      interactionId: 'i1',
      behavior: 'deny',
      message: 'not now',
    });
    const block = streams['s1']!.blocks[0] as Extract<
      (typeof streams)['s1']['blocks'][number],
      { type: 'permission' }
    >;
    expect(block.status).toBe('denied');
    expect(block.message).toBe('not now');

    render(<PermissionCard permission={block} onAnswer={() => undefined} />);

    expect(screen.queryByRole('button', { name: /allow bash/i })).toBeNull();
    expect(screen.getByTestId('permission-outcome')).toHaveTextContent(/denied.*not now/i);
  });

  it('an expired event settles a still-pending card as read-only, matching QuestionCard replay', () => {
    let streams = applyEvent(
      {},
      'chat.permission.requested',
      {
        chatId: 'c1',
        interactionId: 'i1',
        toolName: 'Bash',
        type: 'shell_exec',
        description: 'Run a shell command',
        inputSummary: 'ls',
        permissionMode: 'default',
      },
    );
    streams = applyEvent(streams, 'chat.permission.expired', {
      chatId: 'c1',
      interactionId: 'i1',
      reason: 'turn ended',
    });
    const block = streams['s1']!.blocks[0] as Extract<
      (typeof streams)['s1']['blocks'][number],
      { type: 'permission' }
    >;
    expect(block.status).toBe('expired');

    render(<PermissionCard permission={block} />);
    expect(screen.queryByRole('button', { name: /allow bash/i })).toBeNull();
    expect(screen.getByText(/no longer answerable/i)).toBeInTheDocument();
  });
});
