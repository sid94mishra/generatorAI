// ────────────────────────────────────────────────────────────────
// Syntax highlighter — dependency-free, line-oriented, bounded.
//
// Why not highlight.js / Shiki: both are hundreds of kilobytes of grammar
// the phone would parse at import time (see the web's `lib/highlight`
// header for what that cost the desktop before it moved to a worker), and
// neither can run off the JS thread here. The product constraint is "no new
// dependencies, minimal bundle", so this is a small scanner instead.
//
// It recognises the five things a reader's eye actually uses — keywords,
// strings, comments, numbers, types — for the languages a coding agent
// emits, and nothing else. A construct it does not understand renders as
// plain text, which is what an unlabelled fence renders as anyway.
//
// Bounded three ways, because this runs on the render thread:
//   • never while a block is streaming (the caller's rule, §7.2);
//   • never past 400 lines / 40 KB — a file dump renders plain;
//   • memoised per (language, code), so a re-render of a settled block
//     costs a Map lookup.
//
// Pure module: no React Native import. Unit-tested under node.
// ────────────────────────────────────────────────────────────────

export type TokenKind =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'literal'
  | 'type'
  | 'tag'
  | 'attr'
  | 'property'
  | 'heading'
  | 'meta'
  | 'added'
  | 'removed';

export interface Span {
  kind: TokenKind;
  text: string;
}

export interface Line {
  spans: Span[];
  /** Whole-line tone (diff blocks); the renderer tints the row background. */
  tone?: 'added' | 'removed' | 'meta';
}

export type Language =
  | 'ts'
  | 'json'
  | 'bash'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'css'
  | 'html'
  | 'yaml'
  | 'sql'
  | 'diff'
  | 'markdown';

export interface Highlighted {
  language: Language;
  lines: Line[];
}

export const HIGHLIGHT_MAX_LINES = 400;
export const HIGHLIGHT_MAX_BYTES = 40_000;

// ── Language names ──────────────────────────────────────────────

const ALIASES: Record<string, Language> = {
  ts: 'ts',
  typescript: 'ts',
  tsx: 'ts',
  js: 'ts',
  javascript: 'ts',
  jsx: 'ts',
  mjs: 'ts',
  cjs: 'ts',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  py: 'python',
  python: 'python',
  go: 'go',
  golang: 'go',
  rs: 'rust',
  rust: 'rust',
  java: 'java',
  kotlin: 'java',
  kt: 'java',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  xml: 'html',
  svg: 'html',
  vue: 'html',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  mysql: 'sql',
  postgres: 'sql',
  postgresql: 'sql',
  sqlite: 'sql',
  diff: 'diff',
  patch: 'diff',
  md: 'markdown',
  markdown: 'markdown',
};

const LABELS: Record<string, string> = {
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JSX',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  json: 'JSON',
  jsonc: 'JSON',
  json5: 'JSON5',
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  zsh: 'Zsh',
  console: 'Console',
  py: 'Python',
  python: 'Python',
  go: 'Go',
  golang: 'Go',
  rs: 'Rust',
  rust: 'Rust',
  java: 'Java',
  kotlin: 'Kotlin',
  kt: 'Kotlin',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  html: 'HTML',
  xml: 'XML',
  svg: 'SVG',
  vue: 'Vue',
  yaml: 'YAML',
  yml: 'YAML',
  sql: 'SQL',
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  sqlite: 'SQLite',
  diff: 'Diff',
  patch: 'Patch',
  md: 'Markdown',
  markdown: 'Markdown',
  text: 'Text',
  txt: 'Text',
  plain: 'Text',
  plaintext: 'Text',
};

/** Map a fence label to a grammar, or `null` when there is none for it. */
export function resolveLanguage(alias: string | null | undefined): Language | null {
  if (!alias) return null;
  return ALIASES[alias.trim().toLowerCase()] ?? null;
}

/** Display label for the code block header. Unknown labels show as written. */
export function languageLabel(alias: string | null | undefined): string {
  if (!alias) return 'Text';
  const key = alias.trim().toLowerCase();
  return LABELS[key] ?? alias.trim();
}

