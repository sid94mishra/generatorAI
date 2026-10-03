// The Settings section index (MSettings, MSettingsMore; 04 §1.4, MD-30): four groups — App, Agents & models,
// Integrations, System — with the 15 server / desktop sections (ids = web SETTINGS_NAV) and the 4 per-device rows
// (Notifications, App lock & privacy, Haptics, Widgets & Live Activities). The root renders it; "Search settings"
// filters it on the client (titles, the row words a person would type, and the group). Pure, unit-tested.
import type { MobileIconConcept } from '@generatorai/design-tokens';

export type SettingsGroupId = 'app' | 'agents' | 'integrations' | 'system';

export interface SettingsEntry {
  id: string;
  title: string;
  group: SettingsGroupId;
  icon: MobileIconConcept;
  /** Pushed route; `null` for the inline Haptics switch. */
  href: string | null;
  /** Stored on this phone (MD-30): the group footer names them. */
  device: boolean;
  /** Extra words the search matches besides the title (row labels inside the section). */
  keywords: ReadonlyArray<string>;
}

export const SETTINGS_GROUPS: ReadonlyArray<{ id: SettingsGroupId; title: string }> = [
  { id: 'app', title: 'App' },
  { id: 'agents', title: 'Agents & models' },
  { id: 'integrations', title: 'Integrations' },
  { id: 'system', title: 'System' },
];

const e = (id: string, title: string, group: SettingsGroupId, icon: MobileIconConcept, keywords: string[], device = false): SettingsEntry => ({
  id,
  title,
  group,
  icon,
  href: id === 'haptics' ? null : `/settings/${id}`,
  device,
  keywords,
});

/** Board order. `widgetsTitle` differs per OS (Live Activities / Live Updates); the root passes the platform noun. */
export function settingsEntries(widgetsTitle: string): SettingsEntry[] {
  return [
    e('general', 'General', 'app', 'settings', ['default model', 'version', 'about']),
    e('appearance', 'Appearance', 'app', 'mode-system', ['theme', 'mode', 'dark', 'light', 'accent', 'colour', 'color', 'text size', 'reduce motion', 'transparency']),
    e('notifications', 'Notifications', 'app', 'bell', ['push', 'alerts', 'pause', 'mute'], true),
    e('app-lock', 'App lock & privacy', 'app', 'lock', ['biometrics', 'face id', 'touch id', 'fingerprint', 'passcode', 'app switcher', 'privacy'], true),
    e('haptics', 'Haptics', 'app', 'device', ['vibration'], true),
    e('providers', 'Model providers', 'agents', 'model', ['claude', 'copilot', 'codex', 'opencode', 'acp', 'sign in', 'default provider']),
    e('agents', 'Agents', 'agents', 'agents', ['orchestrator', 'instructions']),
    e('skills', 'Skills', 'agents', 'skills', []),
    e('mcp', 'MCP servers', 'agents', 'mcp', ['model context protocol', 'tools', 'add server']),
    e('templates', 'Templates', 'agents', 'layout', ['workflow templates']),
    e('source-control', 'Source control', 'integrations', 'branch', ['github', 'token', 'git', 'pull request', 'auto-commit']),
    e('browser-terminal', 'Browser & terminal', 'integrations', 'terminal', ['shell', 'profile', 'font size']),
    e('computer-use', 'Computer use', 'integrations', 'computer', ['grants', 'screen']),
    e('audio', 'Audio', 'integrations', 'mic', ['dictation', 'speech', 'voice', 'language', 'read aloud', 'tts']),
    e('extensions', 'Extensions', 'integrations', 'layers', ['plugins', 'widgets']),
    e('security', 'Security & devices', 'system', 'shield', ['paired devices', 'pair', 'access requests', 'network', 'servers', 'unpair', 'approval key', 'scopes']),
    e('storage', 'Storage', 'system', 'database', ['disk', 'retention', 'clean up', 'worktrees']),
    e('diagnostics', 'Diagnostics', 'system', 'activity', ['health', 'uptime', 'database', 'version', 'connection']),
    e('widgets', widgetsTitle, 'system', 'widgets', ['live activity', 'live update', 'control center', 'quick settings', 'tile', 'home screen'], true),
  ];
}

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Entries whose title, group or keywords contain every word of the query (empty query: none). */
export function searchSettings(entries: ReadonlyArray<SettingsEntry>, query: string): SettingsEntry[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const groupTitle = new Map(SETTINGS_GROUPS.map((g) => [g.id, g.title]));
  return entries.filter((entry) => {
    const hay = norm([entry.title, groupTitle.get(entry.group) ?? '', ...entry.keywords].join(' '));
    return words.every((w) => hay.includes(w));
  });
}

/** The keyword that matched, for the result's subtitle ("Appearance · dark"); null when the title matched. */
export function matchedKeyword(entry: SettingsEntry, query: string): string | null {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length || words.every((w) => norm(entry.title).includes(w))) return null;
  return entry.keywords.find((k) => words.some((w) => norm(k).includes(w))) ?? null;
}
