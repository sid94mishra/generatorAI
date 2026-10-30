module.exports = {
  maxWorkers: 1,
  projects: ['ios', 'android'].map((platform) => ({
    displayName: platform,
    resolver: '<rootDir>/scripts/jest-resolver.cjs',
    preset: `jest-expo/${platform}`,
    testMatch: ['<rootDir>/src/{ui,blocks}/**/*.test.tsx'],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    // lucide 1.x resolves to `.mjs` under the react-native condition; Jest loads its CommonJS build.
    moduleNameMapper: { '^lucide-react-native/icons/(.*)$': '<rootDir>/node_modules/lucide-react-native/dist/cjs/icons/$1.js' },
    transformIgnorePatterns: [
      'node_modules/(?!(\\.pnpm|((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@generatorai/.*|@testing-library/.*|test-renderer|uniwind|@lodev09/.*|@legendapp/.*|lucide-react-native|standard-navigation))',
    ],
  })),
};
