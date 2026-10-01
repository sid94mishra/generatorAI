/** Keep server diagnostics readable in native action banners and toasts. */
export function shortError(error: unknown, fallback: string): string {
  const line = (error instanceof Error && error.message ? error.message : fallback).split(/\r?\n/)[0]!.trim();
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}
