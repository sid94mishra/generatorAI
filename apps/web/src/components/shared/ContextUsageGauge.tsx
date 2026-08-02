// ────────────────────────────────────────────────────────────────
// ContextUsageGauge — the one context-window indicator.
//
// Replaces the two divergent implementations that used to exist (the
// chat composer's inline ring and the workflow stage gauge), which
// computed different numerators against different denominators and so
// disagreed with each other and with the model picker.
//
// Everything it renders comes from `resolveContextUsage`, so the
// number here is the same number the picker shows. When the provider
// hasn't reported a limit we render an "unknown" state rather than
// dividing by a guess.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils.js';
import {
  contextRingColor,
  formatPctLabel,
  formatTokens,
  resolveContextUsage,
  type ContextUsageSnapshot,
  type ModelLimits,
  type ResolvedContextUsage,
  type TurnUsage,
} from '@generatorai/client-core';

/** Small circular fill indicator. */
export function ContextRing({
  pct,
  size = 18,
  stroke = 2.5,
}: {
  pct: number | null;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const color = contextRingColor(pct);
  const fill = pct ?? 0;
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={stroke} />
        {pct != null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - fill)}
          />
        )}
      </svg>
    </span>
  );
}

interface ContextUsageGaugeProps {
  snapshot?: ContextUsageSnapshot | null;
  usage?: TurnUsage | null;
  model?: (ModelLimits & { name?: string; id?: string }) | null;
  tier?: 'default' | 'long_context';
  /** Where the popover opens relative to the trigger. */
  placement?: 'top' | 'bottom';
  /** Show the numeric % next to the ring (hidden on narrow toolbars). */
  showLabel?: boolean;
  /**
   * Extra sentence explaining what window this describes — e.g. that a
   * workflow stage shares its conversation with the rest of the run, so the
   * fill is the run's, not the stage's.
   */
  scopeNote?: string;
  className?: string;
}

export function ContextUsageGauge({
  snapshot,
  usage,
  model,
  tier,
  placement = 'top',
  showLabel = true,
  scopeNote,
  className,
}: ContextUsageGaugeProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const resolved = resolveContextUsage({
    snapshot: snapshot ?? null,
    usage: usage ?? null,
    model: model ?? null,
    ...(tier ? { tier } : {}),
  });
  const pctLabel = formatPctLabel(resolved.pct);
  const title =
    resolved.used != null && resolved.limit != null
      ? `Context: ${formatTokens(resolved.used)} / ${formatTokens(resolved.limit)} (${pctLabel}%)`
      : 'Context usage — waiting for the first response';

  return (
    <div ref={ref} className={cn('relative inline-flex', className)} data-testid="context-usage-gauge">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={title}
        aria-label={
          resolved.pct != null
            ? `Context window ${pctLabel}% used — click for details`
            : 'Context usage — click for details'
        }
        data-testid="context-usage-trigger"
        data-context-pct={resolved.pct != null ? Math.round(resolved.pct * 100) : ''}
        data-context-used={resolved.used ?? ''}
        data-context-limit={resolved.limit ?? ''}
        data-context-source={resolved.source}
        className="flex items-center gap-1 rounded-md px-1 py-1 transition-colors hover:bg-[var(--color-accent)]/60"
      >
        <ContextRing pct={resolved.pct} />
        {showLabel && (
          <span className="hidden tabular-nums text-[10px] text-[var(--color-muted-foreground)] lg:inline">
            {pctLabel}%
          </span>
        )}
      </button>

      {open && (
        <ContextUsagePopover
          resolved={resolved}
          model={model ?? null}
          usage={usage ?? null}
          placement={placement}
          {...(scopeNote ? { scopeNote } : {})}
        />
      )}
    </div>
  );
}

