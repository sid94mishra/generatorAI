// ────────────────────────────────────────────────────────────────
// P-45 Collapsible + Accordion (03 §2 P-45; Base UI Collapsible, Accordion;
// Rosetta `aria-expanded` disclosure rows).
//
// API
//   <Collapsible trigger="Thought for 12s" icon="clock" variant="disclosure"
//                open? defaultOpen? onOpenChange? disabled?>panel</Collapsible>
//   <Accordion items={[{ value, trigger, icon?, disabled?, children }]}
//              variant? value? defaultValue? onValueChange? multiple?>
//   Both pass every other prop (data-testid, aria-*, id …) to the Base UI root.
//   `className` styles the root; `triggerClassName` / `panelClassName` the parts.
//   Accordion is single-open by default (Base UI); `multiple` opens several.
//   <CollapsiblePanel>  the styled panel alone, inside a Collapsible root of
//                       the caller's (StepRail rows).
//   <Reveal open motion?="height|width|slide-start">  content shown / hidden
//                       by a control of the caller's (an IconButton with
//                       aria-expanded, a toggle elsewhere): no trigger.
//
// Motion (D-109): every panel eases its height (Reveal also width or a slide)
// and fades, on the motion tokens (`motion-collapse` / `motion-accordion` /
// `motion-reveal-x` / `motion-slide-start`, globals.css), instant under
// reduced motion. A closed panel is unmounted once its close has finished and
// is inert while it closes, so collapsed content is never focusable. Spacing
// lives on an inner box (`panelClassName`), never on the moving panel: a
// padded panel could not close to 0.
//
// Trigger variants (the panel follows the trigger):
//   disclosure  24h (h-control-sm) inline row, no chrome, `text-ui text-fg-3`
//               (hover fg-2): leading 14 icon · label · chevron-right that
//               turns down when open ("Thought for 12s", "6 steps · 2m 44s").
//               24×24 hit area kept at compact density (hitSlop).
//   attached    full-width Button-like trigger (32h, `bg-raised`, 1px line,
//               card radius; bottom corners square while open) + panel in
//               `bg-sunken` with a 1px `line-soft` border and card bottom
//               corners, attached below ("Pair a new device").
//   section     28h full-width section header, `text-ui` 600 `text-fg`,
//               chevron-down at the end (flips when open).
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, ReactNode } from 'react';
import { Accordion as BaseAccordion } from '@base-ui/react/accordion';
import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible';
import type { IconConcept } from '@generatorai/design-tokens';
import { cn } from '../../lib/cn.js';
import { focusRing, hitSlop, HIT_ATTRS } from '../../lib/focus.js';
import { settleOnOpen } from '../../lib/motion.js';
import { Icon } from '../../icons/Icon.js';

export type CollapsibleVariant = 'disclosure' | 'attached' | 'section';

// ── Recipes (shared by Collapsible and Accordion) ──────────────

const TRIGGER: Record<CollapsibleVariant, string> = {
  disclosure: cn(
    'group inline-flex h-control-sm max-w-full cursor-pointer items-center gap-1.5 rounded-control-sm text-ui text-fg-3 select-none',
    'hover:not-data-disabled:text-fg-2 data-panel-open:text-fg-2 data-disabled:cursor-not-allowed',
    hitSlop,
  ),
  attached: cn(
    'group flex h-control-lg w-full cursor-pointer items-center gap-2 rounded-card border border-line bg-raised px-3 text-ui font-medium text-fg select-none',
    'hover:not-data-disabled:bg-hover data-panel-open:rounded-b-none data-disabled:cursor-not-allowed data-disabled:text-fg-3',
  ),
  section: cn(
    'group flex h-control w-full cursor-pointer items-center gap-2 rounded-control-sm text-ui font-semibold text-fg select-none',
    'data-disabled:cursor-not-allowed data-disabled:text-fg-3',
  ),
};

const PANEL: Record<CollapsibleVariant, string> = {
  disclosure: 'pt-1',
  attached: 'rounded-b-card border border-t-0 border-line-soft bg-sunken px-3 py-2.5',
  section: 'pt-2',
};

/** The chevron turns with the panel: same duration and easing as the height. */
const chevronMotion = 'transition-transform duration-normal ease-in-out';

