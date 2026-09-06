import { describe, it, expect } from 'vitest';
import { mergeMcpServers } from '../mergeMcpServers.js';
import type { McpServerConfig } from '@generatorai/shared';

const http = (url: string): McpServerConfig => ({ type: 'http', url });

describe('mergeMcpServers — system ∪ project ∪ agent, chat overrides last', () => {
  it('unions all levels and lets a later level win on a name collision', () => {
    const out = mergeMcpServers({
      system: { github: http('https://system/github'), fs: http('https://system/fs') },
      project: { jira: http('https://project/jira') },
      agent: { github: http('https://agent/github') },
    });
    expect(Object.keys(out).sort()).toEqual(['fs', 'github', 'jira']);
    expect(out['github']).toEqual(http('https://agent/github'));
  });

  it('applies chat overrides LAST: they win and `enabled:false` removes a name', () => {
    const out = mergeMcpServers({
      agent: { github: http('https://agent/github'), slack: http('https://agent/slack') },
      chatOverrides: {
        github: http('https://chat/github'),
        slack: { type: 'http', url: 'https://chat/slack', enabled: false },
        extra: http('https://chat/extra'),
      },
    });
    expect(out).toEqual({ github: http('https://chat/github'), extra: http('https://chat/extra') });
  });

  // The bug this helper exists to kill: creation used only the chat's inline
  // map (dropping the agent's servers) while rebuild spread both. Both call
  // sites must now produce the same answer from the same inputs.
  it('is the same on the create path and the rebuild path (regression for the divergence)', () => {
    const agent = { github: http('https://agent/github') };
    const chat = { jira: http('https://chat/jira') };
    const createPath = mergeMcpServers({ agent, chatOverrides: chat });
    const rebuildPath = mergeMcpServers({ agent, chatOverrides: chat });
    expect(createPath).toEqual(rebuildPath);
    expect(Object.keys(createPath).sort()).toEqual(['github', 'jira']);
  });

  it('skips disabled entries at the union levels and copes with everything undefined', () => {
    expect(mergeMcpServers({})).toEqual({});
    expect(
      mergeMcpServers({ system: { off: { type: 'http', url: 'https://x', enabled: false } } }),
    ).toEqual({});
  });
});
