// ────────────────────────────────────────────────────────────────
// Settings IA (D-26, 04 §3.1, DF-21): the 16 sections (Workflow engine added
// by the Workflow Overhaul merge), their four nav groups
// and the static search index, shared by web and (next pass) mobile so both
// keep one information architecture.
//
// Labels follow the SettingsAppearance / SettingsSecurity boards (sentence
// case; the "Agents" group is "Agents & models" because it holds providers
// and agents, DF-21). Section ids are unchanged: they are URL segments
// (`/settings/<id>`, `generatorai://settings/<id>`).
// ────────────────────────────────────────────────────────────────

export const SETTINGS_SECTION_IDS = [
  'general',
  'appearance',
  'providers',
  'agents',
  'skills',
  'mcp',
  'templates',
  'source-control',
  'browser-terminal',
  'computer-use',
  'audio',
  'extensions',
  'security',
  'storage',
  'workflow-engine',
  'diagnostics',
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'general';

export interface SettingsNavItem {
  id: SettingsSectionId;
  label: string;
  /** Icon concept (`ICON_CONCEPTS` in design-tokens). */
  icon: string;
  /** Extra search terms: the section's field labels and synonyms (lower case). */
  keywords: readonly string[];
}

export interface SettingsNavGroup {
  id: 'app' | 'agents' | 'integrations' | 'system';
  label: string;
  items: readonly SettingsNavItem[];
}

export const SETTINGS_NAV: readonly SettingsNavGroup[] = [
  {
    id: 'app',
    label: 'App',
    items: [
      { id: 'general', label: 'General', icon: 'settings', keywords: ['default model', 'version', 'about'] },
      {
        id: 'appearance',
        label: 'Appearance',
        icon: 'mode-system',
        keywords: ['theme', 'mode', 'dark', 'light', 'accent', 'colour', 'color', 'density', 'compact', 'font size', 'reduce motion'],
      },
    ],
  },
  {
    id: 'agents',
    label: 'Agents & models',
    items: [
      { id: 'providers', label: 'Model providers', icon: 'model', keywords: ['claude', 'codex', 'copilot', 'sign in', 'login', 'connection'] },
      { id: 'agents', label: 'Agents', icon: 'agents', keywords: ['role', 'scope'] },
      { id: 'skills', label: 'Skills', icon: 'skills', keywords: ['catalog'] },
      { id: 'mcp', label: 'MCP servers', icon: 'mcp', keywords: ['tools', 'stdio', 'http', 'sse'] },
      { id: 'templates', label: 'Templates', icon: 'layers', keywords: ['workflow template'] },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    items: [
      { id: 'source-control', label: 'Source control', icon: 'branch', keywords: ['github', 'git', 'token', 'account', 'editor', 'base branch'] },
      { id: 'browser-terminal', label: 'Browser & terminal', icon: 'terminal', keywords: ['shell', 'powershell', 'ssh', 'aws'] },
      { id: 'computer-use', label: 'Computer use', icon: 'computer', keywords: ['desktop driver', 'screen'] },
      { id: 'audio', label: 'Audio', icon: 'mic', keywords: ['speech', 'voice', 'microphone', 'dictation'] },
      { id: 'extensions', label: 'Extensions', icon: 'zap', keywords: ['install', 'plugin'] },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      {
        id: 'security',
        label: 'Security & devices',
        icon: 'shield',
        keywords: ['servers', 'network', 'lan', 'loopback', 'pairing', 'pair', 'qr', 'devices', 'revoke', 'access requests'],
      },
      { id: 'storage', label: 'Storage', icon: 'database', keywords: ['workspaces', 'retention', 'cleanup'] },
      {
        id: 'workflow-engine',
        label: 'Workflow engine',
        icon: 'workflows',
        keywords: ['concurrency', 'limits', 'slots', 'provider', 'model', 'summaries', 'debounce'],
      },
      { id: 'diagnostics', label: 'Diagnostics', icon: 'activity', keywords: ['health', 'telemetry', 'sandbox', 'logs'] },
    ],
  },
];

export function isSettingsSectionId(value: string | null | undefined): value is SettingsSectionId {
  return (SETTINGS_SECTION_IDS as readonly string[]).includes(value ?? '');
}

/** Narrow a URL segment to a section id; unknown or missing → General. */
export function toSettingsSection(value: string | null | undefined): SettingsSectionId {
  return isSettingsSectionId(value) ? value : DEFAULT_SETTINGS_SECTION;
}

/** The canonical URL of a section. */
export function settingsPath(section: SettingsSectionId = DEFAULT_SETTINGS_SECTION): string {
  return `/settings/${section}`;
}

/** True for `/settings` and `/settings/<anything>` — the modal's addresses (D-26). */
export function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || pathname === '/settings/' || /^\/settings\/[^/]+\/?$/.test(pathname);
}

/** The section a settings URL addresses (General for bare `/settings`), or null for any other path. */
export function settingsSectionFromPath(pathname: string): SettingsSectionId | null {
  if (!isSettingsPath(pathname)) return null;
  const segment = pathname.split('/')[2];
  return toSettingsSection(segment);
}

export function settingsSectionLabel(id: SettingsSectionId): string {
  for (const group of SETTINGS_NAV) {
    const item = group.items.find((i) => i.id === id);
    if (item) return item.label;
  }
  return id;
}

/**
 * The nav filtered by a search query: a section matches on its label, its
 * group's label or any keyword (case-insensitive substring). Empty groups are
 * dropped; an empty query returns the whole nav.
 */
export function filterSettingsNav(query: string): SettingsNavGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...SETTINGS_NAV];
  return SETTINGS_NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        group.label.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.includes(q)),
    ),
  })).filter((group) => group.items.length > 0);
}
