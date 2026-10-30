// The header's navigation (06 §2.1, §3.2, §3.3): Back pops when there is history, otherwise walks up the IA
// (parentHref); breadcrumb segments pop to their level when it is in the stack, otherwise replace. Query-free.
import { useCallback, useMemo } from 'react';
import { router, usePathname } from 'expo-router';

import type { BreadcrumbSegment } from '../../ui/layout/Breadcrumb/Breadcrumb.types';
import { parentHref } from './parentHref';

type Href = Parameters<typeof router.replace>[0];

export interface CrumbInput {
  label: string;
  href: string;
}

export function useHeaderBack(): () => void {
  const pathname = usePathname();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace((parentHref(pathname) ?? '/') as Href);
  }, [pathname]);
}

/** Breadcrumb segments from real ancestors (labels from the screen's own data, never sample names). */
export function useBreadcrumb(crumbs: ReadonlyArray<CrumbInput>): BreadcrumbSegment[] {
  return useMemo(
    () =>
      crumbs.map((c) => ({
        label: c.label,
        onPress: () => {
          try {
            router.dismissTo(c.href as Href);
          } catch {
            router.replace(c.href as Href);
          }
        },
      })),
    [crumbs],
  );
}
