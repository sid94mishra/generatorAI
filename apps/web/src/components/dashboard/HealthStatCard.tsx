// ────────────────────────────────────────────────────────────────
// HealthStatCard — the 4th metric card on the dashboard top row.
// Unlike the numeric StatCards, this shows the live server connection
// (Connected / Degraded / Disconnected) with a breathing status dot and
// the server uptime beneath. Clicking opens Settings → Diagnostics.
// Matches StatCard's anatomy so the row stays visually uniform.
// ────────────────────────────────────────────────────────────────

import { Radio } from 'lucide-react';
import { Card } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';
import type { SystemHealth } from '@/platform/HttpPlatformClient.js';

export interface HealthStatCardProps {
  health: SystemHealth | undefined;
  isError: boolean;
  onClick?: () => void;
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function HealthStatCard({ health, isError, onClick }: HealthStatCardProps) {
  const connected = !isError && !!health;
  const degraded = connected && health?.status === 'degraded';

  const tone = !connected ? 'danger' : degraded ? 'warning' : 'success';
  const label = !connected ? 'Disconnected' : degraded ? 'Degraded' : 'Connected';

  const DOT: Record<string, string> = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' };
  const TEXT: Record<string, string> = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' };
  const CHIP: Record<string, string> = {
    success: 'bg-[var(--color-success-muted)] text-[var(--color-success)]',
    warning: 'bg-[var(--color-warning-muted)] text-[var(--color-warning)]',
    danger: 'bg-[var(--color-danger-muted)] text-[var(--color-danger)]',
  };

  const uptime = connected && health ? formatUptime(health.uptime) : null;

  return (
    <Card
      interactive={!!onClick}
      // Same fix as `StatCard`: a clickable `Card` is a plain <div>, so
      // without these the card is mouse-only and unreachable by keyboard or
      // assistive tech. Mirrors the pattern `EntityCard` already uses.
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
      )}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
          System Health
        </p>
        <p className={cn('mt-1 flex items-center gap-1.5 text-lg font-semibold', TEXT[tone])}>
          <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[tone], connected && 'animate-status-breathe')} />
          {label}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {uptime ? `Uptime ${uptime}` : 'No response from server'}
        </p>
      </div>
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', CHIP[tone])}>
        <Radio className="h-5 w-5" />
      </div>
    </Card>
  );
}
