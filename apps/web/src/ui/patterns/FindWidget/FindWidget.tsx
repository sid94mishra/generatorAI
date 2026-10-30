// ────────────────────────────────────────────────────────────────
// C-32 FindWidget (03 §3 C-32; board DockTerminal). Visuals of the find bar
// (terminal, desktop Cmd/Ctrl+F via S-12); behaviour and IPC stay in `app/`.
//
// Floating strip: `bg-overlay`, 1px `line`, `rounded-card`, `shadow-pop`,
// pad 3 3 3 8, gap 2: 14px search icon · 150-wide mono input (24h) · match
// count ("3 of 12", small fg-3, announced politely) · prev / next / close sm
// IconButtons whose tooltips name the keys. `role="search"`.
// Keys in the input: Enter next, Shift+Enter previous, Escape close.
// It floats over the terminal or a web view, so it is a D-19 floating layer
// even though it is not portalled: it carries `data-gai-overlay="popover"`.
// The caller positions it (absolute, top-right).
// ────────────────────────────────────────────────────────────────

import type { ComponentProps, KeyboardEvent, Ref } from 'react';
import { cn } from '../../lib/cn.js';
import { overlayProps } from '../../lib/overlay.js';
import { Icon } from '../../icons/Icon.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { Input } from '../../primitives/Input/Input.js';

export interface FindMatches {
  /** 1-based index of the active match (0 when there is none). */
  current: number;
  total: number;
}

export interface FindWidgetProps extends Omit<ComponentProps<'div'>, 'children'> {
  query: string;
  onQueryChange: (query: string) => void;
  /** Omit while nothing has been searched. */
  matches?: FindMatches;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  /** Accessible name of the input. Default "Find". */
  label?: string;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/** A floating find bar: query, match count, previous / next / close. */
export function FindWidget({
  query,
  onQueryChange,
  matches,
  onPrev,
  onNext,
  onClose,
  label = 'Find',
  placeholder = 'Find',
  inputRef,
  className,
  ...rest
}: FindWidgetProps) {
  const noMatches = !matches || matches.total === 0;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) onPrev();
      else onNext();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };
  return (
    <div
      role="search"
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-card border border-line bg-overlay py-0.75 pr-0.75 pl-2 text-fg shadow-pop',
        className,
      )}
      {...overlayProps('popover')}
      {...rest}
    >
      <Icon concept="search" size={14} className="mr-0.5 shrink-0 text-fg-3" />
      <Input
        ref={inputRef}
        size="sm"
        mono
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        aria-label={label}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="h-control-sm w-37.5 px-1.5"
        // The shell is 24h (20 compact) with a 1px border; the input itself keeps a 24px target (WCAG 2.5.8).
        inputClassName="min-h-6"
      />
      <span className="min-w-12 shrink-0 px-1 text-center text-small whitespace-nowrap text-fg-3 tabular-nums" aria-live="polite">
        {matches ? (matches.total === 0 ? (query ? 'No results' : null) : `${matches.current} of ${matches.total}`) : null}
      </span>
      <IconButton size="sm" icon="chevron-up" label="Previous match" tooltip="Previous match (Shift+Enter)" onClick={onPrev} disabled={noMatches} />
      <IconButton size="sm" icon="chevron-down" label="Next match" tooltip="Next match (Enter)" onClick={onNext} disabled={noMatches} />
      <IconButton size="sm" icon="x" label="Close" tooltip="Close (Escape)" onClick={onClose} />
    </div>
  );
}