const CHEVRON: Record<CollapsibleVariant, { concept: IconConcept; className: string }> = {
  disclosure: { concept: 'chevron-right', className: cn(chevronMotion, 'group-data-panel-open:rotate-90') },
  attached: { concept: 'chevron-down', className: cn(chevronMotion, 'ml-auto text-fg-3 group-data-panel-open:rotate-180') },
  section: { concept: 'chevron-down', className: cn(chevronMotion, 'ml-auto text-fg-3 group-data-panel-open:rotate-180') },
};

/** Inert while closing: the content on its way out is not focusable or clickable. */
const inertWhenClosed = (props: ComponentProps<'div'>, state: { open: boolean }) => (
  <div {...props} inert={!state.open || undefined} />
);

// ── CollapsiblePanel (inside a Collapsible root) ───────────────

export interface CollapsiblePanelProps
  extends Omit<ComponentProps<typeof BaseCollapsible.Panel>, 'className' | 'render' | 'keepMounted' | 'hiddenUntilFound'> {
  /** The moving panel (no padding or vertical margin: it closes to 0). */
  className?: string;
  /** The inner box: spacing, borders, background. */
  innerClassName?: string;
}

/** A Collapsible panel with the shared height + fade motion; spacing goes on the inner box. */
export function CollapsiblePanel({ className, innerClassName, children, ...rest }: CollapsiblePanelProps) {
  return (
    <BaseCollapsible.Panel ref={settleOnOpen} render={inertWhenClosed} className={cn('motion-collapse', className)} {...rest}>
      <div className={cn('min-w-0', innerClassName)}>{children}</div>
    </BaseCollapsible.Panel>
  );
}

// ── Reveal (controlled, no trigger) ────────────────────────────

export type RevealMotion = 'height' | 'width' | 'slide-start';

const REVEAL_MOTION: Record<RevealMotion, string> = {
  height: 'motion-collapse',
  width: 'motion-reveal-x',
  'slide-start': 'motion-slide-start',
};

/**
 * The `gap` of the flex column a height Reveal sits in: the gap then moves
 * with the panel (a negative top margin on the panel, the same space as
 * padding inside it), so opening is one continuous motion instead of the gap
 * appearing at once and the content easing in after it.
 */
export type RevealGap = 1 | 1.5 | 2 | 2.5 | 3 | 4;

const GAP: Record<RevealGap, { panel: string; inner: string }> = {
  1: { panel: '-mt-1', inner: 'pt-1' },
  1.5: { panel: '-mt-1.5', inner: 'pt-1.5' },
  2: { panel: '-mt-2', inner: 'pt-2' },
  2.5: { panel: '-mt-2.5', inner: 'pt-2.5' },
  3: { panel: '-mt-3', inner: 'pt-3' },
  4: { panel: '-mt-4', inner: 'pt-4' },
};

export interface RevealProps extends Omit<ComponentProps<'div'>, 'hidden' | 'inert'> {
  open: boolean;
  /** Height Reveal inside a gapped flex column, after a sibling: that column's gap. */
  gap?: RevealGap;
  /**
   * `height` (default): inline content opening downward. `width`: a docked
   * side panel opening from its edge (the child keeps its own width). `slide-start`:
   * a floating panel sliding in from the inline start.
   */
  motion?: RevealMotion;
}

/**
 * Content shown and hidden by a control of the caller's, with the shared
 * motion: mounted while open or closing, inert while closing, unmounted once
 * closed. The caller's control carries `aria-expanded` (+ `aria-controls`
 * pointing at this `id`). Put spacing inside: the element itself moves.
 */
export function Reveal({ open, motion = 'height', gap, className, children, ...rest }: RevealProps) {
  return (
    <BaseCollapsible.Root open={open} className="contents">
      <BaseCollapsible.Panel
        ref={settleOnOpen}
        render={inertWhenClosed}
        className={cn(REVEAL_MOTION[motion], gap !== undefined && GAP[gap].panel, className)}
        {...rest}
      >
        {gap !== undefined ? <div className={GAP[gap].inner}>{children}</div> : children}
      </BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  );
}

function TriggerContent({
  variant,
  icon,
  richContent = false,
  children,
}: {
  variant: CollapsibleVariant;
  icon?: IconConcept;
  /** The trigger holds multi-line content (a CatalogRow), so it is not clamped to one truncated line. */
  richContent?: boolean;
  children: ReactNode;
}) {
  const chevron = CHEVRON[variant];
  const glyph = variant === 'disclosure' ? 14 : 16;
  return (
    <>
      {icon ? <Icon concept={icon} size={glyph} /> : null}
      <span className={cn('min-w-0 flex-1 text-start', richContent ? 'py-0.5' : 'truncate')}>{children}</span>
      <Icon concept={chevron.concept} size={variant === 'disclosure' ? 12 : 14} className={cn('shrink-0', chevron.className)} />
    </>
  );
}

