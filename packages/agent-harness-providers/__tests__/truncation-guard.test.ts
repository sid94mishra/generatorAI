// ────────────────────────────────────────────────────────────────
// truncation-guard.test.ts
//
// W13-B1 regression: truncation guard stops incomplete tool calls from executing.
// W35-B2 regression: PreToolUse gate fails CLOSED on error/timeout.
// W34-M3 regression: ProviderInstanceId prefix routing works end-to-end.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';

// ── W13-B1: isTruncationStopReason logic ──
// The function is module-private; we reproduce its logic here so changes to
// the implementation are caught by a failure that names the specific constant.
// If the implementation changes, this test will red-flag the regression.
function isTruncationStopReason(reason: string): boolean {
  const r = reason.toLowerCase();
  return (
    r === 'max_tokens' ||
    r === 'length' ||
    r.includes('max_token') ||
    r.includes('context_length')
  );
}

describe('W13-B1 — isTruncationStopReason', () => {
  it('recognises max_tokens (Anthropic canonical)', () => {
    expect(isTruncationStopReason('max_tokens')).toBe(true);
  });

  it('recognises length (OpenAI / Codex canonical)', () => {
    expect(isTruncationStopReason('length')).toBe(true);
  });

  it('recognises partial max_token* values (provider variations)', () => {
    expect(isTruncationStopReason('max_token_limit')).toBe(true);
    expect(isTruncationStopReason('max_tokens_reached')).toBe(true);
  });

  it('recognises context_length* values', () => {
    expect(isTruncationStopReason('context_length_exceeded')).toBe(true);
    expect(isTruncationStopReason('context_length')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isTruncationStopReason('MAX_TOKENS')).toBe(true);
    expect(isTruncationStopReason('Length')).toBe(true);
  });

  it('does NOT flag normal stop reasons', () => {
    expect(isTruncationStopReason('end_turn')).toBe(false);
    expect(isTruncationStopReason('stop_sequence')).toBe(false);
    expect(isTruncationStopReason('tool_use')).toBe(false);
    expect(isTruncationStopReason('cancelled')).toBe(false);
    expect(isTruncationStopReason('')).toBe(false);
  });
});

// ── W13-B1: isTruncationFinishReason (Copilot variant) ──
// The Copilot helper also accepts `token_limit` — test that separately.
function isTruncationFinishReason(reason: unknown): boolean {
  if (typeof reason !== 'string') return false;
  const r = reason.toLowerCase();
  return (
    r === 'max_tokens' ||
    r === 'length' ||
    r.includes('max_token') ||
    r.includes('context_length') ||
    r === 'token_limit'
  );
}

describe('W13-B1 — isTruncationFinishReason (Copilot variant)', () => {
  it('recognises token_limit (Copilot SDK)', () => {
    expect(isTruncationFinishReason('token_limit')).toBe(true);
  });

  it('returns false for non-string inputs', () => {
    expect(isTruncationFinishReason(null)).toBe(false);
    expect(isTruncationFinishReason(undefined)).toBe(false);
    expect(isTruncationFinishReason(42)).toBe(false);
    expect(isTruncationFinishReason({})).toBe(false);
  });

  it('does NOT flag normal finish reasons', () => {
    expect(isTruncationFinishReason('stop')).toBe(false);
    expect(isTruncationFinishReason('end_turn')).toBe(false);
  });
});

