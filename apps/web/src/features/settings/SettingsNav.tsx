// ────────────────────────────────────────────────────────────────
// The Settings modal's left nav (F-settings-01): "Search settings /" and the
// four `SETTINGS_NAV` groups as dense NavItems. Search filters by label,
// group and the static keyword index; Enter opens the first match. Each item
// is a link to the section's URL (open in a new tab works); a plain click
// goes through `onSelect`, which keeps the modal's background page.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Link } from 'react-router';
import type { IconConcept } from '@generatorai/design-tokens';
import { filterSettingsNav, settingsPath, type SettingsSectionId } from '@generatorai/shared/ui-contract';
import { NavItem } from '@/ui/primitives/NavItem/NavItem.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';

export const SETTINGS_SEARCH_ID = 'settings-search';

export interface SettingsNavProps {
  active: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
}

export function SettingsNav({ active, onSelect }: SettingsNavProps) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => filterSettingsNav(query), [query]);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const first = groups[0]?.items[0];
    if (!first) return;
    event.preventDefault();
    onSelect(first.id);
  };

  const onItemClick = (event: MouseEvent<HTMLAnchorElement>, id: SettingsSectionId) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelect(id);
  };

  return (
    <>
      <SearchInput
        id={SETTINGS_SEARCH_ID}
        size="sm"
        value={query}
        onValueChange={setQuery}
        onKeyDown={onSearchKeyDown}
        label="Search settings"
        placeholder="Search settings"
      />
      <nav aria-label="Settings sections" className="-mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-1">
        {groups.length === 0 ? (
          <p className="px-2 py-3 text-small text-fg-3">No settings match “{query.trim()}”.</p>
        ) : (
          groups.map((group) => (
            <div key={group.id} className="flex flex-col gap-px pt-2">
              <SectionHeader variant="label" title={group.label} />
              {group.items.map((item) => (
                <NavItem
                  key={item.id}
                  dense
                  icon={item.icon as IconConcept}
                  label={item.label}
                  active={item.id === active}
                  render={<Link to={settingsPath(item.id)} />}
                  onClick={(event) => onItemClick(event, item.id)}
                  data-testid={`settings-nav-${item.id}`}
                />
              ))}
            </div>
          ))
        )}
      </nav>
    </>
  );
}
