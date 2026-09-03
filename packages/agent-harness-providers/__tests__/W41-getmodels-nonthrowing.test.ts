// ────────────────────────────────────────────────────────────────
// W41-getmodels-nonthrowing.test.ts
//
// `getModels()` must NEVER throw — its failure mode is `[]` (Pi `models.ts`).
// Both real providers used to let the failure escape, so a single
// misconfigured provider could fail boot: `HarnessRegistry.refresh()` probes
// every managed provider, and the catalog is built from that probe.
//
// The failure is injected by making the provider's OPTIONAL SDK unimportable.
// That makes this suite do double duty: constructing the provider, and reading
// `capabilities()` off it, must both still work with a broken SDK — which they
// only can because W41 moved the SDK behind a dynamic import. Under the old
// static `import { query } from '@anthropic-ai/claude-agent-sdk'` the module
// itself would not even load.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  throw new Error('SIMULATED: @anthropic-ai/claude-agent-sdk is not installed');
});
vi.mock('@github/copilot-sdk', () => {
  throw new Error('SIMULATED: @github/copilot-sdk is not installed');
});

const { ClaudeAgentProvider } = await import('../src/providers/claude-agent/ClaudeAgentProvider.js');
const { CopilotProvider } = await import('../src/providers/copilot/CopilotProvider.js');

describe('W41 — ClaudeAgentProvider.getModels() never throws', () => {
  const make = () =>
    new ClaudeAgentProvider({
      cliPath: '/nonexistent/claude',
      defaultCwd: '/tmp',
    } as ConstructorParameters<typeof ClaudeAgentProvider>[0]);

  it('constructs at all with an unimportable SDK (proves the import is lazy)', () => {
    expect(() => make()).not.toThrow();
  });

  it('returns an empty catalog instead of throwing', async () => {
    await expect(make().getModels()).resolves.toEqual([]);
  });

  it('records WHY the catalog is empty rather than swallowing it', async () => {
    // The exact text is the module loader's, not ours — what matters is that a
    // reason SURVIVES. Returning [] with no explanation would make a broken CLI
    // indistinguishable from an account with no model entitlements, which is
    // precisely the diagnostic the registry needs to show the user.
    const provider = make();
    expect(provider.getLastModelProbeError()).toBeUndefined();
    await provider.getModels();
    expect(typeof provider.getLastModelProbeError()).toBe('string');
    expect(provider.getLastModelProbeError()!.length).toBeGreaterThan(0);
  });

  it('still answers capabilities() with a broken SDK', () => {
    // The capability ledger is a declaration (L9) — it must not depend on the
    // SDK resolving, or a misconfigured install cannot even be described.
    expect(make().capabilities().vision).toBe(true);
  });
});

describe('W41 — CopilotProvider.getModels() never throws', () => {
  const make = () =>
    new CopilotProvider({ verbose: false } as ConstructorParameters<typeof CopilotProvider>[0]);

  it('constructs at all with an unimportable SDK (proves the client is built lazily)', () => {
    // The constructor used to call `new CopilotClient(...)`, which is exactly
    // why the SDK had to be a static import.
    expect(() => make()).not.toThrow();
  });

  it('returns an empty catalog instead of throwing', async () => {
    await expect(make().getModels()).resolves.toEqual([]);
  });

  it('records WHY the catalog is empty', async () => {
    const provider = make();
    expect(provider.getLastModelProbeError()).toBeUndefined();
    await provider.getModels();
    expect(typeof provider.getLastModelProbeError()).toBe('string');
    expect(provider.getLastModelProbeError()!.length).toBeGreaterThan(0);
  });

  it('ping() reports not-alive rather than constructing a client to ask', async () => {
    // Teardown/health paths must never build a client (that would resolve the
    // SDK and spawn a CLI for a provider nobody used).
    await expect(make().ping()).resolves.toBe(false);
  });

  it('stop() and shutdown() are safe on a provider that never started', async () => {
    const provider = make();
    await expect(provider.stop()).resolves.toBeUndefined();
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });
});
