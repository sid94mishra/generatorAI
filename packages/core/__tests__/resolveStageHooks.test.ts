// ────────────────────────────────────────────────────────────────
// resolveStageHooks unit tests
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { resolveStageHooks } from '../src/services/resolveStageHooks.js';
import type { HookDefinition, HooksFileConfig } from '@generatorai/shared';

const makeHook = (id: string, priority: number, phase = 'pre_prompt' as const): HookDefinition => ({
  id,
  name: `hook-${id}`,
  phase,
  type: 'function',
  priority,
  enabled: true,
  failurePolicy: 'skip',
  timeoutMs: 10_000,
  retries: 0,
  config: { type: 'function', handlerName: `handler-${id}` },
});

describe('resolveStageHooks', () => {
  it('returns empty array when no hooks from any source', () => {
    const result = resolveStageHooks(undefined, 'myStage', undefined);
    expect(result).toEqual([]);
  });

  it('returns stage hooks when only direct stage hooks provided', () => {
    const hooks = [makeHook('h1', 10), makeHook('h2', 5)];
    const result = resolveStageHooks(hooks, 'myStage', undefined);
    expect(result).toHaveLength(2);
    // Should be sorted by priority (ascending)
    expect(result[0]!.id).toBe('h2');
    expect(result[1]!.id).toBe('h1');
  });

  it('merges wildcard hooks from hooksFile when no direct stage hooks', () => {
    const hooksFile: HooksFileConfig = {
      version: 1,
      workflow: [],
      stages: {
        '*': [makeHook('w1', 5), makeHook('w2', 10)],
      },
    };
    const result = resolveStageHooks(undefined, 'myStage', hooksFile);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('w1');
    expect(result[1]!.id).toBe('w2');
  });

  it('merges stage-specific hooks from hooksFile', () => {
    const hooksFile: HooksFileConfig = {
      version: 1,
      workflow: [],
      stages: {
        'myStage': [makeHook('s1', 5)],
        '*': [makeHook('w1', 10)],
      },
    };
    const result = resolveStageHooks(undefined, 'myStage', hooksFile);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('s1'); // named stage first (lower priority)
    expect(result[1]!.id).toBe('w1'); // wildcard
  });

  it('deduplicates by id — direct hooks win over named stage hooks', () => {
    const directHooks = [makeHook('shared-id', 10)];
    const hooksFile: HooksFileConfig = {
      version: 1,
      workflow: [],
      stages: {
        'myStage': [makeHook('shared-id', 5)],
        '*': [makeHook('shared-id', 1)],
      },
    };
    const result = resolveStageHooks(directHooks, 'myStage', hooksFile);
    // Should only appear once (from directHooks, priority 10)
    expect(result).toHaveLength(1);
    expect(result[0]!.priority).toBe(10);
  });

  it('deduplicates by id — named stage hooks win over wildcard', () => {
    const hooksFile: HooksFileConfig = {
      version: 1,
      workflow: [],
      stages: {
        'myStage': [makeHook('shared-id', 5)],
        '*': [makeHook('shared-id', 1)],
      },
    };
    const result = resolveStageHooks(undefined, 'myStage', hooksFile);
    expect(result).toHaveLength(1);
    expect(result[0]!.priority).toBe(5); // from named, not wildcard
  });

  it('merges all three sources with unique ids', () => {
    const directHooks = [makeHook('d1', 30)];
    const hooksFile: HooksFileConfig = {
      version: 1,
      workflow: [],
      stages: {
        'myStage': [makeHook('n1', 20)],
        '*': [makeHook('w1', 10)],
      },
    };
    const result = resolveStageHooks(directHooks, 'myStage', hooksFile);
    expect(result).toHaveLength(3);
    // Sorted by priority: w1(10) → n1(20) → d1(30)
    expect(result[0]!.id).toBe('w1');
    expect(result[1]!.id).toBe('n1');
    expect(result[2]!.id).toBe('d1');
  });

  it('handles stage with no matching named entry in hooksFile', () => {
    const hooksFile: HooksFileConfig = {
      version: 1,
      workflow: [],
      stages: {
        'otherStage': [makeHook('o1', 5)],
        '*': [makeHook('w1', 10)],
      },
    };
    const result = resolveStageHooks(undefined, 'myStage', hooksFile);
    // Only wildcard applies
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('w1');
  });

  it('handles hooksFile with empty stages record', () => {
    const hooksFile: HooksFileConfig = {
      version: 1,
      workflow: [],
      stages: {},
    };
    const result = resolveStageHooks(undefined, 'myStage', hooksFile);
    expect(result).toEqual([]);
  });
});
