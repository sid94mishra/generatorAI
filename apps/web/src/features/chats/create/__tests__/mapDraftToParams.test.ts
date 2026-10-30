import { describe, expect, it } from 'vitest';
import { EMPTY_CREATE_CHAT_DRAFT, type CreateChatDraft } from '@generatorai/shared/ui-contract';
import { draftFromCodebase, type DraftSource } from '@/blocks/sources/model.js';
import {
  browserSettingsToConfig,
  buildCreateChatParams,
  chatCreateBlockingReason,
  chatCreateDisplayName,
  chatCreateFirstMessage,
} from '../mapDraftToParams.js';

function draft(overrides: Partial<CreateChatDraft> = {}): CreateChatDraft {
  return { ...EMPTY_CREATE_CHAT_DRAFT, ...overrides };
}

function codebaseSource(overrides: Partial<DraftSource> = {}): DraftSource {
  const base = draftFromCodebase({ id: 'cb-1', alias: 'payments-api', type: 'git' }, []);
  return { ...base, ...overrides };
}

describe('chatCreateBlockingReason', () => {
  it('blocks a chat with neither a name nor a first message, worded for the caller', () => {
    expect(chatCreateBlockingReason({ draft: draft(), sourceDrafts: [] }, 'start')).toBe('Name the chat to start it');
    expect(chatCreateBlockingReason({ draft: draft({ name: '   ' }), sourceDrafts: [] }, 'create')).toBe(
      'Name the chat to create it',
    );
  });

  it('a name alone is enough — the first message is optional', () => {
    expect(chatCreateBlockingReason({ draft: draft({ name: 'Login bug' }), sourceDrafts: [] }, 'start')).toBeNull();
    expect(chatCreateFirstMessage(draft({ name: 'Login bug', prompt: '  ' }))).toBeUndefined();
  });

  it('a first message alone also names the chat', () => {
    expect(
      chatCreateBlockingReason({ draft: draft({ prompt: 'Fix the flaky test' }), sourceDrafts: [] }, 'start'),
    ).toBeNull();
    expect(chatCreateFirstMessage(draft({ prompt: 'Fix the flaky test' }))).toBe('Fix the flaky test');
  });

  it('surfaces a source-list error even with a task filled in', () => {
    const bad = codebaseSource({ alias: '' });
    expect(
      chatCreateBlockingReason({ draft: draft({ prompt: 'Fix it' }), sourceDrafts: [bad] }, 'start'),
    ).toBe('Every source needs a name.');
  });
});

describe('browserSettingsToConfig', () => {
  it('omits the config for an unset draft and for the default shape (never a no-op payload)', () => {
    expect(browserSettingsToConfig(undefined)).toBeUndefined();
    expect(browserSettingsToConfig({ visibility: 'headless' })).toBeUndefined();
    expect(
      browserSettingsToConfig({ visibility: 'headless', evalAllowed: false, allowedHostsCsv: '  ' }),
    ).toBeUndefined();
  });

  it('carries visibility, evalAllowed and parsed hosts when they differ from the default', () => {
    expect(browserSettingsToConfig({ visibility: 'visible' })).toEqual({ enabled: true, visibility: 'visible' });
    expect(browserSettingsToConfig({ visibility: 'headless', evalAllowed: true })).toEqual({
      enabled: true,
      visibility: 'headless',
      evalAllowed: true,
    });
    expect(
      browserSettingsToConfig({ visibility: 'off', allowedHostsCsv: 'a.dev, b.dev  c.dev' }),
    ).toEqual({ enabled: true, visibility: 'off', allowedHosts: ['a.dev', 'b.dev', 'c.dev'] });
  });
});

describe('chatCreateDisplayName', () => {
  it('prefers an explicit name, trimmed', () => {
    expect(chatCreateDisplayName({ name: '  Fix checkout  ', prompt: 'irrelevant' })).toBe('Fix checkout');
  });

  it('falls back to the task, truncated to one line', () => {
    expect(chatCreateDisplayName({ name: '', prompt: 'Fix the flaky checkout test\nSecond line' })).toBe(
      'Fix the flaky checkout test',
    );
  });

  it('is empty when both are empty', () => {
    expect(chatCreateDisplayName({ name: '', prompt: '   ' })).toBe('');
  });
});

