// ────────────────────────────────────────────────────────────────
// B-01 ModelPicker — the pure view (03 §2.1; board ComposerModelPicker; D-131).
//
// Popover 620×384: provider column 150 (each provider's logo, D-132; ready
// providers first; the others dimmed with why — "Not signed in" / "Not
// installed" / "Unavailable" — and what to do about it) · model list 272
// (SearchInput "Search models" + refresh; ONE plain list of the provider's
// real models in the provider's order — rows name + mono id + context when
// reported + a "default" badge only when the provider flags the model + check)
// · detail pane (name, description, then only the facts the provider returned:
// client-core's `modelDetails`) · 32h footer "↑↓ Navigate · ↵ Select · Esc
// Close" under the model list. Owner deviation from the board (D-131): no
// Fast / Balanced / Powerful groups, no "Recommended"/"Default" pseudo-rows,
// no detail rows the provider did not send.
//
// Keyboard: focus lands in the search field; typing filters, ↑/↓ move the
// highlight through the visible models (aria-activedescendant) and the detail
// pane follows it — as it follows the pointer — Enter picks, Escape clears
// the query and then closes (the Popover's own dismissal).
//
// Props only: the catalog is client-core's `ModelPickerCatalog`
// (`buildModelPickerCatalog`); `ModelPicker.tsx` connects it to the queries.
// ────────────────────────────────────────────────────────────────

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  findPickerModel,
  modelDetails,
  type ModelPickerCatalog,
  type PickerModel,
  type PickerProvider,
} from '@generatorai/client-core';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { modelPickerBox } from '@/ui/lib/popup.js';
import { KbdHintRow, KbdHintStatus } from '@/ui/patterns/KbdHintRow/KbdHintRow.js';
import { optionSecondaryText } from '@/ui/primitives/Autocomplete/Autocomplete.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from '@/ui/primitives/Popover/Popover.js';
import { ProviderLogo } from '@/ui/primitives/ProviderLogo/ProviderLogo.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { Skeleton } from '@/ui/primitives/Skeleton/Skeleton.js';
import { StatusDot } from '@/ui/primitives/StatusDot/StatusDot.js';
import {
  AVAILABILITY_HINT,
  AVAILABILITY_LABEL,
  contextSummary,
  filterModels,
  initialProvider,
  searchProvider,
  modelMeta,
} from './modelPickerModel.js';

export type ModelPickerVariant = 'chip' | 'field';

export interface ModelPickerViewProps {
  /** Selected model id ('' = none). */
  value: string;
  /** A model row was chosen (the popover then closes). */
  onSelect: (modelId: string) => void;
  /** client-core's picker read model; `undefined` while the first probe is in flight. */
  catalog: ModelPickerCatalog | undefined;
  /** First load: skeleton rows instead of the lists. */
  loading?: boolean;
  /** An explicit re-probe is running (refresh button busy, footer status). */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Opens Settings › Model providers from the not-ready caption. */
  onOpenProviderSettings?: () => void;
  /** `chip`: borderless 24h composer chip. `field`: full-width form control. */
  variant?: ModelPickerVariant;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
  /** Accessible name of the trigger and the popup. Default "Select model". */
  ariaLabel?: string;
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  disabled?: boolean;
  /** Open on this provider's models (a Provider chosen beside the picker). */
  preferredProvider?: string | undefined;
  /** Uncontrolled initial state (stories). */
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  id?: string;
  className?: string;
  'data-testid'?: string;
}

/** Secondary text in a provider row: fg-3 is below 4.5:1 on the pressed (`selected`) fill. */
const pressedMeta = 'text-fg-3 group-aria-pressed/provider:text-fg-2';

const HINTS = [
  { keys: '↑↓', label: 'Navigate' },
  { keys: '↵', label: 'Select' },
  { keys: 'Esc', label: 'Close' },
] as const;

