// ────────────────────────────────────────────────────────────────
// The terminal WebView document.
//
// Inlined as a string rather than bundled as an asset so there is no file
// URL, no `allowFileAccess`, and nothing for the WebView to load from disk.
// The document has no network access and no origin: it is a renderer that
// speaks only `postMessage`.
//
// NOTE: xterm.js itself must be vendored into this string (or served from
// the local bundle) before the terminal renders. The bridge, batching and
// message validation are complete and tested; the vendored renderer is the
// remaining piece and is called out as untested in the handover notes.
// ────────────────────────────────────────────────────────────────

/**
 * Minimal renderer.
 *
 * Deliberately dependency-free for now: it echoes PTY output into a <pre>
 * with ANSI stripped, which is enough to prove the bridge end-to-end without
 * pretending the full emulator is done. Swapping in xterm.js replaces only
 * the `write`/`init` functions — the message contract does not change.
 *
 * ── Theming ──────────────────────────────────────────────────────
 * The document is built per-call from the active palette rather than being a
 * static string. A WebView gets no CSS variables from the host, so baked-in
 * colours simply do not follow the theme: the previous hardcoded
 * `#0d1117`/`#e6edf3` pair rendered a dark terminal inside a light app, with
 * the surrounding chrome the wrong colour on every light-mode device.
 *
 * Colours are injected as CSS custom properties and every rule reads from
 * them, so a theme change is a one-line style swap rather than a re-render.
 */
export interface TerminalPalette {
  /**
   * Terminal background. Use the app's `background` token.
   *
   * Optional because the theme's colour record is indexed by token name and
   * therefore types every lookup as possibly-undefined. A missing token falls
   * back to the dark default below rather than producing `background: undefined`,
   * which the WebView would silently render as transparent-on-white.
   */
  background?: string | undefined;
  /** Default text colour. Use the app's `foreground` token. */
  foreground?: string | undefined;
}

/**
 * A CSS colour is interpolated straight into a `<style>` block, so it must not
 * be able to close that block or start a new rule. Everything the palette can
 * legitimately contain — `#rrggbb`, `rgb(...)`, `hsl(...)`, a colour keyword —
 * fits this character set; anything else is dropped in favour of a safe
 * default rather than trusted.
 */
const SAFE_CSS_COLOR = /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$|^(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/;

function cssColor(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && SAFE_CSS_COLOR.test(trimmed) ? trimmed : fallback;
}

export function terminalHtml(palette: TerminalPalette): string {
  const bg = cssColor(palette.background, '#0d1117');
  const fg = cssColor(palette.foreground, '#e6edf3');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  :root { --term-bg: ${bg}; --term-fg: ${fg}; }
  html, body { margin: 0; padding: 0; height: 100%; background: var(--term-bg); }
  #out {
    margin: 0; padding: 8px; height: 100%; box-sizing: border-box;
    overflow-y: auto; overflow-x: auto; white-space: pre;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px; line-height: 1.45; color: var(--term-fg);
  }
  #input { position: absolute; opacity: 0; pointer-events: none; }
</style>
</head>
<body>
<pre id="out"></pre>
<input id="input" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" />
<script>
(function () {
  var out = document.getElementById('out');
  var input = document.getElementById('input');
  var RN = window.ReactNativeWebView;

  function post(message) { RN && RN.postMessage(JSON.stringify(message)); }

  // Strip CSI/OSC sequences. A real emulator interprets them; this at least
  // does not render them as garbage while the bridge is being proven.
  function strip(text) {
    return text
      .replace(/\\u001b\\][^\\u0007]*(\\u0007|\\u001b\\\\)/g, '')
      .replace(/\\u001b\\[[0-9;?]*[A-Za-z]/g, '')
      .replace(/\\r/g, '');
  }

  function write(text) {
    out.textContent += strip(text);
    // Bound the DOM: an unbounded build log will eventually stall the page.
    if (out.textContent.length > 200000) {
      out.textContent = out.textContent.slice(-150000);
    }
    out.scrollTop = out.scrollHeight;
  }

  function decode(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function handle(raw) {
    var message;
    try { message = JSON.parse(raw); } catch (e) { return; }
    if (message.type === 'data') {
      // Chunks are '|'-delimited: concatenated base64 is only valid when
      // every chunk length is a multiple of 3, which PTY output never is.
      var chunks = String(message.b64).split('|');
      for (var i = 0; i < chunks.length; i++) {
        if (chunks[i]) write(decode(chunks[i]));
      }
    } else if (message.type === 'clear') {
      out.textContent = '';
    }
  }

  // Android delivers to document, iOS to window.
  document.addEventListener('message', function (e) { handle(e.data); });
  window.addEventListener('message', function (e) { handle(e.data); });

  function encode(text) {
    var bytes = new TextEncoder().encode(text);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  out.addEventListener('click', function () { input.focus(); });
  input.addEventListener('input', function () {
    if (input.value) { post({ type: 'input', b64: encode(input.value) }); input.value = ''; }
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { post({ type: 'input', b64: encode('\\r') }); e.preventDefault(); }
    if (e.key === 'Backspace') { post({ type: 'input', b64: encode('\\u007f') }); e.preventDefault(); }
  });

  function reportSize() {
    var probe = document.createElement('span');
    probe.textContent = '0';
    probe.style.cssText = 'visibility:hidden;position:absolute;font-family:inherit;font-size:12px';
    out.appendChild(probe);
    var charWidth = probe.getBoundingClientRect().width || 7;
    out.removeChild(probe);
    var cols = Math.max(20, Math.floor((out.clientWidth - 16) / charWidth));
    var rows = Math.max(5, Math.floor(out.clientHeight / (12 * 1.45)));
    post({ type: 'resize', cols: cols, rows: rows });
  }

  window.addEventListener('resize', reportSize);
  reportSize();
  post({ type: 'ready' });
})();
</script>
</body>
</html>`;
}