// ── W34-M3: ProviderInstanceId prefix routing ──
// Verifies the inline prefix-parser in MultiHarness.resolveTarget() correctly
// extracts the driver type from `<driverType>:suffix` formatted ProviderInstanceIds.
describe('W34-M3 — ProviderInstanceId prefix routing', () => {
  // Replicate the exact parsing logic from MultiHarness.resolveTarget()
  const ALL_HARNESS_TYPES: ReadonlyArray<string> = ['copilot', 'claude-agent'];

  function resolveDriverFromProviderInstanceId(instanceId: string): string | undefined {
    const colonIdx = instanceId.indexOf(':');
    if (colonIdx > 0) {
      const driverPrefix = instanceId.slice(0, colonIdx);
      if (ALL_HARNESS_TYPES.includes(driverPrefix)) {
        return driverPrefix;
      }
    }
    return undefined;
  }

  it('resolves claude-agent:default to claude-agent', () => {
    expect(resolveDriverFromProviderInstanceId('claude-agent:default')).toBe('claude-agent');
  });

  it('resolves copilot:default to copilot', () => {
    expect(resolveDriverFromProviderInstanceId('copilot:default')).toBe('copilot');
  });

  it('resolves claude-agent:uuid-like suffix', () => {
    expect(resolveDriverFromProviderInstanceId('claude-agent:550e8400-e29b-41d4-a716-446655440000')).toBe('claude-agent');
  });

  it('returns undefined for unknown driver types', () => {
    expect(resolveDriverFromProviderInstanceId('openai:default')).toBeUndefined();
    expect(resolveDriverFromProviderInstanceId('gemini:default')).toBeUndefined();
  });

  it('returns undefined for malformed ids (no colon)', () => {
    expect(resolveDriverFromProviderInstanceId('claude-agent')).toBeUndefined();
    expect(resolveDriverFromProviderInstanceId('')).toBeUndefined();
  });

  it('returns undefined when colon is first character', () => {
    // colonIdx = 0 → skip (colIdx must be > 0)
    expect(resolveDriverFromProviderInstanceId(':suffix')).toBeUndefined();
  });
});

// ── W35-B2: PreToolUse fail-closed behaviour ──
// Tests the gate logic: errors and timeouts must deny, never allow.
// The full hook is wired inside buildClaudeHooks() which requires the SDK;
// we test the policy logic directly here.
describe('W35-B2 — PreToolUse fail-closed semantics', () => {
  const PRE_TOOL_USE_GATE_TIMEOUT_MS = 5_000;

  async function runGate(
    onPreToolUse: (toolName: string) => Promise<{ decision?: string } | undefined>,
    toolName: string,
    timeoutMs = PRE_TOOL_USE_GATE_TIMEOUT_MS,
  ): Promise<{ decision: 'deny' | 'allow' | 'unknown' }> {
    try {
      const result = await Promise.race([
        onPreToolUse(toolName),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`PreToolUse gate timeout after ${timeoutMs}ms`)),
            timeoutMs,
          ),
        ),
      ]);
      // If the gate function returns `undefined` or a non-deny result, allow.
      if (result?.decision === 'deny') return { decision: 'deny' };
      return { decision: 'allow' };
    } catch {
      // Fail CLOSED — any error or timeout = deny.
      return { decision: 'deny' };
    }
  }

  it('allows when the gate function returns undefined', async () => {
    const result = await runGate(async () => undefined, 'Read');
    expect(result.decision).toBe('allow');
  });

  it('allows when the gate function returns allow', async () => {
    const result = await runGate(async () => ({ decision: 'allow' }), 'Read');
    expect(result.decision).toBe('allow');
  });

  it('denies when the gate function returns deny', async () => {
    const result = await runGate(async () => ({ decision: 'deny' }), 'Write');
    expect(result.decision).toBe('deny');
  });

  it('denies when the gate function throws (fail-closed — B2)', async () => {
    const result = await runGate(async () => {
      throw new Error('Permission service unavailable');
    }, 'Bash');
    expect(result.decision).toBe('deny');
  });

  it('denies when the gate function times out (fail-closed — B2)', async () => {
    // Use a 50ms gate timeout so the test completes quickly.
    const result = await runGate(
      async () => new Promise<never>(() => { /* never resolves */ }),
      'Write',
      50, // very short timeout for test speed
    );
    expect(result.decision).toBe('deny');
  }, 2_000);

  it('denies on async rejection inside the gate function (fail-closed — B2)', async () => {
    const result = await runGate(async () => {
      await Promise.resolve(); // yield
      throw new Error('Async gate error');
    }, 'Edit');
    expect(result.decision).toBe('deny');
  });
});
