// ────────────────────────────────────────────────────────────────
// P-14 SearchInput (03 §2 P-14; Rosetta `.inp` with search icon + `.kbd` "/").
//
// Input with a leading `search` glyph, a trailing Kbd hint (default "/") while
// empty, and a clear button once there is text. The hint key focuses the field
// when nothing editable has focus (and not inside a surface that owns every
// key, `data-gai-keys="own"`, D-46). Escape clears, then blurs.
// `label` is the accessible name (the Agents audit found one missing).
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { cn } from '../../lib/cn.js';
import { IconButton } from '../IconButton/IconButton.js';
import { Input, type InputProps } from '../Input/Input.js';
import { Kbd } from '../Kbd/Kbd.js';

export interface SearchInputProps
  extends Omit<InputProps, 'value' | 'onChange' | 'leading' | 'trailing' | 'type'> {
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name ("Search chats"). */
  label: string;
  /** Focus key shown while empty; `null` for none. Default "/". */
  shortcut?: string | null;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[data-gai-keys="own"]')) return true;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.getAttribute('role') === 'combobox';
}

/** Search field with a focus hint, a clear button and Escape handling. */
export function SearchInput({
  value,
  onValueChange,
  label,
  shortcut = '/',
  size = 'md',
  placeholder,
  className,
  onKeyDown,
  ...rest
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!shortcut || shortcut.length !== 1) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== shortcut || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.defaultPrevented || isEditable(event.target)) return;
      if (document.querySelector('[data-gai-overlay="dialog"], [data-gai-overlay="palette"]')) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcut]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== 'Escape') return;
    if (value) onValueChange('');
    else inputRef.current?.blur();
  };

  return (
    <Input
      {...rest}
      ref={inputRef}
      type="text"
      role="searchbox"
      enterKeyHint="search"
      size={size}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      aria-label={label}
      leading="search"
      className={cn(size === 'sm' ? 'pr-1' : 'pr-1.5', className)}
      trailing={
        value ? (
          <IconButton
            size="sm"
            icon="x"
            label="Clear search"
            tooltip={false}
            onClick={() => {
              onValueChange('');
              inputRef.current?.focus();
            }}
          />
        ) : shortcut ? (
          <Kbd keys={shortcut} aria-hidden className="mr-1" />
        ) : null
      }
    />
  );
}
