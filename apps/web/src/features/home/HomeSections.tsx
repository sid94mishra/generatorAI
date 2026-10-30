// ────────────────────────────────────────────────────────────────
// Home activity sections (F-home-04…06): Needs you (inline Allow once /
// Approve + Review; a risky gate carries the "Risky" badge), Running (Stop / Cancel) — both from the attention feed
// (G-01) — and Recently finished (G-11, Retry). C-12 SectionHeader over a
// card of C-08 ActivityRows. A section with no items renders nothing (D-36);
// while loading it shows skeleton rows, on error an inline Retry.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import type { AttentionItem, RecentActivityItem, StatusState } from '@generatorai/shared';
import { PERMISSION_GATE_COPY } from '@generatorai/shared/ui-contract';
import { useAttentionAction } from '@/hooks/attentionQueries.js';
import { useRecentActivity, useRetryActivity } from '@/hooks/activityQueries.js';
import { formatElapsed, useNow } from '@/lib/elapsed.js';
import { ActivityRow } from '@/ui/patterns/ActivityRow/ActivityRow.js';
import { DiffStat } from '@/ui/patterns/DiffStat/DiffStat.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { formatAge, formatEndedAt, needsYouActions, needsYouDetail } from './homeModel.js';

/** How many finished items Home lists. */
const RECENT_LIMIT = 6;

function Section({ title, count, countTone, testId, children }: {
  title: string;
  count?: number;
  countTone?: 'warn' | 'run';
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title} data-testid={testId}>
      <SectionHeader title={title} count={count} countTone={countTone} />
      <Card>{children}</Card>
    </section>
  );
}

function TitleLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link render={<RouterLink to={href} />}>{children}</Link>;
}

// ── Needs you ─────────────────────────────────────────────────

export function NeedsYouSection({ items }: { items: readonly AttentionItem[] }) {
  const navigate = useNavigate();
  const act = useAttentionAction();
  const now = useNow(items.length > 0, 30_000);
  if (items.length === 0) return null;
  return (
    <Section title="Needs you" count={items.length} countTone="warn" testId="home-needs-you">
      {items.map((item) => {
        const { primary, openLabel } = needsYouActions(item);
        const pending = act.isPending && act.variables?.item.entityId === item.entityId;
        return (
          <ActivityRow
            key={item.key}
            status="needs_you"
            twoLine
            persistentActions
            title={<TitleLink href={item.href}>{item.title}</TitleLink>}
            context={item.project?.name}
            detail={needsYouDetail(item)}
            time={formatAge(item.since, now)}
            data-testid="home-needs-you-row"
            actions={
              <>
                {/* MG-04: the server's verdict, as on the gate card; the answer stays a click here. */}
                {item.ask?.risk === 'risky' ? <Badge>{PERMISSION_GATE_COPY.risky}</Badge> : null}
                <Button size="sm" onClick={() => navigate(item.href)} aria-label={`${openLabel} ${item.title}`}>
                  {openLabel}
                </Button>
                {primary ? (
                  <Button
                    size="sm"
                    icon="check"
                    loading={pending}
                    aria-label={`${primary.label} ${item.title}`}
                    onClick={() => act.mutate({ item, action: primary.action })}
                  >
                    {primary.label}
                  </Button>
                ) : null}
              </>
            }
          />
        );
      })}
    </Section>
  );
}

// ── Running ───────────────────────────────────────────────────

