// ────────────────────────────────────────────────────────────────
// SettingsRoute — back-compat for the old /settings URL. Settings is
// now a global modal; visiting /settings opens it and returns the user
// to the dashboard behind it.
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';

export function SettingsRoute() {
  const openSettings = useSettingsUiStore((s) => s.openSettings);
  useEffect(() => {
    openSettings();
  }, [openSettings]);
  return <Navigate to="/" replace />;
}

export default SettingsRoute;
