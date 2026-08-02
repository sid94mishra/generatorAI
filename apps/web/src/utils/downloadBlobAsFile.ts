// ────────────────────────────────────────────────────────────────
// downloadBlobAsFile — safe browser blob download helper (Phase 1, 1.18)
//
// Before Phase 1, HttpPlatformClient manually created an `<a>` tag, set
// `href = URL.createObjectURL(blob)`, clicked it, then revoked the URL
// immediately. That had three bugs:
//   1. A failed fetch (e.g., 404) never reached the revoke line.
//   2. Revoking before the browser initiated the download could break
//      the click in certain browsers / under fast click cadence.
//   3. The anchor element leaked in the DOM on error paths.
//
// This helper puts revocation in a `try/finally` with a short drain
// delay so the browser has actually started the download, and removes
// the anchor unconditionally.
// ────────────────────────────────────────────────────────────────

export async function downloadBlobAsFile(
  blob: Blob,
  filename: string,
  options?: { revokeDelayMs?: number },
): Promise<void> {
  const revokeDelayMs = options?.revokeDelayMs ?? 100;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      a.remove();
    }
    // Give the browser time to actually start the download before we
    // revoke the object URL. Too-short a delay breaks the download on
    // some Chromium versions; the 100ms default is conservative.
    await new Promise((resolve) => setTimeout(resolve, revokeDelayMs));
  } finally {
    URL.revokeObjectURL(url);
  }
}
