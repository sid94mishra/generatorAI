// ────────────────────────────────────────────────────────────────
// S-13 ToasterRegion (03 §4 S-13, D-30).
//
// The kit's toast region, mounted once by S-01 AppFrame: bottom-right, 16px
// inside the window, on the toast layer, `data-gai-overlay="toast"` (the
// native browser view hides under it, D-19). Errors and background-job
// completions only. The app's only toaster: every `toast.*` call (features,
// blocks and the data layer's global error handlers) lands here.
// ────────────────────────────────────────────────────────────────

import { Toaster } from '../../primitives/Toast/Toast.js';

export interface ToasterRegionProps {
  /** Accessible name of the notifications region. */
  label?: string;
}

/** The app's kit toaster. */
export function ToasterRegion({ label = 'Notifications' }: ToasterRegionProps) {
  return <Toaster label={label} />;
}
