import { describe, expect, it } from 'vitest';

import {
  HIGHLIGHT_MAX_LINES,
  highlight,
  languageLabel,
  resolveLanguage,
  tokenize,
  withinHighlightBudget,
  type Language,
  type Line,
  type TokenKind,
} from '../components/markdown/highlight';
import { syntaxPalette } from '../components/markdown/syntaxColors';

/** `[kind, text]` pairs for one line — what the tests actually care about. */
function kinds(lines: Line[], index = 0): [TokenKind, string][] {
  return lines[index]!.spans.map((s) => [s.kind, s.text]);
}

function find(lines: Line[], text: string): TokenKind | undefined {
  for (const line of lines) for (const span of line.spans) if (span.text === text) return span.kind;
  return undefined;
}

function joined(lines: Line[]): string {
  return lines.map((l) => l.spans.map((s) => s.text).join('')).join('\n');
}

describe('resolveLanguage / languageLabel', () => {
  it('maps aliases onto the grammar set', () => {
    const cases: [string, Language][] = [
      ['ts', 'ts'],
      ['TypeScript', 'ts'],
      ['jsx', 'ts'],
      ['sh', 'bash'],
      ['zsh', 'bash'],
      ['py', 'python'],
      ['golang', 'go'],
      ['rs', 'rust'],
      ['kt', 'java'],
      ['scss', 'css'],
      ['xml', 'html'],
      ['yml', 'yaml'],
      ['postgres', 'sql'],
      ['patch', 'diff'],
      ['md', 'markdown'],
    ];
    for (const [alias, lang] of cases) expect(resolveLanguage(alias)).toBe(lang);
    expect(resolveLanguage('brainfuck')).toBeNull();
    expect(resolveLanguage(null)).toBeNull();
  });

  it('labels known languages and passes unknown ones through', () => {
    expect(languageLabel('ts')).toBe('TypeScript');
    expect(languageLabel('js')).toBe('JavaScript');
    expect(languageLabel(undefined)).toBe('Text');
    expect(languageLabel('cobol')).toBe('cobol');
  });
});

describe('tokenize — round-trips the source', () => {
  const samples: [Language, string][] = [
    ['ts', 'const x: number = 1; // hi\n/* multi\nline */ `t${x}`'],
    ['json', '{"a": [1, true, null], "b": "s"}'],
    ['bash', 'if [ -f "$HOME/x" ]; then echo ${VAR} # c\nfi'],
    ['python', 'def f(x):\n    """doc\n    string"""\n    return None  # c'],
    ['go', 'func main() {\n\tfmt.Println("hi") // c\n}'],
    ['rust', 'fn main() { let x: Vec<u8> = vec![1]; }'],
    ['java', 'public class A { int x = 0x1F; }'],
    ['css', '.a > b:hover { color: #fff; width: 10px; } /* c */'],
    ['html', '<!-- c --><div class="a" data-x=\'1\'>text</div>'],
    ['yaml', '---\nkey: value # c\nlist:\n  - 1\n  - "two"\n  - true'],
    ['sql', "SELECT a, COUNT(*) FROM t WHERE b = 'x' -- c"],
    ['diff', '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n same'],
    ['markdown', '# Title\n- item `code` [l](https://x)\n```js\nx\n```'],
  ];

  for (const [lang, code] of samples) {
    it(`${lang} reproduces its input exactly`, () => {
      expect(joined(tokenize(code, lang))).toBe(code);
    });
  }
});

