// FROZEN COPY for migration v55 (README R-3, RV-33). Copied from
// packages/workflow-spec/src (P01 review fixes). Never edit: v55 converts
// legacy rows into exactly these shapes and validates them with this copy of
// the validator; the live spec package may move on.

// ────────────────────────────────────────────────────────────────
// A ReDoS-safe regular-expression matcher (RV-21).
//
// `regex` output rules and `validate_input` rules run author-supplied
// patterns against model output. JavaScript's backtracking RegExp can take
// exponential time on patterns like `(a+)+$`, blocking the event loop.
// This engine compiles the pattern to a Thompson NFA and simulates it
// (Pike, without captures), so `test` is O(input × pattern) whatever the
// pattern is. It is pure TypeScript: it runs in the browser (save-time
// validation in the builder) and on the server, with no native build.
//
// Supported: literals, `.`, classes `[a-z]` `[^…]`, escapes \d \D \w \W \s
// \S \b \B \n \r \t \f \v \0 \xHH \uHHHH, anchors ^ $, groups ( ) (?: )
// (?<name> ), alternation, quantifiers * + ? {n} {n,} {n,m} (lazy forms
// accepted; laziness does not change whether a match exists), flags i m s.
// Rejected with a clear error: backreferences and lookaround, which no
// linear-time engine can support (the RE2 subset).
// ────────────────────────────────────────────────────────────────

export interface SafeRegex {
  readonly source: string;
  readonly flags: string;
  /** Whether the pattern matches anywhere in `input`. Linear time. */
  test(input: string): boolean;
}

export type SafeRegexResult = { ok: true; regex: SafeRegex } | { ok: false; error: { message: string; index: number } };

/** Largest `{n,m}` bound, and the NFA size cap. */
export const SAFE_REGEX_MAX_REPEAT = 1000;
export const SAFE_REGEX_MAX_STATES = 20_000;

type Matcher = (c: number) => boolean;
type AssertKind = '^' | '$' | 'b' | 'B';

type RNode =
  | { t: 'empty' }
  | { t: 'char'; m: Matcher }
  | { t: 'assert'; kind: AssertKind }
  | { t: 'cat'; items: RNode[] }
  | { t: 'alt'; options: RNode[] }
  | { t: 'repeat'; node: RNode; min: number; max: number };

class RegexSyntaxError extends Error {
  constructor(
    message: string,
    readonly index: number,
  ) {
    super(message);
  }
}

const isDigitCode = (c: number) => c >= 48 && c <= 57;
const isWordCode = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isLineTerminator = (c: number) => c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
const WHITESPACE = new Set([
  9, 10, 11, 12, 13, 32, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
  ...Array.from({ length: 11 }, (_, i) => 0x2000 + i),
]);
const isSpaceCode = (c: number) => WHITESPACE.has(c);

class RegexParser {
  private i = 0;

  constructor(
    private readonly src: string,
    private readonly ignoreCase: boolean,
    private readonly dotAll: boolean,
  ) {}

  parse(): RNode {
    const node = this.alternation();
    if (this.i < this.src.length) {
      throw new RegexSyntaxError(this.src[this.i] === ')' ? "Unmatched ')'" : `Unexpected '${this.src[this.i]}'`, this.i);
    }
    return node;
  }

  private peek(): string | undefined {
    return this.src[this.i];
  }

  private alternation(): RNode {
    const options = [this.concatenation()];
    while (this.peek() === '|') {
      this.i++;
      options.push(this.concatenation());
    }
    return options.length === 1 ? options[0]! : { t: 'alt', options };
  }

  private concatenation(): RNode {
    const items: RNode[] = [];
    while (this.i < this.src.length && this.peek() !== '|' && this.peek() !== ')') {
      items.push(this.repetition());
    }
    if (items.length === 0) return { t: 'empty' };
    return items.length === 1 ? items[0]! : { t: 'cat', items };
  }