function runningDetail(item: AttentionItem): string | undefined {
  const p = item.progress;
  if (!p) return undefined;
  const step = p.step !== undefined && p.of !== undefined ? `Stage ${p.step} of ${p.of}` : undefined;
  const parts = [step, p.label].filter((s): s is string => !!s);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function RunningSection({ items }: { items: readonly AttentionItem[] }) {
  const act = useAttentionAction();
  const now = useNow(items.length > 0);
  if (items.length === 0) return null;
  return (
    <Section title="Running" count={items.length} countTone="run" testId="home-running">
      {items.map((item) => {
        const verb = item.entity === 'workflow_run' ? 'Cancel' : 'Stop';
        return (
          <ActivityRow
            key={item.key}
            status={item.state}
            title={<TitleLink href={item.href}>{item.title}</TitleLink>}
            context={item.project?.name}
            detail={runningDetail(item)}
            time={formatElapsed(item.since, now)}
            data-testid="home-running-row"
            persistentActions
            actions={
              item.stoppable ? (
                <IconButton
                  icon="stop"
                  size="sm"
                  label={`${verb} ${item.title}`}
                  loading={act.isPending && act.variables?.item.entityId === item.entityId}
                  onClick={() => act.mutate({ item, action: 'stop' })}
                />
              ) : undefined
            }
          />
        );
      })}
    </Section>
  );
}

// ── Recently finished ─────────────────────────────────────────

const OUTCOME_STATE: Record<RecentActivityItem['outcome'], StatusState> = {
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'skipped',
};

/** What the item's work produced (MG-13): "PR #12 opened", "committed to <branch>", else a run's worktree branch. */
function scmOutcome(item: RecentActivityItem): string | undefined {
  if (item.pullRequest) return `PR #${item.pullRequest.number} opened`;
  if (item.commit?.sha) return `committed to ${item.commit.branch}`;
  return item.commit ? `on ${item.commit.branch}` : undefined;
}

function finishedDetail(item: RecentActivityItem): ReactNode {
  const text = item.outcome === 'failed' ? `Failed · ${item.summary}` : item.summary;
  const tail = [scmOutcome(item), text].filter(Boolean).join(' · ');
  // A turn that changed nothing reads like the board's rows without a diff, not "+0 −0".
  if (!item.changes || (item.changes.additions === 0 && item.changes.deletions === 0)) return tail;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <DiffStat added={item.changes.additions} removed={item.changes.deletions} />
      {tail ? <span className="truncate">· {tail}</span> : null}
    </span>
  );
}

/** Refetches when `signal` changes after the first render (something just finished). */
export function useRefetchOn(signal: number, refetch: () => unknown): void {
  const first = useRef(signal);
  useEffect(() => {
    if (signal !== first.current) void refetch();
  }, [signal, refetch]);
}

export function RecentlyFinishedSection({ finishedSignal }: { finishedSignal: number }) {
  const navigate = useNavigate();
  const activity = useRecentActivity({ limit: RECENT_LIMIT });
  const retry = useRetryActivity();
  useRefetchOn(finishedSignal, activity.refetch);
  const now = new Date();

  if (activity.isLoading) {
    return (
      <Section title="Recently finished" testId="home-recent">
        <SkeletonRows rows={3} label="Loading recent activity" />
      </Section>
    );
  }
  if (activity.isError) {
    return (
      <section className="flex flex-col gap-2" aria-label="Recently finished" data-testid="home-recent">
        <SectionHeader title="Recently finished" />
        <Callout
          tone="err"
          title="Could not load recent activity"
          action={
            <Button size="sm" onClick={() => void activity.refetch()}>
              Retry
            </Button>
          }
        />
      </section>
    );
  }
  const items = activity.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <Section title="Recently finished" testId="home-recent">
      {items.map((item) => (
        <ActivityRow
          key={item.key}
          status={OUTCOME_STATE[item.outcome]}
          title={<TitleLink href={item.href}>{item.title}</TitleLink>}
          context={item.project?.name}
          detail={finishedDetail(item)}
          time={formatEndedAt(item.endedAt, now)}
          data-testid="home-recent-row"
          persistentActions
          actions={
            item.retry ? (
              <IconButton
                icon="retry"
                size="sm"
                label={`Retry ${item.title}`}
                loading={retry.isPending && retry.variables?.entityId === item.entityId}
                onClick={() =>
                  retry.mutate(item, {
                    onSuccess: (res) => {
                      // A run retry starts a NEW run: open it; a chat retry opens the chat.
                      if (res.runId) navigate(item.href.replace(/[^/]+$/, res.runId));
                      else navigate(item.href);
                    },
                  })
                }
              />
            ) : item.pullRequest ? (
              <IconButton
                icon="pr"
                size="sm"
                label={`Open pull request ${item.pullRequest.number}`}
                render={<a href={item.pullRequest.url} target="_blank" rel="noopener noreferrer" />}
              />
            ) : undefined
          }
        />
      ))}
    </Section>
  );
}
