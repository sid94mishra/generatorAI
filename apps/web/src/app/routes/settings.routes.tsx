// ────────────────────────────────────────────────────────────────
// Settings modal route (D-26; 06 §2.4). `/settings/:section?` is not a page
// route: the shell (ShellRoute) keeps rendering the page the modal was opened
// over (`state.backgroundLocation`, or Home on a direct load) and mounts this
// modal on top. Selecting a section replaces the history entry and keeps the
// background; closing returns to the background page (Back when the modal was
// pushed over it, else a replace).
// ────────────────────────────────────────────────────────────────

import { lazy, Suspense, useCallback, useEffect } from 'react';
import { createPath, useNavigate } from 'react-router';
import type { SettingsSectionId } from '@generatorai/shared/ui-contract';
import type { OverlayLocationLike } from '@/lib/overlayNavigation.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';

export const SETTINGS_PATTERN = '/settings/:section?';

const LazySettingsModal = lazy(() =>
  // The registrations load with the modal: legacy sections stay out of the entry chunk.
  Promise.all([import('@/app/registries/settingsSections.js'), import('@/features/settings/index.js')]).then(([, m]) => ({
    default: m.SettingsModal,
  })),
);

/** React Router stamps `history.state.idx`; > 0 means there is an entry to go Back to. */
function hasHistoryBehind(): boolean {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' && idx > 0;
}

export interface SettingsModalRouteProps {
  section: SettingsSectionId;
  /** The page rendered behind the modal; null on a direct load (Home is behind it). */
  background: OverlayLocationLike | null;
}

export function SettingsModalRoute({ section, background }: SettingsModalRouteProps) {
  const navigate = useNavigate();

  // The last-visited section is the target of a bare `openSettings()`.
  useEffect(() => {
    useSettingsUiStore.setState({ section });
  }, [section]);

  const onClose = useCallback(() => {
    if (background && hasHistoryBehind()) void navigate(-1);
    else void navigate(background ? createPath(background) : '/', { replace: true });
  }, [background, navigate]);

  const onSelectSection = useCallback((next: SettingsSectionId) => {
    useSettingsUiStore.getState().openSettings(next);
  }, []);

  return (
    <Suspense fallback={null}>
      <LazySettingsModal section={section} onSelectSection={onSelectSection} onClose={onClose} />
    </Suspense>
  );
}
