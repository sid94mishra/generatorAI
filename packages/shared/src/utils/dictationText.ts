// ────────────────────────────────────────────────────────────────
// dictationText — how dictated text joins what is already in the composer.
//
// A streaming recogniser hands over one UTTERANCE at a time, cut at every
// pause of roughly a second, and it treats each one as a fresh sentence: the
// first word is capitalized, and a phrase that straddled the pause — "ping
// me at sign" / "Sid" — arrives as two halves. Nothing on the server can put
// those halves back together, because the server does not know what the
// composer already holds (the user may have typed in between). So the join
// is decided HERE, from the text before the caret and the text arriving, on
// both the web and the mobile composer.
//
// Three decisions, each a pure function so it can be tested as data:
//
//   dictationSeparator   — is there a space between them? Not after "/" or
//                          "@" or an opening quote, not before "," or ")".
//   continueCase         — "…and I'm worried about the rate limiter" then
//                          "Can you check" is a new sentence; "…returns
//                          JSON," then "And the client" is not, and the
//                          capital A is the model's, not the speaker's.
//   applyScratchCommand  — "scratch that" (Dragon, Windows) discards what
//                          was just said; in-utterance it discards the words
//                          before it, on its own it asks the composer to
//                          remove the previous utterance.
//
// The case rule is deliberately a lexicon, not a guess: a continuation is
// lowercased only when its first word is an ordinary English word that the
// speaker would not capitalize mid-sentence. "Redis", "Friday", "Sid" keep
// the model's capital because they are not in the list; "And", "The",
// "Because" lose it because they are.
// ────────────────────────────────────────────────────────────────

/**
 * Matches a "scratch that" style command with whatever punctuation the model
 * hung on it. Shared by the server-side formatter (which resolves the
 * in-utterance form) and the composer (which acts on the standalone form).
 */
const SCRATCH_COMMAND = /\b(?:scratch|delete|undo)[\s,.!?]*(?:that|this)\b[\s,.!?;:]*/gi;

/** The canonical spelling the formatter emits and the composer looks for. */
export const SCRATCH_THAT = 'scratch that';

/**
 * Resolve "scratch that" inside one utterance.
 *
 *   "send the report scratch that send the summary" -> "send the summary"
 *   "scratch that send the summary"                  -> "scratch that send the summary"
 *   "scratch that"                                   -> "scratch that"
 *
 * When words precede the command they are what the speaker is retracting,
 * so they go. When nothing precedes it, the retraction targets the PREVIOUS
 * utterance, which only the composer can see — so the command is passed
 * through in its canonical form for {@link splitScratchCommand} to act on.
 * Only the LAST occurrence matters: saying it twice is still one correction
 * of whatever came before.
 */
export function applyScratchCommand(text: string): string {
  let last: RegExpExecArray | null = null;
  SCRATCH_COMMAND.lastIndex = 0;
  for (let m = SCRATCH_COMMAND.exec(text); m; m = SCRATCH_COMMAND.exec(text)) last = m;
  if (!last) return text;
  const before = text.slice(0, last.index).replace(/[\s,.!?;:]+$/, '');
  const after = text.slice(last.index + last[0].length);
  if (before.trim()) return after;
  return after ? `${SCRATCH_THAT} ${after}` : SCRATCH_THAT;
}

/**
 * Whether a segment begins with a standalone "scratch that", and what
 * follows it. The composer removes the previous utterance and inserts the
 * remainder in its place.
 */
export function splitScratchCommand(text: string): { scratch: boolean; rest: string } {
  const m = /^\s*scratch that\b[\s,.!?;:]*/i.exec(text);
  if (!m) return { scratch: false, rest: text };
  return { scratch: true, rest: text.slice(m[0].length) };
}

/**
 * Locale tags the multilingual Nemotron build appends in auto-detect mode
 * ("<en-US>"). Metadata about the transcript, never part of it.
 */
export function stripLocaleTags(text: string): string {
  return text.replace(/\s*<[a-z]{2,3}(?:-[A-Za-z]{2,4})?>\s*/g, ' ');
}

/** Characters after which the next word attaches directly — "@", "/", an opening bracket. */
const ATTACHES_AFTER = /[@/\\\-_&+=#$*([{<~^|]$/;
/** Characters that attach to the word before them — a comma, a closing bracket. */
const ATTACHES_BEFORE = /^[.,!?;:)\]}%>°]/;
/** Joiners at the START of the incoming text: "/server" continues "source". */
const JOINS_BACKWARD = /^[/\\@_&+=\-~^|]/;

/**
 * The whitespace to put between `before` and `incoming` — either one space or
 * nothing. Nothing when `before` already ends in whitespace or a newline,
 * when it ends in a symbol that attaches forward, when `incoming` begins with
 * one that attaches backward, or when `before` ends in an OPENING quote.
 */
