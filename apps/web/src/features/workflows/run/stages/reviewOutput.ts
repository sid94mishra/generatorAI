// A completion review's output as Markdown (U-19). A JSON output contract
// shows field by field: long text as Markdown under its name, short values
// inline, lists as bullets, anything nested as a small JSON block. A contract
// with a single text field (`{"body": "## Summary…"}`) shows just that text.
// Other output shows as is; JSON that does not parse shows as a code block.

const fence = (text: string) => `\`\`\`json\n${text}\n\`\`\``;
const isLongText = (v: unknown): v is string => typeof v === 'string' && (v.length > 80 || v.includes('\n'));
const title = (key: string) => key.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function field(key: string, value: unknown): string {
  if (isLongText(value)) return `#### ${title(key)}\n\n${value}`;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return `**${title(key)}:** ${value === '' ? '—' : String(value)}`;
  if (Array.isArray(value) && value.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))) {
    return value.length === 0 ? `**${title(key)}:** none` : `**${title(key)}:**\n\n${value.map((v) => `- ${String(v)}`).join('\n')}`;
  }
  return `**${title(key)}:**\n\n${fence(JSON.stringify(value, null, 2))}`;
}

export function reviewOutputMarkdown(output: string): string {
  const trimmed = output.trim();
  if (!trimmed.startsWith('{')) return output;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return fence(trimmed);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fence(trimmed);
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 1 && typeof entries[0]![1] === 'string') return entries[0]![1];
  // Short fields first (verdict, counts), then the long texts.
  const ordered = [...entries.filter(([, v]) => !isLongText(v)), ...entries.filter(([, v]) => isLongText(v))];
  return ordered.map(([k, v]) => field(k, v)).join('\n\n');
}

/** A finished JSON-contract stage's answer (U-21): its JSON as readable Markdown; any other text unchanged. */
export function readableAnswer(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return text;
  try {
    JSON.parse(trimmed);
  } catch {
    return text;
  }
  return reviewOutputMarkdown(trimmed);
}

