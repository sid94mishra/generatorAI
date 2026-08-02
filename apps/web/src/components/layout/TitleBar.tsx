// ────────────────────────────────────────────────────────────────
// TitleBar — the window's own top strip in the desktop shell.
//
// The OS paints minimise/maximise/close into the right end of this row on
// Windows and Linux (Window Controls Overlay), and floats the traffic lights
// over its left end on macOS. Giving those buttons a dedicated row — rather
// than sharing one with the app header — is what stops them landing on top of
// the theme toggle when the window is narrow.
//
// Renders nothing in a browser tab, where the OS already supplies a title bar.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Zap } from 'lucide-react';
import { desktopWindow } from '@/lib/desktop.js';

interface TitleBarProps {
  /** False in a plain browser tab, where this strip must not appear at all. */
  visible: boolean;
}

export function TitleBar({ visible }: TitleBarProps) {
  if (!visible) return null;

  return (
    <div
      data-testid="app-titlebar"
      className="app-titlebar app-drag-region flex shrink-0 select-none items-center gap-2 border-b border-border bg-background"
      onDoubleClick={(e) => {
        // Native convention: double-clicking empty title-bar space zooms the
        // window. Ignore double-clicks that land on a control.
        if (e.target !== e.currentTarget) return;
        desktopWindow.toggleMaximize();
      }}
    >
      <div className="flex h-4 w-4 items-center justify-center rounded bg-[var(--color-primary)]">
        <Zap className="h-2.5 w-2.5 text-white" />
      </div>
      {/* Just the product name — the breadcrumb for the current page already
          sits in the header directly below this strip. */}
      <span className="truncate text-xs font-medium text-[var(--color-muted-foreground)]">
        GeneratorAI
      </span>
    </div>
  );
}
