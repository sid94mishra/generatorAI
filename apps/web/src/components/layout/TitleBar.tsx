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
      className="app-titlebar app-drag-region relative flex shrink-0 select-none items-center border-b border-border bg-background"
      onDoubleClick={(e) => {
        // Native convention: double-clicking empty title-bar space zooms the
        // window. Ignore double-clicks that land on a control.
        if (e.target !== e.currentTarget) return;
        desktopWindow.toggleMaximize();
      }}
    >
      {/* A native window title: the product name, centred and muted. The logo
          lives once, in the sidebar header directly below — repeating it here
          stacked two identical brand marks 40 px apart. Centred on the window
          (not the padded strip) and non-interactive, so double-click-to-zoom
          still reaches the strip itself. */}
      <span className="pointer-events-none absolute inset-x-0 truncate px-[max(var(--titlebar-inset-left),var(--titlebar-inset-right))] text-center text-xs font-medium text-[var(--color-muted-foreground)]">
        GeneratorAI
      </span>
    </div>
  );
}
