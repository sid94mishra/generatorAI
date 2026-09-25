// The spec package depends only on zod, so it restates a few enums the rest
// of the monorepo also defines. This test keeps them identical.
import {
  AGENT_MODES as SHARED_AGENT_MODES,
  BrowserConfigSchema as SharedBrowserConfigSchema,
  HARNESS_PROVIDER_IDS as SHARED_PROVIDERS,
  REASONING_EFFORTS as SHARED_EFFORTS,
} from '@generatorai/shared';
import { describe, expect, it } from 'vitest';
import { AGENT_MODES, BrowserConfigSchema, HARNESS_PROVIDER_IDS, REASONING_EFFORTS } from '../src/index.js';

describe('enums shared with @generatorai/shared', () => {
  it('provider ids', () => expect([...HARNESS_PROVIDER_IDS]).toEqual([...SHARED_PROVIDERS]));
  it('reasoning efforts', () => expect([...REASONING_EFFORTS]).toEqual([...SHARED_EFFORTS]));
  it('agent modes', () => expect([...AGENT_MODES]).toEqual([...SHARED_AGENT_MODES]));
  it('browser config fields', () =>
    expect(Object.keys(BrowserConfigSchema.shape).sort()).toEqual(Object.keys(SharedBrowserConfigSchema.shape).sort()));
});
