# P4-07 — Transcript virtualization spike (D-33)

**Decision: NO-GO for now → the D-33 fallback ships.** Every turn stays in the DOM; long transcripts contain each
turn with `content-visibility: auto` (`contain-turn`), and finished responses before the last 20 turns start
collapsed to their header + digest ("6 steps · +14 −6"). The virtualized path is implemented and kept behind
`TranscriptView virtualize="auto"` so the measurement can be repeated on a quiet machine.

## What was built

| Piece | Where |
|---|---|
| Turn-granularity virtualization (TanStack Virtual 3.14 / virtual-core 3.17: measured heights, `anchorTo: 'end'`, `followOnAppend`, above-the-fold size compensation, `scrollMargin` for the load-earlier row) | `apps/web/src/blocks/transcript/TranscriptView/TranscriptView.tsx` (`virtualize="auto"`) |
| Stick-to-bottom + "Jump to latest" | unchanged host hook `hooks/useStickToBottom.ts` via `useChatTranscript` (observes the list sizer, so it follows virtual growth) |
| App-level find for off-screen turns (model text search → `scrollToIndex` → CSS Custom Highlight API `::highlight(gai-find)`), opened by Mod+F while virtualized; the desktop FindBar can defer to it through `stores/transcriptFindStore.ts` | `TranscriptView/useTranscriptFind.ts`, `client-core transcript/turns.ts` (`turnSearchText`, `findInTexts`) |
| Acceptance spec + 2,000-block fixture (400 turns × user, markdown + code fence, Read/Bash/Edit-with-diff steps, closing text) | `agent-tests/perf/transcript.spec.ts`, `agent-tests/perf/fixtures/transcript-2000.ts`, `agent-tests/perf/playwright.perf.config.ts` |

## Numbers

Not recorded. The spike was run on the development machine while ~6 other agent sessions were building and testing
in parallel: load average 16–20 on the whole run, a `vite build` taking 11–22 minutes, the isolated test server was
SIGTERMed externally twice during the session, and a unit test that renders 115 turns varied between 2.6 s and
14.5 s run to run. Frame-time percentiles (≥ 95 % of frames ≤ 16.7 ms, p99 ≤ 33 ms) measured under that load say
nothing about the transcript, so the owner's instruction applied: when measuring would take long, ship the fallback
and record why.

## Why the fallback is the safer default anyway

- **Find.** With virtualization, browser Cmd+F (web) and `findInPage` (desktop) cannot see unrendered turns. The spike
  answers that with an app-level find that has to take over Mod+F on the web too — replacing the browser's own find
  for the whole page while a long chat is open. The fallback keeps native find working everywhere.
- **Selection, tab order, the accessibility tree.** An unrendered turn cannot be selected, tabbed to or read by a
  screen reader; containment keeps all three (the reason the previous `ChatMessageList` moved from windowing to
  containment, "D8").
- **Cost is bounded without it.** Collapsed finished responses render only their header row; containment skips
  layout/paint of off-screen turns; settled turns are memoised on their messages and never re-render on a streamed
  token (the live turn is the only whole-stream subscriber, W27).

## Re-running the measurement

1. On a quiet machine, set `virtualize="auto"` on the chat's `TranscriptView` (`features/chat/components/ChatTranscript.tsx`).
2. Start an isolated stack (bare `DB_PATH`/`ARTIFACTS_DIR`/`WORKSPACES_DIR`/`EXTENSIONS_DIR`, `GENERATORAI_BIND_HOST=127.0.0.1`,
   Faux harness) and Vite; then
   `TARGET_URL=http://localhost:<web> API_URL=http://127.0.0.1:<api>/api pnpm --filter @generatorai/agent-tests exec playwright test -c perf/playwright.perf.config.ts --headed`.
3. The spec prints `scroll` (`within16`, `p99`, `maxNodes`), `anchored` (`worstGapPx` ≤ 2), `notYanked` (`driftPx` ≤ 1,
   Jump to latest shown) and `find` lines. Accept per 09 §8.2; a GO flips the default to `auto` and records the numbers
   here.
