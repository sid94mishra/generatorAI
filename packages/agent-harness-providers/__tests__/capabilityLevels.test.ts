// P02 (RV-6, RV-9) — each provider declares the capability levels the
// session composer plans with. The composer decides by provider id before a
// conversation exists (`PROVIDER_CAPABILITY_LEVELS` in core); this table test
// keeps every provider's own declaration in step with it.

import { describe, expect, it } from 'vitest';
import { PROVIDER_CAPABILITY_LEVELS, type IAgentHarness } from '@generatorai/core';
import { ClaudeAgentProvider } from '../src/providers/claude-agent/ClaudeAgentProvider.js';
import { CopilotProvider } from '../src/providers/copilot/CopilotProvider.js';
import { CodexProvider } from '../src/providers/codex/CodexProvider.js';
import { OpenCodeProvider } from '../src/providers/opencode/OpenCodeProvider.js';
import { AcpProvider } from '../src/providers/acp/AcpProvider.js';

const providers: Array<[keyof typeof PROVIDER_CAPABILITY_LEVELS, () => IAgentHarness]> = [
  ['claude-agent', () => new ClaudeAgentProvider({ cliPath: '/nonexistent/claude' } as ConstructorParameters<typeof ClaudeAgentProvider>[0])],
  ['copilot', () => new CopilotProvider({ verbose: false } as ConstructorParameters<typeof CopilotProvider>[0])],
  ['codex', () => new CodexProvider({ binaryPath: '/nonexistent/codex' } as ConstructorParameters<typeof CodexProvider>[0])],
  ['opencode', () => new OpenCodeProvider({ baseUrl: 'http://127.0.0.1:1' } as ConstructorParameters<typeof OpenCodeProvider>[0])],
  ['acp', () => new AcpProvider({ command: 'nonexistent-acp' } as ConstructorParameters<typeof AcpProvider>[0])],
];

describe('provider capability levels match the composer table', () => {
  it.each(providers)('%s', (id, make) => {
    const caps = make().capabilities();
    expect({
      approvalGating: caps.approvalGating,
      hostTools: caps.hostTools,
      structuredOutput: caps.structuredOutput,
      skills: caps.skills,
    }).toEqual(PROVIDER_CAPABILITY_LEVELS[id]);
  });
});