export function dictationSeparator(before: string, incoming: string): string {
  if (!before || !incoming) return '';
  if (/\s$/.test(before)) return '';
  if (ATTACHES_AFTER.test(before)) return '';
  if (ATTACHES_BEFORE.test(incoming) || JOINS_BACKWARD.test(incoming)) return '';
  const lastChar = before[before.length - 1]!;
  if (lastChar === '"' || lastChar === "'" || lastChar === '`') {
    // Odd count means the quote just opened; the word belongs inside it.
    const count = before.split(lastChar).length - 1;
    if (count % 2 === 1) return '';
  }
  return ' ';
}

/**
 * Ordinary English words that are never capitalized mid-sentence. Only a
 * word from this list has its model-given capital removed when the previous
 * text has not ended a sentence; anything else is presumed a proper noun.
 */
const COMMON_WORDS = new Set(
  (
    'a an the and but or so nor yet for because although though while if then else unless until till when whenever ' +
    'where wherever whether which who whom whose what whatever that this these those there here how why ' +
    'is are was were be been being am do does did done have has had having will would shall should can could may might must ' +
    'not no nor never always often sometimes usually maybe perhaps probably really very quite just only also too either neither ' +
    'it its he him his she her hers we us our ours you your yours they them their theirs me my mine myself yourself himself herself itself ourselves themselves ' +
    'in on at to from by with without about above below over under between among through during before after into onto out of off up down ' +
    'as than like unlike per via around across along behind beyond inside outside near next past since toward towards within ' +
    'some any all both each every few many much more most other another such same own such ' +
    'one two three four five six seven eight nine ten first second third last ' +
    'now today tomorrow yesterday tonight soon later again still already once twice ' +
    'get got getting give gave go going gone went come came make made take took taken see saw seen know knew known think thought ' +
    'want wanted need needed use used try tried let make sure keep put set run ran say said tell told ask asked add remove check ' +
    'please thanks thank okay ok yes yeah yep fine good great well right sure actually basically honestly however otherwise instead ' +
    'therefore thus hence meanwhile anyway besides moreover furthermore also plus minus except including regarding ' +
    'something someone somewhere anything anyone anywhere nothing nobody nowhere everything everyone everywhere ' +
    'etc example ' +
    'call called send sent start started stop stopped update updated change changed fix fixed move moved write wrote read ' +
    'able about back big small new old high low long short early late'
  ).split(/\s+/),
);

/** A sentence has ended: terminal mark, optionally followed by a closing quote or bracket. */
const ENDS_SENTENCE = /[.!?…]["')\]]*$/;

/**
 * Adjust the case of the first letter of `incoming` to follow `before`.
 *
 * After a sentence end, a newline, or nothing at all, the word starts a
 * sentence and is capitalized. Otherwise it continues one, and if it is an
 * ordinary word the model capitalized only because the utterance began
 * there, the capital is removed. Proper nouns, acronyms ("API") and "I" are
 * left alone.
 */
export function continueCase(before: string, incoming: string): string {
  const first = /^\s*([A-Za-z][A-Za-z']*)/.exec(incoming);
  if (!first) return incoming;
  const word = first[1]!;
  const at = first.index + first[0].length - word.length;
  const trimmed = before.replace(/[ \t]+$/, '');
  const startsSentence = trimmed === '' || /\n$/.test(trimmed) || ENDS_SENTENCE.test(trimmed);

  if (startsSentence) {
    if (/^[a-z]/.test(word)) return incoming.slice(0, at) + word[0]!.toUpperCase() + incoming.slice(at + 1);
    return incoming;
  }
  // Mid-sentence. Leave acronyms, "I", and anything not plainly ordinary.
  if (!/^[A-Z][a-z']*$/.test(word)) return incoming;
  if (word === 'I' || /^I'/.test(word)) return incoming;
  if (!COMMON_WORDS.has(word.toLowerCase())) return incoming;
  return incoming.slice(0, at) + word[0]!.toLowerCase() + incoming.slice(at + 1);
}

export interface StitchResult {
  /** The full composer text. */
  text: string;
  /** Where the inserted text starts, after any separator. */
  start: number;
  /** Where it ends; the caret belongs here. */
  end: number;
}

/**
 * Place `incoming` between `before` and `after` the way a dictation product
 * would: joined, cased and spaced to read as one piece of text.
 */
export function stitchDictation(before: string, incoming: string, after: string): StitchResult {
  const cased = continueCase(before, incoming);
  const lead = dictationSeparator(before, cased);
  const trail = after && cased && !/^\s/.test(after) && !ATTACHES_BEFORE.test(after) && !ATTACHES_AFTER.test(cased) ? ' ' : '';
  const start = before.length + lead.length;
  return { text: `${before}${lead}${cased}${trail}${after}`, start, end: start + cased.length };
}
