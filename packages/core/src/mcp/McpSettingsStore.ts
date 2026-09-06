// ────────────────────────────────────────────────────────────────
// McpSettingsStore — server-side persistence for global MCP settings.
//
// Holds (a) the user's preferences for the BUNDLED catalog — on/off, input
// values such as the filesystem root, and which credentials are stored — and
// (b) CUSTOM servers added from Settings → MCP Servers.
//
// Modelled on `apps/server/src/settings/computerUse.ts`: one JSON file in the
// data directory, written atomically. Before this store the Settings form
// persisted to the browser's localStorage, so the server — the only place a
// harness config is ever built — never saw a custom server at all.
//
// Credential VALUES are never written here; only their names (refs). See
// `McpCredentialVault`.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  CustomMcpServerRecord,
  McpSettings,
  SystemMcpServerPrefs,
} from '@generatorai/shared';

export const MCP_SETTINGS_FILE = 'mcp-settings.json';

const EMPTY: McpSettings = { version: 1, system: {}, custom: [] };

export type CustomMcpServerInput = Omit<
  CustomMcpServerRecord,
  'id' | 'createdAt' | 'updatedAt' | 'credentialRefs' | 'enabled'
> & { enabled?: boolean; credentialRefs?: CustomMcpServerRecord['credentialRefs'] };

export class McpSettingsStore {
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, MCP_SETTINGS_FILE);
  }

  /** Any unreadable or malformed file resolves to "nothing configured". */
  load(): McpSettings {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<McpSettings> | null;
      if (!parsed || parsed.version !== 1) return structuredClone(EMPTY);
      return {
        version: 1,
        system: typeof parsed.system === 'object' && parsed.system ? parsed.system : {},
        custom: Array.isArray(parsed.custom) ? parsed.custom : [],
      };
    } catch {
      return structuredClone(EMPTY);
    }
  }

  private save(settings: McpSettings): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  // ── Bundled catalog preferences ──

  getSystemPrefs(id: string): SystemMcpServerPrefs {
    return this.load().system[id] ?? {};
  }

  setSystemPrefs(id: string, patch: SystemMcpServerPrefs): SystemMcpServerPrefs {
    const settings = this.load();
    const current = settings.system[id] ?? {};
    const next: SystemMcpServerPrefs = { ...current };
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.inputs !== undefined) next.inputs = { ...(current.inputs ?? {}), ...patch.inputs };
    if (patch.credentialRefs !== undefined) next.credentialRefs = patch.credentialRefs;
    settings.system[id] = next;
    this.save(settings);
    return next;
  }

  // ── Custom servers ──

  listCustom(): CustomMcpServerRecord[] {
    return this.load().custom;
  }

  getCustom(id: string): CustomMcpServerRecord | undefined {
    return this.load().custom.find((c) => c.id === id);
  }

  addCustom(input: CustomMcpServerInput, id = `custom-mcp-${randomUUID().slice(0, 8)}`): CustomMcpServerRecord {
    const settings = this.load();
    if (settings.custom.some((c) => c.id === id)) throw new Error(`Custom MCP server "${id}" already exists`);
    const now = Date.now();
    const record: CustomMcpServerRecord = {
      ...input,
      id,
      enabled: input.enabled ?? true,
      credentialRefs: input.credentialRefs ?? {},
      createdAt: now,
      updatedAt: now,
    };
    settings.custom.push(record);
    this.save(settings);
    return record;
  }

  updateCustom(id: string, patch: Partial<CustomMcpServerInput>): CustomMcpServerRecord {
    const settings = this.load();
    const idx = settings.custom.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`Custom MCP server "${id}" not found`);
    const current = settings.custom[idx]!;
    const next: CustomMcpServerRecord = { ...current, ...stripUndefined(patch), updatedAt: Date.now() };
    settings.custom[idx] = next;
    this.save(settings);
    return next;
  }

  removeCustom(id: string): boolean {
    const settings = this.load();
    const before = settings.custom.length;
    settings.custom = settings.custom.filter((c) => c.id !== id);
    if (settings.custom.length === before) return false;
    this.save(settings);
    return true;
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}