// ── Scanner core ────────────────────────────────────────────────

interface Emitter {
  spans: Span[];
  push(kind: TokenKind, text: string): void;
}

function emitter(): Emitter {
  const spans: Span[] = [];
  return {
    spans,
    push(kind, text) {
      if (text.length === 0) return;
      const last = spans[spans.length - 1];
      // Adjacent same-kind spans merge: fewer `Text` nodes on the phone.
      if (last && last.kind === kind) last.text += text;
      else spans.push({ kind, text });
    },
  };
}

interface CLikeDef {
  keywords: Set<string>;
  types: Set<string>;
  literals: Set<string>;
  /** Line comment starters. */
  lineComment: string[];
  /** `[open, close]` for block comments, or `null`. */
  blockComment: [string, string] | null;
  /** Quote characters that delimit a single-line string. */
  quotes: string[];
  /** Delimiters whose strings may span lines (`` ` ``, `"""`). */
  multiline: string[];
  /** Treat a Capitalised identifier as a type name. */
  capitalisedTypes: boolean;
  /** Identifier lookup ignores case (SQL). */
  caseInsensitive: boolean;
  /** `$name` / `${...}` is a variable (bash). */
  dollarVariables: boolean;
  /** A string immediately followed by `:` is a key (JSON). */
  stringKeys: boolean;
  /** `#` only starts a comment at line start or after whitespace (bash). */
  hashCommentNeedsSpace: boolean;
}

interface ScanState {
  /** Close token of the block comment we are inside, if any. */
  block: string | null;
  /** Close token of the multi-line string we are inside, if any. */
  str: string | null;
}

const NUMBER_RE = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?)[a-zA-Z]*/;
const IDENT_RE = /^[A-Za-z_$][\w$]*/;

function isWordChar(c: string): boolean {
  return c !== '' && /[\w$]/.test(c);
}

/** Index of `close` in `line` at or after `from`, honouring `\` escapes. */
function findClose(line: string, from: number, close: string, escapes: boolean): number {
  let i = from;
  while (i < line.length) {
    if (escapes && line[i] === '\\') {
      i += 2;
      continue;
    }
    if (line.startsWith(close, i)) return i;
    i += 1;
  }
  return -1;
}

