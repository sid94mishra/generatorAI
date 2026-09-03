// ────────────────────────────────────────────────────────────────
// App — Root application component with all providers
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryProvider } from '@/providers/QueryProvider.js';
import { PlatformProvider } from '@/providers/PlatformProvider.js';
import { ThemeProvider } from '@/providers/ThemeProvider.js';
import { AuthGate } from '@/components/AuthGate.js';
import { Toaster } from '@/components/Toast.js';
import { router } from '@/router.js';

export function App() {
  return (
    <ThemeProvider>
      <QueryProvider>
        <PlatformProvider>
          {/* Nothing renders until the device is authenticated: an unpaired
              browser would otherwise fire dozens of doomed API calls before
              the user is told why. */}
          <AuthGate>
            {/* Diff/code-view surfaces mount their own <DiffProviders> at the
                point of use (ChangesSurface, FilesSurface, FileViewerModal,
                CodebaseDetailPage) instead of here. @pierre/diffs/react's
                worker pool is a lazily-created, refcounted module-level
                singleton (see DiffProviders.tsx), so multiple mount points
                share one Shiki/WASM pool safely — but mounting it here would
                statically import the whole library into this eager root
                bundle instead of the lazy route chunks that actually use it. */}
            <RouterProvider router={router} />
          </AuthGate>
          <Toaster />
        </PlatformProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}

export default App;
