// ────────────────────────────────────────────────────────────────
// Context-window sizes as the model picker and the composer's tier chip
// print them: 200_000 → "200K", 1_000_000 → "1M", 1_500_000 → "1.5M".
//
// A published LIMIT, not a live count — the gauge's running figures use
// `formatTokens` (stream/contextUsage), which keeps a decimal for small
// counts. Moved from the web's legacy ModelPicker so the new pickers and
// mobile print the same number (P4-08, 03 §2.1 B-01).
// ────────────────────────────────────────────────────────────────

export function formatTokenLimit(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const k = tokens / 1_000;
    return `${Number.isInteger(k) ? k : k.toFixed(0)}K`;
  }
  return String(tokens);
}
