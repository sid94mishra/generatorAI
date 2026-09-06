// ────────────────────────────────────────────────────────────────
// errorHandler — automation webhook token path redaction
//
// req.path on a failed `/api/automations/webhooks/:token` delivery is
// logged on EVERY error response — i.e. every real webhook delivery that
// fails — so the token segment must never reach the log verbatim.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { createErrorMiddleware, redactWebhookPath } from '../../src/middleware/errorHandler.js';
import type { Request, Response } from 'express';
import type { ILogger } from '@generatorai/shared';

function makeLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as ILogger;
}

function makeRes(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe('redactWebhookPath', () => {
  it('redacts the token segment of a webhook delivery path', () => {
    expect(redactWebhookPath('/api/automations/webhooks/abc123def456')).toBe(
      '/api/automations/webhooks/[REDACTED]',
    );
  });

  it('leaves every other path untouched', () => {
    expect(redactWebhookPath('/api/automations/auto-1')).toBe('/api/automations/auto-1');
    expect(redactWebhookPath('/api/automations')).toBe('/api/automations');
    expect(redactWebhookPath('/api/workflow-runs/r1')).toBe('/api/workflow-runs/r1');
  });
});

describe('createErrorMiddleware — webhook path redaction in logs', () => {
  it('never logs the raw token from a failed webhook delivery', () => {
    const logger = makeLogger();
    const middleware = createErrorMiddleware(logger);
    const req = {
      path: '/api/automations/webhooks/super-secret-token-value',
      method: 'POST',
      requestId: 'req-1',
    } as Request;

    middleware(new Error('boom'), req, makeRes(), vi.fn());

    expect(logger.error).toHaveBeenCalledOnce();
    const [, meta] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(meta['path']).toBe('/api/automations/webhooks/[REDACTED]');
    expect(String(meta['path'])).not.toContain('super-secret-token-value');
  });
});
