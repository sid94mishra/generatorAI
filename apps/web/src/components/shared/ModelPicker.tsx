// ────────────────────────────────────────────────────────────────
// ModelPicker — the single, canonical model-selection control.
//
// Extracted verbatim (behaviour-wise) from the chat composer, which was the
// most complete implementation, and generalised so every surface that picks a
// model uses the exact same UI:
//
//   • Chat composer toolbar          → variant="inline"  side="top"
//   • Create-chat dialog             → variant="field"
//   • Settings → default chat model  → variant="field"  allowEmpty
//   • Workflow stage model override  → variant="field"  allowEmpty
//
// Structure: a provider rail (only the ACTIVE harness provider is selectable;
// the others render locked) beside a searchable model list, plus an optional
// details popover opened from each row's info icon. Models always come from
// the active provider's live catalog — never hardcoded.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ChevronDown, Check, Search, X, Lock, Info, Cpu, Eye, Globe, Gauge, ArrowUp, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/index.js';
import { ProviderBrandIcon } from './VendorIcons.js';
import { useHarnessProviders } from '@/hooks/queries.js';
import { resolveModelLimit } from '@generatorai/client-core';
import type { ChatModel } from '@/platform/HttpPlatformClient.js';

// ── Agent providers (harness types) ──────────────────────────────
// The LLM providers this build supports. Readiness (installed / connected /
// authenticated) is reported live per provider by `useHarnessProviders()`;
// providers that fail that probe render locked.
// Labels match the server's `harnessTypeLabel`, so a provider is named the
// same everywhere (a missing entry showed up as its raw id, e.g. "codex").
export const PROVIDERS: Array<{ id: string; label: string }> = [
  { id: 'copilot', label: 'GitHub Copilot' },
  { id: 'claude-agent', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'acp', label: 'ACP Agent' },
];

/** Human label for a harness/agent provider id. */
export function providerLabel(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

// Brand marks live in one place (`VendorIcons`) so the picker, settings and
// anything else stay in sync. Aliased + re-exported for existing import sites.
export const ProviderIcon = ProviderBrandIcon;

/** Compact token count, e.g. 1_000_000 → "1M", 200_000 → "200K". */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const k = tokens / 1_000;
    return `${Number.isInteger(k) ? k : k.toFixed(0)}K`;
  }
  return String(tokens);
}

/** Human label for a model picker category. */
export function categoryLabel(category: string): string {
  switch (category) {
    case 'lightweight': return 'Fast';
    case 'versatile': return 'Balanced';
    case 'powerful': return 'Powerful';
    default: return category.charAt(0).toUpperCase() + category.slice(1);
  }
}

/** Shorten model name for display (fallback when catalog metadata is absent). */
export function getModelShortName(modelId: string): string {
  const map: Record<string, string> = {
    'claude-sonnet-4': 'Sonnet 4',
    'claude-sonnet-4.6': 'Sonnet 4.6',
    'claude-opus-4': 'Opus 4',
    'gpt-4.1': 'GPT-4.1',
    'gpt-4.1-mini': 'GPT-4.1 Mini',
    'o3-mini': 'o3-mini',
  };
  return map[modelId] || modelId;
}

/** A single label/value row in the model details panel. */
export function DetailRow({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-[var(--color-muted-foreground)]">
        {icon}
        {label}
      </span>
      <span className="font-medium text-[var(--color-foreground)]">{value}</span>
    </div>
  );
}

export interface ModelPickerProps {
  /** Selected model id. Empty string / null means "no explicit model". */
  value?: string | null;
  /** Fires with the chosen model id, or `''` when the empty option is picked. */
  onChange: (modelId: string) => void;
  /**
   * `inline` — bare text trigger sized for a toolbar (chat composer).
   * `field`  — full-width bordered control that matches other form inputs.
   */
  variant?: 'inline' | 'field';
  /** Which way the popover opens. Toolbars at the bottom of the screen use `top`. */
  side?: 'top' | 'bottom';
  /** Which edge the popover aligns to. */
  align?: 'start' | 'end';
  /**
   * Offer an explicit "no model" row (inherit from a parent config). The
   * caller supplies the wording because the meaning differs per surface
   * ("Default", "Provider default", "Workflow default", …).
   */
  allowEmpty?: boolean;
  emptyLabel?: string;
  emptyDescription?: string;
  /** Trigger text when nothing is selected and `allowEmpty` is false. */
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  ariaLabel?: string;
  /**
   * Show the provider rail. Always on except where vertical space is too
   * tight to justify it; kept as an escape hatch rather than a fork.
   */
  showProviderRail?: boolean;
}

