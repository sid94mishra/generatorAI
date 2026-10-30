// ────────────────────────────────────────────────────────────────
// BrowserEmptyState (F-dock-04) — what the screencast live view shows until
// a frame paints: access denied, starting, loading, not running, error.
// ────────────────────────────────────────────────────────────────

import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Kbd } from '@/ui/primitives/Kbd/Kbd.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';

export interface BrowserEmptyStateProps {
  status: string;
  isOn: boolean;
  /** The server refused this device browser control (401/403). */
  denied: boolean;
  /** Full interactivity: the URL bar and Start are available. */
  canDrive: boolean;
}

function Busy({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 text-small text-fg-3">
      <Spinner size={16} label={label} />
      <div>{label}…</div>
    </div>
  );
}

export function BrowserEmptyState({ status, isOn, denied, canDrive }: BrowserEmptyStateProps): React.JSX.Element {
  let body: React.ReactNode = null;
  // A refused device is NOT "not running": pointing it at the interactive-
  // browser setting sends the user to a control that cannot fix it. The fix
  // is a scope grant, so say so.
  if (denied) {
    body = (
      <EmptyState
        icon="lock"
        title="Browser control isn’t granted to this device."
        description={
          <>
            Grant it <span className="text-fg">Settings → Security → Devices</span> on a device that is already
            connected. The agent can still browse on its own.
          </>
        }
      />
    );
  } else if (status === 'starting') {
    body = <Busy label="Starting Chromium" />;
  } else if (isOn) {
    body = <Busy label="Loading live view" />;
  } else if (status === 'off' || status === 'terminated') {
    body = (
      <EmptyState
        icon="browser"
        title="Browser is not running."
        description={
          canDrive ? (
            <>Type a URL and press <Kbd keys="Start" />.</>
          ) : (
            // Without full interactivity there is no URL bar, so a bare
            // "not running" line would be a dead end.
            <>
              Ask the agent to browse a page, or enable{' '}
              <span className="text-fg">Settings → Browser &amp; Terminal → interactive browser</span> to drive it
              yourself.
            </>
          )
        }
      />
    );
  } else if (status === 'error') {
    body = <EmptyState icon="warning" tone="error" title="Browser error. Try Start again." />;
  }

  return (
    <div data-testid="browser-empty-state" className="absolute inset-0 flex items-center justify-center p-4">
      {body}
    </div>
  );
}
