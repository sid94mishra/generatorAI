// ────────────────────────────────────────────────────────────────
// spokenNumbers — spoken-form numbers to digits ("inverse text
// normalization", the ITN stage of a speech pipeline).
//
// WHY THIS IS OURS AND NOT THE RUNTIME'S
// --------------------------------------
// NeMo-Speech.cpp has an ITN stage (Sparrowhawk grammars,
// `asr.postproc.itn_model_dir`), but it is gated behind a
// `-DNEMO_SPEECH_WITH_NORM=ON` build flag and NVIDIA's prebuilt binaries do
// not carry it — `nemo-speech doctor` on the official 0.1.0 Windows CPU
// release reports `asr diarization http integrated_vad model_pull punctuation
// realtime_websocket speech_translation translation tts` and no `norm`. There
// is no ITN grammar in its model index either. Doing it here also means every
// engine gets it, not just Nemotron: Moonshine and Whisper emit spoken-form
// numbers too.
//
// THE HARD PART IS KNOWING WHERE ONE NUMBER ENDS
// ----------------------------------------------
// "ten eleven twelve thirteen" is FOUR numbers, not one — you cannot say
// "ten eleven" to mean a single value. "twenty three" is one. "one zero zero
// two" is neither: it is a digit sequence, the way people read out an ID.
// So this walks the token stream with the composition rules of English
// numerals rather than greedily concatenating anything numeric, and treats a
// run of three or more bare digits as a sequence.
//
// Deliberately conservative about what it will NOT touch:
//   - ordinals ("first", "second") — they are words, not quantities;
//   - "a"/"an" as in "a hundred" — too close to the article;
//   - a run of only two bare digits ("two three"), which is as likely to be
//     two separate quantities as the digits of a number.
// ────────────────────────────────────────────────────────────────

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, nought: 0, one: 1, two: 2, three: 3, four: 4,
  five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};

const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** Multipliers, and how far they reach back. */
const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000,
};

/** A run of at least this many bare digits reads as a sequence, not a sum. */
const DIGIT_RUN_MIN = 3;

/**
 * A LONE number word below this stays spelled out.
 *
 * Converting every numeral turned ordinary prose into "1 thing" and "a trial
 * period of 3 months", which is worse than the problem it solves — and it
 * matches the usual style rule of spelling out one through nine. Compounds,
 * digit sequences and decimals are exempt: "twenty three", "one zero zero
 * two" and "thirty one point eight" are unambiguously numeric no matter how
 * small their parts.
 */
const LONE_DIGIT_MIN = 10;

/**
 * Words after which a lone small number is being used as a label, not a
 * quantity — "point number one" is an identifier, "one thing" is not.
 */
const COUNTING_CUES = new Set([
  'number', 'no', 'point', 'item', 'issue', 'step', 'version', 'chapter',
  'page', 'section', 'part', 'phase', 'level', 'option', 'question', 'task',
  'ticket', 'release', 'figure', 'table', 'row', 'column',
  // Symbol prefixes spoken immediately before a value: "dollar sign five",
  // "hash five". The numeral pass runs before the symbol pass (punctuation
  // inserted between number words would confuse the numeral parser), so at
  // this point these are still ordinary words.
  'sign', 'hash', 'hashtag', 'dollar', 'pound',
]);

type Kind = 'unit' | 'teen' | 'ten' | 'scale' | 'and' | 'point' | 'other';

function kindOf(word: string): Kind {
  const w = word.toLowerCase();
  if (w in UNITS) return 'unit';
  if (w in TEENS) return 'teen';
  if (w in TENS) return 'ten';
  if (w in SCALES) return 'scale';
  if (w === 'and') return 'and';
  if (w === 'point') return 'point';
  return 'other';
}

/**
 * Whether `next` can continue the numeral that `prev` ended.
 *
 * This is the whole difference between "twenty three" (one number) and "ten
 * eleven" (two). Written as an explicit table because the failure mode of
 * getting it wrong — silently gluing two numbers into one — is invisible in
 * the transcript and impossible for the user to spot.
 */
function composes(prev: Kind, next: Kind): boolean {
  switch (prev) {
    case 'ten':
      // "twenty three" ✓, "twenty twenty" ✗, "twenty ten" ✗
      return next === 'unit' || next === 'scale';
    case 'unit':
    case 'teen':
      // "two hundred" ✓, "nineteen eighty" ✗ (that is a year, read as digits)
      return next === 'scale';
    case 'scale':
      // "two hundred and thirty", "two thousand five"
      return next === 'unit' || next === 'teen' || next === 'ten' || next === 'scale' || next === 'and';
    case 'and':
      return next === 'unit' || next === 'teen' || next === 'ten';
    default:
      return false;
  }
}

