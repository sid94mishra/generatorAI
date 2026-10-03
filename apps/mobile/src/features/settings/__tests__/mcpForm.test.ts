import { describe, expect, it } from 'vitest';
import { EMPTY_MCP_DRAFT, hasErrors, mcpBody, mcpDraftDirty, missingSetup, setupBody, setupFields, setupProgress, splitArgs, transportLabel, validateMcpDraft } from '../model/mcpForm';

describe('MCP add form (MSetMcpAdd)', () => {
  it('splits arguments, keeping quoted spaces', () => {
    expect(splitArgs('-y @modelcontextprotocol/server-filesystem "/a b" \'c d\'')).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/a b', 'c d']);
    expect(splitArgs('   ')).toEqual([]);
  });

  it('validates per transport', () => {
    expect(validateMcpDraft(EMPTY_MCP_DRAFT)).toEqual({ name: 'Name the server', command: 'Enter the command that starts the server' });
    const http = { ...EMPTY_MCP_DRAFT, name: 'docs', transport: 'http' as const, url: 'ftp://x' };
    expect(validateMcpDraft(http).url).toBe('Use an http:// or https:// URL');
    expect(validateMcpDraft({ ...http, url: 'https://x.dev/mcp' })).toEqual({});
    expect(validateMcpDraft({ ...http, url: 'https://x', pairs: [{ key: 'A B', value: '1' }] }).pairs).toMatch(/spaces/);
    expect(validateMcpDraft({ ...http, url: 'https://x', pairs: [{ key: 'A', value: '1' }, { key: 'A', value: '2' }] }).pairs).toMatch(/once/);
    expect(validateMcpDraft({ ...http, url: 'https://x', timeout: '0' }).timeout).toBeDefined();
    expect(hasErrors({})).toBe(false);
  });

  it('builds the shared body: env for Local, headers for HTTP / SSE, timeout in ms', () => {
    expect(mcpBody({ ...EMPTY_MCP_DRAFT, name: ' docs ', command: 'npx', args: '-y pkg', pairs: [{ key: 'TOKEN', value: 's' }, { key: '', value: '' }], timeout: '30' })).toEqual({
      name: 'docs',
      serverType: 'stdio',
      enabled: true,
      timeoutMs: 30_000,
      command: 'npx',
      args: ['-y', 'pkg'],
      env: { TOKEN: 's' },
    });
    expect(mcpBody({ ...EMPTY_MCP_DRAFT, name: 'docs', transport: 'sse', url: 'https://x', pairs: [{ key: 'Authorization', value: 'Bearer t' }] })).toEqual({
      name: 'docs',
      serverType: 'sse',
      enabled: true,
      url: 'https://x',
      headers: { Authorization: 'Bearer t' },
    });
    expect(mcpDraftDirty(EMPTY_MCP_DRAFT)).toBe(false);
    expect(mcpDraftDirty({ ...EMPTY_MCP_DRAFT, name: 'x' })).toBe(true);
  });
});

describe('bundled server setup (MSetMcp)', () => {
  const slack = {
    id: 'slack',
    name: 'Slack',
    source: 'system',
    serverType: 'stdio' as const,
    inputs: [{ key: 'team', label: 'Team id', required: false }],
    inputValues: { team: 'T1' },
    credentials: { env: [{ name: 'SLACK_BOT_TOKEN', label: 'Bot token' }] },
    needsConfiguration: { missingInputs: [], missingCredentials: ['SLACK_BOT_TOKEN'] },
  };

  it('lists inputs then secrets and counts required ones', () => {
    const fields = setupFields(slack);
    expect(fields.map((f) => [f.id, f.secret, f.required, f.initial])).toEqual([
      ['input:team', false, false, 'T1'],
      ['env:SLACK_BOT_TOKEN', true, true, ''],
    ]);
    const missing = missingSetup(slack);
    expect(setupProgress(fields, {}, missing)).toEqual({ filled: 0, required: 1 });
    expect(setupProgress(fields, { 'env:SLACK_BOT_TOKEN': 'xoxb' }, missing)).toEqual({ filled: 1, required: 1 });
  });

  it('sends only what was typed (an empty secret keeps the stored one)', () => {
    const fields = setupFields(slack);
    expect(setupBody(fields, { 'env:SLACK_BOT_TOKEN': 'xoxb', 'input:team': ' T2 ' }, true)).toEqual({ enabled: true, inputs: { team: 'T2' }, env: { SLACK_BOT_TOKEN: 'xoxb' } });
    expect(setupBody(fields, { 'env:SLACK_BOT_TOKEN': '' }, false)).toEqual({});
    expect(transportLabel(slack)).toBe('STDIO');
    expect(transportLabel({ name: 'x', url: 'https://x' })).toBe('HTTP');
  });
});
