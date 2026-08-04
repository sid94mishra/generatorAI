/** Delay in ms before exiting the Ink render loop */
export const EXIT_DELAY_MS = 200;

/**
 * CLI version.
 *
 * `__CLI_VERSION__` is substituted at bundle time from `package.json` (see
 * apps/cli/esbuild.config.mjs). The fallback is what a `tsx`-from-source dev
 * run reports; it is deliberately not a real version number, because a
 * hand-maintained copy silently drifts from the manifest.
 */
declare const __CLI_VERSION__: string | undefined;
export const CLI_VERSION =
  typeof __CLI_VERSION__ === 'string' ? __CLI_VERSION__ : '0.0.0-dev';

/** Default server URL */
export const DEFAULT_SERVER_URL = 'http://localhost:3100';

/** Exit codes */
export const EXIT_CODES = {
  SUCCESS: 0,
  ERROR: 1,
  TIMEOUT: 2,
  CANCELLED: 3,
  NOT_FOUND: 4,
  AUTH_FAILURE: 5,
  CANNOT_EXECUTE: 126,
  COMMAND_NOT_FOUND: 127,
} as const;
