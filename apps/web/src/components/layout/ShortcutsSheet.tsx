// ────────────────────────────────────────────────────────────────
// ShortcutsSheet — Help ▸ Keyboard Shortcuts (`shortcuts.show`, D-24).
//
// Lists every command bound on THIS host (web sequences in a browser tab,
// ⌘ chords on macOS desktop, Ctrl chords on Windows/Linux desktop) straight
// from the shared registry, so it cannot drift from the menu or the key
// handler. Opened from the native menu, `?` on the web, or the palette.
//
// Interim build on the legacy Modal + Kbd (the kit does not exist yet); P3
// rebuilds it on the ui/ Dialog with `data-gai-overlay="dialog"`. Classes are
// the D-08 design vocabulary only, so the ratchet stays flat.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import {
  COMMANDS,
  COMMAND_GROUP_LABELS,
  COMMAND_IDS,
  SYSTEM_SHORTCUTS,
  formatBinding,
  type CommandGroup,
  type CommandScope,
  type Host,
} from '@generatorai/shared/ui-contract';
import { Modal } from '@/components/ui/Modal.js';
import { Kbd } from '@/components/ui/Kbd.js';
import { useShellStore } from '@/stores/shellStore.js';
import { commandHost, isMacOS } from '@/lib/desktop.js';

interface Row {
  label: string;
  binding: string;
}

interface Section {
  title: string;
  rows: Row[];
}

const GROUP_ORDER: CommandGroup[] = ['navigate', 'create', 'view', 'edit', 'app', 'help'];

const SCOPE_TITLES: Record<Exclude<CommandScope, 'global'>, string> = {
  composer: 'Composer',
  palette: 'Command palette',
  builder: 'Workflow builder',
  dock: 'Panels and dialogs',
  find: 'Panels and dialogs',
  settings: 'Panels and dialogs',
};

/** Sections for one host: global commands by group, scoped ones by surface, then system keys. */
export function shortcutSections(host: Host): Section[] {
  const byTitle = new Map<string, Row[]>();
  const push = (title: string, row: Row) => byTitle.set(title, [...(byTitle.get(title) ?? []), row]);

  for (const group of GROUP_ORDER) {
    for (const id of COMMAND_IDS) {
      const def = COMMANDS[id];
      const binding = def[host];
      if (def.scope === 'global' && def.group === group && binding !== null) {
        push(COMMAND_GROUP_LABELS[group], { label: def.label, binding });
      }
    }
  }
  for (const id of COMMAND_IDS) {
    const def = COMMANDS[id];
    const binding = def[host];
    if (def.scope !== 'global' && binding !== null) push(SCOPE_TITLES[def.scope], { label: def.label, binding });
  }
  for (const s of SYSTEM_SHORTCUTS) {
    const binding = s[host];
    if (binding !== null) push('System', { label: s.label, binding });
  }
  return [...byTitle].map(([title, rows]) => ({ title, rows }));
}

function Binding({ binding, host }: { binding: string; host: Host }) {
  const chords = formatBinding(binding, host, { mac: isMacOS });
  return (
    <span className="flex shrink-0 items-center gap-1">
      {chords.map((keys, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-small text-fg-3">then</span>}
          <Kbd keys={keys} />
        </React.Fragment>
      ))}
    </span>
  );
}

export function ShortcutsSheet() {
  const open = useShellStore((s) => s.shortcutsOpen);
  const setOpen = useShellStore((s) => s.setShortcutsOpen);
  const sections = useMemo(() => shortcutSections(commandHost), []);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" size="lg">
      <div className="grid gap-6 sm:grid-cols-2" data-testid="shortcuts-sheet">
        {sections.map((section) => (
          <section key={section.title} aria-label={section.title}>
            <h3 className="mb-2 text-small font-medium text-fg-2">{section.title}</h3>
            <ul className="flex flex-col gap-1">
              {section.rows.map((row) => (
                <li key={`${row.label}:${row.binding}`} className="flex items-center justify-between gap-4 text-ui">
                  <span className="min-w-0 truncate">{row.label}</span>
                  <Binding binding={row.binding} host={commandHost} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
