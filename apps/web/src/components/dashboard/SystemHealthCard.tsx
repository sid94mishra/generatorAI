// ────────────────────────────────────────────────────────────────
// SystemHealthCard — the mission-control "heartbeat" card.
// A compact vertical card: a prominent live connection status at the
// top (breathing pulse) followed by a stacked list of health readouts
// (uptime, agent, database, active workload). Fed by the polled
// /api/health snapshot.
// ────────────────────────────────────────────────────────────────

import { Activity, Cpu, Database, MessageSquare, GitBranch, Radio, Clock } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import type { SystemHealth } from '@/platform/HttpPlatformClient.js';

export interface SystemHealthCardProps {
  health: SystemHealth | undefined;
  /** True when the most recent poll failed → server unreachable. */
  isError: boolean;
  /** Epoch ms of the last successful poll (for "synced Xs ago"). */
  lastUpdated?: number;
  now: number;
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function SystemHealthCard({ health, isError, lastUpdated, now }: SystemHealthCardProps) {
  const connected = !isError && !!health;
  const degraded = connected && health?.status === 'degraded';

  const connTone = !connected ? 'danger' : degraded ? 'warning' : 'success';
  const connLabel = !connected ? 'Disconnected' : degraded ? 'Degraded' : 'Connected';
  const DOT: Record<string, string> = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' };
  const TEXT: Record<string, string> = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' };

  const syncedAgo = lastUpdated ? Math.max(0, Math.round((now - lastUpdated) / 1000)) : null;

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">System Health</h2>
        </div>
      </div>

      {/* Connection hero */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-subtle">
          <span className={cn('h-2.5 w-2.5 rounded-full', DOT[connTone], connected && 'animate-status-breathe')} />
        </span>
        <div className="min-w-0">
          <p className={cn('text-sm font-semibold', TEXT[connTone])}>{connLabel}</p>
          <p className="text-[11px] text-muted-foreground">
            {connected
              ? syncedAgo !== null ? `Heartbeat · synced ${syncedAgo}s ago` : 'Heartbeat · live'
              : 'No response from server'}
          </p>
        </div>
      </div>

      {/* Readouts */}
      <div className="flex flex-col divide-y divide-border">
        <HealthRow icon={<Clock className="h-4 w-4" />} label="Uptime"
          value={health ? formatUptime(health.uptime) : '—'} />
        <HealthRow icon={<Cpu className="h-4 w-4" />} label="Agent provider"
          value={health ? health.harness.type : '—'}
          tone={health ? (health.harness.healthy ? 'success' : 'danger') : undefined} />
        <HealthRow icon={<Database className="h-4 w-4" />} label="Database"
          value={health ? (health.db ? 'Healthy' : 'Down') : '—'}
          tone={health ? (health.db ? 'success' : 'danger') : undefined} />
        <HealthRow icon={<MessageSquare className="h-4 w-4" />} label="Active chats"
          value={health ? String(health.activeChats) : '—'} />
        <HealthRow icon={<GitBranch className="h-4 w-4" />} label="Active runs"
          value={health ? String(health.activeWorkflowRuns) : '—'} />
        <HealthRow icon={<Activity className="h-4 w-4" />} label="Running chats"
          value={health ? String(health.runningChatIds.length) : '—'} />
      </div>
    </section>
  );
}

interface HealthRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'success' | 'warning' | 'danger';
}

function HealthRow({ icon, label, value, tone }: HealthRowProps) {
  const TEXT: Record<string, string> = {
    success: 'text-success', warning: 'text-warning', danger: 'text-danger',
  };
  return (
    <div className="flex items-center justify-between px-5 py-2.5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <span className={cn('text-xs font-semibold tabular-nums', tone ? TEXT[tone] : 'text-foreground')}>
        {value}
      </span>
    </div>
  );
}
