import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vitest 4 no longer excludes build output by default, and `tsc` emits the
    // compiled __tests__ into dist/ — without this every case runs twice.
    exclude: [...configDefaults.exclude, '**/dist/**'],
    globals: true,
  },
});
