// ────────────────────────────────────────────────────────────────
// AgentBrowsingStrip (F-dock-04, NEW) — "Bug Fixer is browsing · Your clicks
// still work", shown while the chat's turn streams. The board's last-action
// detail ("click 'Apply'") has no source yet, so it is not rendered (D-36).
// ────────────────────────────────────────────────────────────────

import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';

export interface AgentBrowsingStripProps {
  /** The agent driving the page; "The agent" when unknown. */
  agentName?: string;
}

export function AgentBrowsingStrip({ agentName }: AgentBrowsingStripProps): React.JSX.Element {
  return (
    <div role="status" className="flex items-center gap-2 border-b border-line-soft bg-run-bg px-3 py-1.5 text-small">
      <Spinner size={14} className="text-run" />
      <span className="min-w-0 truncate text-fg">{agentName ?? 'The agent'} is browsing</span>
      <span className="shrink-0 text-fg-3">· Your clicks still work</span>
    </div>
  );
}
