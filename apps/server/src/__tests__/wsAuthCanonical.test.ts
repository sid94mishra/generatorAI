// D-115 (audit F-1) — a WebSocket upgrade obeys the same canonical route
// policy as REST: the stream's own scopes are widened by the policy entry for
// its path, and a non-canonical path is refused.

import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Principal, Scope } from '@generatorai/auth';
import { authorizeWebSocketUpgrade } from '../middleware/wsAuth.js';

function setup(url: string, scopes: Scope[]) {
  const principal: Principal = { type: 'paired-device', id: 'd1', displayName: 'd', scopes, transport: 'loopback' };
  const container = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    config: { port: 3100, security: { corsOrigins: [] } },
    security: {
      tls: null,
      posture: { bindHost: '127.0.0.1' },
      auth: { authenticate: vi.fn(async () => principal) },
      audit: { record: vi.fn() },
    },
  };
  const written: string[] = [];
  const socket = { write: (s: string) => written.push(s), destroy: vi.fn() } as unknown as Duplex;
  const req = {
    url,
    headers: { host: '127.0.0.1:3100' },
    socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  return { container, socket, req, written };
}

describe('authorizeWebSocketUpgrade — canonical route policy', () => {
  it('demands the policy scopes for the path even when the handler asks for fewer', async () => {
    const { container, socket, req, written } = setup('/api/workspaces/w1/terminals/t1/stream', ['write:chats']);
    const result = await authorizeWebSocketUpgrade({
      container: container as never,
      req,
      socket,
      requiredScopes: [],
      ticketScope: { scope: 'terminal', id: 't1' },
      label: 'test',
    });
    expect(result.ok).toBe(false);
    expect(written.join('')).toContain('403');
  });

  it('admits a principal that holds both the handler and the policy scopes', async () => {
    const { container, socket, req } = setup('/api/workspaces/w1/terminals/t1/stream', ['exec:terminal']);
    const result = await authorizeWebSocketUpgrade({
      container: container as never,
      req,
      socket,
      requiredScopes: ['exec:terminal'],
      ticketScope: { scope: 'terminal', id: 't1' },
      label: 'test',
    });
    expect(result.ok).toBe(true);
  });

  it.each(['/api/workspaces/w1/../w2/terminals/t1/stream', '/api//stt/stream', '/api/stt/%2E%2E/stream'])(
    'refuses a non-canonical upgrade path: %s',
    async (url) => {
      const { container, socket, req, written } = setup(url, ['exec:terminal', 'write:chats']);
      const result = await authorizeWebSocketUpgrade({
        container: container as never,
        req,
        socket,
        requiredScopes: [],
        ticketScope: { scope: 'stt', id: null },
        label: 'test',
      });
      expect(result.ok).toBe(false);
      expect(written.join('')).toContain('400');
      expect(container.security.auth.authenticate).not.toHaveBeenCalled();
    },
  );
});