describe('tokenize — ts/js', () => {
  it('classifies keywords, types, strings, numbers, comments', () => {
    const lines = tokenize('const n: number = 42; // note', 'ts');
    expect(kinds(lines)).toEqual([
      ['keyword', 'const'],
      ['plain', ' n: '],
      ['type', 'number'],
      ['plain', ' = '],
      ['number', '42'],
      ['plain', '; '],
      ['comment', '// note'],
    ]);
  });

  it('carries a block comment across lines', () => {
    const lines = tokenize('a /* start\nmiddle\nend */ b', 'ts');
    expect(kinds(lines, 1)).toEqual([['comment', 'middle']]);
    expect(kinds(lines, 2)).toEqual([
      ['comment', 'end */'],
      ['plain', ' b'],
    ]);
  });

  it('carries a template literal across lines but not a plain string', () => {
    const tpl = tokenize('`line1\nline2` x', 'ts');
    expect(kinds(tpl, 1)).toEqual([
      ['string', 'line2`'],
      ['plain', ' x'],
    ]);
    const str = tokenize('"unterminated\nnext', 'ts');
    expect(kinds(str, 1)).toEqual([['plain', 'next']]);
  });

  it('does not treat a URL in a string as a comment', () => {
    const lines = tokenize('const u = "https://x"; // c', 'ts');
    expect(find(lines, '"https://x"')).toBe('string');
    expect(find(lines, '// c')).toBe('comment');
  });

  it('treats a Capitalised identifier as a type and literals as literals', () => {
    const lines = tokenize('new Foo(null, true)', 'ts');
    expect(find(lines, 'Foo')).toBe('type');
    expect(find(lines, 'null')).toBe('literal');
    expect(find(lines, 'true')).toBe('literal');
  });

  it('keeps identifiers containing digits whole', () => {
    const lines = tokenize('v1 + x2', 'ts');
    expect(kinds(lines)).toEqual([['plain', 'v1 + x2']]);
  });
});

describe('tokenize — json', () => {
  it('marks keys as properties and values as strings/literals/numbers', () => {
    const lines = tokenize('{"name": "x", "n": 1.5, "ok": true}', 'json');
    expect(find(lines, '"name"')).toBe('property');
    expect(find(lines, '"x"')).toBe('string');
    expect(find(lines, '1.5')).toBe('number');
    expect(find(lines, 'true')).toBe('literal');
  });
});

describe('tokenize — bash', () => {
  it('handles variables, comments and commands', () => {
    const lines = tokenize('echo "$HOME" ${X:-y} # note', 'bash');
    expect(find(lines, 'echo')).toBe('type');
    expect(find(lines, '"$HOME"')).toBe('string');
    expect(find(lines, '${X:-y}')).toBe('attr');
    expect(find(lines, '# note')).toBe('comment');
  });

  it('does not comment out `${#arr}`', () => {
    const lines = tokenize('n=${#arr}', 'bash');
    expect(lines[0]!.spans.some((s) => s.kind === 'comment')).toBe(false);
  });
});

describe('tokenize — python', () => {
  it('carries a triple-quoted string across lines', () => {
    const lines = tokenize('s = """a\nb\nc""" + x', 'python');
    expect(kinds(lines, 1)).toEqual([['string', 'b']]);
    expect(kinds(lines, 2)[0]).toEqual(['string', 'c"""']);
  });

  it('classifies keywords and literals', () => {
    const lines = tokenize('def f(): return None', 'python');
    expect(find(lines, 'def')).toBe('keyword');
    expect(find(lines, 'None')).toBe('literal');
  });
});

describe('tokenize — go / rust / java', () => {
  it('go: keywords, builtins and raw strings', () => {
    const lines = tokenize('func main() { s := `raw`; var n int = 1 }', 'go');
    expect(find(lines, 'func')).toBe('keyword');
    expect(find(lines, '`raw`')).toBe('string');
    expect(find(lines, 'int')).toBe('type');
  });

  it('rust: keywords and std types', () => {
    const lines = tokenize('let v: Vec<u8> = Vec::new();', 'rust');
    expect(find(lines, 'let')).toBe('keyword');
    expect(find(lines, 'u8')).toBe('type');
    expect(find(lines, 'Vec')).toBe('type');
  });

  it('java: modifiers and hex numbers', () => {
    const lines = tokenize('public static int x = 0x1F;', 'java');
    expect(find(lines, 'public')).toBe('keyword');
    expect(find(lines, 'int')).toBe('type');
    expect(find(lines, '0x1F')).toBe('number');
  });
});