/** Ordered, labelled, colour-coded breakdown rows. */
const BREAKDOWN_ROWS: Array<{ key: keyof NonNullable<ResolvedContextUsage['breakdown']>; label: string; color: string }> = [
  { key: 'system', label: 'System prompt', color: 'bg-violet-500' },
  { key: 'tools', label: 'Tool definitions', color: 'bg-amber-500' },
  { key: 'mcpTools', label: 'MCP tools', color: 'bg-orange-500' },
  { key: 'memoryFiles', label: 'Memory files', color: 'bg-lime-500' },
  { key: 'skills', label: 'Skills', color: 'bg-teal-500' },
  { key: 'agents', label: 'Sub-agents', color: 'bg-cyan-500' },
  { key: 'conversation', label: 'Conversation', color: 'bg-sky-500' },
  { key: 'userMessages', label: '· User messages', color: 'bg-sky-400' },
  { key: 'assistantMessages', label: '· Assistant messages', color: 'bg-sky-300' },
  { key: 'toolCalls', label: '· Tool calls', color: 'bg-indigo-400' },
  { key: 'toolResults', label: '· Tool results', color: 'bg-indigo-300' },
  { key: 'attachments', label: '· Attachments', color: 'bg-fuchsia-400' },
];

/** Segments shown in the stacked bar — the nested "·" rows would double-count. */
const BAR_SEGMENTS: Array<{ key: keyof NonNullable<ResolvedContextUsage['breakdown']>; label: string; color: string }> = [
  { key: 'system', label: 'System', color: '#8b5cf6' },
  { key: 'tools', label: 'Tools', color: '#f59e0b' },
  { key: 'mcpTools', label: 'MCP tools', color: '#f97316' },
  { key: 'memoryFiles', label: 'Memory', color: '#84cc16' },
  { key: 'skills', label: 'Skills', color: '#14b8a6' },
  { key: 'conversation', label: 'Conversation', color: '#0ea5e9' },
];

