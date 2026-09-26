// ────────────────────────────────────────────────────────────────
// F-composer-14 — "Tools in this chat": the composer tool-toggle registry's
// entries as switches. Rendered only when at least one entry applies to the
// chat (see `toolToggles.ts`).
// ────────────────────────────────────────────────────────────────

import type { IconConcept } from '@generatorai/design-tokens';
import type { ComposerToolToggleId } from '@generatorai/shared/ui-contract';
import { Icon } from '@/ui/icons/Icon.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from '@/ui/primitives/Popover/Popover.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';

export interface ToolsPopoverItem {
  id: ComposerToolToggleId;
  label: string;
  hint: string;
  icon: IconConcept;
  on: boolean;
  pending: boolean;
}

export function ToolsPopover({
  items,
  onToggle,
  disabled,
}: {
  items: ToolsPopoverItem[];
  onToggle: (id: ComposerToolToggleId, on: boolean) => void;
  disabled?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <PopoverRoot>
      <PopoverTrigger disabled={disabled} render={<IconButton icon="tool" size="sm" label="Tools in this chat" />} />
      <PopoverPopup side="top" align="start" className="flex w-72 flex-col p-1">
        <PopoverTitle className="flex h-step items-center px-2 text-small text-fg-3">Tools in this chat</PopoverTitle>
        {items.map((item) => (
          <div key={item.id} className="flex min-h-10 items-center gap-2 rounded-control-sm px-2 py-1">
            <Icon concept={item.icon} size={16} className="shrink-0 text-fg-3" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-ui text-fg">{item.label}</span>
              <span className="text-small text-fg-3">{item.hint}</span>
            </span>
            <Switch
              checked={item.on}
              disabled={item.pending}
              aria-label={item.label}
              onCheckedChange={(on) => onToggle(item.id, on)}
            />
          </div>
        ))}
      </PopoverPopup>
    </PopoverRoot>
  );
}