/** Fold a validated numeral phrase into its value. */
function evaluate(words: string[]): number {
  let total = 0;
  let current = 0;
  for (const raw of words) {
    const w = raw.toLowerCase();
    if (w === 'and') continue;
    if (w in UNITS) { current += UNITS[w]!; continue; }
    if (w in TEENS) { current += TEENS[w]!; continue; }
    if (w in TENS) { current += TENS[w]!; continue; }
    const scale = SCALES[w]!;
    if (scale >= 1_000) {
      total += (current || 1) * scale;
      current = 0;
    } else {
      current = (current || 1) * scale;
    }
  }
  return total + current;
}

interface Token {
  text: string;
  /** Leading whitespace exactly as it appeared, so output spacing is preserved. */
  gap: string;
}

function tokenize(text: string): { tokens: Token[]; tail: string } {
  const tokens: Token[] = [];
  const re = /(\s*)(\S+)/g;
  let m: RegExpExecArray | null;
  let end = 0;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ gap: m[1]!, text: m[2]! });
    end = re.lastIndex;
  }
  // Trailing whitespace belongs to no token; keep it so the caller's text is
  // returned byte-identical apart from the numerals themselves.
  return { tokens, tail: text.slice(end) };
}

/** Strip trailing punctuation so "eight." still parses, and hand it back. */
function split(word: string): { core: string; trail: string } {
  const m = /^(.*?)([.,;:!?)\]}"']*)$/.exec(word);
  return { core: m?.[1] ?? word, trail: m?.[2] ?? '' };
}

/**
 * Rewrite spoken numbers in `text` as digits.
 *
 * Idempotent — digits are not number words, so a second pass is a no-op. That
 * matters because this runs on every streaming partial as well as on the
 * committed segment.
 */
export function normalizeSpokenNumbers(text: string): string {
  const { tokens, tail } = tokenize(text);
  if (tokens.length === 0) return text;

  const out: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const { core, trail } = split(tokens[i]!.text);
    const kind = kindOf(core);

    if (kind === 'other' || kind === 'and' || kind === 'point') {
      out.push(tokens[i]!.gap + tokens[i]!.text);
      i += 1;
      continue;
    }

    // ── Digit sequence: "one zero zero two" -> 1002 ──
    // Checked first: its members are all `unit`s, which would otherwise be
    // emitted one at a time.
    let run = 0;
    while (i + run < tokens.length) {
      const p = split(tokens[i + run]!.text);
      if (kindOf(p.core) !== 'unit') break;
      // A trailing mark ends the run but is still part of it.
      if (p.trail) { run += 1; break; }
      run += 1;
    }
    if (run >= DIGIT_RUN_MIN) {
      let digits = '';
      let tail = '';
      for (let k = 0; k < run; k += 1) {
        const p = split(tokens[i + k]!.text);
        digits += String(UNITS[p.core.toLowerCase()]!);
        tail = p.trail;
      }
      out.push(tokens[i]!.gap + digits + tail);
      i += run;
      continue;
    }

    // ── Arithmetic compound: "one thousand two hundred and thirty four" ──
    const phrase: string[] = [core];
    let prev: Kind = kind;
    let j = i + 1;
    let lastTrail = trail;
    // A word carrying trailing punctuation closes the numeral.
    while (!lastTrail && j < tokens.length) {
      const p = split(tokens[j]!.text);
      const k = kindOf(p.core);
      if (!composes(prev, k)) break;
      phrase.push(p.core);
      lastTrail = p.trail;
      // "and" is only a connector if a number really follows it.
      if (k === 'and') {
        const after = j + 1 < tokens.length ? kindOf(split(tokens[j + 1]!.text).core) : 'other';
        if (!composes('and', after)) { phrase.pop(); break; }
      }
      prev = k;
      j += 1;
    }

    let value = String(evaluate(phrase));

    // ── Decimal: "thirty one point eight" -> 31.8 ──
    // Only between two numbers, so "point number one" keeps its noun.
    if (!lastTrail && j + 1 < tokens.length && kindOf(split(tokens[j]!.text).core) === 'point') {
      let d = j + 1;
      let decimals = '';
      while (d < tokens.length) {
        const p = split(tokens[d]!.text);
        if (kindOf(p.core) !== 'unit') break;
        decimals += String(UNITS[p.core.toLowerCase()]!);
        d += 1;
        if (p.trail) { lastTrail = p.trail; break; }
      }
      if (decimals) {
        value += `.${decimals}`;
        j = d;
      }
    }

    // A lone small numeral is left as a word unless something marks it as a
    // label — see LONE_DIGIT_MIN / COUNTING_CUES.
    const isLone = phrase.length === 1 && !value.includes('.');
    if (isLone && Number(value) < LONE_DIGIT_MIN) {
      const prevWord = i > 0 ? split(tokens[i - 1]!.text).core.toLowerCase() : '';
      if (!COUNTING_CUES.has(prevWord)) {
        out.push(tokens[i]!.gap + tokens[i]!.text);
        i += 1;
        continue;
      }
    }

    out.push(tokens[i]!.gap + value + lastTrail);
    i = j;
  }

  return out.join('') + tail;
}
