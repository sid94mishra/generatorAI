module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: [
      // Per-icon imports for lucide: without this Metro bundles all ~1,500
      // icons (1.29 MB of source) for the ~60 the app draws. See the plugin.
      './plugins/babel-plugin-lucide-icons',
      // Reanimated's plugin MUST be last — it rewrites worklets and expects
      // every other transform to have already run.
      'react-native-reanimated/plugin',
    ],
  };
};
