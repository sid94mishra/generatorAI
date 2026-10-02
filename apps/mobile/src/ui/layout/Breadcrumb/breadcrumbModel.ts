// Pure Breadcrumb logic (03 ML-03): middle collapse and the title view's spoken name and actions.
import type { BreadcrumbSegment } from './Breadcrumb.types';

export type CollapsedCrumbs = { shown: BreadcrumbSegment[]; hidden: BreadcrumbSegment[]; ellipsisAt: number | null };

/** More than three levels: first … last two; the hidden middle opens as a menu from "…". */
export function collapseCrumbs(segments: ReadonlyArray<BreadcrumbSegment>, max = 3): CollapsedCrumbs {
  if (segments.length <= max) return { shown: [...segments], hidden: [], ellipsisAt: null };
  return { shown: [segments[0]!, ...segments.slice(-(max - 1))], hidden: segments.slice(1, -(max - 1)), ellipsisAt: 1 };
}

/** "Chats, Payments service, Fix flaky checkout test". */
export function titleViewLabel(breadcrumb: ReadonlyArray<BreadcrumbSegment> | undefined, title: string): string {
  return [...(breadcrumb ?? []).map((s) => s.label), title].join(', ');
}

export function crumbActions(breadcrumb: ReadonlyArray<BreadcrumbSegment> | undefined): Array<{ name: string; label: string }> {
  return (breadcrumb ?? []).flatMap((s, i) => (s.onPress ? [{ name: `crumb-${i}`, label: `Go to ${s.label}` }] : []));
}
