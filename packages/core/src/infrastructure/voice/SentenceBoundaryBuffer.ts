// ────────────────────────────────────────────────────────────────
// SentenceBoundaryBuffer — accumulates streaming text deltas, emits
// complete sentences as they finish.
//
// Phase 4 (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part E): "Sentence-
// boundary EventBus subscriber... pipelined synthesis overlapped with
// continued generation." This is the piece that lets speak() start
// synthesizing sentence 1's audio while the agent is still generating
// sentence 2's tokens, instead of waiting for the whole message.
//
// Deliberately simple heuristic, not a real sentence tokenizer: a
// sentence ends at one or more `.`/`!`/`?` followed by whitespace. Known,
// accepted limitation — an abbreviation like "Mr. Smith" or a decimal
// like "3.14" will be treated as a sentence boundary, producing a slightly
// early TTS chunk boundary. This is a genuinely minor cosmetic cost (a
// sentence gets split one word earlier than ideal), not a correctness
// bug — the alternative (a real NLP sentence splitter) is disproportionate
// weight for what this needs to do, and every chunk still gets synthesized
// and played, just with a boundary in a slightly different place.
// ────────────────────────────────────────────────────────────────

const SENTENCE_END = /[.!?]+\s+/;

/** Any character that isn't whitespace or common punctuation — a cheap
 *  "does this actually say anything" test. Guards against forwarding a
 *  punctuation-only fragment (e.g. a delta that happens to land as just
 *  `".!? "`) to the TTS engine as if it were a real sentence. */
const HAS_WORD_CONTENT = /[^\s.,!?;:'"()-]/;

/**
 * Hard cap on how much unterminated text this buffers before forcing a
 * boundary anyway. Streamed text with no `.`/`!`/`?` for a long stretch
 * (a code block, a bullet list, a long clause) would otherwise accumulate
 * without limit until `flush()` — defeating the entire point of Phase 4
 * pipelining, since sentence 1's audio couldn't start until the whole
 * un-punctuated message finally ends. Not a sentence boundary, so this is
 * only applied once no real `SENTENCE_END` match is left to find.
 */
const MAX_BUFFER_CHARS = 400;

export class SentenceBoundaryBuffer {
  private buffer = '';

  /** Feed a text delta. Returns any sentences that completed as a result. */
  push(delta: string): string[] {
    this.buffer += delta;
    const sentences: string[] = [];
    for (;;) {
      const match = SENTENCE_END.exec(this.buffer);
      if (!match) break;
      const end = match.index + match[0].length;
      this.take(sentences, end);
    }
    while (this.buffer.length > MAX_BUFFER_CHARS) {
      this.take(sentences, this.forceBreakIndex());
    }
    return sentences;
  }

  /** Return and clear whatever's left — call once the source stream ends. */
  flush(): string {
    const rest = this.buffer.trim();
    this.buffer = '';
    return HAS_WORD_CONTENT.test(rest) ? rest : '';
  }

  /** Slice off `this.buffer[0, end)` as one sentence and append it if non-empty. */
  private take(sentences: string[], end: number): void {
    const sentence = this.buffer.slice(0, end).trim();
    if (HAS_WORD_CONTENT.test(sentence)) sentences.push(sentence);
    this.buffer = this.buffer.slice(end);
  }

  /** Break at the last whitespace within the cap, or the cap itself if there's none. */
  private forceBreakIndex(): number {
    const lastSpace = this.buffer.lastIndexOf(' ', MAX_BUFFER_CHARS);
    return lastSpace > 0 ? lastSpace + 1 : MAX_BUFFER_CHARS;
  }
}
