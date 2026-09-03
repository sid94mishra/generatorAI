// ────────────────────────────────────────────────────────────────
// StatCard — canonical metric card (Dashboard + Project detail)
// Compact, consistent: label + value + optional icon, neutral numerals
// (color is reserved for status, not the metric value itself).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { cn } from '@/lib/utils.js';
import { Card } from './Card.js';

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  /** Optional tint for the icon chip (default: muted) */
  iconTone?: 'primary' | 'success' | 'warning' | 'info' | 'muted';
  onClick?: () => void;
  className?: string;
}

const ICON_TONES: Record<NonNullable<StatCardProps['iconTone']>, string> = {
  primary: 'bg-[var(--color-info-muted)] text-[var(--color-primary)]',
  success: 'bg-[var(--color-success-muted)] text-[var(--color-success)]',
  warning: 'bg-[var(--color-warning-muted)] text-[var(--color-warning)]',
  info: 'bg-[var(--color-info-muted)] text-[var(--color-info)]',
  muted: 'bg-[var(--color-subtle)] text-[var(--color-muted-foreground)]',
};

export function StatCard({ label, value, icon, iconTone = 'muted', onClick, className }: StatCardProps) {
  return (
    <Card
      interactive={!!onClick}
      // A clickable `Card` is a plain <div>, so without these a stat card is
      // mouse-only: unreachable by keyboard and invisible to assistive tech
      // (and to `getByRole('button')`). The Dashboard's Chats / Workflows /
      // Automations cards are the app's primary navigation into those lists,
      // so that was a real dead end, not a cosmetic gap. Mirrors the pattern
      // `EntityCard` already uses.
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        'flex items-center justify-between gap-3 px-4 py-3.5',
        onClick && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
          {label}
        </p>
        {/* Neutral numerals — color is reserved for status, not the value */}
        <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-foreground)]">{value}</p>
      </div>
      {icon && (
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', ICON_TONES[iconTone])}>
          {icon}
        </div>
      )}
    </Card>
  );
}
