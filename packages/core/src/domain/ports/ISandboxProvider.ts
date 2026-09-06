// ────────────────────────────────────────────────────────────────
// ISandboxProvider — Port interface for sandbox lifecycle & execution
// Vendor-agnostic: Docker Sandbox is one implementation.
// ────────────────────────────────────────────────────────────────

export interface SandboxConfig {
  /** Unique name for the sandbox instance (e.g., "genai-run-<runId>") */
  name: string;
  /** Docker image / template to use */
  image: string;
  /** Host directories to mount into the sandbox */
  mounts?: SandboxMount[];
  /** Environment variables to set in the sandbox */
  env?: Record<string, string>;
}

export interface SandboxMount {
  /** Host path */
  source: string;
  /** Path inside the sandbox */
  target: string;
  /** Read-only mount */
  readonly?: boolean;
}

export interface SandboxExecOptions {
  /** Working directory inside the sandbox */
  cwd?: string;
  /** Environment variables for this exec only */
  env?: Record<string, string>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Stream stdout/stderr lines as they arrive */
  streamTo?: (line: string, stream: 'stdout' | 'stderr') => void;
}

export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SandboxInfo {
  name: string;
  status: 'running' | 'stopped' | 'unknown';
}

export interface ISandboxProvider {
  /** Create and start a new sandbox */
  create(config: SandboxConfig): Promise<void>;

  /** Execute a command inside a running sandbox */
  exec(name: string, command: string[], options?: SandboxExecOptions): Promise<SandboxExecResult>;

  /** Stop a running sandbox */
  stop(name: string): Promise<void>;

  /** Remove a sandbox (stop + delete) */
  remove(name: string): Promise<void>;

  /** Get sandbox status */
  inspect(name: string): Promise<SandboxInfo>;

  /** Check if the sandbox provider is available on this host */
  isAvailable(): Promise<boolean>;

  /**
   * List sandboxes currently known to the provider, optionally filtered by
   * name prefix. Phase 1, 1.9: used by the orphan reaper at boot to find
   * `genai-run-*` containers left behind by a crash.
   *
   * Providers that cannot enumerate sandboxes (or for which enumeration is
   * meaningless, e.g. the in-process host fallback) return an empty list.
   */
  list(prefix?: string): Promise<SandboxInfo[]>;
}

/**
 * A live sandbox attached to a workflow run. Declared here (not in
 * `services/SandboxLifecycleManager.ts`, which re-exports it) so that
 * infrastructure adapters such as `SandboxPtyHost` can depend on the shape
 * without importing the application layer — see the boundary lint in
 * eslint.config.mjs (APPLICATION-REVIEW-2026-09 plan item 30).
 */
export interface SandboxSession {
  sandboxName: string;
  /** cliUrl for the SDK to connect to; undefined if CLI not started in sandbox */
  cliUrl?: string;
  cliPort: number;
  /** Whether this is using the Docker sandbox or the host fallback */
  isDockerSandbox: boolean;
}

/** The one capability `SandboxPtyHost` needs from the lifecycle manager. */
export interface ISandboxSessionLookup {
  getSession(runId: string): SandboxSession | undefined;
}
