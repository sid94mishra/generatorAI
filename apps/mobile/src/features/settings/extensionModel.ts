export interface ExtensionRow {
  id: string;
  name: string;
  version: string | null;
  description: string | null;
  scope: string | null;
  /** Where it is installed on the server. */
  rootPath: string | null;
  enabled: boolean;
  /** False when the extension is enabled but failed to register. */
  ready: boolean;
  errors: string[];
}

/**
 * The route returns the server's `InstalledExtension` (`{ manifest, scope,
 * enabled, ready, errors }`); client-core's `ExtensionSummary` describes a
 * flat `{ id, name }`. Accept either so the screen works against both.
 */
export function toRow(raw: unknown): ExtensionRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const manifest = (r.manifest && typeof r.manifest === 'object' ? r.manifest : r) as Record<string, unknown>;
  const id = typeof manifest.id === 'string' ? manifest.id : null;
  if (!id) return null;
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  return {
    id,
    name: str(manifest.name) ?? id,
    version: str(manifest.version),
    description: str(manifest.description),
    scope: str(r.scope),
    rootPath: str(r.rootPath),
    enabled: r.enabled === true,
    ready: r.ready !== false,
    errors: Array.isArray(r.errors) ? r.errors.filter((e): e is string => typeof e === 'string') : [],
  };
}


/** Built-in (system scope) extensions cannot be switched off or uninstalled (MDF-119: a lock, not a disabled switch). */
export const isBuiltIn = (row: ExtensionRow): boolean => row.scope === 'system';

/** "Ready" / "Error" / "Disabled" — the state word the row and the sheet show. */
export function extensionState(row: ExtensionRow): { label: string; health: 'ok' | 'err' | 'idle' } {
  if (!row.enabled) return { label: 'Disabled', health: 'idle' };
  return row.ready ? { label: 'Ready', health: 'ok' } : { label: 'Error', health: 'err' };
}

export const SCOPE_LABEL: Record<string, string> = { system: 'Built in', user: 'User', workspace: 'Workspace' };
