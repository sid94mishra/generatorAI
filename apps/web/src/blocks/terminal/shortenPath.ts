/**
 * The tail of a path, within a character budget (the terminal cwd chip).
 *
 * Counting segments rather than characters once put the workspace's 36-char
 * execution id inside the label and the ellipsis then cut off the part that
 * says where you are ("source/shop"). The last segment always survives;
 * earlier ones are added while they fit.
 */
export function shortenPath(p: string, budget = 34): string {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0) return p;
  const kept: string[] = [parts[parts.length - 1] as string];
  let length = kept[0]!.length;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const next = parts[i] as string;
    if (length + next.length + 1 > budget) break;
    kept.unshift(next);
    length += next.length + 1;
  }
  if (kept.length === parts.length) return p;
  return '…/' + kept.join('/');
}
