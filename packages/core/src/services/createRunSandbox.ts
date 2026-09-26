// ────────────────────────────────────────────────────────────────
// createRunSandbox — picks the sandbox provider for workflow runs and wraps
// it in a SandboxLifecycleManager. Shared by the server composition root and
// the SDK so both boot the same sandbox for the same settings.
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import { DockerSandboxProvider } from '../infrastructure/DockerSandboxProvider.js';
import { HostProcessSandboxProvider } from '../infrastructure/HostProcessSandboxProvider.js';
import type { ISandboxProvider } from '../domain/ports/ISandboxProvider.js';
import { SandboxLifecycleManager } from './SandboxLifecycleManager.js';

/**
 * The run sandbox. `null` when sandbox mode is off in the deployment
 * config — a configuration, not a missing dependency.
 */
export interface RunSandbox {
  lifecycle: SandboxLifecycleManager;
  provider: ISandboxProvider;
}

export interface RunSandboxOptions {
  /** `docker` requires Docker Sandbox; `host` runs on the host; `auto` prefers Docker. */
  provider: 'docker' | 'host' | 'auto';
  /** Docker image for the sandbox template. */
  image?: string;
  /** Port for the harness CLI inside the sandbox. */
  cliPort?: number;
  /** Max time to wait for sandbox + CLI startup. */
  startupTimeoutMs?: number;
  /**
   * Explicit opt-in to the host-process provider when `auto` finds no Docker
   * (`GENERATORAI_ALLOW_HOST_SANDBOX=true` on the server). Without it that
   * case refuses to boot rather than silently running unsandboxed.
   */
  allowHostFallback?: boolean;
}

export async function createRunSandbox(
  options: RunSandboxOptions,
  logger: ILogger,
): Promise<RunSandbox> {
  let provider: ISandboxProvider | undefined;
  let dockerAvailable = false;

  if (options.provider === 'docker' || options.provider === 'auto') {
    const dockerProvider = new DockerSandboxProvider(logger);
    dockerAvailable = await dockerProvider.isAvailable();
    if (dockerAvailable) {
      provider = dockerProvider;
      logger.info('[Sandbox] Docker Sandbox detected — using microVM isolation');
    } else if (options.provider === 'docker') {
      logger.error('[Sandbox] Docker Sandbox not available but provider=docker was specified');
      throw new Error(
        'Sandbox mode requires Docker Desktop with Sandbox support. ' +
        'Set sandbox.provider to "auto" or "host" for fallback, or disable sandbox mode.',
      );
    }
  }

  if (!provider) {
    // Host-process fallback has NO hypervisor isolation — agent-generated
    // code runs directly on the host. Require explicit opt-in (either by
    // choosing `provider='host'` or by `allowHostFallback`) so a user who
    // configured `auto` never silently runs unsandboxed.
    const hostExplicit = options.provider === 'host';
    if (!hostExplicit && !options.allowHostFallback) {
      logger.error(
        '[Sandbox] Docker Sandbox unavailable and host-process fallback not opted in. ' +
        'Either install Docker, set sandbox.provider="host" explicitly, ' +
        'or set GENERATORAI_ALLOW_HOST_SANDBOX=true to proceed without isolation.',
      );
      throw new Error(
        'Sandbox fallback to host-process requires explicit opt-in. ' +
        'Set GENERATORAI_ALLOW_HOST_SANDBOX=true or sandbox.provider="host".',
      );
    }
    provider = new HostProcessSandboxProvider(logger);
    // ERROR level so this cannot be missed in log scrapers; agent code
    // running on the host is a production hazard.
    logger.error(
      '[Sandbox] SANDBOX ISOLATION DISABLED — using host-process fallback. ' +
      'Agent-generated code will run with the process\'s privileges. ' +
      `(opt-in source: ${hostExplicit ? 'sandbox.provider="host"' : 'GENERATORAI_ALLOW_HOST_SANDBOX=true'})`,
    );
  }

  const lifecycle = new SandboxLifecycleManager(
    provider,
    {
      image: options.image ?? 'generatorai/sandbox:latest',
      cliPort: options.cliPort ?? 4321,
      startupTimeoutMs: options.startupTimeoutMs ?? 30_000,
      dockerAvailable,
    },
    logger,
  );
  logger.info(`[Sandbox] Sandbox mode ENABLED (provider: ${dockerAvailable ? 'docker' : 'host-fallback'})`);
  return { lifecycle, provider };
}
