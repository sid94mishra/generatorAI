// shortcutFor — one command's key chips for this host (D-24 `SHORTCUTS`), for
// tooltips: `['Ctrl','K']`, `['⌘','K']`; undefined when unbound or a sequence.
// Shared by the shell (app/shell) and page headers (features/*).

import { bindingFor, formatBinding, type RendererCommandId } from '@generatorai/shared/ui-contract';
import { commandHost, isMacOS } from './desktop.js';

export function shortcutFor(id: RendererCommandId): readonly string[] | undefined {
  const binding = bindingFor(id, commandHost);
  if (!binding) return undefined;
  const chords = formatBinding(binding, commandHost, { mac: isMacOS });
  return chords.length === 1 ? chords[0] : undefined;
}
