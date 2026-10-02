// Pure Menu logic (03 MP-27): groups between separators, lookups, glyph names and the flattened action list that
// ContextMenu exposes as accessibility actions (MD-28).
import { mobileIconDef, type MobileIconConcept } from '@generatorai/design-tokens';
import type { MenuEntry, MenuItem, MenuSeparator } from './Menu.types';

export function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return (entry as MenuSeparator).type === 'separator';
}

/** Items split into groups at separators; empty groups dropped (≤ 3 groups is the design rule, not enforced). */
export function menuGroups(entries: ReadonlyArray<MenuEntry>): MenuItem[][] {
  const groups: MenuItem[][] = [[]];
  for (const entry of entries) {
    if (isSeparator(entry)) groups.push([]);
    else groups[groups.length - 1]!.push(entry);
  }
  return groups.filter((g) => g.length > 0);
}

/** Depth-first search through submenus. */
export function findMenuItem(entries: ReadonlyArray<MenuEntry>, id: string): MenuItem | undefined {
  for (const entry of entries) {
    if (isSeparator(entry)) continue;
    if (entry.id === id) return entry;
    const inner = entry.children ? findMenuItem(entry.children, id) : undefined;
    if (inner) return inner;
  }
  return undefined;
}

/** The entries shown at a submenu path (ids of the opened parents). */
export function entriesAt(entries: ReadonlyArray<MenuEntry>, path: ReadonlyArray<string>): ReadonlyArray<MenuEntry> {
  let level = entries;
  for (const id of path) {
    const parent = level.find((e): e is MenuItem => !isSeparator(e) && e.id === id);
    if (!parent?.children) return level;
    level = parent.children;
  }
  return level;
}

/** Every enabled leaf, labelled with its submenu path ("Move to › Archive"): the accessibility actions. */
export function menuActions(entries: ReadonlyArray<MenuEntry>, prefix = ''): Array<{ name: string; label: string }> {
  const out: Array<{ name: string; label: string }> = [];
  for (const entry of entries) {
    if (isSeparator(entry) || entry.disabled) continue;
    const label = prefix ? `${prefix} › ${entry.label}` : entry.label;
    if (entry.children) out.push(...menuActions(entry.children, label));
    else out.push({ name: entry.id, label });
  }
  return out;
}

/** SF Symbol for a concept (undefined for lucide-only domain glyphs, which native menus show without an icon). */
export function sfSymbolFor(concept: MobileIconConcept | undefined): string | undefined {
  return concept ? mobileIconDef(concept).sfSymbol : undefined;
}
