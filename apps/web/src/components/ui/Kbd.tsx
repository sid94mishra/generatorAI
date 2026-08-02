// ────────────────────────────────────────────────────────────────
// Kbd — keyboard shortcut hint chip. Renders platform-correct
// modifier labels (⌘ on macOS, Ctrl elsewhere — same SPA runs in
// the Electron desktop app on all platforms).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { cn } from '@/lib/utils.js';

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac/i.test(navigator.platform ?? '') || /mac/i.test(navigator.userAgent);
}

/** "mod" renders as ⌘ on macOS and Ctrl elsewhere. */
export type KbdKey = 'mod' | 'shift' | 'alt' | 'enter' | 'esc' | (string & {});

function keyLabel(key: KbdKey, mac: boolean): string {
  switch (key) {
    case 'mod':
      return mac ? '⌘' : 'Ctrl';
    case 'shift':
      return mac ? '⇧' : 'Shift';
    case 'alt':
      return mac ? '⌥' : 'Alt';
    case 'enter':
      return '↵';
    case 'esc':
      return 'Esc';
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  /** Keys in press order, e.g. ['mod', 'K'] */
  keys: KbdKey[];
}

export function Kbd({ keys, className, ...props }: KbdProps) {
  const mac = isMacPlatform();
  return (
    <kbd
      className={cn(
        'inline-flex items-center gap-0.5 rounded border border-border bg-subtle px-1.5 py-0.5',
        'font-mono text-[10px] font-medium text-muted-foreground',
        className,
      )}
      {...props}
    >
      {keys.map((k, i) => (
        <span key={i}>{keyLabel(k, mac)}</span>
      ))}
    </kbd>
  );
}
