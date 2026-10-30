'use strict';

// expo-share-intent prepends its App Group to the app's entitlements without checking whether it is already there
// (app.config.ts and expo-widgets put the same `group.dev.generatorai.app` in), so the list would carry it twice.
// Listed FIRST in `plugins`: a plugin's mod registered first runs last, after every other entitlements mod.
const { withEntitlementsPlist } = require('expo/config-plugins');

const KEY = 'com.apple.security.application-groups';

function uniqueAppGroups(entitlements) {
  const groups = entitlements[KEY];
  if (Array.isArray(groups)) entitlements[KEY] = [...new Set(groups)];
  return entitlements;
}

module.exports = (config) =>
  withEntitlementsPlist(config, (cfg) => {
    cfg.modResults = uniqueAppGroups(cfg.modResults);
    return cfg;
  });
module.exports.uniqueAppGroups = uniqueAppGroups;
