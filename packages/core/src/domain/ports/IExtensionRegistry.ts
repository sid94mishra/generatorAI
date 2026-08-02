// ────────────────────────────────────────────────────────────────
// IExtensionRegistry — Domain port for the extension surface.
//
// The registry knows which extensions are installed and where.
// It is the single source of truth consulted by:
//   - CustomToolRegistry (contributed tools)
//   - McpHub (contributed MCP servers)
//   - WidgetRegistry (contributed widgets)
//   - SystemArtifactService (contributed skills/agents/prompts)
//   - HookRegistry (contributed hooks)
//
// Implementations live in the application layer (ExtensionManager).
// ────────────────────────────────────────────────────────────────

import type {
  ExtensionScope,
  InstalledExtension,
  InstallExtensionParams,
} from '@generatorai/shared';

export interface IExtensionRegistry {
  /** List all installed extensions across every scope. */
  list(): InstalledExtension[];

  /** Get an installed extension by id. Returns undefined if not present. */
  get(id: string): InstalledExtension | undefined;

  /** True when an extension is installed AND enabled. */
  isEnabled(id: string): boolean;

  /** Install/enable extension from a directory or archive. */
  install(params: InstallExtensionParams): Promise<InstalledExtension>;

  /** Remove an extension from disk + registry. */
  uninstall(id: string, scope?: ExtensionScope): Promise<boolean>;

  /** Enable or disable a previously-installed extension. */
  setEnabled(id: string, enabled: boolean): Promise<void>;

  /** Re-scan disk + reload all extensions. */
  reload(): Promise<void>;

  /** Return the on-disk root for an extension asset lookup. */
  resolveRoot(id: string): string | undefined;
}
