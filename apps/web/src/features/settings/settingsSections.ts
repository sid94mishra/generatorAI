// ────────────────────────────────────────────────────────────────
// Settings section registry (F-settings-01; D-26; 04 §3.1).
//
// The modal's nav (groups, labels, order, search keywords) is static and
// shared: `SETTINGS_NAV` in `@generatorai/shared/ui-contract`. What each
// section RENDERS is registered here, so P6-05…P6-10 rebuild sections one at
// a time without reopening the modal. Registrations live in one file under
// `app/registries/settingsSections.tsx` (app may import legacy section
// components and every feature; a feature may not import another feature):
//
//   import { registerSettingsSection } from '@/features/settings/index.js';
//
//   registerSettingsSection({
//     id: 'general',                        // a SettingsSectionId (URL segment)
//     render: () => <GeneralSection />,     // a component element; hooks live inside it
//     footer: <SettingsStatusFooter icon="check">Saved to the server</SettingsStatusFooter>, // optional 40h bar
//   }, { replace: Boolean(import.meta.hot) }); // hot reload re-runs the registration file
//
// Contract:
// - `render()` is called during the modal's render; return an element and keep
//   hooks inside that component. A rebuilt section renders the C-13 recipe
//   (`SettingsSection` + `SettingRow`s / `SettingsTable`); a legacy one renders
//   as it is until its P6 task replaces it.
// - Registering an id twice throws unless `replace` is set. Returns an
//   unregister function (tests). Later registrations are picked up live.
// - A section with no registration renders an empty state, never a crash.
// ────────────────────────────────────────────────────────────────

import { useSyncExternalStore, type ReactNode } from 'react';
import { isSettingsSectionId, type SettingsSectionId } from '@generatorai/shared/ui-contract';

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  /** The section body. Return a component element; hooks live inside it. */
  render: () => ReactNode;
  /** The modal's 40h status bar (`SettingsStatusFooter`) while this section is open. */
  footer?: ReactNode;
}

export interface RegisterSettingsSectionOptions {
  /** Replace an existing entry instead of throwing. Only for hot reload: `Boolean(import.meta.hot)`. */
  replace?: boolean;
}

let sections: ReadonlyMap<SettingsSectionId, SettingsSectionDefinition> = new Map();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Register what a section renders. Throws on an unknown or duplicate id. */
export function registerSettingsSection(
  definition: SettingsSectionDefinition,
  options: RegisterSettingsSectionOptions = {},
): () => void {
  if (!isSettingsSectionId(definition.id)) {
    throw new Error(`"${definition.id}" is not a settings section id (SETTINGS_SECTION_IDS).`);
  }
  if (sections.has(definition.id) && !options.replace) {
    throw new Error(`Settings section "${definition.id}" is already registered.`);
  }
  const next = new Map(sections);
  next.set(definition.id, definition);
  sections = next;
  emit();
  return () => {
    if (sections.get(definition.id) !== definition) return;
    const without = new Map(sections);
    without.delete(definition.id);
    sections = without;
    emit();
  };
}

export function getSettingsSection(id: SettingsSectionId): SettingsSectionDefinition | undefined {
  return sections.get(id);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => sections;

/** The registered definition of one section, live. */
export function useSettingsSection(id: SettingsSectionId): SettingsSectionDefinition | undefined {
  return useSyncExternalStore(subscribe, snapshot, snapshot).get(id);
}