describe('tokenize — css / html / yaml / sql', () => {
  it('css: selectors, properties, values', () => {
    const lines = tokenize('.btn:hover { color: #fff; margin: 4px; }', 'css');
    expect(find(lines, '.btn')).toBe('attr');
    expect(find(lines, ':hover')).toBe('keyword');
    expect(find(lines, 'color')).toBe('property');
    expect(find(lines, '#fff')).toBe('number');
    expect(find(lines, '4px')).toBe('number');
  });

  it('html: tags, attributes, strings, comments across lines', () => {
    const lines = tokenize('<a href="x" disabled>hi</a>\n<!-- c\nd -->', 'html');
    expect(find(lines, '<a')).toBe('tag');
    expect(find(lines, 'href')).toBe('attr');
    expect(find(lines, '"x"')).toBe('string');
    expect(find(lines, 'hi')).toBe('plain');
    expect(kinds(lines, 2)).toEqual([['comment', 'd -->']]);
  });

  it('yaml: keys, scalars, comments, document markers', () => {
    const lines = tokenize('---\nname: app # c\nport: 8080\non: true\n- "quoted"', 'yaml');
    expect(kinds(lines, 0)).toEqual([['meta', '---']]);
    expect(find(lines, 'name')).toBe('property');
    expect(find(lines, '# c')).toBe('comment');
    expect(find(lines, '8080')).toBe('number');
    expect(find(lines, 'true')).toBe('literal');
    expect(find(lines, '"quoted"')).toBe('string');
  });

  it('sql: case-insensitive keywords, strings, comments', () => {
    const lines = tokenize("select id from users where name = 'x' -- why", 'sql');
    expect(find(lines, 'select')).toBe('keyword');
    expect(find(lines, 'where')).toBe('keyword');
    expect(find(lines, "'x'")).toBe('string');
    expect(find(lines, '-- why')).toBe('comment');
  });
});

describe('tokenize — diff', () => {
  it('tones added, removed and header lines', () => {
    const lines = tokenize('--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n same', 'diff');
    expect(lines.map((l) => l.tone)).toEqual(['meta', 'meta', 'meta', 'removed', 'added', undefined]);
    expect(lines[3]!.spans[0]!.kind).toBe('removed');
    expect(lines[4]!.spans[0]!.kind).toBe('added');
  });
});

describe('tokenize — markdown', () => {
  it('marks headings, fences, inline code and link targets', () => {
    const lines = tokenize('# Title\n- item `code` [l](https://x)\n```js\ninside\n```', 'markdown');
    expect(kinds(lines, 0)).toEqual([['heading', '# Title']]);
    expect(find(lines, '`code`')).toBe('string');
    expect(find(lines, 'https://x')).toBe('attr');
    expect(kinds(lines, 2)).toEqual([['meta', '```js']]);
    expect(kinds(lines, 3)).toEqual([['plain', 'inside']]);
  });
});

describe('highlight — budget and cache', () => {
  it('returns null for an unknown language', () => {
    expect(highlight('x', 'cobol')).toBeNull();
    expect(highlight('x', undefined)).toBeNull();
  });

  it('refuses blocks over the line cap and the byte cap', () => {
    const tall = 'x\n'.repeat(HIGHLIGHT_MAX_LINES + 1);
    expect(withinHighlightBudget(tall)).toBe(false);
    expect(highlight(tall, 'ts')).toBeNull();
    expect(withinHighlightBudget('x'.repeat(50_000))).toBe(false);
    expect(withinHighlightBudget('x\n'.repeat(100))).toBe(true);
  });

  it('memoises per (language, code)', () => {
    const a = highlight('const a = 1;', 'ts');
    const b = highlight('const a = 1;', 'typescript');
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(highlight('const a = 1;', 'go')).not.toBe(a);
  });
});

describe('syntaxPalette', () => {
  it('maps every kind onto an existing theme colour, plain inherits', () => {
    const colors = {
      primary: '#p',
      success: '#s',
      warning: '#w',
      danger: '#d',
      info: '#i',
      done: '#o',
      'muted-foreground': '#m',
    };
    const palette = syntaxPalette(colors);
    expect(palette.plain).toBeUndefined();
    expect(palette.keyword).toBe('#p');
    expect(palette.string).toBe('#s');
    expect(palette.comment).toBe('#m');
    expect(palette.number).toBe('#w');
    expect(palette.type).toBe('#i');
    expect(palette.attr).toBe('#o');
    expect(palette.added).toBe('#s');
    expect(palette.removed).toBe('#d');
  });

  it('falls back when a theme lacks info/done', () => {
    const palette = syntaxPalette({ primary: '#p', 'primary-emphasis': '#pe' });
    expect(palette.type).toBe('#pe');
    expect(palette.attr).toBe('#pe');
  });
});
