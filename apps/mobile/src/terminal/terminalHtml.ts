// ────────────────────────────────────────────────────────────────
// The terminal WebView document.
//
// Inlined as a string rather than bundled as an asset so there is no file
// URL, no `allowFileAccess`, and nothing for the WebView to load from disk.
// The document has no network access and no origin: it is a renderer that
// speaks only `postMessage`. Everything it needs — xterm.js, its CSS, the
// fit / search / web-links addons — is vendored into the string by
// `scripts/build-terminal-bundle.mjs`.
//
// ── Importers ────────────────────────────────────────────────────
// `TerminalView.tsx` is the ONLY importer of this module, and it loads it
// with a dynamic `import()`. `xtermBundle.generated.ts` is ~570 KB of string
// literal; keeping it off the static import graph means Hermes does not
// touch it until a terminal is actually opened. A unit test
// (`terminalHtml.test.ts`) enforces the single-importer rule.
//
// ── Theming ──────────────────────────────────────────────────────
// A WebView gets no CSS variables from the host, so the palette is baked in
// at construction as an xterm `ITheme` (from `useTheme().terminal`, which is
// generated from the same design tokens the web app uses) and swapped live
// with a `theme` message afterwards. Every colour is validated before it is
// interpolated — the theme record is trusted data, but a `<style>` block is
// no place to find out otherwise.
// ────────────────────────────────────────────────────────────────

import {
  XTERM_ADDON_FIT_JS,
  XTERM_ADDON_SEARCH_JS,
  XTERM_ADDON_WEB_LINKS_JS,
  XTERM_CSS,
  XTERM_JS,
} from './xtermBundle.generated';
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  SCROLLBACK_LINES,
  clampFontSize,
} from './terminalSettings';

export interface TerminalHtmlOptions {
  /**
   * xterm `ITheme`: background, foreground, cursor, selection and the sixteen
   * ANSI colours. Unknown keys are dropped; invalid colours fall back.
   */
  theme: Record<string, string | undefined>;
  /** Clamped to `FONT_SIZE_MIN..FONT_SIZE_MAX`. */
  fontSize?: number;
  fontFamily?: string;
}

export { FONT_SIZE_MIN, FONT_SIZE_MAX, FONT_SIZE_DEFAULT, SCROLLBACK_LINES, clampFontSize };

/** The monospace stack the platforms actually ship. */
export const DEFAULT_FONT_FAMILY =
  'Menlo, "JetBrains Mono", "Roboto Mono", "Droid Sans Mono", ui-monospace, monospace';

