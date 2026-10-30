import { describe, expect, it } from 'vitest';
import type { HarnessProviderStatus } from '@generatorai/shared';
import { providerActions, providerDescription, providerHint, providerStatus } from '../model/providerView';

const p = (over: Partial<HarnessProviderStatus>): HarnessProviderStatus => ({
  type: 'copilot',
  label: 'GitHub Copilot',
  installed: true,
  connected: true,
  authenticated: true,
  ready: true,
  modelCount: 2,
  models: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  supportsLogin: true,
  ...over,
});

describe('provider view (MSetProviders, MDF-108)', () => {
  it('states status as glyph + word', () => {
    expect(providerStatus(p({}), false)).toEqual({ label: 'Connected', health: 'ok' });
    expect(providerStatus(p({ ready: false, authenticated: false }), false)).toEqual({ label: 'Not signed in', health: 'err' });
    expect(providerStatus(p({ ready: false, installed: false }), false)).toEqual({ label: 'Not installed', health: 'idle' });
    expect(providerStatus(p({}), true).label).toBe('Checking…');
  });

  it('offers Sign in / Sign out / Make default like web', () => {
    expect(providerActions(p({ ready: false, authenticated: false }), false)).toEqual({ signIn: true, signOut: false, makeDefault: false });
    expect(providerActions(p({}), false)).toEqual({ signIn: false, signOut: true, makeDefault: true });
    expect(providerActions(p({}), true).makeDefault).toBe(false);
    expect(providerActions(p({ supportsLogin: false, ready: false, authenticated: false }), false).signIn).toBe(false);
  });

  it('explains an empty catalog', () => {
    expect(providerHint(p({}))).toBeNull();
    expect(providerHint(p({ models: [] }))).toMatch(/No models/);
    expect(providerHint(p({ ready: false, installed: false, type: 'codex' }))).toMatch(/npm i -g @openai\/codex/);
    expect(providerHint(p({ ready: false, authenticated: false }))).toMatch(/Sign in/);
    expect(providerDescription(p({ type: 'other', label: 'Other' }))).toBe('Other provider.');
  });
});