describe('buildCreateChatParams', () => {
  it('names the chat from the task when Name is left empty, and sends no sources/primary/agent for a bare model draft', () => {
    const params = buildCreateChatParams({
      draft: draft({ prompt: 'Fix the flaky checkout test' }),
      sourceDrafts: [],
    });
    expect(params).toEqual({ name: 'Fix the flaky checkout test' });
  });

  it('defaults primary to the first source and includes the mapped source list', () => {
    const source = codebaseSource();
    const params = buildCreateChatParams({
      draft: draft({ prompt: 'Fix it', name: 'Fix checkout' }),
      sourceDrafts: [source],
    });
    expect(params.primary).toBe(source.alias);
    expect(params.sources).toHaveLength(1);
    expect(params.sources?.[0]).toMatchObject({ kind: 'codebase', codebaseId: 'cb-1', alias: source.alias });
  });

  it('respects an explicit primaryAlias over the first source', () => {
    const first = codebaseSource();
    const second = codebaseSource({ key: 'cb:2', codebaseId: 'cb-2', alias: 'checkout-web' });
    const params = buildCreateChatParams({
      draft: draft({ prompt: 'Fix it', name: 'Fix checkout', primaryAlias: 'checkout-web' }),
      sourceDrafts: [first, second],
    });
    expect(params.primary).toBe('checkout-web');
  });

  it('never sends agentRef for a bare-model draft, even with a stale value', () => {
    const params = buildCreateChatParams({
      draft: draft({ prompt: 'Fix it', who: 'model', agentRef: 'project:bug-fixer' }),
      sourceDrafts: [],
    });
    expect(params.agentRef).toBeUndefined();
  });

  it('sends agentRef for an agent or orchestrator draft', () => {
    const agentParams = buildCreateChatParams({
      draft: draft({ prompt: 'Fix it', who: 'agent', agentRef: 'project:bug-fixer' }),
      sourceDrafts: [],
    });
    expect(agentParams.agentRef).toBe('project:bug-fixer');

    const orchestratorParams = buildCreateChatParams({
      draft: draft({ prompt: 'Fix it', who: 'orchestrator', agentRef: 'global:orchestrator', orchestratorMode: true }),
      sourceDrafts: [],
    });
    expect(orchestratorParams.agentRef).toBe('global:orchestrator');
    expect(orchestratorParams.orchestratorMode).toBe(true);
  });

  it('includes description, tags, projectId and browserConfig only when set', () => {
    const params = buildCreateChatParams({
      draft: draft({
        prompt: 'Fix it',
        description: '  Flaky test in CI  ',
        tags: ['checkout', 'flaky-test'],
        projectId: 'proj-1',
        browser: { visibility: 'visible' },
      }),
      sourceDrafts: [],
    });
    expect(params.description).toBe('Flaky test in CI');
    expect(params.tags).toEqual(['checkout', 'flaky-test']);
    expect(params.projectId).toBe('proj-1');
    expect(params.browserConfig).toEqual({ enabled: true, visibility: 'visible' });
  });

  it('omits orchestratorMode entirely when off, rather than sending false', () => {
    const params = buildCreateChatParams({ draft: draft({ prompt: 'Fix it' }), sourceDrafts: [] });
    expect('orchestratorMode' in params).toBe(false);
  });
});

describe('buildCreateChatParams — effort and context tier', () => {
  it('sends the chosen effort and context tier in the harness config', () => {
    const params = buildCreateChatParams({
      draft: draft({ prompt: 'Plan it', model: 'opus', reasoningEffort: 'high', contextTier: 'long_context' }),
      sourceDrafts: [],
    });
    expect(params.harnessConfig).toEqual({ reasoningEffort: 'high', contextTier: 'long_context' });
  });

  it('sends no harness config when neither is set', () => {
    expect(buildCreateChatParams({ draft: draft({ prompt: 'x' }), sourceDrafts: [] }).harnessConfig).toBeUndefined();
  });
});
