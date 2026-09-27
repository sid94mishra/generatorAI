// ────────────────────────────────────────────────────────────────
// Background-location routing for the Settings modal (D-26, 06 §2.4).
//
// The shell renders the pages at `pageLocation`, which is the URL except
// under the Settings modal (`/settings/:section?`). There it is:
//   1. `state.backgroundLocation` — the page `openSettings()` opened it over;
//   2. else the last page shown — a plain link or a desktop deep link to
//      /settings/… (the URL is then replaced to carry that page as its
//      background, so Close, Back and isOverlayNavigation see it);
//   3. else Home — a direct load.
// The page therefore stays mounted while the modal is open.
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef } from 'react';
import { createPath, useLocation, useNavigate, type Location } from 'react-router';
import { settingsPath, settingsSectionFromPath, type SettingsSectionId } from '@generatorai/shared/ui-contract';
import { backgroundLocationOf, type OverlayLocationLike, type OverlayState } from '@/lib/overlayNavigation.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';

/** Behind a directly loaded Settings modal. */
export const HOME_LOCATION: Location = { pathname: '/', search: '', hash: '', state: null, key: 'settings-home', mask: undefined };

export interface ShellLocations {
  /** The URL. */
  location: Location;
  /** What the main card renders: the URL, or the page behind the Settings modal. */
  pageLocation: Location;
  /** The open Settings section, or null when the modal is closed. */
  settingsSection: SettingsSectionId | null;
  /** The modal's background as the URL state names it (null on a direct load). */
  background: OverlayLocationLike | null;
}

export function useShellLocations(): ShellLocations {
  const location = useLocation();
  const navigate = useNavigate();
  const settingsSection = settingsSectionFromPath(location.pathname);
  const background = settingsSection ? backgroundLocationOf(location.state) : null;

  const lastPage = useRef<Location | null>(null);
  if (!settingsSection) lastPage.current = location;

  const raw: Location = settingsSection ? ((background as Location | null) ?? lastPage.current ?? HOME_LOCATION) : location;
  const rawPath = createPath(raw);
  // Identity follows the page's address, so a re-render (or a section switch
  // inside the modal) is not a navigation for the page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pageLocation = useMemo(() => raw, [rawPath, raw.key]);

  useEffect(() => {
    if (!settingsSection || background || !lastPage.current) return;
    const state: OverlayState = { backgroundLocation: lastPage.current };
    void navigate(createPath(location), { replace: true, state });
  }, [settingsSection, background, location, navigate]);

  return { location, pageLocation, settingsSection, background };
}

/**
 * Lends the settings store its opener: `openSettings(section)` is a
 * navigation that needs the current location, and a store cannot hold a
 * router hook (importing the router there would close an import cycle
 * through every lazy page).
 *   outside Settings  push `/settings/<section>` with `state.backgroundLocation`
 *   inside it         replace, keeping the same background
 */
export function useSettingsOpener(location: Location): void {
  const navigate = useNavigate();
  const setOpener = useSettingsUiStore((s) => s.setOpener);
  const locationRef = useRef(location);
  locationRef.current = location;
  useEffect(() => {
    setOpener((section: SettingsSectionId) => {
      const current = locationRef.current;
      if (settingsSectionFromPath(current.pathname)) {
        void navigate(settingsPath(section), { replace: true, state: current.state });
        return;
      }
      const state: OverlayState = { backgroundLocation: current };
      void navigate(settingsPath(section), { state });
    });
    return () => setOpener(null);
  }, [navigate, setOpener]);
}
