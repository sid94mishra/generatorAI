// ────────────────────────────────────────────────────────────────
// automation rotate-webhook-token / show / list — the CLI must not
// reintroduce a token leak on top of the server's redaction. `show`/`list`
// are pure pass-throughs of `ctx.api.automations.get/list`, which the server
// route already redacts via `toPublicAutomation` — this locks in that the
// CLI layer does not add, log, or otherwise surface the raw value itself.
// `rotate-webhook-token` is the one command that DOES show a raw credential
// (by design, once) — this checks the shape and warning text.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from 'vitest';
import { automationCommands } from '../automation.js';
import type { CliContext } from '../../context/CliContext.js';

const AUTOMATION = {
  id: 'auto_1',
  name: 'nightly',
  triggerType: 'webhook' as const,
  // Server-redacted shape: masked, never the raw token.
  webhookToken: '••••',
};

function fakeContext(overrides: {
  list?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
  rotateWebhookToken?: ReturnType<typeof vi.fn>;
}): CliContext {
  return {
    api: {
      automations: {
        list: overrides.list ?? vi.fn(async () => [AUTOMATION]),
        get: overrides.get ?? vi.fn(async () => AUTOMATION),
        rotateWebhookToken:
          overrides.rotateWebhookToken ??
          vi.fn(async () => ({ token: 'brand-new-raw-token', signingSecret: 'brand-new-secret' })),
      },
    },
  } as unknown as CliContext;
}

const rotate = automationCommands().find((c) => c.id === 'automation.rotateWebhookToken')!;
const show = automationCommands().find((c) => c.id === 'automation.show')!;
const listCmd = automationCommands().find((c) => c.id === 'automation.list')!;

describe('automation rotate-webhook-token', () => {
  it('forwards the { token, signingSecret } shape and warns it is shown once', async () => {
    const rotateFn = vi.fn(async () => ({ token: 'raw-token-xyz', signingSecret: 'raw-secret-xyz' }));
    const ctx = fakeContext({
      list: vi.fn(async () => [AUTOMATION]),
      rotateWebhookToken: rotateFn,
    });

    const result = await rotate.handler(ctx, { args: { automation: 'auto_1' }, flags: {} } as never);

    expect(rotateFn).toHaveBeenCalledWith('auto_1');
    expect(result).toMatchObject({
      data: { token: 'raw-token-xyz', signingSecret: 'raw-secret-xyz' },
    });
    expect((result as { warnings?: string[] }).warnings?.join(' ')).toMatch(/only place|shown/i);
  });
});

describe('automation show / list — no CLI-side leak on top of server redaction', () => {
  it('show() returns exactly what the API gave it (already redacted server-side)', async () => {
    const getFn = vi.fn(async () => AUTOMATION);
    const ctx = fakeContext({ list: vi.fn(async () => [AUTOMATION]), get: getFn });

    const result = await show.handler(ctx, { args: { automation: 'auto_1' }, flags: {} } as never);

    expect(getFn).toHaveBeenCalledWith('auto_1');
    expect(JSON.stringify(result)).not.toMatch(/brand-new-raw-token|raw-token-xyz/);
    expect((result as { data: typeof AUTOMATION }).data.webhookToken).toBe('••••');
  });

  it('list() returns exactly what the API gave it (already redacted server-side)', async () => {
    const listFn = vi.fn(async () => [AUTOMATION]);
    const ctx = fakeContext({ list: listFn });

    const result = await listCmd.handler(ctx, { args: {}, flags: {} } as never);

    expect(JSON.stringify(result)).not.toMatch(/brand-new-raw-token|raw-token-xyz/);
  });
});
