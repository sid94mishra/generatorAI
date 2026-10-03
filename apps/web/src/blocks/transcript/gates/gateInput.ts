// Display text for a gate's input summary (PermissionCard).

/**
 * The gate's input as the board draws it: a shell gate shows the command
 * itself (`git push -u origin …`), not the JSON object that carries it.
 * Anything else keeps the provider's summary verbatim.
 */
export function gateInputText(summary: string): string {
  try {
    const parsed: unknown = JSON.parse(summary);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>);
      const command = (parsed as Record<string, unknown>)['command'];
      const rest = entries.filter(([key]) => key !== 'command' && key !== 'description');
      if (typeof command === 'string' && rest.length === 0) return command;
    }
  } catch {
    /* not JSON: show it as given */
  }
  return summary;
}
