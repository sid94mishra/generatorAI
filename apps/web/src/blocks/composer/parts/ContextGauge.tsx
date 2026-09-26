// ────────────────────────────────────────────────────────────────
// F-composer-11 / B-13 — the context gauge and its popover.
//
// Trigger: 14px ring + "42%" (`context-usage-trigger`, carrying the numbers it
// drew as `data-context-*` for the e2e honesty checks). Popover (288 wide,
// ComposerStates "Per-turn · Gauge popover"): model id, "84.2K / 200K tokens ·
// 42%", a 6px stacked bar (System prompt, Tool definitions, MCP tools, Skills,
// Conversation) with the auto-compact marker, the "Where the tokens go"
// legend, Remaining / Max prompt / Max output / Auto-compacts at, and where
// the numbers came from. Before the first response it says so instead of
// dividing by a guess. Everything comes from `resolveContextUsage`
// (client-core), so this, the tier chip and the picker agree.
// ────────────────────────────────────────────────────────────────

import {
  formatPctLabel,
  formatTokens,
  resolveContextUsage,
  type ContextUsageSnapshot,
  type ModelLimits,
  type ResolvedContextUsage,
  type TurnUsage,
} from '@generatorai/client-core';
import { cn } from '@/ui/lib/cn.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Gauge, type GaugeTone } from '@/ui/primitives/Gauge/Gauge.js';
import { PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from '@/ui/primitives/Popover/Popover.js';

type BreakdownKey = keyof NonNullable<ResolvedContextUsage['breakdown']>;

/** Legend rows; nested "·" rows reuse their parent's chart slot, dimmed. */
const BREAKDOWN_ROWS: Array<{ key: BreakdownKey; label: string; swatch: string }> = [
  { key: 'system', label: 'System prompt', swatch: 'bg-chart-2' },
  { key: 'tools', label: 'Tool definitions', swatch: 'bg-chart-3' },
  { key: 'mcpTools', label: 'MCP tools', swatch: 'bg-chart-3 opacity-60' },
  { key: 'memoryFiles', label: 'Memory files', swatch: 'bg-chart-4' },
  { key: 'skills', label: 'Skills', swatch: 'bg-chart-5' },
  { key: 'agents', label: 'Sub-agents', swatch: 'bg-chart-5 opacity-60' },
  { key: 'conversation', label: 'Conversation', swatch: 'bg-chart-1' },
  { key: 'userMessages', label: '· User messages', swatch: 'bg-chart-1 opacity-75' },
  { key: 'assistantMessages', label: '· Assistant messages', swatch: 'bg-chart-1 opacity-55' },
  { key: 'toolCalls', label: '· Tool calls', swatch: 'bg-chart-6 opacity-75' },
  { key: 'toolResults', label: '· Tool results', swatch: 'bg-chart-6 opacity-55' },
  { key: 'attachments', label: '· Attachments', swatch: 'bg-chart-2 opacity-55' },
];

/** Stacked-bar segments — the nested rows would double-count. */
const BAR_SEGMENTS: Array<{ key: BreakdownKey; label: string; swatch: string }> = [
  { key: 'system', label: 'System', swatch: 'bg-chart-2' },
  { key: 'tools', label: 'Tools', swatch: 'bg-chart-3' },
  { key: 'mcpTools', label: 'MCP tools', swatch: 'bg-chart-6' },
  { key: 'memoryFiles', label: 'Memory', swatch: 'bg-chart-4' },
  { key: 'skills', label: 'Skills', swatch: 'bg-chart-5' },
  { key: 'conversation', label: 'Conversation', swatch: 'bg-chart-1' },
];

function toneFor(pct: number | null): GaugeTone | undefined {
  if (pct == null) return undefined;
  if (pct >= 0.9) return 'err';
  if (pct >= 0.7) return 'warn';
  return undefined;
}

const TONE_TEXT: Record<GaugeTone, string> = { warn: 'text-warn', err: 'text-err' };

export interface ContextGaugeProps {
  snapshot?: ContextUsageSnapshot | null;
  usage?: TurnUsage | null;
  model?: (ModelLimits & { name?: string; id?: string }) | null;
  tier?: 'default' | 'long_context';
  /** Hide the "42%" beside the ring (narrow toolbars). */
  showLabel?: boolean;
  className?: string;
}

export function ContextGauge({ snapshot, usage, model, tier, showLabel = true, className }: ContextGaugeProps) {
  const resolved = resolveContextUsage({
    snapshot: snapshot ?? null,
    usage: usage ?? null,
    model: model ?? null,
    ...(tier ? { tier } : {}),
  });
  const pctLabel = formatPctLabel(resolved.pct);
  const tone = toneFor(resolved.pct);
  const title =
    resolved.used != null && resolved.limit != null
      ? `Context: ${formatTokens(resolved.used)} / ${formatTokens(resolved.limit)} (${pctLabel}%)`
      : 'Context usage — waiting for the first response';

  return (
    <PopoverRoot>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            title={title}
            aria-label={
              resolved.pct != null ? `Context window ${pctLabel}% used — click for details` : 'Context usage — click for details'
            }
            data-testid="context-usage-trigger"
            data-context-pct={resolved.pct != null ? Math.round(resolved.pct * 100) : ''}
            data-context-used={resolved.used ?? ''}
            data-context-limit={resolved.limit ?? ''}
            data-context-source={resolved.source}
            className={cn('gap-1 px-1.5 font-mono text-micro text-fg-2 data-popup-open:bg-selected', className)}
          />
        }
      >
        <span className="inline-flex items-center gap-1">
          <Gauge value={Math.round((resolved.pct ?? 0) * 100)} label="Context window" {...(tone ? { tone } : {})} />
          {showLabel ? <span className={cn('tabular-nums', tone && TONE_TEXT[tone])}>{pctLabel}%</span> : null}
        </span>
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" className="w-72 p-3" data-testid="context-usage-popover">
        <ContextUsageDetails resolved={resolved} model={model ?? null} usage={usage ?? null} />
      </PopoverPopup>
    </PopoverRoot>
  );
}

