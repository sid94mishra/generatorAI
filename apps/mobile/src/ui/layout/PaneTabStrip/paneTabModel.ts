// Pure PaneTabStrip rules (03 ML-08; MD-23, MD-95). Unit-tested.
import type { PaneTab } from './PaneTabStrip.types';

/** "Changes, 2" / "Plan, needs you" — the count and attention are part of the name. */
export function paneTabLabel(tab: Pick<PaneTab, 'label' | 'count' | 'attention'>): string {
  return [tab.label, tab.count ? String(tab.count) : null, tab.attention ? 'needs you' : null].filter(Boolean).join(', ');
}

export function paneTabTestID(tab: Pick<PaneTab, 'type' | 'id'>, variant: 'tabs' | 'instanceChips'): string {
  return variant === 'tabs' ? `pane-tab-${tab.type}` : `pane-instance-${tab.id}`;
}