/** A provider + model picker: trigger (chip or field) and the three-pane popover. */
export function ModelPickerView({
  value,
  preferredProvider,
  onSelect,
  catalog,
  loading = false,
  refreshing = false,
  onRefresh,
  onOpenProviderSettings,
  variant = 'chip',
  side = 'bottom',
  align = 'start',
  ariaLabel = 'Select model',
  placeholder = 'Select a model…',
  disabled = false,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  id,
  className,
  'data-testid': testId,
}: ModelPickerViewProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const popupRef = useRef<HTMLDivElement>(null);

  const selected = catalog ? findPickerModel(catalog, value) : undefined;
  const selectedProvider = selected ? catalog?.providers.find((p) => p.type === selected.provider) : undefined;
  // The selection is missing from a conclusive catalog (its provider signed
  // out or failed): say so instead of borrowing another provider's look.
  const unavailable = Boolean(value) && !selected && !loading && (catalog?.providers.length ?? 0) > 0;
  const label = selected?.name ?? (value || placeholder);
  const title = unavailable ? `${value} is not available right now. Open to pick another model.` : undefined;

  const trigger =
    variant === 'chip' ? (
      <Button
        variant="ghost"
        size="sm"
        icon={unavailable ? 'warning' : undefined}
        trailingIcon="chevron-down"
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
        data-unavailable={unavailable || undefined}
        data-testid={testId}
        id={id}
        className={cn('max-w-40 data-popup-open:bg-selected data-popup-open:text-fg', unavailable && 'text-warn', className)}
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <ProviderLogo provider={selected.provider} size={14} />
            <span className="truncate">{label}</span>
          </span>
        ) : (
          label
        )}
      </Button>
    ) : (
      <Button
        variant="secondary"
        size="lg"
        trailingIcon="chevron-down"
        disabled={disabled}
        aria-label={ariaLabel}
        title={title}
        data-unavailable={unavailable || undefined}
        data-testid={testId}
        id={id}
        className={cn(
          'w-full justify-between border-line-strong bg-sunken font-normal data-popup-open:border-focus',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {unavailable ? <Icon concept="warning" size={14} className="shrink-0 text-warn" /> : null}
          {selected ? <ProviderLogo provider={selected.provider} size={14} /> : null}
          <span className={cn('truncate', !value && 'text-fg-3')}>{label}</span>
          {selected ? <span className="truncate text-small text-fg-3">{modelMeta(selected, selectedProvider)}</span> : null}
        </span>
      </Button>
    );

  return (
    <PopoverRoot open={open} onOpenChange={(next) => setOpen(next)}>
      <PopoverTrigger render={trigger} />
      <PopoverPopup
        side={side}
        align={align}
        ref={popupRef}
        // Focus lands in the search field so typing filters at once.
        initialFocus={() => popupRef.current?.querySelector<HTMLElement>('[role="searchbox"]') ?? true}
        className={cn(modelPickerBox, 'flex flex-col overflow-hidden')}
        data-testid="model-picker-popup"
      >
        <PopoverTitle className="sr-only">{ariaLabel}</PopoverTitle>
        <ModelPickerPanel
          preferredProvider={preferredProvider}
          value={value}
          catalog={catalog}
          loading={loading}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onOpenProviderSettings={onOpenProviderSettings}
          onSelect={(modelId) => {
            onSelect(modelId);
            setOpen(false);
          }}
        />
      </PopoverPopup>
    </PopoverRoot>
  );
}

interface PanelProps {
  value: string;
  preferredProvider?: string | undefined;
  catalog: ModelPickerCatalog | undefined;
  loading: boolean;
  refreshing: boolean;
  onRefresh?: () => void;
  onOpenProviderSettings?: () => void;
  onSelect: (modelId: string) => void;
}

/** The popover body. Base UI mounts it only while open, so its browse state starts fresh each time. */
function ModelPickerPanel({ value, preferredProvider, catalog, loading, refreshing, onRefresh, onOpenProviderSettings, onSelect }: PanelProps) {
  const [browse, setBrowse] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const listId = useId();

  const providerType = searchProvider(catalog, browse ?? initialProvider(catalog, value, preferredProvider), query);
  const provider = catalog?.providers.find((p) => p.type === providerType);
  const visible = useMemo(() => filterModels(provider?.models ?? [], query), [provider, query]);

  const highlighted =
    visible.find((m) => m.id === highlightedId) ?? visible.find((m) => m.id === value) ?? visible[0];
  const optionId = (model: PickerModel) => `${listId}-${visible.indexOf(model)}`;

  useEffect(() => {
    if (!highlighted) return;
    document.getElementById(`${listId}-${visible.indexOf(highlighted)}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [highlighted, visible, listId]);

  const move = (delta: number) => {
    if (visible.length === 0) return;
    const at = highlighted ? visible.indexOf(highlighted) : -1;
    const next = visible[(at + delta + visible.length) % visible.length];
    if (next) setHighlightedId(next.id);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (highlighted) onSelect(highlighted.id);
    } else if (event.key === 'Escape' && query) {
      // The first Escape only clears the query (SearchInput); keep the popover open.
      event.stopPropagation();
    }
  };

  const status = refreshing ? (
    <KbdHintStatus tone="run">Refreshing models…</KbdHintStatus>
  ) : catalog?.stale ? (
    <KbdHintStatus tone="run">Checking providers…</KbdHintStatus>
  ) : null;

  const listShown = provider?.availability === 'ready' && visible.length > 0;

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <ProviderColumn
          catalog={catalog}
          loading={loading}
          active={providerType}
          onOpenProviderSettings={onOpenProviderSettings}
          onPick={(type) => {
            setBrowse(type);
            setHighlightedId(null);
          }}
        />

        <div className="flex w-68 shrink-0 flex-col border-r border-line-soft">
          <div className="flex shrink-0 items-center gap-1 border-b border-line-soft p-1.5">
            <SearchInput
              size="sm"
              label="Search models"
              placeholder="Search models"
              shortcut={null}
              value={query}
              onValueChange={(next) => {
                setQuery(next);
                setHighlightedId(null);
              }}
              onKeyDown={onSearchKeyDown}
              aria-controls={listShown ? listId : undefined}
              aria-activedescendant={listShown && highlighted ? optionId(highlighted) : undefined}
              className="min-w-0 flex-1 border-transparent bg-transparent"
            />
            {onRefresh ? (
              <IconButton
                size="sm"
                icon="refresh"
                label="Refresh models"
                onClick={onRefresh}
                disabled={refreshing}
                aria-busy={refreshing || undefined}
              />
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {loading && !catalog ? (
              <ListSkeleton />
            ) : !provider ? (
              <p className="px-2 py-3 text-small text-fg-3">No model providers are configured.</p>
            ) : provider.availability !== 'ready' ? (
              <NotReady provider={provider} />
            ) : visible.length === 0 ? (
              <p className="px-2 py-3 text-small text-fg-3" role="status">
                {query ? `No models match “${query.trim()}”.` : `${provider.label} lists no models.`}
              </p>
            ) : (
              <div id={listId} role="listbox" aria-label={`${provider.label} models`}>
                {visible.map((model) => (
                  <ModelRow
                    key={model.id}
                    id={optionId(model)}
                    model={model}
                    selected={model.id === value}
                    highlighted={model === highlighted}
                    onHover={() => setHighlightedId(model.id)}
                    onPick={() => onSelect(model.id)}
                  />
                ))}
              </div>
            )}
          </div>
          <KbdHintRow hints={HINTS} end={status} className="min-h-8 shrink-0 border-t border-line-soft px-3" />
        </div>

        <ModelDetail model={provider?.availability === 'ready' ? highlighted : undefined} provider={provider} />
      </div>
    </>
  );
}

function ProviderColumn({
  catalog,
  loading,
  active,
  onPick,
  onOpenProviderSettings,
}: {
  catalog: ModelPickerCatalog | undefined;
  loading: boolean;
  active: string | null;
  onPick: (type: string) => void;
  onOpenProviderSettings?: () => void;
}) {
  const providers = catalog?.providers ?? [];
  const notReady = providers.find((p) => p.availability !== 'ready');
  return (
    <div className="flex w-37.5 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line-soft p-1.5">
      <div className="flex h-step shrink-0 items-center px-1.5 text-small text-fg-3">Provider</div>
      {loading && !catalog
        ? [0, 1].map((i) => (
            <div key={i} className="flex min-h-10 items-center gap-2 px-1.5">
              <Skeleton shape="block" className="size-6" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton width="80%" />
                <Skeleton shape="meta" width="50%" />
              </div>
            </div>
          ))
        : providers.map((p) => (
            <ProviderRow key={p.type} provider={p} active={p.type === active} onPick={() => onPick(p.type)} />
          ))}
      {notReady && notReady.availability !== 'ready' ? (
        <div className="mt-1 flex flex-col items-start gap-1 px-1.5 text-micro text-fg-3">
          <p>{AVAILABILITY_HINT[notReady.availability]}</p>
          {onOpenProviderSettings ? (
            <Button variant="ghost" size="sm" className="-ml-2" onClick={onOpenProviderSettings}>
              Model providers
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProviderRow({ provider, active, onPick }: { provider: PickerProvider; active: boolean; onPick: () => void }) {
  const ready = provider.availability === 'ready';
  const count = provider.models.length;
  return (
    <Button
      variant="ghost"
      pressed={active}
      onClick={onPick}
      title={provider.error ?? undefined}
      data-availability={provider.availability}
      className={cn('group/provider h-auto min-h-10 w-full justify-start px-1.5 py-1 text-left', !ready && 'text-fg-3')}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center">
          <ProviderLogo provider={provider.type} size={20} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className={cn('truncate text-ui', ready ? 'text-fg' : pressedMeta)}>{provider.label}</span>
          <span className={cn('flex min-w-0 items-center gap-1 text-micro font-normal', pressedMeta)}>
            {ready ? (
              <>
                <StatusDot tone="ok" size="sm" />
                <span className="truncate font-mono">
                  {count} {count === 1 ? 'model' : 'models'}
                </span>
              </>
            ) : (
              <>
                <Icon concept="lock" size={12} />
                <span className="truncate">{AVAILABILITY_LABEL[provider.availability]}</span>
              </>
            )}
          </span>
        </span>
      </span>
    </Button>
  );
}

function NotReady({ provider }: { provider: PickerProvider }) {
  if (provider.availability === 'ready') return null;
  return (
    <div className="flex flex-col gap-1 px-2 py-3 text-small" role="status">
      <p className="flex items-center gap-1.5 font-medium text-fg">
        <Icon concept="lock" size={14} className="text-fg-3" />
        {provider.label} · {AVAILABILITY_LABEL[provider.availability]}
      </p>
      {provider.error ? <p className="text-fg-3">{provider.error}</p> : null}
      <p className="text-fg-3">{AVAILABILITY_HINT[provider.availability]}</p>
    </div>
  );
}

function ModelRow({
  id,
  model,
  selected,
  highlighted,
  onHover,
  onPick,
}: {
  id: string;
  model: PickerModel;
  selected: boolean;
  highlighted: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const context = contextSummary(model);
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      data-highlighted={highlighted || undefined}
      onMouseMove={highlighted ? undefined : onHover}
      // Keep focus in the search field; the click still picks.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
      className={cn(
        'group/option flex min-h-10 cursor-default items-center gap-2 rounded-control-sm py-1 pr-2 pl-1 select-none',
        'text-fg-2 data-highlighted:bg-selected data-highlighted:text-fg',
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-fg">
        {selected ? <Icon concept="check" size={14} /> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn('truncate text-ui', selected && 'text-fg')}>{model.name}</span>
          {model.isDefault ? <Badge size="sm">default</Badge> : null}
        </span>
        {model.name !== model.id ? <span className={cn('truncate font-mono text-micro', optionSecondaryText)}>{model.id}</span> : null}
      </span>
      {context ? <span className={cn('shrink-0 font-mono text-micro', optionSecondaryText)}>{context}</span> : null}
    </div>
  );
}

function ModelDetail({ model, provider }: { model: PickerModel | undefined; provider: PickerProvider | undefined }) {
  const rows = model ? modelDetails(model) : [];
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-3" data-testid="model-picker-detail" aria-live="polite">
      {model ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-ui font-semibold text-fg">{model.name}</span>
            {model.isDefault ? <Badge size="sm">default</Badge> : null}
          </div>
          {model.name !== model.id ? <p className="truncate font-mono text-micro text-fg-3">{model.id}</p> : null}
          {model.description ? <p className="text-small text-fg-2">{model.description}</p> : null}
          <dl className="flex flex-col gap-0.5 text-small">
            <div className="flex min-h-5 items-center justify-between gap-2">
              <dt className="truncate text-fg-3">Provider</dt>
              <dd className="flex min-w-0 items-center gap-1.5 text-fg">
                <ProviderLogo provider={model.provider} size={12} />
                <span className="truncate">{provider?.label ?? model.provider}</span>
              </dd>
            </div>
            {rows.map((row) => (
              <div key={row.label} className="flex min-h-5 items-start justify-between gap-2">
                <dt className="shrink-0 text-fg-3">{row.label}</dt>
                <dd
                  className={cn('min-w-0 text-right text-fg', row.mono && 'truncate font-mono text-micro leading-5')}
                  title={row.mono ? row.value : undefined}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      <p className="mt-auto flex items-start gap-1.5 text-micro text-fg-3">
        <Icon concept="info" size={12} className="mt-0.5 shrink-0" />
        Changing the model applies from the next turn.
      </p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading models" className="flex flex-col">
      {['62%', '48%', '70%', '55%'].map((width) => (
        <div key={width} className="flex min-h-10 items-center gap-2 px-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton width={width} />
            <Skeleton shape="meta" width="40%" />
          </div>
          <Skeleton width={32} />
        </div>
      ))}
    </div>
  );
}
