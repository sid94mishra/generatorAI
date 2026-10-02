// MB-42 WorkspacePane (03 MB-42, ML-07, ML-08; 06 §1.1, §3.8; MD-23, MD-24, MD-82): the end SidePanel of the shell.
// The focused chat or run claims it with its tabs and a body renderer (`useClaimPaneScope`), so the shell renders
// the bodies without importing a feature (their legacy sections until M6). Overlay over a scrim below 840, docked
// at ≥ 840, full screen as a mode (window width; the main column's width when the sidebar is docked). Visited
// bodies stay mounted (terminal, WebView never remount); hidden ones are parked and paused. Back exits full screen
// first, then closes the overlay pane (06 §3.2).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams, usePathname } from 'expo-router';
import { DOCK_LINK_PARAM, parseDockLinkTab } from '@generatorai/shared/ui-contract';

import type { PanelSlot } from '../../ui/layout/AdaptiveLayout';
import { PaneShell } from '../../ui/layout/PaneShell';
import { PaneTabStrip } from '../../ui/layout/PaneTabStrip';
import { SidePanel } from '../../ui/layout/SidePanel';
import { useBackHandler } from '../../ui/platform/back';
import { useShellStore } from '../shell/shellStore';
import { isMobilePaneTab, type MobilePaneTab } from './paneRegistry';
import { scopeKey, usePaneStore, type PaneClaim, type PaneScope } from './paneStore';
import { paneVisibleOn } from './paneVisibility';

/** Claim the pane while this chat / run screen is focused; release it when the screen goes away. Consumes `?dock=`. */
export function useClaimPaneScope(claim: PaneClaim | null): void {
  const params = useLocalSearchParams();
  const raw = params[DOCK_LINK_PARAM];
  const dock = parseDockLinkTab(typeof raw === 'string' ? raw : undefined);
  const pending = useRef<MobilePaneTab | null>(null);
  useEffect(() => {
    if (!dock) return;
    if (isMobilePaneTab(dock)) pending.current = dock;
    router.setParams({ [DOCK_LINK_PARAM]: undefined });
    if (claim) {
      usePaneStore.getState().setClaim(claim, pending.current);
      pending.current = null;
    }
  }, [dock, claim]);

  useFocusEffect(
    useCallback(() => {
      if (!claim) return;
      usePaneStore.getState().setClaim(claim, pending.current);
      pending.current = null;
    }, [claim]),
  );
  const scope = useRef<PaneScope | null>(null);
  useEffect(() => {
    scope.current = claim?.scope ?? null;
  }, [claim]);
  useEffect(
    () => () => {
      if (scope.current) usePaneStore.getState().release(scope.current);
    },
    [],
  );
}

/** The header's pane toggle (ML-02 `paneToggle`): count = changed files; attention when a tab needs you. */
export function usePaneToggle(): { open: boolean; count: number; attention: boolean; onPress: () => void } {
  const open = usePaneStore((s) => s.open);
  const claim = usePaneStore((s) => s.claim);
  const toggle = usePaneStore((s) => s.toggle);
  const count = claim?.tabs.find((t) => t.type === 'changes')?.count ?? 0;
  const attention = Boolean(claim?.tabs.some((t) => t.attention));
  return { open, count, attention, onPress: toggle };
}

/** Whether the pane is on screen (claimed, open, over its screen) and in full screen — the shell's layout inputs. */
export function usePaneShown(): { shown: boolean; fullscreen: boolean } {
  const pathname = usePathname();
  const claim = usePaneStore((s) => s.claim);
  const open = usePaneStore((s) => s.open);
  const fullscreen = usePaneStore((s) => s.fullscreen);
  const shown = Boolean(claim && open && paneVisibleOn(pathname, claim.path));
  return { shown, fullscreen: shown && fullscreen };
}

/** The pane in the presentation AdaptiveLayout gives it (overlay < 840, docked ≥ 840, full screen as a mode). */
export function WorkspacePane({ presentation, width }: PanelSlot): React.ReactElement {
  const { shown } = usePaneShown();
  const claim = usePaneStore((s) => s.claim);
  const fullscreen = usePaneStore((s) => s.fullscreen);
  const active = usePaneStore((s) => s.active);
  const { setOpen, setFullscreen, select } = usePaneStore.getState();
  const surfaceOwnsGestures = useShellStore((s) => s.gestureOwner === 'surface');
  const tabs = claim?.tabs ?? [];
  const current: MobilePaneTab = tabs.some((t) => t.type === active) ? active : (tabs[0]?.type ?? 'changes');

  // Visited bodies stay mounted per scope (MD-24); a new scope starts fresh.
  const key = claim ? scopeKey(claim.scope) : '';
  const [visited, setVisited] = useState<{ key: string; types: MobilePaneTab[] }>({ key, types: [] });
  if (shown && (visited.key !== key || !visited.types.includes(current))) {
    setVisited((v) => (v.key !== key ? { key, types: [current] } : { key, types: [...v.types, current] }));
  }

  useBackHandler(shown && fullscreen, () => {
    setFullscreen(false);
    return true;
  });

  return (
    <SidePanel
      side="end"
      open={shown}
      onOpenChange={setOpen}
      presentation={presentation}
      dragToCloseEnabled={!surfaceOwnsGestures}
      width={width}
      accessibilityLabel="Workspace pane"
      testID="pane"
    >
      {claim ? (
        <PaneShell
          title="Workspace"
          subtitle={claim.title}
          mode={presentation === 'persistent' ? 'docked' : presentation}
          onToggleFullscreen={() => setFullscreen(!fullscreen)}
          onClose={() => setOpen(false)}
          onBackToChat={() => setFullscreen(false)}
          backToLabel={claim.scope.kind === 'run' ? 'Back to run' : 'Back to chat'}
          tabs={<PaneTabStrip tabs={tabs} active={current} onSelect={(id) => select(id as MobilePaneTab)} accessibilityLabel="Workspace tabs" />}
        >
          {(visited.key === key ? visited.types : []).map((type) => {
            const on = shown && type === current;
            return (
              <View
                key={`${key}:${type}`}
                pointerEvents={on ? 'auto' : 'none'}
                accessibilityElementsHidden={!on}
                importantForAccessibility={on ? 'auto' : 'no-hide-descendants'}
                className={on ? 'absolute inset-0' : 'absolute inset-0 opacity-0'}
              >
                {claim.renderTab(type, { active: on })}
              </View>
            );
          })}
        </PaneShell>
      ) : null}
    </SidePanel>
  );
}

