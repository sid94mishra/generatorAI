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
 *   @huggingface/transformers  Loads onnxruntime-node (a native addon) and
 *                              sharp; behind a guarded dynamic import, so a
 *                              broken install degrades to "voice input
 *                              unavailable" instead of a server that will
 *                              not start.
 *
 *   kokoro-js                 The text-to-speech engine. It imports
 *                              @huggingface/transformers statically, and
 *                              esbuild hoists that import to the top of the
 *                              bundle when kokoro-js is inlined — so the whole
 *                              server failed to start without transformers.
 *                              Kept external, it stays behind the engine's
 *                              guarded dynamic import.
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
  'kokoro-js',
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
 * Voice (D-184): every speech engine runs on transformers + onnxruntime-node, so without them dictation and
 * read-aloud cannot work in the packaged app. The install is ~400 MB; staging trims it to the target's own
 * onnxruntime binary and transformers' Node build (`pruneVoiceRuntime`), about 80 MB.
 */
export const RUNTIME_PACKAGES = [
  'better-sqlite3',
  'node-pty',
  'playwright',
  '@trycua/cua-driver',
  // The Codex CLI the packaged app ships. Its `bin/codex.js` launcher picks
  // the per-platform binary package (`@openai/codex-<platform>-<arch>`) by
  // `process.platform`/`process.arch`, and `resolveCodexCommand` finds the
  // launcher with `createRequire(...).resolve('@openai/codex/bin/codex.js')`
  // — a package-relative lookup that only works when the package sits next
  // to the bundle, exactly like the cua driver above. Sign-in stays in the
  // user's `CODEX_HOME`; the binary is just the protocol the build was typed
  // against (see schemas/versions.json).
  '@openai/codex',
  // The GitHub Copilot CLI's loader (E-1): it pins the CLI version. The per-platform binary
  // (`@github/copilot-<platform>-<arch>`, ~308 MB) is dropped at staging and downloaded on first use
  // (apps/server settings/copilotCli.ts), so the app no longer ships it to everyone.
  '@github/copilot',
  // Voice input and read-aloud (D-184): the speech engines' runtime, and the text-to-speech engine.
  '@huggingface/transformers',
  'kokoro-js',
];

/**
 * D-184 — what voice needs of its packages, trimmed after install:
 *  - onnxruntime-node vendors a binary for every OS and CPU (~210 MB): keep the target's own;
 *  - onnxruntime-web (~90 MB) is the browser runtime: transformers' Node build never imports it;
 *  - transformers ships browser builds, a 21 MB wasm and source maps beside its Node build.
 * Returns what it removed, for the log.
 */
export function pruneVoiceRuntime(nodeModules, platform, arch, fs, path) {
  const removed = [];
  const rm = (p) => {
    if (!fs.existsSync(p)) return;
    fs.rmSync(p, { recursive: true, force: true });
    removed.push(path.relative(nodeModules, p));
  };
  const napi = path.join(nodeModules, 'onnxruntime-node', 'bin', 'napi-v3');
  if (fs.existsSync(napi)) {
    for (const os of fs.readdirSync(napi)) {
      const osDir = path.join(napi, os);
      if (os !== platform) {
        rm(osDir);
        continue;
      }
      for (const cpu of fs.readdirSync(osDir)) if (cpu !== arch) rm(path.join(osDir, cpu));
    }
  }
  rm(path.join(nodeModules, 'onnxruntime-web'));
  const dist = path.join(nodeModules, '@huggingface', 'transformers', 'dist');
  if (fs.existsSync(dist)) {
    for (const f of fs.readdirSync(dist)) if (!/^transformers\.node\.(mjs|cjs)$/.test(f)) rm(path.join(dist, f));
  }
  return removed;
}

/** D-184 — the onnxruntime binding voice cannot run without, as path segments under node_modules. */
export function onnxBinding(platform, arch) {
  return ['onnxruntime-node', 'bin', 'napi-v3', platform, arch, 'onnxruntime_binding.node'];
}

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
