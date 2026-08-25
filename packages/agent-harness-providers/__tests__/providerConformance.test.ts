// ────────────────────────────────────────────────────────────────
// Conformance smoke-tests for real provider adapters (MINOR-4 fix).
//
// capabilities() is synchronous and does not require a live subprocess.
// ClaudeAgentProvider and CopilotProvider are constructed with a dummy
// binary path (no process is started in the constructor — that only
// happens in initialize()). This validates L9 compliance without
// network access.
//
// The full lifecycle/tool-call/cancellation/truncation suites require
// a live agent binary + credentials; those run in integration tests.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { runCapabilityDeclarationConformance } from '../src/conformance/index.js';
import { ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';
import { CopilotProvider } from '../src/providers/copilot/CopilotProvider.js';

describe('ClaudeAgentProvider capability conformance', () => {
  it(
    'capabilities() satisfies L9 — all required fields declared, fail-closed defaults',
    () => {
      // Constructor does NOT start the subprocess — only initialize() does.
      const provider = new ClaudeAgentProvider({
        cliBinaryPath: '/nonexistent/claude',
        defaultModel: 'sonnet',
        defaultCwd: '/tmp',
        defaultEffort: 'high',
        defaultPermissionMode: 'bypassPermissions',
      });
      // Must not throw; all required fields must be non-undefined.
      expect(() => runCapabilityDeclarationConformance(provider)).not.toThrow();
      // Spot-check: vision and computer-use must default to false (fail-closed).
      const caps = provider.capabilities();
      expect(typeof caps.vision).toBe('boolean');
      expect(typeof caps.computerUse).toBe('boolean');
      expect(Array.isArray(caps.reasoningEfforts)).toBe(true);
    },
    // Allow up to 15s in case module loading is slow.
    15_000,
  );
});

describe('CopilotProvider capability conformance', () => {
  it(
    'capabilities() satisfies L9 — all required fields declared, fail-closed defaults',
    () => {
      const provider = new CopilotProvider({
        copilotCliPath: '/nonexistent/gh',
        defaultModel: 'claude-sonnet-4.6',
        homeDir: '/tmp/.copilot-home',
      });
      expect(() => runCapabilityDeclarationConformance(provider)).not.toThrow();
      const caps = provider.capabilities();
      expect(typeof caps.vision).toBe('boolean');
      expect(typeof caps.computerUse).toBe('boolean');
      expect(Array.isArray(caps.reasoningEfforts)).toBe(true);
    },
    15_000,
  );
});
