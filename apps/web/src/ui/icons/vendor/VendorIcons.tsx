// ────────────────────────────────────────────────────────────────
// Non-provider brand marks (D-17): GitHub's mark (source control "Connect
// GitHub"), the GeneratorAI app mark, and the editors "Open in" offers (VS
// Code, Cursor). lucide-react 1.x removed its brand icons, so they live here.
//
// Editor path data (24×24, copied verbatim; the marks remain their owners'
// trademarks, used only to name the editor):
//   VS Code  Simple Icons 7.21.0 icons/visualstudiocode.svg, CC0-1.0, brand hex 007ACC
//   Cursor   Simple Icons 16 icons/cursor.svg, CC0-1.0, monochrome (text colour) Agent-provider logos are NOT here: they come from
// the one registry, `PROVIDER_LOGOS` (packages/design-tokens), drawn by
// `ui/primitives/ProviderLogo` (D-132).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import type { EditorId } from '@generatorai/shared';

export interface VendorIconProps {
  className?: string;
}

/**
 * The GeneratorAI app mark (sidebar server switcher, rail, title strip): a
 * square with round corners in `fg` with two nodes joined by a branch in `ground`, so it
 * inverts with the theme. Sized by the caller (`size-5.5` in the sidebar).
 */
export function AppMark({ className }: VendorIconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden>
      <rect width="20" height="20" rx="5" className="fill-fg" />
      <circle cx="6.5" cy="6.5" r="2.1" className="fill-ground" />
      <circle cx="13.5" cy="13.5" r="2.1" className="fill-ground" />
      <path d="M6.5 8.8v2.4a2.3 2.3 0 0 0 2.3 2.3h2.4" fill="none" strokeWidth="1.6" strokeLinecap="round" className="stroke-ground" />
    </svg>
  );
}

/** GitHub's mark — "Connect GitHub" affordances (source control). */
export function GitHubMark({ className }: VendorIconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.05 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.34 9.34 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.92-2.34 4.78-4.57 5.04.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
    </svg>
  );
}

/** VS Code's mark in its brand blue. */
export function VSCodeMark({ className }: VendorIconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="#007ACC" className={className} aria-hidden>
      <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
    </svg>
  );
}

/** Cursor's mark — monochrome, in the text colour, so it inverts with the theme. */
export function CursorMark({ className }: VendorIconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" />
    </svg>
  );
}

/** The mark of an editor "Open in" offers. */
export function EditorMark({ editor, className }: VendorIconProps & { editor: EditorId }): React.JSX.Element {
  return editor === 'cursor' ? <CursorMark className={className} /> : <VSCodeMark className={className} />;
}
