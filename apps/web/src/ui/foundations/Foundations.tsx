// ────────────────────────────────────────────────────────────────
// Foundations — the token vocabulary drawn with its own utilities (P1-SB).
//
// A workshop page, not a product component: it exists so Storybook (and its
// MCP manifest, and VRT) show every design name in the current appearance —
// surfaces, text tiers, status text + hue, accents, type scale, radii and
// density heights. Every class is written out literally so Tailwind emits it
// and a renamed token fails to render here instead of silently vanishing.
// Text only ever sits on pairs the WCAG suite asserts (packages/design-tokens
// design.test.ts), so axe's color-contrast rule doubles as a check on them.
// ────────────────────────────────────────────────────────────────

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ACCENT_IDS, ACCENT_LABELS, type AccentId } from '@generatorai/design-tokens';
import { applyAppearance, type AppliedAppearance } from '../lib/appearance.js';
import { cn } from '../lib/cn.js';

const SURFACES = [
  { name: 'ground', className: 'bg-ground' },
  { name: 'surface', className: 'bg-surface' },
  { name: 'raised', className: 'bg-raised' },
  { name: 'overlay', className: 'bg-overlay' },
  { name: 'sunken', className: 'bg-sunken' },
  { name: 'hover', className: 'bg-hover' },
  { name: 'selected', className: 'bg-selected' },
] as const;

const LINES = [
  { name: 'line-soft', className: 'border-line-soft' },
  { name: 'line', className: 'border-line' },
  { name: 'line-strong', className: 'border-line-strong' },
] as const;

const TEXT_TIERS = [
  { name: 'fg', className: 'text-fg', use: 'Primary text' },
  { name: 'fg-2', className: 'text-fg-2', use: 'Secondary text' },
  { name: 'fg-3', className: 'text-fg-3', use: 'Tertiary text' },
] as const;

const STATUSES = [
  { name: 'run', text: 'text-run', tint: 'bg-run-bg', hue: 'bg-run', label: 'Running' },
  { name: 'ok', text: 'text-ok', tint: 'bg-ok-bg', hue: 'bg-ok', label: 'Done' },
  { name: 'warn', text: 'text-warn', tint: 'bg-warn-bg', hue: 'bg-warn', label: 'Needs you' },
  { name: 'err', text: 'text-err', tint: 'bg-err-bg', hue: 'bg-err', label: 'Failed' },
] as const;

const DIFF_ROWS = [
  { name: 'add-bg', className: 'bg-add-bg', sample: '+ const ready = true;' },
  { name: 'del-bg', className: 'bg-del-bg', sample: '- const ready = false;' },
] as const;

const TYPE_STEPS = [
  { name: 'display', className: 'text-display' },
  { name: 'heading', className: 'text-heading' },
  { name: 'title', className: 'text-title' },
  { name: 'body', className: 'text-body' },
  { name: 'ui', className: 'text-ui' },
  { name: 'small', className: 'text-small' },
  { name: 'micro', className: 'text-micro' },
] as const;

const RADII = [
  { name: 'badge', className: 'rounded-badge' },
  { name: 'control-sm', className: 'rounded-control-sm' },
  { name: 'control', className: 'rounded-control' },
  { name: 'seg', className: 'rounded-seg' },
  { name: 'card', className: 'rounded-card' },
  { name: 'panel', className: 'rounded-panel' },
  { name: 'dialog', className: 'rounded-dialog' },
] as const;

const HEIGHTS = [
  { name: 'control-sm', className: 'h-control-sm' },
  { name: 'control', className: 'h-control' },
  { name: 'control-lg', className: 'h-control-lg' },
  { name: 'nav', className: 'h-nav' },
  { name: 'item', className: 'h-item' },
  { name: 'step', className: 'h-step' },
  { name: 'th', className: 'h-th' },
  { name: 'row', className: 'h-row' },
  { name: 'tab', className: 'h-tab' },
  { name: 'bar', className: 'h-bar' },
  { name: 'badge', className: 'h-badge' },
  { name: 'kbd', className: 'h-kbd' },
  { name: 'panel-bar', className: 'h-panel-bar' },
  { name: 'dialog-bar', className: 'h-dialog-bar' },
  { name: 'footer', className: 'h-footer' },
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-title text-fg">{title}</h2>
      {children}
    </section>
  );
}

function TokenName({ children }: { children: ReactNode }) {
  return <code className="font-mono text-small text-fg-2">{children}</code>;
}

/**
 * One accent in the CURRENT theme and mode. Accents are derived per theme, so
 * the swatch re-themes its own subtree through the one appearance writer.
 */
