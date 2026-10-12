// An answer that IS JSON (a stage's output contract, an agent replying with a
// payload) renders as one JSON code block, never as Markdown prose: parsed as
// prose, its braces and quotes turn into broken paragraphs, and a streaming one
// reflows on every token. A finished answer is pretty-printed; one still
// streaming, or one that does not parse, keeps its own text inside the block.

/** A fence longer than any backtick run in the content, so embedded ``` (a PR body's code) cannot close it. */
function fenceFor(content: string): string {
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

export function jsonBlock(content: string): string {
  const fence = fenceFor(content);
  return `${fence}json\n${content}\n${fence}`;
}

/** The Markdown to render for an answer: JSON as a code block, anything else unchanged. */
export function jsonAnswerMarkdown(text: string, streaming = false): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text;
  if (streaming) return jsonBlock(trimmed);
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== 'object') return text;
    return jsonBlock(JSON.stringify(parsed, null, 2));
  } catch {
    // `[link](x)` style prose starts with `[` too: only a brace-led answer is taken for broken JSON.
    return trimmed.startsWith('{') ? jsonBlock(trimmed) : text;
  }
}
