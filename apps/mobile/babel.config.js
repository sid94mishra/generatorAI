module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: [
      // Reanimated's plugin MUST be last — it rewrites worklets and expects
      // every other transform to have already run.
      'react-native-reanimated/plugin',
    ],
  };
};
