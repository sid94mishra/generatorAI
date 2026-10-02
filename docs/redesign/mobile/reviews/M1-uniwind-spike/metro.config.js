const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const themes = require('./themes.json');

const config = getDefaultConfig(__dirname);
// The design-tokens package is a symlink outside this folder (check 12).
config.watchFolders = ['/Users/sidmishra/Desktop/Projects/mobile_redesign/packages/design-tokens'];
config.resolver.unstable_enableSymlinks = true;

module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  extraThemes: themes,
  dtsFile: './uniwind-types.d.ts',
});
