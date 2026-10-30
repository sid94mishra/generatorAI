// ────────────────────────────────────────────────────────────────
// Home right column (F-home-07…09): This week (G-10 stats), System (G-12)
// and the shortcut counts. Every row or tile is real data or absent (D-36):
// a rate or duration the server omitted is not drawn, a count still loading
// shows nothing rather than zero.
// ────────────────────────────────────────────────────────────────

import { useMemo, type MouseEvent } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { useAttention } from '@/hooks/attentionQueries.js';
import { useStatsSummary } from '@/hooks/statsQueries.js';
import { useSystemInfo } from '@/hooks/systemQueries.js';
import { useShellStatus } from '@/hooks/useShellStatus.js';
import { useProjects } from '@/hooks/projectQueries.js';
import { useAgents } from '@/hooks/agentQueries.js';
import { useAutomations } from '@/hooks/automationQueries.js';
import { useScripts } from '@/hooks/scriptQueries.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';
import { KeyValueList, type KeyValueItem } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { StatStrip, type StatTileItem } from '@/ui/patterns/StatStrip/StatStrip.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { Count } from '@/ui/primitives/Count/Count.js';
import { NavItem } from '@/ui/primitives/NavItem/NavItem.js';
import { ProgressBar } from '@/ui/primitives/ProgressBar/ProgressBar.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { StatusDot } from '@/ui/primitives/StatusDot/StatusDot.js';
import {
  formatBytes,
  formatDuration,
  formatPercent,
  formatUptime,
  formatWeekRange,
  localeFirstDay,
  weekRange,
} from './homeModel.js';
import { useRefetchOn } from './HomeSections.js';

// ── This week ─────────────────────────────────────────────────

export function ThisWeekCard({ finishedSignal }: { finishedSignal: number }) {
  const navigate = useNavigate();
  const locale = typeof navigator === 'undefined' ? undefined : navigator.language;
  const range = useMemo(() => weekRange(new Date(), localeFirstDay(locale)), [locale]);
  const query = useMemo(() => ({ from: range.from.toISOString(), to: range.to.toISOString() }), [range]);
  const stats = useStatsSummary(query);
  useRefetchOn(finishedSignal, stats.refetch);

  const tiles: StatTileItem[] = [];
  if (stats.data) {
    const { chats, runs } = stats.data;
    tiles.push({ value: chats.created, label: 'Chats', href: '/chats' });
    tiles.push({ value: runs.total, label: 'Workflow runs', href: '/workflows' });
    if (runs.successRate !== undefined) tiles.push({ value: formatPercent(runs.successRate), label: 'Run success rate' });
    if (runs.avgDurationMs !== undefined) tiles.push({ value: formatDuration(runs.avgDurationMs), label: 'Avg run time' });
  }

  // StatStrip's tile links are plain anchors (the kit has no router): route them client-side.
  const routeLinkClicks = (event: MouseEvent<HTMLElement>) => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    const href = anchor.getAttribute('href');
    if (!href?.startsWith('/')) return;
    event.preventDefault();
    navigate(href);
  };

  return (
    <Card data-testid="home-this-week">
      <Card.Header title="This week" meta={formatWeekRange(range, locale)} />
      {stats.isError ? (
        <Card.Body>
          <Callout
            tone="err"
            title="Could not load this week's numbers"
            action={
              <Button size="sm" onClick={() => void stats.refetch()}>
                Retry
              </Button>
            }
          />
        </Card.Body>
      ) : tiles.length > 0 ? (
        // Delegates the tile anchors' clicks; the anchors keep their own keyboard behaviour.
        <div onClick={routeLinkClicks}>
          <StatStrip layout="grid" items={tiles} className="rounded-none border-0 bg-transparent" />
        </div>
      ) : (
        <SkeletonRows rows={2} label="Loading this week" />
      )}
    </Card>
  );
}

// ── System ────────────────────────────────────────────────────

export function SystemCard() {
  const info = useSystemInfo();
  // "N running" is the Running list's own count (top-level chats with an active
  // turn or working background tasks, live runs and executions) — one definition.
  const running = useAttention().data?.counts.running;
  const shell = useShellStatus();
  const openSettings = useSettingsUiStore((s) => s.openSettings);

  const top: KeyValueItem[] = [
    {
      label: 'Server',
      value: (
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={shell.connection.tone} size="sm" />
          {shell.connection.label}
        </span>
      ),
      ...(shell.address ? { meta: shell.address } : {}),
    },
  ];
  const bottom: KeyValueItem[] = [];
  const data = info.data;
  if (data) {
    top.push({
      label: 'Agents',
      value: running !== undefined ? `${running} running` : '',
      meta: `max ${data.agents.max}`,
    });
    top.push({
      label: 'Database',
      value: 'SQLite',
      ...(data.database.sizeBytes !== undefined ? { meta: formatBytes(data.database.sizeBytes) } : {}),
    });
    bottom.push({ label: 'Uptime', value: formatUptime(data.uptimeSec), mono: true });
    bottom.push({ label: 'Version', value: data.serverVersion, mono: true });
  }
  const disk = data?.disk;

  return (
    <Card data-testid="home-system">
      <Card.Header
        title="System"
        action={
          <Button variant="ghost" size="sm" onClick={() => openSettings('diagnostics')}>
            Diagnostics
          </Button>
        }
      />
      <Card.Body>
        <KeyValueList items={top} labelWidth={72} dense />
        {disk && disk.totalBytes > 0 ? (
          // The meter's own label row reads "Disk · 182 GB / 476 GB … 38%".
          <ProgressBar
            value={disk.usedBytes}
            max={disk.totalBytes}
            kind="meter"
            label={`Disk · ${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}`}
          />
        ) : null}
        {bottom.length > 0 ? <KeyValueList items={bottom} labelWidth={72} dense /> : null}
        {info.isError ? (
          <Callout
            tone="err"
            title="Could not load system info"
            action={
              <Button size="sm" onClick={() => void info.refetch()}>
                Retry
              </Button>
            }
          />
        ) : null}
      </Card.Body>
    </Card>
  );
}

// ── Shortcuts ─────────────────────────────────────────────────

export function ShortcutsCard() {
  const projects = useProjects();
  const agents = useAgents();
  const automations = useAutomations();
  const scripts = useScripts();
  const rows = [
    { label: 'Projects', icon: 'projects', to: '/projects', count: projects.data?.length },
    { label: 'Agents', icon: 'agents', to: '/agents', count: agents.data?.length },
    { label: 'Automations', icon: 'automations', to: '/automations', count: automations.data?.length },
    { label: 'Scripts', icon: 'scripts', to: '/scripts', count: scripts.data?.length },
  ] as const;
  return (
    <Card className="p-1.5" data-testid="home-shortcuts">
      <nav aria-label="Shortcuts" className="flex flex-col">
        {rows.map((row) => (
          <NavItem
            key={row.to}
            icon={row.icon}
            label={row.label}
            count={row.count !== undefined ? <Count>{row.count}</Count> : undefined}
            render={<RouterLink to={row.to} />}
          />
        ))}
      </nav>
    </Card>
  );
}
