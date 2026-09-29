export interface ExtensionRow {
  id: string;
  name: string;
  version: string | null;
  description: string | null;
  scope: string | null;
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
    enabled: r.enabled === true,
    ready: r.ready !== false,
    errors: Array.isArray(r.errors) ? r.errors.filter((e): e is string => typeof e === 'string') : [],
  };
}

