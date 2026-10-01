module.exports = {
  maxWorkers: 1,
  projects: ['ios', 'android'].map((platform) => ({
    displayName: platform,
    resolver: '<rootDir>/scripts/jest-resolver.cjs',
    preset: `jest-expo/${platform}`,
    testMatch: ['<rootDir>/src/{ui,blocks}/**/*.test.tsx'],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    transformIgnorePatterns: [
      'node_modules/(?!(\\.pnpm|((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@generatorai/.*|@testing-library/.*|test-renderer|nativewind|react-native-css-interop|uniwind|@lodev09/.*|@legendapp/.*|lucide-react-native))',
    ],
  })),
};
