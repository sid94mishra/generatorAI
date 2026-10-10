// ────────────────────────────────────────────────────────────────
// Non-provider brand marks (D-17): GitHub's mark (source control "Connect
// GitHub") and the GeneratorAI app mark. lucide-react 1.x removed its brand
// icons, so they live here. Agent-provider logos are NOT here: they come from
// the one registry, `PROVIDER_LOGOS` (packages/design-tokens), drawn by
// `ui/primitives/ProviderLogo` (D-132).
// ────────────────────────────────────────────────────────────────

import React from 'react';

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
