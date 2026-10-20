// ────────────────────────────────────────────────────────────────
// A JSON stage's result, readable (evaluation, D-159). A stage with a
// structured output ends on a closing remark — W1's Spec showed "Now I'm
// writing the spec…" as its output while the spec itself was only in the
// data. Its row, its approval card and its inspector show the data: each
// field under its name, lists as bullets, a list of flat records one bullet
// per record, and anything nested deeper as JSON.
// ────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v: unknown): v is string | number | boolean => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (isRecord(v) && Object.keys(v).length === 0);
const flat = (v: Json) => Object.values(v).every((x) => isScalar(x) || x === null);

const ACRONYMS: Readonly<Record<string, string>> = { api: 'API', ui: 'UI', url: 'URL', id: 'ID', ids: 'IDs', pr: 'PR', json: 'JSON', http: 'HTTP', sql: 'SQL', adr: 'ADR' };

/** `backendTasks` / `backend_tasks` → "Backend tasks"; `apiTasks` → "API tasks". */
export function fieldLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => ACRONYMS[w] ?? w)
    .join(' ');
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : key;
}

/** `Pulse v<version>` keeps its placeholder: angle brackets outside code spans would be read as HTML tags. */
function text(value: string): string {
  return value
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/[<>]/g, (c) => `\\${c}`)))
    .join('');
}

const jsonBlock = (v: unknown) => `\`\`\`json\n${JSON.stringify(v, null, 2)}\n\`\`\``;
const oneLine = (s: string) => !s.includes('\n') && s.length <= 140;

/** A flat record as one line: `title — key: value · key: value`. */
function recordLine(v: Json): string {
  const entries = Object.entries(v).filter(([, x]) => !empty(x));
  const lead = entries.find(([, x]) => typeof x === 'string');
  const rest = entries.filter((e) => e !== lead).map(([k, x]) => `${fieldLabel(k)}: ${String(x)}`);
  return text([lead ? String(lead[1]) : '', rest.join(' · ')].filter(Boolean).join(' — '));
}

function list(items: readonly unknown[]): string | null {
  if (items.every(isScalar)) return items.map((x) => `- ${text(String(x).replace(/\n+/g, ' '))}`).join('\n');
  if (items.every((x) => isRecord(x) && flat(x))) return items.map((x) => `- ${recordLine(x as Json).replace(/\n+/g, ' ')}`).join('\n');
  return null;
}

function field(key: string, value: unknown): string {
  const label = fieldLabel(key);
  if (typeof value === 'string') return oneLine(value) ? `**${label}:** ${text(value)}` : `**${label}**\n\n${text(value)}`;
  if (isScalar(value)) return `**${label}:** ${String(value)}`;
  if (Array.isArray(value)) return `**${label}**\n\n${list(value) ?? jsonBlock(value)}`;
  if (isRecord(value) && flat(value)) {
    const rows = Object.entries(value).filter(([, x]) => !empty(x)).map(([k, x]) => `- ${fieldLabel(k)}: ${text(String(x))}`);
    return `**${label}**\n\n${rows.join('\n')}`;
  }
  return `**${label}**\n\n${jsonBlock(value)}`;
}

/** Markdown for a stage's structured output (see the file header). */
export function structuredOutputMarkdown(data: unknown): string {
  if (isScalar(data)) return text(String(data));
  if (Array.isArray(data)) return list(data) ?? jsonBlock(data);
  if (!isRecord(data)) return '';
  const fields = Object.entries(data).filter(([, v]) => !empty(v));
  return fields.length > 0 ? fields.map(([k, v]) => field(k, v)).join('\n\n') : jsonBlock(data);
}

/** A structured output worth showing as the stage's result: an object or a list. */
export function hasStructuredOutput(data: unknown): boolean {
  return (isRecord(data) && Object.keys(data).length > 0) || (Array.isArray(data) && data.length > 0);
}