const triggerAttrs = (variant: CollapsibleVariant) => (variant === 'disclosure' ? HIT_ATTRS : {});

// ── Collapsible (single) ───────────────────────────────────────

export interface CollapsibleProps
  extends Omit<ComponentProps<typeof BaseCollapsible.Root>, 'className' | 'children' | 'render'> {
  /** Trigger label. */
  trigger: ReactNode;
  variant?: CollapsibleVariant;
  /** Leading glyph in the trigger. */
  icon?: IconConcept;
  children: ReactNode;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
  /**
   * A control that sits OUTSIDE the trigger, on the same row (a Switch, a
   * busy Spinner) — never nested inside it, so an interactive control is
   * never a button inside a button (the settings CatalogRow: Skills, MCP
   * servers, Model providers).
   */
  endSlot?: ReactNode;
  /** The trigger holds multi-line content instead of one truncated label (a CatalogRow). */
  richContent?: boolean;
}

/** One show/hide region with its trigger, and an optional external control on the trigger's row. */
export function Collapsible({
  trigger,
  variant = 'disclosure',
  icon,
  children,
  className,
  triggerClassName,
  panelClassName,
  endSlot,
  richContent = false,
  ...rest
}: CollapsibleProps) {
  const triggerNode = (
    <BaseCollapsible.Trigger
      className={cn(
        TRIGGER[variant],
        variant === 'disclosure' && 'self-start',
        endSlot != null && 'min-w-0 flex-1',
        richContent && 'items-start',
        focusRing,
        triggerClassName,
      )}
      {...triggerAttrs(variant)}
    >
      <TriggerContent variant={variant} icon={icon} richContent={richContent}>
        {trigger}
      </TriggerContent>
    </BaseCollapsible.Trigger>
  );
  return (
    <BaseCollapsible.Root className={cn('flex min-w-0 flex-col items-stretch', className)} {...rest}>
      {endSlot != null ? (
        <div className="flex items-center gap-2">
          {triggerNode}
          <div className="shrink-0">{endSlot}</div>
        </div>
      ) : (
        triggerNode
      )}
      <CollapsiblePanel innerClassName={cn(PANEL[variant], panelClassName)}>{children}</CollapsiblePanel>
    </BaseCollapsible.Root>
  );
}

// ── Accordion (grouped) ────────────────────────────────────────

export interface AccordionItemData {
  /** Stable id; the Accordion value is the list of open ids. */
  value: string;
  trigger: ReactNode;
  icon?: IconConcept;
  disabled?: boolean;
  children: ReactNode;
  /** Passed to the item root (e2e hook). */
  'data-testid'?: string;
}

export interface AccordionProps
  extends Omit<BaseAccordion.Root.Props<string>, 'className' | 'children' | 'render'> {
  items: readonly AccordionItemData[];
  variant?: CollapsibleVariant;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
}

/** A group of collapsibles with arrow-key navigation between triggers; single-open unless `multiple`. */
export function Accordion({
  items,
  variant = 'section',
  className,
  triggerClassName,
  panelClassName,
  ...rest
}: AccordionProps) {
  return (
    <BaseAccordion.Root<string>
      className={cn('flex min-w-0 flex-col', variant === 'attached' ? 'gap-2' : 'gap-1', className)}
      {...rest}
    >
      {items.map((item) => (
        <BaseAccordion.Item
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          data-testid={item['data-testid']}
          className="flex min-w-0 flex-col items-stretch"
        >
          <BaseAccordion.Header className="flex min-w-0">
            <BaseAccordion.Trigger className={cn(TRIGGER[variant], focusRing, triggerClassName)} {...triggerAttrs(variant)}>
              <TriggerContent variant={variant} icon={item.icon}>
                {item.trigger}
              </TriggerContent>
            </BaseAccordion.Trigger>
          </BaseAccordion.Header>
          <BaseAccordion.Panel ref={settleOnOpen} render={inertWhenClosed} className="motion-accordion">
            <div className={cn('min-w-0', PANEL[variant], panelClassName)}>{item.children}</div>
          </BaseAccordion.Panel>
        </BaseAccordion.Item>
      ))}
    </BaseAccordion.Root>
  );
}
