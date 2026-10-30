// ────────────────────────────────────────────────────────────────
// useDockLinkParam — R-4 `?dock=<tab>` (04-screen-map.md): Home "Review",
// Needs-you rows, the palette and deep links (`generatorai://chats/<id>?dock=plan`)
// land on a dock tab. The page consumes the parameter once and removes it with
// `replace`, so history does not fill with dock states.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { DOCK_LINK_PARAM, parseDockLinkTab, type DockLinkTab } from '@generatorai/shared/ui-contract';

export function useDockLinkParam(onDockLink: (tab: DockLinkTab) => void): void {
  const [params, setParams] = useSearchParams();
  const raw = params.get(DOCK_LINK_PARAM);
  const onDockLinkRef = useRef(onDockLink);
  onDockLinkRef.current = onDockLink;

  useEffect(() => {
    if (raw === null) return;
    const tab = parseDockLinkTab(raw);
    if (tab) onDockLinkRef.current(tab);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(DOCK_LINK_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [raw, setParams]);
}