export function ModelPicker({
  value,
  onChange,
  variant = 'field',
  side = 'bottom',
  align = 'start',
  allowEmpty = false,
  emptyLabel = 'Default',
  emptyDescription,
  placeholder = 'Select a model…',
  disabled = false,
  id,
  className,
  ariaLabel = 'Select model',
  showProviderRail = true,
}: ModelPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [infoModelId, setInfoModelId] = useState<string | null>(null);
  // Provider whose catalog the user is browsing. Defaults to the provider that
  // owns the current value, else the server's primary provider.
  const [providerTab, setProviderTab] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: providerData, isLoading: providersLoading, refetch: refetchProviders, isFetching } = useHarnessProviders();

  const providerInfos = useMemo(() => providerData?.providers ?? [], [providerData]);
  const primaryProvider = providerData?.primary ?? 'copilot';

  /** Every model across every ready provider, tagged with its owner. */
  const allModels = useMemo(
    () => providerInfos.flatMap((p) => (p.ready ? p.models.map((m) => ({ ...m, provider: m.provider ?? p.type })) : [])),
    [providerInfos],
  );

  const selectedModel = useMemo(
    () => (value ? allModels.find((m) => m.id === value) : undefined),
    [allModels, value],
  );

  /** Provider that owns the current selection, so the trigger icon is right. */
  const selectedProvider = selectedModel?.provider ?? primaryProvider;

  const providers = useMemo(
    () => providerInfos.map((p) => ({
      id: p.type,
      label: p.label,
      enabled: p.ready,
      error: p.error,
      modelCount: p.modelCount,
    })),
    [providerInfos],
  );

  /**
   * Tab to browse when nothing is selected yet.
   *
   * `primary` is the server's *configured* preference and is reported whether
   * or not that provider can actually serve models — a Copilot that was never
   * signed in is still `primary`. Landing on it left anyone without that
   * provider's CLI logged in staring at an empty "unavailable" list, with no
   * hint that a different provider had a full catalog one click away; the
   * common reading of that screen is "starting a chat is broken". This is not
   * specific to any OS — it reproduces wherever the primary provider is
   * unauthenticated — so prefer `primary` while it is ready and otherwise fall
   * back to the first provider that is.
   */
  const defaultBrowseProvider = useMemo(() => {
    if (providerInfos.find((p) => p.type === primaryProvider)?.ready) return primaryProvider;
    return providerInfos.find((p) => p.ready)?.type ?? primaryProvider;
  }, [providerInfos, primaryProvider]);

  // Browse the selected model's provider by default so opening the picker
  // lands on the tab the user is actually using.
  const effectiveProviderTab = providerTab ?? selectedModel?.provider ?? defaultBrowseProvider;
  const activeTabInfo = providerInfos.find((p) => p.type === effectiveProviderTab);

  const filteredModels = useMemo(() => {
    const source = activeTabInfo?.ready ? activeTabInfo.models : [];
    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    );
  }, [activeTabInfo, search]);

  const infoModel = useMemo(
    () => (infoModelId ? allModels.find((m) => m.id === infoModelId) : undefined),
    [infoModelId, allModels],
  );

  // Reset transient popover state on close. Dismissal (outside click, Escape,
  // focus management, layering) is handled by Radix's Popover primitive.
  useEffect(() => {
    if (open) return;
    setSearch('');
    setInfoModelId(null);
  }, [open]);

  /**
   * Drive the model list's scroll manually.
   *
   * When the picker lives inside a Radix Dialog (create-chat, settings), the
   * dialog mounts `react-remove-scroll`, which calls `preventDefault()` on
   * wheel events whose target isn't inside the dialog's DOM subtree. Our
   * popover is portalled out of that subtree, so the list refuses to scroll —
   * while the same component scrolls fine in the chat composer, which has no
   * dialog.
   *
   * Applying the delta ourselves works in both cases because assigning
   * `scrollTop` is unaffected by the cancelled native scroll. This is wired
   * through a callback ref (not an effect) so the listener attaches the
   * instant the portalled node mounts, and with `passive: false` so
   * `preventDefault()` is honoured — React's synthetic `onWheel` is passive
   * and could not.
   */
  const detachWheelRef = useRef<(() => void) | null>(null);
  const listRef = useCallback((el: HTMLDivElement | null) => {
    detachWheelRef.current?.();
    detachWheelRef.current = null;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (el.scrollHeight <= el.clientHeight) return;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      // Let the gesture pass through at the extremes so it doesn't feel stuck.
      if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) return;
      e.preventDefault();
      e.stopPropagation();
      el.scrollTop += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    detachWheelRef.current = () => el.removeEventListener('wheel', onWheel);
  }, []);

  const select = (modelId: string): void => {
    onChange(modelId);
    setOpen(false);
    setInfoModelId(null);
  };

  // Trigger label: prefer the catalog name, fall back to a friendly short
  // name so an id that isn't in the catalog still reads sensibly.
  const triggerLabel = value
    ? (selectedModel?.name ?? getModelShortName(value))
    : (allowEmpty ? emptyLabel : placeholder);
  const hasValue = Boolean(value);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <div className={cn(variant === 'field' && 'w-full', className)}>
        <PopoverPrimitive.Trigger asChild>
      <Button
        variant="ghost"
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(
          'flex h-auto items-center transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-60',
          variant === 'field'
            ? [
                'w-full justify-between gap-2 rounded-md border border-[var(--color-input)]',
                'bg-[var(--color-background)] px-3 py-2 text-left text-sm',
                'hover:border-[color-mix(in_srgb,var(--color-primary)_50%,var(--color-border))]',
                'focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none',
                open && 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/20',
              ]
            : [
                'min-w-0 max-w-[160px] gap-1 rounded-md px-2 py-1 text-xs font-medium',
                open
                  ? 'bg-[var(--color-accent)] text-[var(--color-foreground)]'
                  : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]/60 hover:text-[var(--color-foreground)]',
              ],
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {hasValue && (
            <ProviderIcon
              provider={selectedProvider}
              className={cn('shrink-0', variant === 'field' ? 'h-3.5 w-3.5 text-[var(--color-muted-foreground)]' : 'h-3.5 w-3.5')}
            />
          )}
          <span
            className={cn(
              'truncate',
              variant === 'field' && !hasValue && 'text-[var(--color-muted-foreground)]',
            )}
          >
            {triggerLabel}
          </span>
        </span>
        <ChevronDown className={cn('shrink-0 opacity-60', variant === 'field' ? 'h-4 w-4' : 'h-3 w-3')} />
      </Button>
        </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          role="listbox"
          aria-label={ariaLabel}
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          // Radix focuses the content wrapper by default, which swallows
          // keystrokes meant for the filter box. Send focus straight to the
          // search input instead so the user can type immediately.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            searchRef.current?.focus();
          }}
          // Radix portals the panel and positions it with collision
          // detection, so no `overflow`/`transform` ancestor can clip it and
          // it flips automatically when the preferred side lacks room. It
          // also registers in Radix's layer stack, which pauses a parent
          // Dialog's focus trap — without that the search box can't be typed
          // in when the picker lives inside a modal.
          //
          // z-index sits above `Modal` (z-[1000]). `role="listbox"` also
          // makes the desktop native-browser overlay hit-test treat this as
          // workbench chrome, so a WebContentsView hides instead of painting
          // over it.
          className={cn(
            'z-[1100] flex items-start gap-2',
            align === 'end' && 'flex-row-reverse',
            // Zoom in place (same feel as the reasoning-effort dropdown)
            // rather than sliding in from a screen edge.
            'animate-in fade-in-0 zoom-in-95 duration-150',
          )}
        >
          {/* Provider rail + model list */}
          <div className="flex overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl">
            {showProviderRail && (
              <div className="flex w-12 flex-col items-center gap-1 border-r border-[var(--color-border)]/60 bg-[var(--color-subtle)]/40 py-2">
                {providers.map((p) => (
                  <Button
                    key={p.id}
                    variant="ghost"
                    size="icon"
                    type="button"
                    // Every connected provider is selectable now; only the
                    // ones that failed their readiness probe are locked.
                    disabled={!p.enabled}
                    onClick={() => p.enabled && setProviderTab(p.id)}
                    title={p.enabled
                      ? `${p.label} — ${p.modelCount} model${p.modelCount === 1 ? '' : 's'}`
                      : `${p.label} — unavailable${p.error ? `: ${p.error}` : ''}`}
                    className={cn(
                      'relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                      !p.enabled && 'cursor-not-allowed opacity-30',
                      effectiveProviderTab === p.id && p.enabled
                        ? 'bg-[var(--color-primary)]/15 text-[var(--color-primary)]'
                        : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]',
                    )}
                  >
                    <ProviderIcon provider={p.id} className="h-5 w-5" />
                    {!p.enabled && (
                      <Lock className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 text-[var(--color-muted-foreground)]" />
                    )}
                  </Button>
                ))}
              </div>
            )}

            {/* Model list (from the active provider — no hardcoding) */}
            <div className="flex w-80 flex-col">
              {/* Search header — mirrors the app's standard in-dropdown search
                  (`CommandInput`): 4-unit icon, `text-sm`, fixed row height and
                  a full-opacity placeholder so the text is legible. */}
              <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-[var(--color-border)] px-3">
                <Search className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                <input
                  ref={searchRef}
                  type="text"
                  // Opts out of the global offset focus ring (see globals.css):
                  // the popover's own border is the affordance here, and the
                  // ring would draw a stray box inside the dropdown header.
                  data-inline-search=""
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search models"
                  // `min-w-0` keeps the flex item from overflowing the row and
                  // pushing the clear button past the panel edge.
                  className="h-full w-full min-w-0 bg-transparent text-sm text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted-foreground)]"
                />
                {search && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className="h-auto w-auto shrink-0 rounded p-0.5 text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
                    title="Clear"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
                {/* Catalogs are cached (a cold probe spawns each provider's
                    CLI), so offer an explicit re-probe — e.g. right after
                    signing in to a provider. */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  onClick={() => void refetchProviders()}
                  aria-label="Refresh model list"
                  title="Refresh model list"
                  className="h-auto w-auto shrink-0 rounded p-0.5 text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
                </Button>
              </div>
              <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
                {/* Inherit / no-explicit-model row. Kept above the catalog and
                    outside the search filter so it's always reachable. */}
                {allowEmpty && (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => select('')}
                    className={cn(
                      'h-auto mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors',
                      !hasValue ? 'bg-[var(--color-primary)]/10' : 'hover:bg-[var(--color-accent)]',
                    )}
                  >
                    <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                      {!hasValue && <Check className="h-4 w-4 text-[var(--color-primary)]" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-sm font-medium', !hasValue ? 'text-[var(--color-primary)]' : 'text-[var(--color-foreground)]')}>
                        {emptyLabel}
                      </span>
                      {emptyDescription && (
                        <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                          {emptyDescription}
                        </span>
                      )}
                    </span>
                  </Button>
                )}

                {providersLoading ? (
                  <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
                    <RefreshCw className="h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      Loading live model catalogs…
                    </p>
                  </div>
                ) : !activeTabInfo?.ready ? (
                  <div className="flex flex-col items-center gap-1.5 px-3 py-6 text-center">
                    <Lock className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                    <p className="text-xs font-medium text-[var(--color-foreground)]">
                      {activeTabInfo?.label ?? providerLabel(effectiveProviderTab)} is unavailable
                    </p>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {activeTabInfo?.error
                        ? activeTabInfo.error
                        : activeTabInfo?.installed === false
                          ? 'Provider SDK is not installed.'
                          : 'Sign in to this provider to use its models.'}
                    </p>
                  </div>
                ) : filteredModels.length === 0 ? (
                  <p className="px-2.5 py-3 text-center text-xs text-[var(--color-muted-foreground)]">No models found.</p>
                ) : (
                  filteredModels.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        'group flex w-full items-center gap-1 rounded-lg py-2 pl-2 pr-1 transition-colors',
                        value === m.id ? 'bg-[var(--color-primary)]/10' : 'hover:bg-[var(--color-accent)]',
                      )}
                    >
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => select(m.id)}
                        className="h-auto flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                          {value === m.id && <Check className="h-4 w-4 text-[var(--color-primary)]" />}
                        </span>
                        <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', value === m.id ? 'text-[var(--color-primary)]' : 'text-[var(--color-foreground)]')}>
                          {m.name}
                        </span>
                        {resolveModelLimit(m, 'default') ? (
                          <span
                            className="flex-shrink-0 rounded bg-[var(--color-muted)]/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--color-muted-foreground)]"
                            title="Maximum prompt tokens"
                          >
                            {formatTokens(resolveModelLimit(m, 'default')!)}
                          </span>
                        ) : null}
                      </Button>
                      {/* Info icon — opens the model details popover */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setInfoModelId((prev) => (prev === m.id ? null : m.id));
                        }}
                        className={cn(
                          'h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-colors',
                          infoModelId === m.id
                            ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                            : 'text-[var(--color-muted-foreground)]/60 opacity-0 hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] group-hover:opacity-100',
                        )}
                        title="Model details"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Details popover — opened via a row's info icon */}
          {infoModel && (
            <div className="w-60 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3.5 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--color-foreground)]">{infoModel.name}</span>
                {infoModel.category && (
                  <span className="text-[10px] font-medium text-[var(--color-muted-foreground)]">{categoryLabel(infoModel.category)}</span>
                )}
              </div>
              {/* Provider-supplied blurb. For Claude Code this is the only
                  place the concrete version + per-Mtok pricing is stated. */}
              {infoModel.description && (
                <p className="mb-2.5 text-[11px] leading-relaxed text-[var(--color-muted-foreground)]">
                  {infoModel.description}
                </p>
              )}
              <div className="space-y-1.5 text-[11px]">
                <DetailRow
                  icon={<ProviderIcon provider={infoModel.provider ?? effectiveProviderTab} className="h-3 w-3" />}
                  label="Provider"
                  value={providerInfos.find((p) => p.type === (infoModel.provider ?? effectiveProviderTab))?.label
                    ?? providerLabel(infoModel.provider ?? effectiveProviderTab)}
                />
                {infoModel.supportsLongContext && (
                  <DetailRow icon={<Globe className="h-3 w-3" />} label="Long context" value="Yes" />
                )}
                {/* Prompt budget is what the context gauge measures against, so
                    it is the headline number; the advertised total (prompt +
                    completion) is shown separately rather than conflated. */}
                {resolveModelLimit(infoModel, 'default') ? (
                  <DetailRow
                    icon={<Cpu className="h-3 w-3" />}
                    label="Context (prompt)"
                    value={formatTokens(resolveModelLimit(infoModel, 'default')!)}
                  />
                ) : null}
                {infoModel.supportsLongContext && resolveModelLimit(infoModel, 'long_context') ? (
                  <DetailRow
                    icon={<Cpu className="h-3 w-3" />}
                    label="Long context (prompt)"
                    value={formatTokens(resolveModelLimit(infoModel, 'long_context')!)}
                  />
                ) : null}
                {infoModel.maxOutputTokens ? (
                  <DetailRow icon={<ArrowUp className="h-3 w-3" />} label="Max output" value={formatTokens(infoModel.maxOutputTokens)} />
                ) : null}
                {infoModel.supportsReasoning && (infoModel.reasoningEfforts?.length ?? 0) > 0 && (
                  <DetailRow icon={<Gauge className="h-3 w-3" />} label="Reasoning" value={`${infoModel.reasoningEfforts!.length} levels`} />
                )}
                {infoModel.supportsVision && (
                  <DetailRow icon={<Eye className="h-3 w-3" />} label="Vision" value="Supported" />
                )}
              </div>
            </div>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
      </div>
    </PopoverPrimitive.Root>
  );
}
