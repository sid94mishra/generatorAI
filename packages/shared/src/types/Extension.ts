// ────────────────────────────────────────────────────────────────
// Extension — GeneratorAI extension package descriptor.
//
// An extension is a directory (workspace-scope, user-scope, or
// system-scope) whose root contains `extension.json`. The manifest is
// thin — identity, metadata and an `entry` pointer. All contributions
// (widgets, tools, hooks, skills, …) are registered imperatively from
// the entry file's `loadExtension(ai)` factory.
// ────────────────────────────────────────────────────────────────

import type { WidgetPermission } from './Widget.js';

export type ExtensionScope = 'system' | 'user' | 'workspace';

export interface ExtensionAuthor {
  name: string;
  email?: string;
  url?: string;
}

export interface ExtensionEngines {
  generatorai: string; // semver range
}

export interface ExtensionManifest {
  id: string;                                     // globally unique
  name: string;
  version: string;                                // semver
  description?: string;
  author?: ExtensionAuthor | string;
  license?: string;
  repository?: string;
  publisher?: string;
  engines?: ExtensionEngines;
  permissions?: WidgetPermission[];
  /**
   * Relative path to the ES module whose default (or named
   * `loadExtension`) export receives the per-extension `ExtensionAPI`
   * handle (`ai`) and registers contributions imperatively.
   */
  entry: string;
  /** Optional icon path (relative to the extension root). */
  icon?: string;
  /** Reserved — signature over the manifest + files. Not verified yet. */
  signature?: string;
}

/** Runtime record: what's installed + where + what state it's in. */
export interface InstalledExtension {
  manifest: ExtensionManifest;
  scope: ExtensionScope;
  rootPath: string;
  enabled: boolean;
  loadedAt: string;
  errors?: string[];
  /** True when contributions were successfully registered. */
  ready: boolean;
}

/** Payload for `POST /api/extensions`. */
export interface InstallExtensionParams {
  /** Absolute or relative path to an already-extracted extension directory. */
  path?: string;
  /** URL of a tarball or a git repository (git+https://…). */
  source?: string;
  /** Which scope to install into. Default 'workspace' if workspaceId given,
   *  else 'user'. */
  scope?: ExtensionScope;
  /** Workspace id — required when scope='workspace'. */
  workspaceId?: string;
  /** Skip permission-diff prompt (assumed pre-approved). */
  force?: boolean;
}