  private quantifier(): { min: number; max: number } | null {
    const c = this.peek();
    if (c === '*') return this.i++, { min: 0, max: Infinity };
    if (c === '+') return this.i++, { min: 1, max: Infinity };
    if (c === '?') return this.i++, { min: 0, max: 1 };
    if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(this.src.slice(this.i));
      if (!m) return null;
      const min = Number(m[1]);
      const max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
      if (max < min) throw new RegexSyntaxError('Quantifier bounds are out of order', this.i);
      if (min > SAFE_REGEX_MAX_REPEAT || (max !== Infinity && max > SAFE_REGEX_MAX_REPEAT)) {
        throw new RegexSyntaxError(`Repetition counts are limited to ${SAFE_REGEX_MAX_REPEAT}`, this.i);
      }
      this.i += m[0].length;
      return { min, max };
    }
    return null;
  }

  private repetition(): RNode {
    const start = this.i;
    const atom = this.atom();
    const q = this.quantifier();
    if (!q) return atom;
    if (atom.t === 'assert') throw new RegexSyntaxError('Nothing to repeat', start);
    if (this.peek() === '?') this.i++;
    if (this.quantifier()) throw new RegexSyntaxError('Nothing to repeat', this.i - 1);
    return { t: 'repeat', node: atom, min: q.min, max: q.max };
  }

  private atom(): RNode {
    const start = this.i;
    const c = this.src[this.i++]!;
    switch (c) {
      case '(': {
        if (this.src.startsWith('?:', this.i)) {
          this.i += 2;
        } else if (/^\?<?[=!]/.test(this.src.slice(this.i, this.i + 3))) {
          throw new RegexSyntaxError('Lookaround assertions are not supported (linear-time engine)', start);
        } else if (this.src.startsWith('?<', this.i)) {
          const m = /^\?<([A-Za-z_$][\w$]*)>/.exec(this.src.slice(this.i));
          if (!m) throw new RegexSyntaxError('Invalid group name', start);
          this.i += m[0].length;
        } else if (this.peek() === '?') {
          throw new RegexSyntaxError('Invalid group', start);
        }
        const inner = this.alternation();
        if (this.peek() !== ')') throw new RegexSyntaxError("Unterminated group: missing ')'", start);
        this.i++;
        return inner;
      }
      case ')':
        throw new RegexSyntaxError("Unmatched ')'", start);
      case '[': {
        const cls = this.charClass(start);
        const folded = this.fold(cls.m);
        return { t: 'char', m: cls.negate ? (x) => !folded(x) : folded };
      }
      case '.':
        return { t: 'char', m: this.dotAll ? () => true : (x) => !isLineTerminator(x) };
      case '^':
        return { t: 'assert', kind: '^' };
      case '$':
        return { t: 'assert', kind: '$' };
      case '*':
      case '+':
      case '?':
        throw new RegexSyntaxError('Nothing to repeat', start);
      case '{': {
        this.i--;
        if (/^\{\d+(,\d*)?\}/.test(this.src.slice(this.i))) throw new RegexSyntaxError('Nothing to repeat', start);
        this.i++;
        return this.literal(c.charCodeAt(0));
      }
      case '\\':
        return this.escape(start);
      default:
        return this.literal(c.charCodeAt(0));
    }
  }

  private literal(code: number): RNode {
    return { t: 'char', m: this.fold((x) => x === code) };
  }

  /** Case-insensitive wrapper: a char matches when any of its case forms does. */
  private fold(m: Matcher): Matcher {
    if (!this.ignoreCase) return m;
    return (x) => {
      if (m(x)) return true;
      const s = String.fromCharCode(x);
      const lo = s.toLowerCase();
      const up = s.toUpperCase();
      return (lo.length === 1 && m(lo.charCodeAt(0))) || (up.length === 1 && m(up.charCodeAt(0)));
    };
  }

  private escape(start: number): RNode {
    const c = this.src[this.i++];
    if (c === undefined) throw new RegexSyntaxError('Pattern ends with a backslash', start);
    switch (c) {
      case 'b':
        return { t: 'assert', kind: 'b' };
      case 'B':
        return { t: 'assert', kind: 'B' };
      case 'k':
        if (this.peek() === '<') throw new RegexSyntaxError('Backreferences are not supported (linear-time engine)', start);
        return this.literal('k'.charCodeAt(0));
      default: {
        if (c >= '1' && c <= '9') throw new RegexSyntaxError('Backreferences are not supported (linear-time engine)', start);
        const m = this.escapeMatcher(c, start, false);
        return { t: 'char', m: this.fold(m) };
      }
    }
  }

  /** Matcher of an escape whose backslash and letter are consumed (`c` is the letter). */
  private escapeMatcher(c: string, start: number, inClass: boolean): Matcher {
    switch (c) {
      case 'd':
        return isDigitCode;
      case 'D':
        return (x) => !isDigitCode(x);
      case 'w':
        return isWordCode;
      case 'W':
        return (x) => !isWordCode(x);
      case 's':
        return isSpaceCode;
      case 'S':
        return (x) => !isSpaceCode(x);
      default:
        return this.singleCode(this.escapeCode(c, start, inClass));
    }
  }

  private singleCode(code: number): Matcher {
    return (x) => x === code;
  }

  /** Code unit of a single-character escape. */
  private escapeCode(c: string, start: number, inClass: boolean): number {
    switch (c) {
      case 'n':
        return 10;
      case 'r':
        return 13;
      case 't':
        return 9;
      case 'f':
        return 12;
      case 'v':
        return 11;
      case '0':
        if (/[0-9]/.test(this.peek() ?? '')) throw new RegexSyntaxError('Octal escapes are not supported', start);
        return 0;
      case 'b':
        if (inClass) return 8;
        break;
      case 'x': {
        const hex = this.src.slice(this.i, this.i + 2);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new RegexSyntaxError('Invalid \\x escape', start);
        this.i += 2;
        return parseInt(hex, 16);
      }
      case 'u': {
        const hex = this.src.slice(this.i, this.i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new RegexSyntaxError('Invalid \\u escape', start);
        this.i += 4;
        return parseInt(hex, 16);
      }
      case 'c':
        throw new RegexSyntaxError('Control escapes (\\c) are not supported', start);
      default:
        break;
    }
    if (inClass && c >= '1' && c <= '9') throw new RegexSyntaxError('Octal escapes are not supported', start);
    return c.charCodeAt(0);
  }

  /** The positive set of a class and whether it is negated (case folding applies before negation). */
  private charClass(start: number): { m: Matcher; negate: boolean } {
    let negate = false;
    if (this.peek() === '^') {
      negate = true;
      this.i++;
    }
    const parts: Matcher[] = [];
    while (this.i < this.src.length && this.peek() !== ']') {
      const lo = this.classAtom(start);
      if (this.peek() === '-' && this.src[this.i + 1] !== ']' && this.i + 1 < this.src.length) {
        const save = this.i;
        this.i++;
        const hi = this.classAtom(start);
        if (lo.code !== undefined && hi.code !== undefined) {
          if (hi.code < lo.code) throw new RegexSyntaxError('Character class range out of order', save);
          const a = lo.code;
          const b = hi.code;
          parts.push((x) => x >= a && x <= b);
          continue;
        }
        // A class escape on either side makes '-' a literal (as in JavaScript).
        parts.push(lo.m, this.singleCode(45), hi.m);
        continue;
      }
      parts.push(lo.m);
    }
    if (this.peek() !== ']') throw new RegexSyntaxError("Unterminated character class: missing ']'", start);
    this.i++;
    return { m: (x) => parts.some((p) => p(x)), negate };
  }

  private classAtom(start: number): { m: Matcher; code?: number } {
    const c = this.src[this.i++]!;
    if (c !== '\\') return { m: this.singleCode(c.charCodeAt(0)), code: c.charCodeAt(0) };
    const e = this.src[this.i++];
    if (e === undefined) throw new RegexSyntaxError('Pattern ends with a backslash', start);
    if ('dDwWsS'.includes(e)) return { m: this.escapeMatcher(e, start, true) };
    const code = this.escapeCode(e, start, true);
    return { m: this.singleCode(code), code };
  }
}