/** Every key xterm's `ITheme` accepts. Anything else is not forwarded. */
const THEME_KEYS = [
  'background',
  'foreground',
  'cursor',
  'cursorAccent',
  'selectionBackground',
  'selectionForeground',
  'selectionInactiveBackground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;

/**
 * A CSS colour is interpolated straight into a `<style>` block and into a
 * JSON literal inside `<script>`, so it must not be able to close either.
 * Everything the palette can legitimately contain — `#rrggbb[aa]`,
 * `rgb(...)`, `hsl(...)`, a colour keyword — fits this character set;
 * anything else is dropped in favour of a safe default rather than trusted.
 */
const SAFE_CSS_COLOR = /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$|^(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/;

const DEFAULT_THEME: Record<string, string> = {
  background: '#0d1117',
  foreground: '#e6edf3',
};

/** Keep the known keys with valid colours; guarantee background + foreground. */
export function sanitizeTheme(theme: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of THEME_KEYS) {
    const value = theme[key]?.trim();
    if (value && SAFE_CSS_COLOR.test(value)) out[key] = value;
  }
  out['background'] ??= DEFAULT_THEME['background']!;
  out['foreground'] ??= DEFAULT_THEME['foreground']!;
  return out;
}

/** A font-family list is interpolated into JSON inside `<script>`; keep it to safe characters. */
function safeFontFamily(family: string | undefined): string {
  const trimmed = family?.trim();
  return trimmed && /^[\w\s,"'-]+$/.test(trimmed) ? trimmed : DEFAULT_FONT_FAMILY;
}

export function terminalHtml(options: TerminalHtmlOptions): string {
  const theme = sanitizeTheme(options.theme);
  const fontSize = clampFontSize(options.fontSize);
  const fontFamily = safeFontFamily(options.fontFamily);

  // JSON inside <script>: `<` is escaped so no value can open a tag, even
  // though every value has already been validated above.
  const config = JSON.stringify({ theme, fontSize, fontFamily, scrollback: SCROLLBACK_LINES }).replace(
    /</g,
    '\\u003c',
  );

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
${XTERM_CSS}
html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: ${theme['background']}; }
#term { position: absolute; inset: 0; padding: 4px 0 0 4px; box-sizing: border-box; }
.xterm .xterm-viewport { overscroll-behavior: contain; }
</style>
</head>
<body>
<div id="term"></div>
<script>${XTERM_JS}</script>
<script>${XTERM_ADDON_FIT_JS}</script>
<script>${XTERM_ADDON_SEARCH_JS}</script>
<script>${XTERM_ADDON_WEB_LINKS_JS}</script>
<script>
(function () {
  var CONFIG = ${config};
  var RN = window.ReactNativeWebView;
  function post(message) { if (RN) RN.postMessage(JSON.stringify(message)); }

  // The UMD builds attach their exports object to globalThis under the
  // library name, so the class is one level down.
  var Fit = (window.FitAddon && window.FitAddon.FitAddon) || null;
  var Search = (window.SearchAddon && window.SearchAddon.SearchAddon) || null;
  var WebLinks = (window.WebLinksAddon && window.WebLinksAddon.WebLinksAddon) || null;

  var term = new Terminal({
    theme: CONFIG.theme,
    fontSize: CONFIG.fontSize,
    fontFamily: CONFIG.fontFamily,
    lineHeight: 1.2,
    scrollback: CONFIG.scrollback,
    // Same as the web panel: the PTY already emits CRLF; converting LF would
    // double every newline a raw-mode program prints.
    convertEol: false,
    cursorBlink: true,
    allowProposedApi: true,
    // Long-press selection is the phone's copy gesture; xterm's default
    // right-click behaviour has no equivalent.
    rightClickSelectsWord: true,
  });

  var fit = Fit ? new Fit() : null;
  var search = Search ? new Search() : null;
  if (fit) term.loadAddon(fit);
  if (search) term.loadAddon(search);
  if (WebLinks) {
    // Never navigate inside the WebView: it has no network and no origin.
    // Hand the URL to React Native, which decides whether to open it.
    term.loadAddon(new WebLinks(function (event, uri) {
      if (event && event.preventDefault) event.preventDefault();
      post({ type: 'link', url: String(uri).slice(0, 2048) });
    }));
  }

  term.open(document.getElementById('term'));

  // ── Renderer → RN ────────────────────────────────────────────
  term.onData(function (data) { post({ type: 'input', b64: encodeUtf8(data) }); });
  term.onResize(function (size) { post({ type: 'resize', cols: size.cols, rows: size.rows }); });
  term.onTitleChange(function (title) { post({ type: 'title', title: String(title).slice(0, 256) }); });
  term.onBell(function () { post({ type: 'bell' }); });
  term.onSelectionChange(function () {
    if (term.hasSelection()) post({ type: 'selection', text: term.getSelection() });
  });

  // Hardware-keyboard heuristic. A soft keyboard cannot emit Escape, Tab,
  // arrows, paging keys or a Ctrl/Alt/Meta chord — those only arrive here
  // from a physical keyboard (RN never injects key events; it writes to the
  // PTY socket directly). Throttled: one signal a second is plenty.
  var lastHw = 0;
  term.attachCustomKeyEventHandler(function (e) {
    if (e.type === 'keydown') {
      var hw = e.ctrlKey || e.altKey || e.metaKey ||
        /^(Escape|Tab|Arrow(Up|Down|Left|Right)|Home|End|Page(Up|Down)|F[0-9]+)$/.test(e.key);
      if (hw && Date.now() - lastHw > 1000) { lastHw = Date.now(); post({ type: 'hwkey' }); }
    }
    return true;
  });

  // ── RN → renderer ────────────────────────────────────────────
  var SEARCH_OPTIONS = {
    regex: false, wholeWord: false, caseSensitive: false, incremental: true,
    decorations: {
      matchBackground: '#4d4d00', matchOverviewRuler: '#d19a66',
      activeMatchBackground: '#d19a66', activeMatchColorOverviewRuler: '#f5c542'
    }
  };
  function runSearch(query, direction) {
    if (!search) return;
    if (!query) { try { search.clearDecorations(); } catch (e) {} return; }
    var found = false;
    try {
      found = direction === 'prev'
        ? search.findPrevious(query, SEARCH_OPTIONS)
        : search.findNext(query, SEARCH_OPTIONS);
    } catch (e) {}
    post({ type: 'searchResult', found: !!found });
  }

  function refit() { if (fit) { try { fit.fit(); } catch (e) {} } }

  function handle(raw) {
    var message;
    try { message = JSON.parse(raw); } catch (e) { return; }
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
      case 'data': {
        // Chunks are '|'-delimited: concatenated base64 is only valid when
        // every chunk length is a multiple of 3, which PTY output never is.
        // Bytes, not text: xterm's own decoder keeps UTF-8 state across
        // writes, so a multi-byte character split over two PTY reads is
        // still rendered as one glyph.
        var chunks = String(message.b64).split('|');
        for (var i = 0; i < chunks.length; i++) if (chunks[i]) term.write(decodeBase64(chunks[i]));
        break;
      }
      case 'clear': term.clear(); if (search) { try { search.clearDecorations(); } catch (e) {} } break;
      case 'theme':
        if (message.theme && typeof message.theme === 'object') {
          term.options.theme = message.theme;
          if (message.theme.background) document.body.style.background = message.theme.background;
        }
        break;
      case 'fit': refit(); break;
      case 'fontSize': {
        var size = Number(message.size);
        if (size >= ${FONT_SIZE_MIN} && size <= ${FONT_SIZE_MAX}) { term.options.fontSize = size; refit(); }
        break;
      }
      case 'search': runSearch(String(message.query || ''), 'next'); break;
      case 'searchNext': runSearch(String(message.query || ''), 'next'); break;
      case 'searchPrev': runSearch(String(message.query || ''), 'prev'); break;
      case 'clearSearch': if (search) { try { search.clearDecorations(); } catch (e) {} } break;
      case 'scrollToBottom': term.scrollToBottom(); break;
      case 'focus': term.focus(); break;
      case 'blur': term.blur(); break;
      default: break;
    }
  }

  // Android delivers to document, iOS to window.
  document.addEventListener('message', function (e) { handle(e.data); });
  window.addEventListener('message', function (e) { handle(e.data); });

  // ── Codecs ───────────────────────────────────────────────────
  function decodeBase64(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function encodeUtf8(text) {
    var bytes = new TextEncoder().encode(text);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  // ── Layout ───────────────────────────────────────────────────
  // The soft keyboard shrinks the visual viewport, not the layout viewport,
  // on both platforms; without listening to it the bottom rows hide behind
  // the keys.
  window.addEventListener('resize', refit);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', refit);
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(refit).observe(document.getElementById('term'));
  }

  // Deferred: layout may not be settled on first paint, and the initial
  // \`resize\` must precede \`ready\` so the session is created at the real
  // geometry rather than 80×24.
  setTimeout(function () {
    refit();
    post({ type: 'resize', cols: term.cols, rows: term.rows });
    post({ type: 'ready' });
  }, 30);
})();
</script>
</body>
</html>`;
}