function ContextUsagePopover({
  resolved,
  model,
  usage,
  placement,
  scopeNote,
}: {
  resolved: ResolvedContextUsage;
  model: (ModelLimits & { name?: string; id?: string }) | null;
  usage: TurnUsage | null;
  placement: 'top' | 'bottom';
  scopeNote?: string;
}) {
  const { used, limit, pct, remaining, breakdown } = resolved;
  const color = contextRingColor(pct);
  const pctLabel = formatPctLabel(pct);
  const hasBreakdown = !!breakdown && Object.values(breakdown).some((v) => typeof v === 'number' && v > 0);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      data-testid="context-usage-popover"
      className={cn(
        'absolute right-0 z-[100] w-72 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-[11px] shadow-2xl',
        placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-[var(--color-foreground)]">Context window</span>
        <span className="truncate font-mono text-[10px] text-[var(--color-muted-foreground)]">
          {model?.name ?? resolved.model ?? '—'}
        </span>
      </div>

      {used == null ? (
        <p className="py-1 text-[10px] leading-snug text-[var(--color-muted-foreground)]">
          Context usage appears here after the model responds.
        </p>
      ) : (
        <>
          {scopeNote && (
            <p className="mb-2 rounded-md bg-[var(--color-subtle)]/60 px-2 py-1 text-[10px] leading-snug text-[var(--color-muted-foreground)]">
              {scopeNote}
            </p>
          )}
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[var(--color-foreground)]" data-testid="context-usage-total">
              {formatTokens(used)}{' '}
              <span className="text-[var(--color-muted-foreground)]">
                / {limit != null ? formatTokens(limit) : '—'} tokens
              </span>
            </span>
            <span className="font-semibold tabular-nums" style={{ color }}>
              {pctLabel}%
            </span>
          </div>

          {/* Stacked bar — segments when the provider gave a split, plain fill otherwise. */}
          <div className="relative mb-2.5 mt-0.5 flex h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
            {hasBreakdown && limit ? (
              BAR_SEGMENTS.map((seg) => {
                const v = breakdown?.[seg.key];
                if (!v) return null;
                return (
                  <div
                    key={seg.key}
                    className="h-full"
                    style={{ width: `${Math.min(100, (v / limit) * 100)}%`, background: seg.color }}
                    title={`${seg.label}: ${v.toLocaleString()}`}
                  />
                );
              })
            ) : (
              <div
                className="h-full rounded-full"
                style={{ width: `${(pct ?? 0) * 100}%`, background: color }}
              />
            )}
            {/* Auto-compact marker. */}
            {resolved.compactionThreshold != null && limit ? (
              <span
                className="absolute top-0 h-full w-px bg-[var(--color-foreground)]/50"
                style={{ left: `${Math.min(100, (resolved.compactionThreshold / limit) * 100)}%` }}
                title={`Auto-compacts at ${formatTokens(resolved.compactionThreshold)}`}
              />
            ) : null}
          </div>

          {hasBreakdown && (
            <div className="mb-2.5 space-y-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                Where the tokens go
              </p>
              {BREAKDOWN_ROWS.map((row) => {
                const v = breakdown?.[row.key];
                if (v == null || v === 0) return null;
                return (
                  <Row key={row.key} color={row.color} label={row.label} value={v.toLocaleString()} />
                );
              })}
            </div>
          )}

          <div className="space-y-1.5 border-t border-[var(--color-border)]/60 pt-2">
            {remaining != null && (
              <Row label="Remaining" value={formatTokens(remaining)} hint="Tokens still available in the window" />
            )}
            {limit != null && <Row label="Max prompt" value={formatTokens(limit)} />}
            {model?.maxOutputTokens ? <Row label="Max output" value={formatTokens(model.maxOutputTokens)} /> : null}
            {resolved.messagesLength != null && <Row label="Messages" value={String(resolved.messagesLength)} />}
            {resolved.apiUsage?.input != null && (
              <Row label="Input tokens" value={resolved.apiUsage.input.toLocaleString()} />
            )}
            {resolved.apiUsage?.cacheRead ? (
              <Row label="Cache read" value={resolved.apiUsage.cacheRead.toLocaleString()} hint="Reused from prompt cache" />
            ) : null}
            {resolved.apiUsage?.cacheWrite ? (
              <Row label="Cache write" value={resolved.apiUsage.cacheWrite.toLocaleString()} hint="Written to prompt cache" />
            ) : null}
            {resolved.apiUsage?.output != null && (
              <Row label="Output tokens" value={resolved.apiUsage.output.toLocaleString()} />
            )}
            {usage?.cost != null && usage.cost > 0 && (
              usage.provider === 'copilot'
                ? <Row label="Cost multiplier" value={`${formatMultiplier(usage.cost)}×`} hint="Premium-request billing weight (not USD)" />
                : <Row label="Cost" value={`$${usage.cost.toFixed(4)}`} hint="Reported cost in USD" />
            )}
            {usage?.durationMs != null && usage.durationMs > 0 && (
              <Row label="Duration" value={`${(usage.durationMs / 1000).toFixed(1)}s`} />
            )}
          </div>

          <p className="mt-2.5 border-t border-[var(--color-border)] pt-2 text-[10px] leading-snug text-[var(--color-muted-foreground)]">
            {resolved.source === 'provider'
              ? 'Reported by the provider for this session.'
              : resolved.source === 'derived'
                ? 'Estimated from the last response’s token counts — the provider has not reported a breakdown yet.'
                : 'Estimated from the last turn’s token counts.'}
            {limit == null && ' The provider has not published a context limit for this model.'}
          </p>
        </>
      )}
    </div>
  );
}

function Row({ color, label, value, hint }: { color?: string; label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-[var(--color-muted-foreground)]" title={hint}>
        {color && <span className={cn('h-2 w-2 flex-shrink-0 rounded-sm', color)} />}
        {label}
      </span>
      <span className="font-mono tabular-nums text-[var(--color-foreground)]">{value}</span>
    </div>
  );
}

/** Trim a billing multiplier to a compact form: 1 → "1", 1.5 → "1.5". */
function formatMultiplier(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
