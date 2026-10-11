// ────────────────────────────────────────────────────────────────
// NativeBrowserView — the desktop branch of the Integrated Browser.
//
// When the desktop shell exposes a native browser
// (`window.generatoraiDesktop.browser`), page rendering is handed to a real
// Electron `WebContentsView` sitting on top of the workbench DOM. This view
// only reserves its rectangle and shows the "Paused (overlay open)" badge;
// the lifecycle, bounds, placeholder screenshot, D-19 overlay loop and event
// relay live in the driver, `useNativeBrowserView.ts`.
//
// Without the bridge (web build, desktop without the flag) `BrowserPanel`
// renders its screencast path instead.
// ────────────────────────────────────────────────────────────────

import { useNativeBrowserView, type NativeBrowserViewOptions } from './useNativeBrowserView.js';
import { cn } from '@/ui/lib/cn.js';

export type NativeBrowserViewProps = NativeBrowserViewOptions & {
  /** A fixed frame (device mode, D-144) instead of filling the panel. */
  frame?: { width: number; height: number } | null;
};

export function NativeBrowserView({ frame, ...props }: NativeBrowserViewProps): React.JSX.Element {
  const { containerRef, placeholderBg, obscured } = useNativeBrowserView(props);

  return (
    <div
      ref={containerRef}
      data-testid="browser-live-view"
      className={cn(
        'relative min-h-0 bg-ground bg-contain bg-center bg-no-repeat',
        frame ? 'flex-none rounded-control shadow-pop ring-1 ring-line' : 'flex-1',
      )}
      // The last-frame screenshot shown while the native view is hidden (a
      // computed data URL) and the device frame's size: computed geometry.
      style={{
        ...(placeholderBg ? { backgroundImage: `url(${placeholderBg})` } : {}),
        ...(frame ? { width: frame.width, height: frame.height } : {}),
      }}
      aria-label="Native browser view"
    >
      {obscured && (
        <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-2">
          <span className="rounded-badge bg-scrim px-1.5 py-0.5 text-micro text-fg-2">Paused (overlay open)</span>
        </div>
      )}
    </div>
  );
}
