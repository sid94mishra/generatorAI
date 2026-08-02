// ────────────────────────────────────────────────────────────────
// App — Root application component with all providers
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryProvider } from '@/providers/QueryProvider.js';
import { PlatformProvider } from '@/providers/PlatformProvider.js';
import { ThemeProvider } from '@/providers/ThemeProvider.js';
import { DiffProviders } from '@/components/diff/DiffProviders.js';
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
            {/* One shared Shiki worker pool + AST cache for every diff surface.
                Mounted at the root so switching pages keeps the cache warm. */}
            <DiffProviders>
              <RouterProvider router={router} />
            </DiffProviders>
          </AuthGate>
          <Toaster />
        </PlatformProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}

export default App;
