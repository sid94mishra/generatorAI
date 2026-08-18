/**
 * CLI version.
 *
 * Read from the package rather than hard-coded so a release bump cannot leave
 * `--version` reporting something the package does not claim. `with { type:
 * 'json' }` keeps it a static import that esbuild inlines into the bundle.
 */
import pkg from '../package.json' with { type: 'json' };

export const CLI_VERSION: string = (pkg as { version: string }).version;
