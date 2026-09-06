import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpSettingsStore, MCP_SETTINGS_FILE } from '../McpSettingsStore.js';

describe('McpSettingsStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mcp-settings-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('starts empty and persists to the data dir (server-side, not the browser)', () => {
    const store = new McpSettingsStore(dir);
    expect(store.load()).toEqual({ version: 1, system: {}, custom: [] });
    const rec = store.addCustom({ name: 'My server', serverType: 'http', url: 'https://x' });
    expect(existsSync(join(dir, MCP_SETTINGS_FILE))).toBe(true);
    expect(new McpSettingsStore(dir).listCustom()).toEqual([rec]);
    expect(rec.enabled).toBe(true);
  });

  it('merges bundled-server prefs field by field', () => {
    const store = new McpSettingsStore(dir);
    store.setSystemPrefs('system-mcp-filesystem', { inputs: { allowedDirectory: '/data' } });
    store.setSystemPrefs('system-mcp-filesystem', { enabled: false });
    expect(store.getSystemPrefs('system-mcp-filesystem')).toEqual({
      inputs: { allowedDirectory: '/data' },
      enabled: false,
    });
  });

  it('updates and removes custom servers', () => {
    const store = new McpSettingsStore(dir);
    const rec = store.addCustom({ name: 'a', serverType: 'stdio', command: 'npx' });
    const upd = store.updateCustom(rec.id, { enabled: false, credentialRefs: { env: ['TOKEN'] } });
    expect(upd.enabled).toBe(false);
    expect(upd.credentialRefs).toEqual({ env: ['TOKEN'] });
    expect(store.removeCustom(rec.id)).toBe(true);
    expect(store.removeCustom(rec.id)).toBe(false);
  });

  it('treats a corrupt file as empty rather than throwing', () => {
    writeFileSync(join(dir, MCP_SETTINGS_FILE), '{ not json', 'utf8');
    expect(new McpSettingsStore(dir).load()).toEqual({ version: 1, system: {}, custom: [] });
  });
});