function scanCLikeLine(line: string, def: CLikeDef, state: ScanState): Span[] {
  const out = emitter();
  let i = 0;
  const n = line.length;

  // Resume a construct that started on a previous line.
  if (state.str !== null) {
    const end = findClose(line, 0, state.str, true);
    if (end === -1) {
      out.push('string', line);
      return out.spans;
    }
    out.push('string', line.slice(0, end + state.str.length));
    i = end + state.str.length;
    state.str = null;
  } else if (state.block !== null) {
    const end = line.indexOf(state.block);
    if (end === -1) {
      out.push('comment', line);
      return out.spans;
    }
    out.push('comment', line.slice(0, end + state.block.length));
    i = end + state.block.length;
    state.block = null;
  }

  while (i < n) {
    const c = line[i]!;
    const prev = i > 0 ? line[i - 1]! : '';

    // Line comment.
    let commented = false;
    for (const lc of def.lineComment) {
      if (!line.startsWith(lc, i)) continue;
      if (lc === '#' && def.hashCommentNeedsSpace && i > 0 && !/\s/.test(prev)) continue;
      out.push('comment', line.slice(i));
      commented = true;
      break;
    }
    if (commented) break;

    // Block comment.
    if (def.blockComment && line.startsWith(def.blockComment[0], i)) {
      const [open, close] = def.blockComment;
      const end = line.indexOf(close, i + open.length);
      if (end === -1) {
        out.push('comment', line.slice(i));
        state.block = close;
        break;
      }
      out.push('comment', line.slice(i, end + close.length));
      i = end + close.length;
      continue;
    }

    // Strings. Multi-line delimiters (`"""`) are checked before their
    // single-character prefixes (`"`).
    let stringDelim: string | null = null;
    for (const m of def.multiline) if (line.startsWith(m, i)) stringDelim = m;
    if (stringDelim === null && def.quotes.includes(c)) stringDelim = c;
    if (stringDelim !== null) {
      const end = findClose(line, i + stringDelim.length, stringDelim, true);
      if (end === -1) {
        out.push('string', line.slice(i));
        if (def.multiline.includes(stringDelim)) state.str = stringDelim;
        break;
      }
      const text = line.slice(i, end + stringDelim.length);
      let kind: TokenKind = 'string';
      if (def.stringKeys) {
        const after = line.slice(end + stringDelim.length).search(/\S/);
        const nextChar = after === -1 ? '' : line[end + stringDelim.length + after];
        if (nextChar === ':') kind = 'property';
      }
      out.push(kind, text);
      i = end + stringDelim.length;
      continue;
    }

    // Variables (`$HOME`, `${x}`).
    if (def.dollarVariables && c === '$') {
      const m = /^\$(\{[^}]*\}|[A-Za-z_][\w]*|[\d@#?*!$-])/.exec(line.slice(i));
      if (m) {
        out.push('attr', m[0]);
        i += m[0].length;
        continue;
      }
    }

    // Numbers — only at a word boundary, so `x2` and `v1` stay identifiers.
    if (/\d/.test(c) && !isWordChar(prev)) {
      const m = NUMBER_RE.exec(line.slice(i));
      if (m) {
        out.push('number', m[0]);
        i += m[0].length;
        continue;
      }
    }

    // Identifiers.
    if (/[A-Za-z_$]/.test(c) && !isWordChar(prev)) {
      const m = IDENT_RE.exec(line.slice(i));
      if (m) {
        const word = m[0];
        const key = def.caseInsensitive ? word.toUpperCase() : word;
        let kind: TokenKind = 'plain';
        if (def.keywords.has(key)) kind = 'keyword';
        else if (def.types.has(key)) kind = 'type';
        else if (def.literals.has(key)) kind = 'literal';
        else if (def.capitalisedTypes && /^[A-Z]/.test(word) && /[a-z]/.test(word)) kind = 'type';
        out.push(kind, word);
        i += word.length;
        continue;
      }
    }

    out.push('plain', c);
    i += 1;
  }

  return out.spans;
}

function scanCLike(lines: string[], def: CLikeDef): Line[] {
  const state: ScanState = { block: null, str: null };
  return lines.map((line) => ({ spans: scanCLikeLine(line, def, state) }));
}

// ── Language definitions ────────────────────────────────────────

const words = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));

const C_LITERALS = words('true false null undefined NaN Infinity');

const TS_DEF: CLikeDef = {
  keywords: words(
    'abstract as async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in instanceof interface is keyof let namespace new of override package private protected public readonly return satisfies set static super switch this throw try type typeof var void while with yield',
  ),
  types: words(
    'any bigint boolean never number object string symbol unknown Array Promise Record Partial Required Readonly Pick Omit Map Set Date Error RegExp JSON Math console window document',
  ),
  literals: C_LITERALS,
  lineComment: ['//'],
  blockComment: ['/*', '*/'],
  quotes: ['"', "'", '`'],
  multiline: ['`'],
  capitalisedTypes: true,
  caseInsensitive: false,
  dollarVariables: false,
  stringKeys: false,
  hashCommentNeedsSpace: false,
};

const JSON_DEF: CLikeDef = {
  keywords: new Set(),
  types: new Set(),
  literals: words('true false null'),
  lineComment: ['//'],
  blockComment: ['/*', '*/'],
  quotes: ['"'],
  multiline: [],
  capitalisedTypes: false,
  caseInsensitive: false,
  dollarVariables: false,
  stringKeys: true,
  hashCommentNeedsSpace: false,
};

