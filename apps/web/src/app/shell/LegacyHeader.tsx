// ────────────────────────────────────────────────────────────────
// LegacyHeader (D-21, 06 §2.3): the old global Header as the first row of the
// main card, for every route whose handle still says `legacyHeader: true`.
// Rendered by RouteSlot INSIDE the route element, so the Header's
// `useParams()` still resolves `:id` (chat breadcrumb, Archive). Each ported
// page turns the flag off; P7 deletes this file and Header.tsx.
// ────────────────────────────────────────────────────────────────

import { Header } from '@/components/layout/Header.js';
import { LegacyHeaderSlot } from '@/ui/shell/PageHeaderSlot/PageHeaderSlot.js';

export function LegacyHeader() {
  return (
    <LegacyHeaderSlot>
      <Header />
    </LegacyHeaderSlot>
  );
}
