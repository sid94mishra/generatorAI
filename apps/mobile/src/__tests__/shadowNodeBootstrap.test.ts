import { describe, expect, it } from 'vitest';
import { applyShadowNodeRaceFix } from '../../plugins/withShadowNodeRaceFix.js';

const template = `  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }`;

describe('native root-retention bootstrap', () => {
  it('applies once across repeated Expo prebuilds', () => {
    const first = applyShadowNodeRaceFix(template);
    expect(applyShadowNodeRaceFix(first)).toBe(first);
    expect(first.indexOf('dangerouslyForceOverride')).toBeGreaterThan(first.indexOf('loadReactNative(this)'));
    expect(first.indexOf('dangerouslyForceOverride')).toBeLessThan(first.indexOf('ApplicationLifecycleDispatcher'));
  });

  it('delegates other flags to the configured release-level provider', () => {
    const result = applyShadowNodeRaceFix(template);
    expect(result).toContain('ReactNativeFeatureFlagsProvider by defaultFlags');
    expect(result).toContain('ReleaseLevel.EXPERIMENTAL');
    expect(result).toContain('ReleaseLevel.CANARY');
    expect(result).toContain('ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android()');
    expect(result).toContain('override fun fixFindShadowNodeByTagRaceCondition(): Boolean = true');
  });

  it('requires review when the native entry-point template changes', () => {
    expect(() => applyShadowNodeRaceFix('class MainApplication {}')).toThrow(/entry point/);
  });
});
