// ────────────────────────────────────────────────────────────────
// CatalogRow — the expandable list row shared by Model providers, Skills
// and MCP servers (04 §3.1 F-settings-04/06/07; replaces
// `components/settings/shared.tsx`'s `CatalogAccordionRow`). Built on the
// kit's `Collapsible` (`attached` variant) with its `endSlot`, so a row's
// on/off toggle sits OUTSIDE the disclosure trigger — never a button nested
// inside a button.
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '@/ui/lib/cn.js';
import { Collapsible } from '@/ui/primitives/Collapsible/Collapsible.js';
import { Icon } from '@/ui/icons/Icon.js';

export interface CatalogRowProps {
  icon?: IconConcept;
  title: ReactNode;
  badges?: ReactNode;
  subtitle?: ReactNode;
  /** Sits to the right of the trigger, outside it (a Switch, a busy Spinner). */
  control?: ReactNode;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
  'data-testid'?: string;
}

/** One catalog entry: a disclosure row, an optional external control, and an expanded detail panel. */
export function CatalogRow({
  icon,
  title,
  badges,
  subtitle,
  control,
  disabled,
  open,
  onOpenChange,
  children,
  'data-testid': testId,
}: CatalogRowProps) {
  return (
    <Collapsible
      variant="attached"
      richContent
      open={open}
      onOpenChange={onOpenChange}
      endSlot={control}
      className={cn(disabled && 'opacity-60')}
      triggerClassName="h-auto min-h-control-lg items-center py-1.5"
      data-testid={testId}
      trigger={
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          {icon ? (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-control-sm border border-line bg-sunken text-fg-2">
              <Icon concept={icon} size={14} />
            </span>
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-ui font-medium text-fg">{title}</span>
              {badges}
            </span>
            {subtitle != null ? <span className="mt-0.5 block truncate text-small text-fg-3">{subtitle}</span> : null}
          </span>
        </span>
      }
    >
      {children}
    </Collapsible>
  );
}
