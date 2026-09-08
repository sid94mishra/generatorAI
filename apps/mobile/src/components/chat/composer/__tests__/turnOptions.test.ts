import { describe, expect, it } from 'vitest';
import type { ModelInfo } from '@generatorai/client-core';

import {
  MODE_OPTIONS,
  PERMISSION_MODES,
  TIER_OPTIONS,
  effectiveEffort,
  effortOptionsFor,
  isModeOverride,
  modeLabel,
  optionsChipLabel,
  permissionLabel,
} from '../turnOptions';

const model = (over: Partial<ModelInfo>): ModelInfo =>
  ({ id: 'm', name: 'M', ...over }) as ModelInfo;

describe('option catalogues', () => {
  it('mode values match the server enum', () => {
    expect(MODE_OPTIONS.map((m) => m.value)).toEqual(['auto', 'plan']);
    expect(modeLabel('plan')).toBe('Plan first');
  });
  it('permission values are the PATCH body values', () => {
    expect(PERMISSION_MODES.map((m) => m.value)).toEqual(['default', 'acceptEdits', 'bypassPermissions']);
    expect(permissionLabel('acceptEdits')).toBe('Auto-accept edits');
    expect(permissionLabel('unknown')).toBe('unknown');
  });
  it('tier values match harnessConfig.contextTier', () => {
    expect(TIER_OPTIONS.map((t) => t.value)).toEqual(['default', 'long_context']);
  });
});

describe('effort options', () => {
  it('come from the model, in its order, with copy', () => {
    const opts = effortOptionsFor(model({ supportsReasoning: true, reasoningEfforts: ['low', 'high', 'xhigh'] }));
    expect(opts.map((o) => o.value)).toEqual(['low', 'high', 'xhigh']);
    expect(opts[0]!.title).toBe('Low');
    expect(opts[1]!.help).toMatch(/longer/);
  });
  it('are empty when the model does not reason', () => {
    expect(effortOptionsFor(model({ supportsReasoning: false, reasoningEfforts: ['low'] }))).toEqual([]);
    expect(effortOptionsFor(undefined)).toEqual([]);
  });
  it('effective effort falls back to the model default', () => {
    expect(effectiveEffort(null, model({ defaultReasoningEffort: 'medium' }))).toBe('medium');
    expect(effectiveEffort('high', model({ defaultReasoningEffort: 'medium' }))).toBe('high');
    expect(effectiveEffort(null, undefined)).toBeNull();
  });
});

describe('optionsChipLabel', () => {
  it('reads "Options" when everything is default', () => {
    expect(optionsChipLabel({ effort: null, model: undefined, permissionMode: 'default', contextTier: 'default' })).toBe('Options');
  });
  it('summarises the non-default bits', () => {
    expect(
      optionsChipLabel({
        effort: 'high',
        model: undefined,
        permissionMode: 'bypassPermissions',
        contextTier: 'long_context',
      }),
    ).toBe('High · Long ctx · Full autonomy');
  });
  it('shows the model default effort when none is set', () => {
    expect(
      optionsChipLabel({ effort: null, model: model({ defaultReasoningEffort: 'medium' }), permissionMode: 'default', contextTier: 'default' }),
    ).toBe('Medium');
  });
});

describe('isModeOverride', () => {
  it('compares against the chat default, treating null as auto', () => {
    expect(isModeOverride('plan', null)).toBe(true);
    expect(isModeOverride('auto', undefined)).toBe(false);
    expect(isModeOverride('plan', 'plan')).toBe(false);
  });
});
