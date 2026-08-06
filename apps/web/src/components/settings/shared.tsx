// ────────────────────────────────────────────────────────────────
// Settings section shared primitives — a consistent anatomy for every
// section of the Settings modal: a titled card, a labeled setting row,
// a read-only info row, and a status pill. Keeps sections dense and
// visually uniform (Linear/Vercel reference) using only design tokens.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Check, X, Minus, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils.js';

/** Header for a whole settings section (the right-pane title). */
export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

/** A titled card grouping related settings. */
export function SettingsCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-border bg-card', className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-medium text-foreground">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

/** A single labeled setting row with a control on the right. */
export function SettingRow({
  label,
  description,
  control,
  className,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-2', className)}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/**
 * A lightweight header for a flat list section (count/title on the left,
 * an action such as a search box or Add button on the right). Use this
 * instead of wrapping a list in a titled SettingsCard so rows aren't
 * double-boxed.
 */
export function SectionListHeader({
  title,
  action,
  className,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** A read-only key/value info row with an optional status tone. */
export function InfoRow({
  label,
  value,
  tone,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: 'success' | 'danger' | 'warning' | 'muted';
}) {
  const TONE: Record<string, string> = {
    success: 'text-success',
    danger: 'text-danger',
    warning: 'text-warning',
    muted: 'text-muted-foreground',
  };
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 text-right font-medium tabular-nums', tone ? TONE[tone] : 'text-foreground')}>{value}</span>
    </div>
  );
}

/** Small status dot + label for a boolean/ok state. */
export function StatusPip({ state, children }: { state: 'ok' | 'bad' | 'neutral'; children: React.ReactNode }) {
  const Icon = state === 'ok' ? Check : state === 'bad' ? X : Minus;
  const tone =
    state === 'ok' ? 'text-success' : state === 'bad' ? 'text-danger' : 'text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', tone)}>
      <Icon className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

/**
 * A consistent expandable catalog row used by Skills / MCP / Providers.
 * The disclosure affordance is a LEFT-aligned right-chevron that rotates
 * down when open; an optional leading brand/type icon sits next to it, the
 * title/subtitle fill the middle, and an arbitrary `control` (usually a
 * Switch) is pinned to the right. Expanded `children` render below a divider.
 */
export function CatalogAccordionRow({
  icon,
  title,
  badge,
  subtitle,
  control,
  expanded,
  onToggleExpanded,
  disabled,
  children,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  badge?: React.ReactNode;
  subtitle?: React.ReactNode;
  control?: React.ReactNode;
  expanded: boolean;
  onToggleExpanded: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-card transition-colors', disabled && 'opacity-60', expanded && 'border-primary/40')}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none"
        >
          <ChevronRight
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150',
              expanded && 'rotate-90 text-primary',
            )}
          />
          {icon && (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-subtle text-foreground">
              {icon}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">{title}</span>
              {badge}
            </span>
            {subtitle && (
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>
            )}
          </span>
        </button>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {expanded && children && (
        <div className="border-t border-border bg-subtle/30 px-3.5 py-3">{children}</div>
      )}
    </div>
  );
}
