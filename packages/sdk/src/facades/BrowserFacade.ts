// ────────────────────────────────────────────────────────────────
// BrowserFacade — ai.browser.*
//
// Integrated Browser (v13). Thin wrapper around `BrowserService` for
// programmatic control from SDK consumers. Requires a workspace to
// already exist (via `ai.workspaces.create` or via a chat/run start).
// ────────────────────────────────────────────────────────────────

import type {
  BrowserService,
  WorkspaceManager,
} from '@generatorai/core';
import type {
  BrowserConfig,
  BrowserSessionDescriptor,
  BrowserInspectorSelection,
  WorkspaceArtifactRecord,
} from '@generatorai/shared';

export class BrowserFacade {
  constructor(
    private readonly browserService: BrowserService,
    private readonly workspaceManager: WorkspaceManager,
  ) {}

  /**
   * Start (or attach to) a browser session for a workspace. Idempotent.
   */
  async start(
    workspaceId: string,
    config?: BrowserConfig,
    initialUrl?: string,
  ): Promise<BrowserSessionDescriptor> {
    const workspace = await this.workspaceManager.getExecutionWorkspace(workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    // Merge caller-provided config over any stored default. `enabled` is
    // forced true because the caller invoked `start()`.
    const merged: BrowserConfig = {
      ...(workspace.browserConfig as BrowserConfig | undefined),
      ...(config ?? {}),
      enabled: true,
    };
    workspace.browserConfig = merged as Record<string, unknown>;
    const descriptor = await this.browserService.ensureStarted(workspace);
    if (initialUrl && descriptor.ready) {
      await this.browserService.navigate(workspaceId, initialUrl, 'system');
    }
    return descriptor;
  }

  /** Stop the workspace's browser session. */
  async stop(workspaceId: string, reason?: string): Promise<void> {
    return this.browserService.stop(workspaceId, reason ?? 'sdk');
  }

  /** Current descriptor (status + mode + url). */
  async describe(workspaceId: string): Promise<BrowserSessionDescriptor> {
    return this.browserService.describe(workspaceId);
  }

  /** Navigate to a URL. */
  async navigate(workspaceId: string, url: string) {
    return this.browserService.navigate(workspaceId, url, 'system');
  }

  /** History back. */
  async back(workspaceId: string) {
    return this.browserService.back(workspaceId);
  }

  /** History forward. */
  async forward(workspaceId: string) {
    return this.browserService.forward(workspaceId);
  }

  /** Reload. */
  async reload(workspaceId: string) {
    return this.browserService.reload(workspaceId, 'system');
  }

  /** Capture a PNG screenshot; returns the artifact-registered path. */
  async screenshot(workspaceId: string) {
    return this.browserService.screenshot(workspaceId, 'system');
  }

  /** Capture the full DOM as HTML. */
  async domSnapshot(workspaceId: string) {
    return this.browserService.domSnapshot(workspaceId, 'system');
  }

  /**
   * Toggle the injected inspector overlay. When on, the next user click on
   * the page produces a `browser.selection` event; subscribe via
   * `ai.events.onAll` with `filter: browser.selection`.
   */
  async inspector(workspaceId: string, on: boolean) {
    return this.browserService.inspector(workspaceId, on);
  }

  /**
   * Record an inspector selection manually — mostly used by desktop-native
   * hosts that can't use Playwright's `context.exposeFunction`.
   */
  async recordSelection(workspaceId: string, selection: BrowserInspectorSelection) {
    return this.browserService.recordInspectorSelection(workspaceId, selection);
  }
}

// Re-export for consumers.
export type { WorkspaceArtifactRecord };
