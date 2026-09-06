// Pure manifest transform, kept free of any `expo/config-plugins` import so
// it can be unit-tested without loading the Expo toolchain.
//
// Expo SDK 57 removed `android.usesCleartextTraffic` from the config type and
// `expo-build-properties` is not a dependency here, so the attribute is set
// on the generated AndroidManifest directly. See README "Android cleartext"
// for why a network-security-config allow-list is not used instead.
'use strict';

/**
 * @param {{ manifest: { application?: Array<{ $?: Record<string, string> }> } }} manifest
 * @returns the same object, with `android:usesCleartextTraffic="true"` on <application>.
 */
function setUsesCleartextTraffic(manifest) {
  const application = manifest?.manifest?.application?.[0];
  if (!application) {
    throw new Error('[withCleartextTraffic] AndroidManifest has no <application> element');
  }
  application.$ = { ...(application.$ ?? {}), 'android:usesCleartextTraffic': 'true' };
  return manifest;
}

module.exports = { setUsesCleartextTraffic };
