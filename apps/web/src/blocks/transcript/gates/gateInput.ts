// Display text for a gate's input summary (PermissionCard).

/**
 * The gate's input as the board draws it: a shell gate shows the command
 * itself (`git push -u origin …`), not the JSON object that carries it; its other options follow as comments.
 * Anything else keeps the provider's summary verbatim.
 */
export function gateInputText(summary: string): string {
  try {
    const parsed: unknown = JSON.parse(summary);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed as Record<string, unknown>);
      const command = (parsed as Record<string, unknown>)['command'];
      const rest = entries.filter(([key]) => key !== 'command' && key !== 'description');
      // The command first, then the call's other options as comments (`# timeout: 300000`): Claude adds timeout /
      // run_in_background to most long commands, and those gates read as a JSON object instead of a command.
      if (typeof command === 'string') {
        return [command, ...rest.map(([key, value]) => `# ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)].join('\n');
      }
    }
  } catch {
    /* not JSON: show it as given */
  }
  return summary;
}
