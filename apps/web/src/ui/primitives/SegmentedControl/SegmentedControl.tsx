// ────────────────────────────────────────────────────────────────
// P-25 SegmentedControl (03 §2 P-25; Rosetta `.seg` with `button.on`).
//
// Track: pad 2, seg radius, `bg-sunken`, 1px `line-soft`, gap 2. Items 24h
// (sm) / 28h in a 32h track (md), pad 0 10, small 500 fg-2; selected
// `bg-raised text-fg` + 1px `line` ring. Items may carry an icon, a mono
// count, be icon-only (`ariaLabel` is then the accessible name) or disabled with a
// `reason` tooltip. `fullWidth` stretches the items.
//
// `semantics` says what the control does (03 §10 issue 9):
//   radio — picks a value (mode, density, effort): Base UI RadioGroup/Radio.
//   tabs  — scopes a list (All / Active / Archived): Base UI Tabs (tablist).
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Tabs } from '@base-ui/react/tabs';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { focusRing } from '../../lib/focus.js';
import { Icon } from '../../icons/Icon.js';
import { Tooltip } from '../Tooltip/Tooltip.js';

export interface SegmentedItem<V extends string = string> {
  value: V;
  /** Visible text. Omit for an icon-only item and give `ariaLabel` instead. */
  label?: string;
  /** Accessible name for icon-only items ("List view"). */
  ariaLabel?: string;
  icon?: IconConcept;
  count?: ReactNode;
  disabled?: boolean;
  /** Why it is disabled: shown as a tooltip. */
  reason?: string;
}

const trackVariants = cva('inline-flex items-center gap-0.5 rounded-seg border border-line-soft bg-sunken p-0.5', {
  variants: {
    size: { sm: '', md: 'h-control-lg' },
    fullWidth: { true: 'flex w-full', false: '' },
  },
  defaultVariants: { size: 'sm', fullWidth: false },
});

const itemVariants = cva(
  [
    'inline-flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-control-sm px-2.5 text-small font-medium whitespace-nowrap text-fg-2 select-none',
    'transition-control hover:text-fg',
    'aria-checked:bg-raised aria-checked:text-fg aria-checked:ring-1 aria-checked:ring-line',
    'aria-selected:bg-raised aria-selected:text-fg aria-selected:ring-1 aria-selected:ring-line',
    'data-disabled:cursor-not-allowed data-disabled:opacity-45 data-disabled:hover:text-fg-2',
    focusRing,
  ],
  {
    variants: {
      size: { sm: 'h-control-sm', md: 'h-control' },
      iconOnly: { true: 'px-1.75', false: '' },
      fullWidth: { true: 'flex-1', false: '' },
    },
    defaultVariants: { size: 'sm', iconOnly: false, fullWidth: false },
  },
);

export interface SegmentedControlProps<V extends string = string> {
  value: V;
  onValueChange: (value: V) => void;
  items: readonly SegmentedItem<V>[];
  /** `radio` picks a value; `tabs` scopes a list. Default `radio`. */
  semantics?: 'radio' | 'tabs';
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  /** Accessible name of the group ("Chat scope", "Density"). */
  label: string;
  className?: string;
  'data-testid'?: string;
}

function ItemContent({ item }: { item: SegmentedItem }) {
  return (
    <>
      {item.icon ? <Icon concept={item.icon} size={14} /> : null}
      {item.label ? <span className="truncate">{item.label}</span> : null}
      {item.count != null ? <span className="font-mono text-micro text-fg-3">{item.count}</span> : null}
    </>
  );
}

/** A small set of mutually exclusive options drawn as one pill track. */
export function SegmentedControl<V extends string = string>({
  value,
  onValueChange,
  items,
  semantics = 'radio',
  size = 'sm',
  fullWidth = false,
  label,
  className,
  'data-testid': testId,
}: SegmentedControlProps<V>) {
  const track = cn(trackVariants({ size, fullWidth }), className);
  const withReason = (item: SegmentedItem<V>, node: ReactNode) =>
    item.disabled && item.reason ? (
      <Tooltip key={item.value} content={item.reason}>
        <span className="inline-flex">{node}</span>
      </Tooltip>
    ) : (
      node
    );
  const itemClass = (item: SegmentedItem<V>) =>
    itemVariants({ size, iconOnly: !item.label, fullWidth });

  if (semantics === 'tabs') {
    return (
      <Tabs.Root value={value} onValueChange={(next) => onValueChange(next as V)}>
        <Tabs.List aria-label={label} className={track} data-testid={testId}>
          {items.map((item) =>
            withReason(
              item,
              <Tabs.Tab
                key={item.value}
                value={item.value}
                disabled={item.disabled}
                aria-label={item.label ? undefined : item.ariaLabel}
                className={itemClass(item)}
              >
                <ItemContent item={item} />
              </Tabs.Tab>,
            ),
          )}
        </Tabs.List>
      </Tabs.Root>
    );
  }

  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onValueChange(next as V)}
      aria-label={label}
      className={track}
      data-testid={testId}
    >
      {items.map((item) =>
        withReason(
          item,
          <Radio.Root
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            aria-label={item.label ? undefined : item.ariaLabel}
            className={itemClass(item)}
          >
            <ItemContent item={item} />
          </Radio.Root>,
        ),
      )}
    </RadioGroup>
  );
}
