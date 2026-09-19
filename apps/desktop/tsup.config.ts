import { defineConfig } from 'tsup';

// The Electron main and preload processes are bundled to CommonJS. Electron's
// main process is most robust as CJS, and the preload script must be CJS so it
// can use `require('electron')` synchronously before the page loads.
export default defineConfig({
  entry: {
    'main/index': 'src/main/index.ts',
    'preload/index': 'src/preload/index.ts',
    'preload/prompt': 'src/preload/prompt.ts',
  },
  outDir: 'dist',
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  shims: false,
  // Provided by the Electron runtime / resolved from node_modules at runtime.
  external: ['electron', 'electron-updater'],
});
