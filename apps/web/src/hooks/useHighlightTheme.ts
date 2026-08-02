// ────────────────────────────────────────────────────────────────
// useHighlightTheme — injects the correct highlight.js theme stylesheet
// (<link> in <head>) for the active app theme and keeps it in sync. Any
// component that renders hljs-highlighted markup (MarkdownRenderer,
// SyntaxHighlightedCode) calls this so tokens are actually colourised.
// A single shared <link id="hljs-theme-link"> is reused across callers.
// ────────────────────────────────────────────────────────────────

import { useEffect } from 'react';
import { useTheme } from '@/providers/ThemeProvider.js';

// URL-only imports (Vite ?url) so only one stylesheet is active at a time.
import hljsLightUrl from 'highlight.js/styles/github.css?url';
import hljsDarkUrl from 'highlight.js/styles/github-dark.css?url';

export function useHighlightTheme(): void {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const id = 'hljs-theme-link';
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = resolvedTheme === 'dark' ? hljsDarkUrl : hljsLightUrl;
  }, [resolvedTheme]);
}
