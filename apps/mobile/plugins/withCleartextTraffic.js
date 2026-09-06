// Expo config plugin: allow plain `http://` on Android so a release build can
// pair with a GeneratorAI server on the same LAN (`http://<lan-ip>:<port>`).
// The "loopback / RFC1918 / .local only" restriction is enforced by
// `PairingEndpointSchema` at the application layer — see README.
'use strict';

const { withAndroidManifest } = require('expo/config-plugins');
const { setUsesCleartextTraffic } = require('./androidManifestCleartext');

module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults = setUsesCleartextTraffic(mod.modResults);
    return mod;
  });
};