type State =
  | { k: 'm'; m: Matcher; out: number }
  | { k: 's'; a: number; b: number }
  | { k: 'a'; kind: AssertKind; out: number }
  | { k: 'match' };

class Compiler {
  readonly states: State[] = [{ k: 'match' }];

  private push(s: State): number {
    if (this.states.length >= SAFE_REGEX_MAX_STATES) {
      throw new RegexSyntaxError(`Pattern is too large (more than ${SAFE_REGEX_MAX_STATES} states)`, 0);
    }
    this.states.push(s);
    return this.states.length - 1;
  }

  /** Compile `node` so that it continues to state `next`; returns its entry state. */
  compile(node: RNode, next: number): number {
    switch (node.t) {
      case 'empty':
        return next;
      case 'char':
        return this.push({ k: 'm', m: node.m, out: next });
      case 'assert':
        return this.push({ k: 'a', kind: node.kind, out: next });
      case 'cat': {
        let s = next;
        for (let i = node.items.length - 1; i >= 0; i--) s = this.compile(node.items[i]!, s);
        return s;
      }
      case 'alt': {
        const starts = node.options.map((o) => this.compile(o, next));
        let s = starts[starts.length - 1]!;
        for (let i = starts.length - 2; i >= 0; i--) s = this.push({ k: 's', a: starts[i]!, b: s });
        return s;
      }
      case 'repeat': {
        let s = next;
        if (node.max === Infinity) {
          const loop = this.push({ k: 's', a: -1, b: next });
          const body = this.compile(node.node, loop);
          (this.states[loop] as Extract<State, { k: 's' }>).a = body;
          s = loop;
        } else {
          for (let i = 0; i < node.max - node.min; i++) s = this.push({ k: 's', a: this.compile(node.node, s), b: next });
        }
        for (let i = 0; i < node.min; i++) s = this.compile(node.node, s);
        return s;
      }
    }
  }
}