function AccentSwatch({ appearance, accent }: { appearance: AppliedAppearance; accent: AccentId }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) applyAppearance({ ...appearance, accent }, ref.current);
  }, [appearance, accent]);
  return (
    <div ref={ref} className="flex flex-col gap-2 bg-surface">
      <div className="flex h-control items-center justify-center rounded-control bg-accent px-3 text-ui text-on-accent">
        {ACCENT_LABELS[accent]}
      </div>
      <div className="flex h-control items-center justify-center rounded-control bg-surface px-3 text-ui text-fg outline-2 outline-offset-1 outline-focus">
        Focus
      </div>
    </div>
  );
}

export interface FoundationsProps {
  /** The appearance the story renders in; accents are drawn in its theme and mode. */
  appearance: AppliedAppearance;
  className?: string;
}

export function Foundations({ appearance, className }: FoundationsProps) {
  return (
    <div className={cn('flex max-w-dialog-lg flex-col gap-8 font-sans text-ui text-fg', className)}>
      <header className="flex flex-col gap-1">
        <h1 className="text-heading text-fg">Foundations</h1>
        <p className="text-body text-fg-2">
          The design vocabulary in <TokenName>{appearance.theme}</TokenName> · <TokenName>{appearance.resolved}</TokenName>{' '}
          · accent <TokenName>{appearance.accent}</TokenName> · <TokenName>{appearance.density}</TokenName>
        </p>
      </header>

      <Section title="Surfaces">
        <ul className="grid grid-cols-4 gap-3">
          {SURFACES.map((s) => (
            <li key={s.name} className="flex flex-col gap-1">
              <div className={cn('flex flex-col gap-0.5 rounded-card border border-line p-3', s.className)}>
                {TEXT_TIERS.map((t) => (
                  <span key={t.name} className={cn('text-ui', t.className)}>
                    {t.name}
                  </span>
                ))}
              </div>
              <TokenName>{s.name}</TokenName>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Lines">
        <ul className="grid grid-cols-3 gap-3">
          {LINES.map((l) => (
            <li key={l.name} className={cn('rounded-card border-2 bg-surface p-3', l.className)}>
              <TokenName>{l.name}</TokenName>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Text tiers">
        <ul className="flex flex-col gap-1">
          {TEXT_TIERS.map((t) => (
            <li key={t.name} className="flex items-baseline gap-3">
              <span className={cn('w-40 text-body', t.className)}>{t.use}</span>
              <TokenName>{`text-${t.name}`}</TokenName>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Status">
        <ul className="grid grid-cols-4 gap-3">
          {STATUSES.map((s) => (
            <li key={s.name} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3">
              <div className="flex items-center gap-2">
                <span aria-hidden className={cn('size-3 rounded-badge', s.hue)} />
                <span className={cn('text-ui', s.text)}>{s.label}</span>
              </div>
              <span className={cn('flex h-badge items-center self-start rounded-badge px-2 text-small', s.tint, s.text)}>
                {s.label}
              </span>
              <TokenName>{s.name}</TokenName>
            </li>
          ))}
        </ul>
        <ul className="flex flex-col overflow-hidden rounded-card border border-line bg-surface">
          {DIFF_ROWS.map((d) => (
            <li key={d.name} className={cn('flex items-center justify-between gap-3 px-3 py-1', d.className)}>
              <code className="font-mono text-small text-fg">{d.sample}</code>
              <code className="font-mono text-small text-fg">{d.name}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Accents">
        <ul className="grid grid-cols-7 gap-3">
          {ACCENT_IDS.map((id) => (
            <li key={id}>
              <AccentSwatch appearance={appearance} accent={id} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type scale">
        <ul className="flex flex-col gap-2">
          {TYPE_STEPS.map((t) => (
            <li key={t.name} className="flex items-baseline gap-4">
              <span className="w-20 shrink-0">
                <TokenName>{t.name}</TokenName>
              </span>
              <span className={cn('text-fg', t.className)}>Ship the change, then review it</span>
            </li>
          ))}
          <li className="flex items-baseline gap-4">
            <span className="w-20 shrink-0">
              <TokenName>mono</TokenName>
            </span>
            <code className="font-mono text-ui text-fg">pnpm --filter @generatorai/web storybook</code>
          </li>
        </ul>
      </Section>

      <Section title="Radii">
        <ul className="flex flex-wrap gap-4">
          {RADII.map((r) => (
            <li key={r.name} className="flex flex-col items-center gap-1">
              <div className={cn('size-12 border border-line-strong bg-raised', r.className)} />
              <TokenName>{r.name}</TokenName>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Heights">
        <ul className="flex flex-col gap-1">
          {HEIGHTS.map((h) => (
            <li key={h.name} className="flex items-center gap-3">
              <span className="w-24 shrink-0">
                <TokenName>{h.name}</TokenName>
              </span>
              <div className={cn('w-40 rounded-control-sm border border-line bg-raised', h.className)} />
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
