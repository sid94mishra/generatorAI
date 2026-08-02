import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Only the platform-agnostic logic is unit-tested here: transport planning,
// scope labels, theme resolution. Screens need a device (or Maestro) and are
// covered by the E2E suite instead — a jsdom shim for React Native renders
// something that resembles the app without behaving like it, which is worse
// than no coverage because it passes when the real thing is broken.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