function makeMatcher(states: State[], start: number, multiline: boolean): (input: string) => boolean {
  const mark = new Int32Array(states.length);
  let gen = 0;

  return (input: string) => {
    const n = input.length;
    const holds = (kind: AssertKind, pos: number): boolean => {
      const prev = pos > 0 ? input.charCodeAt(pos - 1) : -1;
      const next = pos < n ? input.charCodeAt(pos) : -1;
      switch (kind) {
        case '^':
          return pos === 0 || (multiline && isLineTerminator(prev));
        case '$':
          return pos === n || (multiline && isLineTerminator(next));
        case 'b':
          return (prev >= 0 && isWordCode(prev)) !== (next >= 0 && isWordCode(next));
        case 'B':
          return (prev >= 0 && isWordCode(prev)) === (next >= 0 && isWordCode(next));
      }
    };
    /** Epsilon closure of `s` at `pos`, appended to `list`. Returns true on reaching the match state. */
    const add = (list: number[], s0: number, pos: number): boolean => {
      const stack = [s0];
      while (stack.length) {
        const s = stack.pop()!;
        if (mark[s] === gen) continue;
        mark[s] = gen;
        const st = states[s]!;
        switch (st.k) {
          case 'match':
            return true;
          case 'm':
            list.push(s);
            break;
          case 's':
            stack.push(st.b, st.a);
            break;
          case 'a':
            if (holds(st.kind, pos)) stack.push(st.out);
            break;
        }
      }
      return false;
    };

    gen++;
    let clist: number[] = [];
    if (add(clist, start, 0)) return true;
    for (let pos = 0; pos < n; pos++) {
      const c = input.charCodeAt(pos);
      gen++;
      const nlist: number[] = [];
      for (const s of clist) {
        const st = states[s] as Extract<State, { k: 'm' }>;
        if (st.m(c) && add(nlist, st.out, pos + 1)) return true;
      }
      if (add(nlist, start, pos + 1)) return true;
      clist = nlist;
    }
    return false;
  };
}

/** Compile a pattern (no slashes) with flags from `i`, `m`, `s`. Never throws. */
export function compileSafeRegex(pattern: string, flags = ''): SafeRegexResult {
  if (!/^[ims]*$/.test(flags) || new Set(flags).size !== flags.length) {
    return { ok: false, error: { message: `Unsupported flags '${flags}' (use i, m, s)`, index: 0 } };
  }
  try {
    const ast = new RegexParser(pattern, flags.includes('i'), flags.includes('s')).parse();
    const compiler = new Compiler();
    const start = compiler.compile(ast, 0);
    const test = makeMatcher(compiler.states, start, flags.includes('m'));
    return { ok: true, regex: { source: pattern, flags, test } };
  } catch (err) {
    if (err instanceof RegexSyntaxError) return { ok: false, error: { message: err.message, index: err.index } };
    return { ok: false, error: { message: (err as Error)?.message ?? String(err), index: 0 } };
  }
}
