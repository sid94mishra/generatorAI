// The orchestrator names its workers' tasks as slugs (`qa-stabilise-flaky-tests`). The transcript's delegation rows
// and the Tasks dock both show them as titles: `QA stabilise flaky tests`.

const ACRONYMS: ReadonlySet<string> = new Set([
  'adr', 'api', 'ci', 'cli', 'css', 'db', 'e2e', 'html', 'http', 'id', 'json', 'pr', 'qa', 'sdk', 'sql', 'sse', 'ssrf',
  'ui', 'url', 'ux',
]);

/** `qa-stabilise-flaky-tests` → `QA stabilise flaky tests`; words already cased by the author are kept. */
export function taskTitle(name: string): string {
  const words = name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return name;
  return words
    .map((word, i) => {
      if (word !== word.toLowerCase()) return word;
      if (ACRONYMS.has(word)) return word.toUpperCase();
      return i === 0 ? word[0]!.toUpperCase() + word.slice(1) : word;
    })
    .join(' ');
}
