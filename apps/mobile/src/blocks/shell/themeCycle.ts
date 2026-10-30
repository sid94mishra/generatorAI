// "Toggle theme" on mobile cycles System → Light → Dark (MB-21) and says where it goes. Pure.
export type ThemeModeName = 'system' | 'light' | 'dark';

const ORDER: readonly ThemeModeName[] = ['system', 'light', 'dark'];
const LABEL: Record<ThemeModeName, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export function nextThemeMode(mode: ThemeModeName): ThemeModeName {
  return ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length] ?? 'system';
}

/** "Dark → System". */
export function themeToggleHint(mode: ThemeModeName): string {
  return `${LABEL[mode] ?? 'System'} → ${LABEL[nextThemeMode(mode)]}`;
}
