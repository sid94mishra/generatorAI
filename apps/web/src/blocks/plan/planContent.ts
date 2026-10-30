// ────────────────────────────────────────────────────────────────
// Plan document helpers for the Plan dock (F-dock-plan).
// ────────────────────────────────────────────────────────────────

/**
 * The plan's markdown without a leading `# <title>` line when it repeats the plan title the panel already shows as
 * its heading (agents start plan files with their title, so the panel read "X" twice). Other headings stay.
 */
export function withoutLeadingTitle(content: string, title: string): string {
  const match = /^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/.exec(content);
  if (!match) return content;
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(match[1] ?? '') === norm(title) ? content.slice(match[0].length).replace(/^\s*\n/, '') : content;
}
