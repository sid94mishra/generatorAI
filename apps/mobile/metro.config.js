const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

// ────────────────────────────────────────────────────────────────
// Metro config for a pnpm workspace.
//
// Two things pnpm breaks that must be repaired here:
//   1. Workspace packages live outside the app root, so Metro has to be told
//      to watch the repo root or every `@generatorai/*` import 404s.
//   2. pnpm's symlinked store means the default resolver can load two copies
//      of React. `disableHierarchicalLookup` + explicit nodeModulesPaths
//      pins resolution to the app and the root.
// ────────────────────────────────────────────────────────────────

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;
// Workspace packages ship TypeScript sources (`main: ./src/index.ts`), so
// Metro must resolve them from source rather than a non-existent build.
config.resolver.unstable_enablePackageExports = true;

// Route Node's `crypto` to the native JSI implementation. This is what lets
// `@generatorai/client-runtime` — written against WebCrypto — run unmodified
// on React Native, which is the whole reason mobile inherits DPoP for free.
//
// The second job here is TypeScript's NodeNext import style. Our workspace
// packages are consumed as raw `.ts` source, but their own relative imports
// are written as `./stream/index.js` because `moduleResolution: NodeNext`
// requires the *emitted* specifier. `tsc` rewrites nothing — the `.js` is
// literal — and Metro has no notion of "a `.js` specifier that means `.ts`",
// so it looks for a file that never exists on disk. Node's own ESM loader has
// the same blind spot; only the TS toolchain understands the mapping.
//
// Rather than rewrite every specifier (which would break `tsc` and the web
// build), retry a failed `.js` resolution with the extension stripped so
// Metro's normal `sourceExts` scan finds the `.ts`/`.tsx` file.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'crypto') {
    return context.resolveRequest(context, 'react-native-quick-crypto', platform);
  }

  const resolve = originalResolveRequest ?? context.resolveRequest;

  // Only relative specifiers can be workspace-internal TS source. Bare
  // specifiers are real packages and must keep their normal resolution.
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      return resolve(context, moduleName, platform);
    } catch {
      return resolve(context, moduleName.slice(0, -'.js'.length), platform);
    }
  }

  try {
    return resolve(context, moduleName, platform);
  } catch (error) {
    // `disableHierarchicalLookup` above pins resolution to two directories,
    // which is what stops a second copy of React being bundled. The cost is
    // that any transitive dependency pnpm did NOT hoist to the root becomes
    // invisible, even though the symlink inside the virtual store is valid —
    // expo-router's own `standard-navigation` is one such package, and it
    // fails the whole bundle rather than degrading.
    //
    // So fall back to Node's resolution FROM THE IMPORTING FILE, which does
    // follow the store symlinks. Order matters: the pinned paths are still
    // tried first, so React and friends keep resolving to the single hoisted
    // copy and this only ever rescues genuinely unhoisted packages.
    if (moduleName.startsWith('.') || moduleName.startsWith('/')) throw error;
    try {
      return {
        type: 'sourceFile',
        filePath: require.resolve(moduleName, { paths: [context.originModulePath] }),
      };
    } catch {
      throw error;
    }
  }
};

module.exports = withNativeWind(config, { input: './src/theme/global.css' });
