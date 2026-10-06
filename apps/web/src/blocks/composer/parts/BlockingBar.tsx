// ────────────────────────────────────────────────────────────────
// F-composer-22 — the one bar above the box that says why Send is held back.
//
// One at a time, in the machine's priority (`composerBlockingState`):
// Preparation failed (Retry · Edit sources) > Preparing workspace > Waiting on
// you (Cancel and send). Typing is never blocked (D-29); a failed preparation
// shows its bar but does not block Send (D-61). The turn states (running,
// stopping, force reset) draw no bar — the primary control carries them.
// ────────────────────────────────────────────────────────────────

import type { ComposerBlockingState } from '@generatorai/shared/ui-contract';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Reveal } from '@/ui/primitives/Collapsible/Collapsible.js';

export interface BlockingBarProps {
  blocking: ComposerBlockingState;
  /** Why preparation failed (the server's message). */
  prepError?: string | undefined;
  onRetryPrep?: (() => void) | undefined;
  retryingPrep?: boolean;
  onEditSources?: (() => void) | undefined;
  /** What the open gate is (page-derived copy per gate kind). */
  waitingLabel?: string | null | undefined;
  onCancelWaiting?: (() => void) | undefined;
}

const barBase = 'flex min-h-9 items-center gap-2 rounded-card border px-3 py-1.5 text-ui';

/** The bar eases in above the box when Send is held back (D-108), and leaves at once. */
export function BlockingBar(props: BlockingBarProps) {
  const bar = barFor(props);
  return <Reveal open={bar != null}>{bar != null ? <div className="pb-2">{bar}</div> : null}</Reveal>;
}

function barFor({
  blocking,
  prepError,
  onRetryPrep,
  retryingPrep = false,
  onEditSources,
  waitingLabel,
  onCancelWaiting,
}: BlockingBarProps) {
  if (blocking === 'prep_failed') {
    return (
      <div role="alert" data-testid="workspace-prep-error" className={`${barBase} border-line bg-err-bg`}>
        <Icon concept="status-failed" size={14} className="shrink-0 text-err" />
        <span className="min-w-0 flex-1 text-fg">
          <span className="font-medium text-err">Preparation failed.</span>{' '}
          {prepError ?? 'One of this chat’s sources could not be prepared.'}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {onRetryPrep ? (
            <Button size="sm" icon="retry" onClick={onRetryPrep} loading={retryingPrep}>
              Retry
            </Button>
          ) : null}
          {onEditSources ? (
            <Button size="sm" variant="ghost" icon="settings" onClick={onEditSources}>
              Edit sources
            </Button>
          ) : null}
        </span>
      </div>
    );
  }
  if (blocking === 'preparing') {
    return (
      <div role="status" aria-live="polite" data-testid="workspace-prep-bar" className={`${barBase} border-line bg-run-bg`}>
        <Spinner size={14} className="shrink-0 text-run" />
        <span className="min-w-0 flex-1 truncate text-fg">Preparing workspace… creating worktrees and checking out branches</span>
      </div>
    );
  }
  if (blocking === 'waiting_on_you' && waitingLabel) {
    return (
      <div role="status" aria-live="polite" data-testid="composer-waiting-bar" className={`${barBase} border-line bg-warn-bg`}>
        <Icon concept="hand" size={14} className="shrink-0 text-warn" />
        <span className="min-w-0 flex-1 truncate text-fg">{waitingLabel}</span>
        {onCancelWaiting ? (
          <Button size="sm" variant="ghost" onClick={onCancelWaiting} className="shrink-0">
            Cancel and send
          </Button>
        ) : null}
      </div>
    );
  }
  return null;
}
