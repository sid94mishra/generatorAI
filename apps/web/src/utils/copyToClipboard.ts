// ────────────────────────────────────────────────────────────────
// copyTextToClipboard — the async Clipboard API with a same-document
// fallback.
//
// `navigator.clipboard.writeText` needs a secure context, a focused document
// and (in Electron) a session permission that says yes to
// `clipboard-sanitized-write`. When any of those is missing it rejects, and
// the user sees "could not copy" for text that is sitting right there. The
// fallback selects the text in an off-screen textarea and runs the legacy
// `copy` command, which works in every browser and Electron shell we ship.
// ────────────────────────────────────────────────────────────────

export async function copyTextToClipboard(text: string): Promise<void> {
  let firstError: unknown;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      firstError = err;
    }
  }
  if (typeof document === 'undefined') throw firstError ?? new Error('Clipboard is not available');
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  ta.style.pointerEvents = 'none';
  document.body.appendChild(ta);
  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    if (!ok) throw firstError ?? new Error('The clipboard refused the copy');
  } finally {
    document.body.removeChild(ta);
  }
}
