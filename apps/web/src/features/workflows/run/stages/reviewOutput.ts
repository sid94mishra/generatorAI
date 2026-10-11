// A completion review's output as Markdown (U-19). A JSON output contract
// (`{"body": "## Summary…"}`) shows its text fields as Markdown, not as an
// escaped JSON string; other JSON shows as a code block; text shows as is.

const fence = (text: string) => `\`\`\`json\n${text}\n\`\`\``;

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
  const texts = entries.filter(([, v]) => typeof v === 'string' && (v as string).length > 0) as Array<[string, string]>;
  if (texts.length === 0 || texts.length !== entries.length) return fence(JSON.stringify(parsed, null, 2));
  if (texts.length === 1) return texts[0]![1];
  return texts.map(([k, v]) => `#### ${k}\n\n${v}`).join('\n\n');
}