const BASH_DEF: CLikeDef = {
  keywords: words(
    'if then else elif fi for while until do done case esac in function select return local export readonly declare typeset unset shift source alias exit break continue set trap eval exec time',
  ),
  types: words(
    'echo printf cd ls cat grep sed awk find xargs mkdir rm cp mv chmod chown curl wget git npm pnpm yarn npx node python pip docker kubectl make sudo apt brew tar zip unzip ssh scp touch head tail sort uniq wc tr cut tee test',
  ),
  literals: words('true false'),
  lineComment: ['#'],
  blockComment: null,
  quotes: ['"', "'"],
  multiline: [],
  capitalisedTypes: false,
  caseInsensitive: false,
  dollarVariables: true,
  stringKeys: false,
  hashCommentNeedsSpace: true,
};

const PYTHON_DEF: CLikeDef = {
  keywords: words(
    'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self cls',
  ),
  types: words(
    'int float str bytes bool list dict set tuple frozenset object type range print len open isinstance super Exception ValueError TypeError KeyError',
  ),
  literals: words('True False None'),
  lineComment: ['#'],
  blockComment: null,
  quotes: ['"', "'"],
  multiline: ['"""', "'''"],
  capitalisedTypes: true,
  caseInsensitive: false,
  dollarVariables: false,
  stringKeys: false,
  hashCommentNeedsSpace: false,
};

const GO_DEF: CLikeDef = {
  keywords: words(
    'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
  ),
  types: words(
    'bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any make new len cap append copy delete panic recover',
  ),
  literals: words('true false nil iota'),
  lineComment: ['//'],
  blockComment: ['/*', '*/'],
  quotes: ['"', "'", '`'],
  multiline: ['`'],
  capitalisedTypes: true,
  caseInsensitive: false,
  dollarVariables: false,
  stringKeys: false,
  hashCommentNeedsSpace: false,
};

const RUST_DEF: CLikeDef = {
  keywords: words(
    'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while',
  ),
  types: words(
    'bool char str i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 String Vec Option Some None Result Ok Err Box Rc Arc HashMap HashSet',
  ),
  literals: words('true false'),
  lineComment: ['//'],
  blockComment: ['/*', '*/'],
  quotes: ['"'],
  multiline: [],
  capitalisedTypes: true,
  caseInsensitive: false,
  dollarVariables: false,
  stringKeys: false,
  hashCommentNeedsSpace: false,
};

const JAVA_DEF: CLikeDef = {
  keywords: words(
    'abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try var void volatile while record sealed permits yield fun val when object data companion override',
  ),
  types: words(
    'boolean byte char double float int long short String Integer Long Double Boolean Object List Map Set ArrayList HashMap Optional System Math',
  ),
  literals: words('true false null'),
  lineComment: ['//'],
  blockComment: ['/*', '*/'],
  quotes: ['"', "'"],
  multiline: ['"""'],
  capitalisedTypes: true,
  caseInsensitive: false,
  dollarVariables: false,
  stringKeys: false,
  hashCommentNeedsSpace: false,
};

const SQL_DEF: CLikeDef = {
  keywords: words(
    'SELECT FROM WHERE AND OR NOT IN IS NULL AS JOIN LEFT RIGHT INNER OUTER FULL CROSS ON GROUP BY ORDER HAVING LIMIT OFFSET INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE INDEX VIEW DROP ALTER ADD COLUMN PRIMARY KEY FOREIGN REFERENCES UNIQUE DEFAULT CHECK CONSTRAINT IF EXISTS BEGIN COMMIT ROLLBACK TRANSACTION WITH RECURSIVE UNION ALL DISTINCT CASE WHEN THEN ELSE END LIKE ILIKE BETWEEN ASC DESC RETURNING CASCADE EXPLAIN ANALYZE',
  ),
  types: words(
    'INT INTEGER BIGINT SMALLINT SERIAL BIGSERIAL TEXT VARCHAR CHAR BOOLEAN BOOL DATE TIME TIMESTAMP TIMESTAMPTZ INTERVAL NUMERIC DECIMAL REAL FLOAT DOUBLE JSON JSONB UUID BLOB BYTEA COUNT SUM AVG MIN MAX COALESCE NOW',
  ),
  literals: words('TRUE FALSE NULL'),
  lineComment: ['--'],
  blockComment: ['/*', '*/'],
  quotes: ["'", '"'],
  multiline: [],
  capitalisedTypes: false,
  caseInsensitive: true,
  dollarVariables: false,
  stringKeys: false,
  hashCommentNeedsSpace: false,
};

