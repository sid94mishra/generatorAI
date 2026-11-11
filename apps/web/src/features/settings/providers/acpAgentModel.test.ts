import { describe, expect, it } from 'vitest';
import type { AcpAgentInfo, AcpAgentsResponse } from '@generatorai/shared';
import { agentBadges, filterAcpAgents, installProgressLabel, runtimeBadge, splitArgs } from './acpAgentModel.js';

const agent = (patch: Partial<AcpAgentInfo> = {}): AcpAgentInfo => ({
  id: 'gemini',
  name: 'Gemini CLI',
  description: 'Google’s agent',
  version: '1.2.0',
  custom: false,
  distribution: { offered: ['npx'], selected: 'npx', package: '@google/gemini-cli@1.2.0' },
  installed: null,
  updateAvailable: false,
  enabled: false,
  env: [],
  ...patch,
});
const node: AcpAgentsResponse['node'] = { available: true, version: '22.0.0' };
const labels = (a: AcpAgentInfo, n = node) => agentBadges(a, n).map((b) => b.label);

describe('agentBadges', () => {
  it('installed, update, unverified, native provider', () => {
    expect(
      labels(agent({ installed: { version: '1.1.0', kind: 'binary', installedAt: 1, unverified: true }, updateAvailable: true, nativeProvider: 'codex' })),
    ).toEqual(['Installed v1.1.0', 'Update available', 'Unverified download', 'Also available as a native provider']);
    expect(labels(agent({ distribution: { offered: ['binary'], selected: 'binary', unverified: true } }))).toEqual(['Unverified download']);
  });

  it('says why an agent cannot be installed here', () => {
    const npxOnly = agent({ distribution: { offered: ['npx'], selected: null, unavailableReason: 'Needs Node.js 18' } });
    expect(labels(npxOnly, { available: false })).toEqual(['Needs Node.js']);
    const uvx = agent({ distribution: { offered: ['uvx'], selected: null, unavailableReason: 'Needs uv' } });
    const badges = agentBadges(uvx, node);
    expect(badges.map((b) => b.label)).toEqual(['Not available on this platform']);
    expect(badges[0]!.title).toBe('Needs uv');
  });

  it('the live status of an enabled agent', () => {
    const base = { connected: true, authState: 'authenticated' as const, ready: true, modelCount: 2, authMethods: [], supportsLogout: false, checkedAt: 1 };
    expect(runtimeBadge(agent({ enabled: true, status: base }))?.label).toBe('Ready');
    expect(runtimeBadge(agent({ enabled: true, status: { ...base, ready: false, authState: 'unauthenticated' } }))?.label).toBe('Not signed in');
    expect(runtimeBadge(agent({ enabled: true, status: { ...base, ready: false, connected: false, checkedAt: undefined } }))?.label).toBe('Starting…');
    expect(runtimeBadge(agent({ enabled: true, status: { ...base, ready: false, error: 'spawn ENOENT' } }))).toMatchObject({ label: 'Not working', tone: 'err' });
    expect(runtimeBadge(agent({ enabled: false, status: base }))).toBeNull();
  });
});

describe('filterAcpAgents', () => {
  it('matches name, id, description and authors', () => {
    const list = [agent(), agent({ id: 'goose', name: 'Goose', description: 'Block', authors: ['Block, Inc.'] })];
    expect(filterAcpAgents(list, 'gem').map((a) => a.id)).toEqual(['gemini']);
    expect(filterAcpAgents(list, 'block').map((a) => a.id)).toEqual(['goose']);
    expect(filterAcpAgents(list, '  ')).toHaveLength(2);
  });
});

describe('splitArgs', () => {
  it('splits on spaces and keeps quoted spaces', () => {
    expect(splitArgs('  /a/b.mjs --flag  ')).toEqual(['/a/b.mjs', '--flag']);
    expect(splitArgs(`"/My Agents/x.mjs" 'it''s' a\\ b ""`)).toEqual(['/My Agents/x.mjs', 'its', 'a b', '']);
    expect(splitArgs('')).toEqual([]);
  });
});

describe('installProgressLabel', () => {
  it('names the phase and the bytes while downloading', () => {
    expect(installProgressLabel({ phase: 'downloading', version: '1.0.0', receivedBytes: 3 * 1048576, totalBytes: 12 * 1048576 })).toBe(
      'Downloading v1.0.0 · 3.0 of 12.0 MB',
    );
    expect(installProgressLabel({ phase: 'npm', version: '1.0.0', receivedBytes: 0 })).toBe('Installing with npm v1.0.0');
  });
});
