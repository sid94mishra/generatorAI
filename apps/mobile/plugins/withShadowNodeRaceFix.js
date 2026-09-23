'use strict';

const { withMainApplication } = require('expo/config-plugins');

const marker = '// GeneratorAI: retain the Fabric root during legacy tag lookup.';

function applyShadowNodeRaceFix(source) {
  if (source.includes(marker)) return source;
  const anchor = '    loadReactNative(this)';
  if (!source.includes(anchor)) throw new Error('Shadow-node fix requires the Expo Kotlin loadReactNative entry point.');
  return source.replace(anchor, `${anchor}
    ${marker}
    // RN 0.86.2 includes this upstream fix but leaves it disabled. Apply it
    // before any ReactHost/runtime exists, retaining every release-level default.
    val defaultFlags = when (DefaultNewArchitectureEntryPoint.releaseLevel) {
      ReleaseLevel.EXPERIMENTAL -> com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Experimental_Android()
      ReleaseLevel.CANARY -> com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Canary_Android()
      else -> com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android()
    }
    com.facebook.react.internal.featureflags.ReactNativeFeatureFlags.dangerouslyForceOverride(
      object : com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider by defaultFlags {
        override fun fixFindShadowNodeByTagRaceCondition(): Boolean = true
      }
    )
    check(com.facebook.react.internal.featureflags.ReactNativeFeatureFlags.fixFindShadowNodeByTagRaceCondition())
    android.util.Log.i("GeneratorAI", "Fabric root-retention fix enabled before ReactHost startup")`);
}

module.exports = function withShadowNodeRaceFix(config) {
  return withMainApplication(config, (mod) => {
    if (mod.modResults.language !== 'kt') throw new Error('Shadow-node fix requires Kotlin MainApplication.');
    mod.modResults.contents = applyShadowNodeRaceFix(mod.modResults.contents);
    return mod;
  });
};
module.exports.applyShadowNodeRaceFix = applyShadowNodeRaceFix;
