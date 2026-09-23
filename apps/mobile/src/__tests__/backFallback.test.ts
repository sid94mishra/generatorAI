import { describe, expect, it } from 'vitest';
import { backFallbackFor } from '../navigation/backFallback';

describe('backFallbackFor', () => {
  it('lets back leave the app from tab roots and terminal screens', () => {
    for (const p of ['/', '/chats', '/runs', '/projects', '/pair', '/revoked', '/chats/']) {
      expect(backFallbackFor(p)).toBeNull();
    }
  });

  it('returns detail screens to the catalogue they belong to', () => {
    expect(backFallbackFor('/chats/abc')).toBe('/(tabs)/chats');
    expect(backFallbackFor('/workflows/w1')).toBe('/(tabs)/runs?segment=workflows');
    expect(backFallbackFor('/automations/a1')).toBe('/(tabs)/runs?segment=automations');
    expect(backFallbackFor('/scripts/s1')).toBe('/(tabs)/runs?segment=scripts');
    // There is no runs list: a run backs out to Workflows, where runs live.
    expect(backFallbackFor('/runs/r1')).toBe('/(tabs)/runs?segment=workflows');
    expect(backFallbackFor('/projects/p1')).toBe('/(tabs)/projects');
    expect(backFallbackFor('/approvals')).toBe('/(tabs)');
  });

  it('returns nested screens to their parent', () => {
    expect(backFallbackFor('/runs/r1/stages/s1')).toBe('/runs/r1');
    expect(backFallbackFor('/projects/p1/pull-requests')).toBe('/projects/p1');
    expect(backFallbackFor('/projects/p1/codebases/c1')).toBe('/projects/p1');
    expect(backFallbackFor('/settings/appearance')).toBe('/settings');
    expect(backFallbackFor('/settings')).toBe('/(tabs)');
  });
});
