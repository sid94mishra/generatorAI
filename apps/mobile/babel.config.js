module.exports = function (api) {
  api.cache(true);
  return {
    // Uniwind needs no Babel preset: className is resolved by its Metro
    // transformer and the components Metro substitutes for react-native's.
    presets: ['babel-preset-expo'],
    plugins: [
      // Reanimated's plugin MUST be last — it rewrites worklets and expects
      // every other transform to have already run.
      'react-native-reanimated/plugin',
    ],
  };
};
