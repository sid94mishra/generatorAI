// ────────────────────────────────────────────────────────────────
// highlight.js HTML → flat render tokens.
//
// `hljs.highlight()` returns an HTML string meant for `innerHTML`. The chat
// path renders MODEL-AUTHORED content, so pushing that string through
// `dangerouslySetInnerHTML` would put a string built from model output on the
// one path where we least want one — even though highlight.js escapes its
// input, that is a property of a dependency rather than of this codebase, and
// W31 spends real effort keeping model-authored content off exactly this
// surface.
//
// So the worker converts the markup to a flat `[className, text]` list and
// React renders real elements. Nesting is flattened to the joined class chain,
// which is visually identical (highlight.js themes colour by class, and a
// nested span's colour wins anyway) and removes innerHTML entirely.
//
// The input grammar is narrow and fixed — highlight.js emits only
// `<span class="…">`, `</span>` and escaped text — so this is a small scanner
// rather than an HTML parser, and it is exhaustively tested.
// ────────────────────────────────────────────────────────────────

/** One leaf of highlighted output: the class chain, and the literal text. */
export type HighlightToken = readonly [className: string, text: string];

const ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
});

/** Decode the entity set highlight.js produces (and numeric escapes). */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[body] ?? match;
  });
}

/**
 * Flatten highlight.js markup into render tokens.
 *
 * Unbalanced markup cannot corrupt the output: a stray `</span>` with an empty
 * stack is ignored, and unclosed spans simply keep their class until the end.
 * The text is always preserved in full — losing a line of the user's code to a
 * parse quirk would be a far worse failure than losing its colour.
 */
export function tokenizeHighlightHtml(html: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  const stack: string[] = [];
  let cursor = 0;

  const pushText = (raw: string): void => {
    if (!raw) return;
    const text = decodeEntities(raw);
    const className = stack.length > 0 ? stack.join(' ') : '';
    const last = tokens[tokens.length - 1];
    // Merge adjacent runs with the same class so a long comment is one text
    // node instead of one per entity escape inside it.
    if (last && last[0] === className) tokens[tokens.length - 1] = [className, last[1] + text];
    else tokens.push([className, text]);
  };

  while (cursor < html.length) {
    const next = html.indexOf('<', cursor);
    if (next === -1) {
      pushText(html.slice(cursor));
      break;
    }
    pushText(html.slice(cursor, next));

    if (html.startsWith('</span>', next)) {
      stack.pop();
      cursor = next + '</span>'.length;
      continue;
    }

    const open = /^<span class="([^"]*)">/.exec(html.slice(next));
    if (open) {
      stack.push(open[1] ?? '');
      cursor = next + open[0].length;
      continue;
    }

    // Not markup we emit. Treat the '<' as literal text rather than dropping
    // it — this branch should be unreachable, and silently eating a character
    // of someone's code is not an acceptable way to be wrong.
    pushText('<');
    cursor = next + 1;
  }

  return tokens;
}
