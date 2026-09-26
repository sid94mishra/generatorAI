// ────────────────────────────────────────────────────────────────
// ChangesSurface characterization — render helper.
//
// Kept apart from ./changesSurfaceHarness.tsx on purpose: this module pulls
// in the app providers (which import the mocked hook modules), while the
// harness is itself imported BY those mock factories.
// ────────────────────────────────────────────────────────────────

import type { ReactElement } from 'react';
import { Toaster } from 'sonner';
import { renderWithProviders } from '../../helpers/renderWithProviders.js';
import { makeChangesPlatform } from './changesSurfaceHarness.js';

/**
 * Render the surface under the app providers plus a sonner `<Toaster />`, so
 * a toast is asserted by what the user reads rather than by spying on it.
 */
export function renderSurface(ui: ReactElement) {
  const platform = makeChangesPlatform();
  const result = renderWithProviders(
    <>
      {ui}
      <Toaster />
    </>,
    { platform: platform as never },
  );
  const rerenderSurface = (next: ReactElement) =>
    result.rerender(
      <>
        {next}
        <Toaster />
      </>,
    );
  return { ...result, platform, rerenderSurface };
}
