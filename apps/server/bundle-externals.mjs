// ────────────────────────────────────────────────────────────────
// The single definition of what stays outside the server bundle.
//
// Two consumers read this, and they used to keep their own copies:
//
//   esbuild.config.mjs                     what NOT to inline
//   apps/desktop/scripts/stage-server-runtime.mjs   what to ship beside it
//
// Those lists are related but not equal, and a package added to one and
// forgotten in the other produces a bundle that builds cleanly and then dies
// at runtime on a missing import. Keeping both here makes the difference
// explicit rather than accidental.
// ────────────────────────────────────────────────────────────────

/**
 * Left out of the bundle deliberately. Everything else is inlined.
 *
 *   better-sqlite3 / node-pty  Native `.node` addons — machine code, not JS.
 *                              esbuild cannot inline them.
 *
 *   playwright / -core         Resolves its driver through package-relative
 *                              paths and ships a `bin/` directory, both of
 *                              which break when inlined.
 *
 *   @huggingface/transformers  Large, and already behind a guarded dynamic
 *                              import that degrades to "voice input
 *                              unavailable". Optional by design.
 *
 *   @trycua/cua-driver        Finds its native library through
 *                              `createRequire(callerUrl).resolve()` against a
 *                              sibling platform package. Inlined, `callerUrl`
 *                              becomes the bundle and that resolve fails — the
 *                              same breakage as playwright, but silent until
 *                              the first computer-use call.
 */
export const BUNDLE_EXTERNALS = [
  'better-sqlite3',
  'node-pty',
  'playwright',
  'playwright-core',
  '@huggingface/transformers',
  '@trycua/cua-driver',
];

/**
 * Installed next to the bundle so the packaged app can resolve them.
 *
 * Narrower than `BUNDLE_EXTERNALS` on purpose:
 *
 *   playwright-core            A dependency of `playwright`, so pnpm brings it
 *                              in; naming it again would pin two versions.
 *
 *   @huggingface/transformers  ~300 MB of ONNX runtime for a feature that is
 *                              designed to be absent. Excluding it is what
 *                              makes the guarded import worth having.
 */
export const RUNTIME_PACKAGES = ['better-sqlite3', 'node-pty', 'playwright', '@trycua/cua-driver'];

/**
 * `@trycua/cua-driver` keeps its compiled library in a per-target optional
 * dependency, so the generic `NATIVE_PACKAGES` check below cannot see it.
 *
 * pnpm resolves the optional dependency from `supportedArchitectures`, which
 * means a wrong-target stage installs cleanly and then fails to load the
 * library at runtime.
 */
export function driverPlatformPackage(platform, arch) {
  const triple =
    platform === 'win32'
      ? `win32-${arch}-msvc`
      : platform === 'darwin'
        ? `darwin-${arch}`
        : `linux-${arch}-gnu`;
  const lib =
    platform === 'win32'
      ? 'cua_driver_sdk.dll'
      : platform === 'darwin'
        ? 'libcua_driver_sdk.dylib'
        : 'libcua_driver_sdk.so';
  return { name: `@trycua/cua-driver-${triple}`, lib };
}

/**
 * Runtime packages whose `.node` binary is compiled against a specific V8/Node
 * ABI, so it has to match the runtime that loads it.
 *
 * The embedded server is spawned with `ELECTRON_RUN_AS_NODE=1` — it runs
 * *Electron's* Node, a different ABI from the system Node. A mismatch fails at
 * load with NODE_MODULE_VERSION.
 *
 * `node-pty` is absent deliberately: it is built against N-API, which is ABI
 * stable across runtimes.
 */
export const ABI_SENSITIVE_PACKAGES = ['better-sqlite3'];

/**
 * Runtime packages that load a compiled `.node` binary, and are therefore
 * useless without one for the target platform.
 *
 * They arrive by different routes, which is the reason to check rather than
 * assume: `better-sqlite3` downloads a prebuild per Electron ABI, while
 * `node-pty` vendors prebuilds for darwin and win32 only and has to be
 * compiled from source on Linux. A failed compile there is not fatal to
 * `pnpm install`, so without this the first sign of trouble is a packaged app
 * whose terminal does not open.
 */
export const NATIVE_PACKAGES = ['better-sqlite3', 'node-pty'];
