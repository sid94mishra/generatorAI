// ────────────────────────────────────────────────────────────────
// SystemStatusPill — the mission-control header "health light".
// Combines the live server connection with the active workload count:
//   • disconnected → danger (server unreachable)
//   • N running    → info + breathing dot
//   • all idle     → neutral, steady
// Pairs a dot with a label so state is never conveyed by color alone.
// ────────────────────────────────────────────────────────────────

import { cn } from '@/lib/utils.js';

export interface SystemStatusPillProps {
  connected: boolean;
  runningCount: number;
  className?: string;
}

export function SystemStatusPill({ connected, runningCount, className }: SystemStatusPillProps) {
  const tone = !connected ? 'danger' : runningCount > 0 ? 'info' : 'idle';

  const label = !connected
    ? 'Disconnected'
    : runningCount > 0
      ? `${runningCount} running`
      : 'All systems idle';

  const DOT: Record<typeof tone, string> = {
    danger: 'bg-danger',
    info: 'bg-info',
    idle: 'bg-muted-foreground',
  };
  const TEXT: Record<typeof tone, string> = {
    danger: 'text-danger',
    info: 'text-info',
    idle: 'text-muted-foreground',
  };

  const animated = tone !== 'idle';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-2 w-2 items-center justify-center">
        <span className={cn('h-2 w-2 rounded-full', DOT[tone], animated && 'animate-status-breathe')} />
      </span>
      <span className={cn('tabular-nums', TEXT[tone])}>{label}</span>
    </span>
  );
}