// ── CSS ─────────────────────────────────────────────────────────

function scanCss(lines: string[]): Line[] {
  let inBlock = false;
  let inComment = false;
  return lines.map((line) => {
    const out = emitter();
    let i = 0;
    while (i < line.length) {
      const rest = line.slice(i);
      if (inComment) {
        const end = rest.indexOf('*/');
        if (end === -1) {
          out.push('comment', rest);
          i = line.length;
        } else {
          out.push('comment', rest.slice(0, end + 2));
          i += end + 2;
          inComment = false;
        }
        continue;
      }
      if (rest.startsWith('/*')) {
        inComment = true;
        continue;
      }
      const c = rest[0]!;
      if (c === '{') {
        inBlock = true;
        out.push('plain', c);
        i += 1;
        continue;
      }
      if (c === '}') {
        inBlock = false;
        out.push('plain', c);
        i += 1;
        continue;
      }
      if (c === '"' || c === "'") {
        const end = findClose(line, i + 1, c, true);
        const stop = end === -1 ? line.length : end + 1;
        out.push('string', line.slice(i, stop));
        i = stop;
        continue;
      }
      let m: RegExpExecArray | null;
      if ((m = /^@[\w-]+/.exec(rest))) {
        out.push('keyword', m[0]);
        i += m[0].length;
        continue;
      }
      if ((m = /^!important\b/.exec(rest))) {
        out.push('keyword', m[0]);
        i += m[0].length;
        continue;
      }
      if (inBlock) {
        if ((m = /^(-?[\w-]+)(\s*):/.exec(rest)) && !/^[\d.]/.test(m[1]!)) {
          out.push('property', m[1]!);
          i += m[1]!.length;
          continue;
        }
        if ((m = /^#[0-9a-fA-F]{3,8}\b/.exec(rest))) {
          out.push('number', m[0]);
          i += m[0].length;
          continue;
        }
        if ((m = /^-?(\d+\.?\d*|\.\d+)(px|em|rem|%|vh|vw|vmin|vmax|pt|ms|s|deg|fr|ch|ex)?\b/.exec(rest)) && !isWordChar(i > 0 ? line[i - 1]! : '')) {
          out.push('number', m[0]);
          i += m[0].length;
          continue;
        }
        if ((m = /^[\w-]+/.exec(rest))) {
          out.push('plain', m[0]);
          i += m[0].length;
          continue;
        }
      } else {
        if ((m = /^[.#][\w-]+/.exec(rest))) {
          out.push('attr', m[0]);
          i += m[0].length;
          continue;
        }
        if ((m = /^::?[\w-]+(\([^)]*\))?/.exec(rest))) {
          out.push('keyword', m[0]);
          i += m[0].length;
          continue;
        }
        if ((m = /^[A-Za-z][\w-]*/.exec(rest))) {
          out.push('tag', m[0]);
          i += m[0].length;
          continue;
        }
      }
      out.push('plain', c);
      i += 1;
    }
    return { spans: out.spans };
  });
}

// ── HTML / XML ──────────────────────────────────────────────────

function scanHtml(lines: string[]): Line[] {
  let inTag = false;
  let inComment = false;
  return lines.map((line) => {
    const out = emitter();
    let i = 0;
    while (i < line.length) {
      const rest = line.slice(i);
      if (inComment) {
        const end = rest.indexOf('-->');
        if (end === -1) {
          out.push('comment', rest);
          i = line.length;
        } else {
          out.push('comment', rest.slice(0, end + 3));
          i += end + 3;
          inComment = false;
        }
        continue;
      }
      let m: RegExpExecArray | null;
      if (!inTag) {
        if (rest.startsWith('<!--')) {
          inComment = true;
          continue;
        }
        if ((m = /^<!\w[^>]*>?/.exec(rest))) {
          out.push('meta', m[0]);
          i += m[0].length;
          continue;
        }
        if ((m = /^<\/?[A-Za-z][\w:.-]*/.exec(rest))) {
          out.push('tag', m[0]);
          i += m[0].length;
          inTag = true;
          continue;
        }
        const next = rest.indexOf('<', 1);
        const chunk = next === -1 ? rest : rest.slice(0, next);
        out.push('plain', chunk);
        i += chunk.length;
        continue;
      }
      // Inside a tag.
      if ((m = /^\/?>/.exec(rest))) {
        out.push('tag', m[0]);
        i += m[0].length;
        inTag = false;
        continue;
      }
      const c = rest[0]!;
      if (c === '"' || c === "'") {
        const end = findClose(line, i + 1, c, false);
        const stop = end === -1 ? line.length : end + 1;
        out.push('string', line.slice(i, stop));
        i = stop;
        continue;
      }
      if ((m = /^[A-Za-z_:@][\w:.@-]*/.exec(rest))) {
        out.push('attr', m[0]);
        i += m[0].length;
        continue;
      }
      out.push('plain', c);
      i += 1;
    }
    return { spans: out.spans };
  });
}

// ── YAML ────────────────────────────────────────────────────────

function scanYaml(lines: string[]): Line[] {
  return lines.map((line) => {
    const out = emitter();
    if (/^\s*(---|\.\.\.)\s*$/.test(line)) return { spans: [{ kind: 'meta', text: line }] as Span[] };
    let i = 0;
    let m: RegExpExecArray | null;
    // Leading indentation and list dash.
    if ((m = /^\s*(- +)?/.exec(line)) && m[0].length > 0) {
      out.push('plain', m[0]);
      i = m[0].length;
    }
    // `key:` — a scalar key up to the first colon followed by space/EOL.
    if ((m = /^([^\s#'"-][^:#]*?|'[^']*'|"[^"]*")(:)(?=\s|$)/.exec(line.slice(i)))) {
      out.push('property', m[1]!);
      out.push('plain', ':');
      i += m[0].length;
    }
    while (i < line.length) {
      const rest = line.slice(i);
      const prev = i > 0 ? line[i - 1]! : '';
      if (rest[0] === '#' && (i === 0 || /\s/.test(prev))) {
        out.push('comment', rest);
        break;
      }
      const c = rest[0]!;
      if (c === '"' || c === "'") {
        const end = findClose(line, i + 1, c, c === '"');
        const stop = end === -1 ? line.length : end + 1;
        out.push('string', line.slice(i, stop));
        i = stop;
        continue;
      }
      if ((m = /^[&*][\w-]+/.exec(rest))) {
        out.push('attr', m[0]);
        i += m[0].length;
        continue;
      }
      if ((m = /^(true|false|null|yes|no|on|off|~)(?=\s|$|,|\])/i.exec(rest)) && !isWordChar(prev)) {
        out.push('literal', m[0]);
        i += m[0].length;
        continue;
      }
      if (/\d/.test(c) && !isWordChar(prev)) {
        const num = NUMBER_RE.exec(rest);
        if (num) {
          out.push('number', num[0]);
          i += num[0].length;
          continue;
        }
      }
      if ((m = /^[\w][\w.-]*/.exec(rest))) {
        out.push('plain', m[0]);
        i += m[0].length;
        continue;
      }
      out.push('plain', c);
      i += 1;
    }
    return { spans: out.spans };
  });
}

// ── Markdown ────────────────────────────────────────────────────

function scanMarkdown(lines: string[]): Line[] {
  let inFence = false;
  return lines.map((line) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      return { spans: [{ kind: 'meta', text: line }] as Span[] };
    }
    if (inFence) return { spans: [{ kind: 'plain', text: line }] as Span[] };
    if (/^#{1,6}\s/.test(line)) return { spans: [{ kind: 'heading', text: line }] as Span[] };
    const out = emitter();
    let i = 0;
    let m: RegExpExecArray | null;
    if ((m = /^\s*([-*+]|\d+\.|>)\s+/.exec(line))) {
      out.push('keyword', m[0]);
      i = m[0].length;
    }
    while (i < line.length) {
      const rest = line.slice(i);
      if ((m = /^`+[^`]*`+/.exec(rest))) {
        out.push('string', m[0]);
        i += m[0].length;
        continue;
      }
      if ((m = /^!?\[([^\]]*)\]\(([^)]*)\)/.exec(rest))) {
        const head = m[0].slice(0, m[0].length - m[2]!.length - 1);
        out.push('plain', head);
        out.push('attr', m[2]!);
        out.push('plain', ')');
        i += m[0].length;
        continue;
      }
      if ((m = /^(\*\*|__)[^*_]+\1/.exec(rest))) {
        out.push('keyword', m[0]);
        i += m[0].length;
        continue;
      }
      out.push('plain', rest[0]!);
      i += 1;
    }
    return { spans: out.spans };
  });
}

// ── Diff ────────────────────────────────────────────────────────

function scanDiff(lines: string[]): Line[] {
  return lines.map((line) => {
    if (/^(\+\+\+|---|diff |index |@@|Only in|Binary files)/.test(line)) {
      return { spans: [{ kind: 'meta', text: line }], tone: 'meta' };
    }
    if (line[0] === '+') return { spans: [{ kind: 'added', text: line }], tone: 'added' };
    if (line[0] === '-') return { spans: [{ kind: 'removed', text: line }], tone: 'removed' };
    return { spans: [{ kind: 'plain', text: line }] };
  });
}

// ── Entry points ────────────────────────────────────────────────

/** Tokenise without the cache or the size cap. Exposed for tests. */
export function tokenize(code: string, language: Language): Line[] {
  const lines = code.split('\n');
  switch (language) {
    case 'ts':
      return scanCLike(lines, TS_DEF);
    case 'json':
      return scanCLike(lines, JSON_DEF);
    case 'bash':
      return scanCLike(lines, BASH_DEF);
    case 'python':
      return scanCLike(lines, PYTHON_DEF);
    case 'go':
      return scanCLike(lines, GO_DEF);
    case 'rust':
      return scanCLike(lines, RUST_DEF);
    case 'java':
      return scanCLike(lines, JAVA_DEF);
    case 'sql':
      return scanCLike(lines, SQL_DEF);
    case 'css':
      return scanCss(lines);
    case 'html':
      return scanHtml(lines);
    case 'yaml':
      return scanYaml(lines);
    case 'markdown':
      return scanMarkdown(lines);
    case 'diff':
      return scanDiff(lines);
  }
}

/** Whether a block is small enough to colour on the render thread. */
export function withinHighlightBudget(code: string): boolean {
  if (code.length > HIGHLIGHT_MAX_BYTES) return false;
  let lines = 1;
  for (let i = 0; i < code.length; i += 1) {
    if (code.charCodeAt(i) === 10) {
      lines += 1;
      if (lines > HIGHLIGHT_MAX_LINES) return false;
    }
  }
  return true;
}

const CACHE_MAX = 48;
const cache = new Map<string, Highlighted>();

/**
 * Highlight `code` labelled `alias`.
 *
 * Returns `null` when there is no grammar for the label or the block is over
 * budget; the caller renders plain text in both cases. Results are memoised
 * per (language, code) so re-rendering a settled block never re-scans.
 */
export function highlight(code: string, alias: string | null | undefined): Highlighted | null {
  const language = resolveLanguage(alias);
  if (language === null || !withinHighlightBudget(code)) return null;

  const key = `${language} ${code}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const result: Highlighted = { language, lines: tokenize(code, language) };
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, result);
  return result;
}
