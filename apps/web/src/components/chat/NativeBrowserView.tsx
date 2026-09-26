// ────────────────────────────────────────────────────────────────
// NativeBrowserView — the desktop branch of the Integrated Browser.
//
// When the desktop shell exposes a native browser
// (`window.generatoraiDesktop.browser`), page rendering is handed to a real
// Electron `WebContentsView` sitting on top of the workbench DOM. This view
// only reserves its rectangle and shows the "Paused (overlay open)" badge;
// the lifecycle, bounds, placeholder screenshot, D-19 overlay loop and event
// relay live in the driver, `blocks/browser/useNativeBrowserView.ts`.
//
// Without the bridge (web build, desktop without the flag) the parent
// `BrowserPanel` renders its screencast path instead.
// ────────────────────────────────────────────────────────────────

import { useNativeBrowserView, type NativeBrowserViewOptions } from '@/blocks/browser/useNativeBrowserView.js';

export type NativeBrowserViewProps = NativeBrowserViewOptions;

export function NativeBrowserView(props: NativeBrowserViewProps): React.JSX.Element {
  const { containerRef, placeholderBg, obscured } = useNativeBrowserView(props);

  return (
    <div
      ref={containerRef}
      data-testid="browser-live-view"
      className="relative flex-1 min-h-0 bg-black"
      style={placeholderBg ? {
        backgroundImage: `url(${placeholderBg})`,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      } : undefined}
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