function Row({ swatch, label, value, hint }: { swatch?: string; label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-h-5 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5 text-fg-2" title={hint}>
        {swatch ? <span aria-hidden className={cn('size-2 shrink-0 rounded-badge', swatch)} /> : null}
        <span className="truncate">{label}</span>
      </span>
      <span className="font-mono text-micro text-fg tabular-nums">{value}</span>
    </div>
  );
}

/** The popover body; exported for the stories. */
export function ContextUsageDetails({
  resolved,
  model,
  usage,
}: {
  resolved: ResolvedContextUsage;
  model: (ModelLimits & { name?: string; id?: string }) | null;
  usage: TurnUsage | null;
}) {
  const { used, limit, pct, remaining, breakdown } = resolved;
  const tone = toneFor(pct);
  const pctLabel = formatPctLabel(pct);
  const hasBreakdown = !!breakdown && Object.values(breakdown).some((v) => typeof v === 'number' && v > 0);

  return (
    <div className="flex flex-col gap-2 text-small">
      <div className="flex items-center justify-between gap-2">
        <PopoverTitle className="text-ui font-medium text-fg">Context window</PopoverTitle>
        <span className="truncate font-mono text-micro text-fg-3">{model?.id ?? model?.name ?? resolved.model ?? '—'}</span>
      </div>

      {used == null ? (
        <p className="text-fg-3">Context usage appears here after the model responds.</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between">
            <span className="text-fg" data-testid="context-usage-total">
              {formatTokens(used)} <span className="text-fg-3">/ {limit != null ? formatTokens(limit) : '—'} tokens</span>
            </span>
            <span className={cn('font-mono tabular-nums', tone ? TONE_TEXT[tone] : 'text-fg')}>{pctLabel}%</span>
          </div>

          <div className="relative flex min-h-1.5 w-full overflow-hidden rounded-badge bg-line">
            {hasBreakdown && limit ? (
              BAR_SEGMENTS.map((seg) => {
                const v = breakdown?.[seg.key];
                if (!v) return null;
                return (
                  <span
                    key={seg.key}
                    className={cn('h-full', seg.swatch)}
                    // Computed geometry: the segment's share of the window.
                    style={{ width: `${Math.min(100, (v / limit) * 100)}%` }}
                    title={`${seg.label}: ${v.toLocaleString()}`}
                  />
                );
              })
            ) : (
              <span
                className={cn('h-full', tone === 'err' ? 'bg-err' : tone === 'warn' ? 'bg-warn' : 'bg-fg-2')}
                style={{ width: `${(pct ?? 0) * 100}%` }}
              />
            )}
            {resolved.compactionThreshold != null && limit ? (
              <span
                className="absolute top-0 h-full w-px bg-fg-2"
                style={{ left: `${Math.min(100, (resolved.compactionThreshold / limit) * 100)}%` }}
                title={`Auto-compacts at ${formatTokens(resolved.compactionThreshold)}`}
              />
            ) : null}
          </div>

          {hasBreakdown ? (
            <div className="flex flex-col">
              <p className="flex min-h-5 items-center text-fg-3">Where the tokens go</p>
              {BREAKDOWN_ROWS.map((row) => {
                const v = breakdown?.[row.key];
                if (v == null || v === 0) return null;
                return <Row key={row.key} swatch={row.swatch} label={row.label} value={v.toLocaleString()} />;
              })}
            </div>
          ) : null}

          <div className="flex flex-col border-t border-line-soft pt-1.5">
            {remaining != null ? <Row label="Remaining" value={formatTokens(remaining)} hint="Tokens still available in the window" /> : null}
            {limit != null ? <Row label="Max prompt" value={formatTokens(limit)} /> : null}
            {model?.maxOutputTokens ? <Row label="Max output" value={formatTokens(model.maxOutputTokens)} /> : null}
            {resolved.compactionThreshold != null ? (
              <Row label="Auto-compacts at" value={formatTokens(resolved.compactionThreshold)} />
            ) : null}
            {resolved.messagesLength != null ? <Row label="Messages" value={String(resolved.messagesLength)} /> : null}
            {resolved.apiUsage?.cacheRead ? (
              <Row label="Cache read" value={resolved.apiUsage.cacheRead.toLocaleString()} hint="Reused from prompt cache" />
            ) : null}
            {usage?.cost != null && usage.cost > 0 ? (
              usage.provider === 'copilot' ? (
                <Row label="Cost multiplier" value={`${formatMultiplier(usage.cost)}×`} hint="Premium-request billing weight (not USD)" />
              ) : (
                <Row label="Cost" value={`$${usage.cost.toFixed(4)}`} hint="Reported cost in USD" />
              )
            ) : null}
            {usage?.durationMs != null && usage.durationMs > 0 ? (
              <Row label="Duration" value={`${(usage.durationMs / 1000).toFixed(1)}s`} />
            ) : null}
          </div>

          <p className="text-micro text-fg-3">
            {resolved.source === 'provider'
              ? 'Reported by the provider for this session.'
              : resolved.source === 'derived'
                ? 'Estimated from the last response’s token counts — the provider has not reported a breakdown yet.'
                : 'Estimated from the last turn’s token counts.'}
            {limit == null ? ' The provider has not published a context limit for this model.' : ''}
          </p>
        </>
      )}
    </div>
  );
}

/** A billing multiplier, compact: 1 → "1", 1.5 → "1.5". */
function formatMultiplier(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
