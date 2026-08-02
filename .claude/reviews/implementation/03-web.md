# 03 — Web frontend (`apps/web`)

Detailed implementation plan for the 5 Critical + 7 High findings in section C of [../CODE_REVIEW.md](../CODE_REVIEW.md).

---

## Critical

### [CRITICAL] Event data cast without narrowing — `stores/sseManager.ts:141, 672`

**Issue.** `event.data as Record<string, unknown>` bypasses discriminated-union narrowing. Shape drift between server emission and client consumption is silent until runtime.

**Fix.**
1. Add `getEventData<K>(kind, data)` helper in `packages/shared/src/types/AgentEvent.ts` that returns `Extract<AgentEvent, {kind:K}>['data']` (typed).
2. In `processEvent` / `processMetadataEvent`: `const data = getEventData(kind, event.data)` once at the top.
3. All downstream `data.text`, `data.stageRunId` etc. accesses are now type-narrowed (kind determines shape).
4. Coordinates with 2.17 `EVENT_REGISTRY` — once that lands, `getEventData` also runs a runtime Zod parse and throws on schema drift.

**Effort:** S. **Acceptance:** TS strict flags any shape mismatch; no `as Record<string, unknown>` remains in `sseManager`.

### [CRITICAL] Replay-vs-live dedup race — `stores/sseManager.ts:802-814`

**Issue.** `if (event.sequenceId <= lastReplayedSequence || seenSequenceIds.has(…)) return;` drops legitimate late events that equal `lastReplayedSequence`. Combined with the 200-ID pruning window, out-of-order events slightly past the boundary vanish.

**Fix.**
1. Change the `<=` to `<` (events at the exact boundary still considered; Set dedup catches true duplicates).
2. Expand pruning window: `threshold = maxSeenSequence - 300`, prune only when Set size > 500.
3. Log-warn when Set size exceeds 600 in dev.

**Effort:** S. **Acceptance:** unit test — replay finishes with `lastReplayedSequence=101`; SSE delivers 101 right after; event appears exactly once in store.

### [CRITICAL] Cross-buffer flush non-atomic — `stores/streamStore.ts:160-183` + `sseManager` callers

**Issue.** Flushing thinking buffer and appending token are two separate Zustand `set()` calls; batched commit order is not guaranteed to match the temporal order. Result: rare block duplication / reordering.

**Fix.**
1. New store action `flushAndAppendToken(sessionId, token)` that, in a single `set((state) => …)`, finalizes any pending thinking block AND appends the new token block.
2. Matching `flushAndAppendThinking(sessionId, text)` for the reverse direction.
3. Update `sseManager.processEvent` branches for `copilot.token` / `copilot.reasoning_delta` to call these atomic actions instead of two separate calls.
4. Extend to tool-start and system blocks if analogous interleaving applies.

**Effort:** M. **Acceptance:** stress test emitting alternating token/thinking/tool-start 100×/s; block list matches temporal order deterministically.

### [CRITICAL] Blob URL leak — `HttpPlatformClient.ts:574-587, 629-642`

**Issue.** `URL.createObjectURL(blob)` without `try/finally`. On fetch error: URL never revoked. Immediate `a.click()` + next-tick revoke race: browser may not start download before revoke.

**Fix.**
1. New shared helper `apps/web/src/utils/downloadBlobAsFile.ts`:
   ```ts
   export async function downloadBlobAsFile(blob: Blob, filename: string, revokeDelayMs = 500) {
     const url = URL.createObjectURL(blob);
     try {
       const a = document.createElement('a');
       a.href = url; a.download = filename;
       document.body.appendChild(a); a.click();
       document.body.removeChild(a);
       await new Promise(r => setTimeout(r, revokeDelayMs));
     } finally {
       URL.revokeObjectURL(url);
     }
   }
   ```
2. Refactor `downloadRunFile` and `downloadWorkflowFile` to fetch, throw-on-!ok, and call the helper.

**Effort:** S.

### [CRITICAL] Polling vs SSE inconsistency at completion — `pages/WorkflowRunPage.tsx:85-89`

**Issue.** `useWorkflowRun` polls every 30 s (from QueryProvider default staleTime). SSE completion event invalidates the query, but a refetch that's already in flight can write stale data after, causing status flicker.

**Fix.**
1. Update `useWorkflowRun` to pass `refetchInterval` as a function:
   ```ts
   refetchInterval: (data) => ['completed','failed','cancelled'].includes(data?.status) ? false : 5_000
   ```
2. In `sseManager` on `workflow_run.completed|failed|cancelled`: call `queryClient.refetchQueries({ queryKey: workflowKeys.run(runId) })` explicitly (not just invalidate), so the last write is the right one.
3. Add `isTerminal` memo in `workflowRunStore` used for refetch-disable as a second signal.

**Effort:** S.

---

## High

### [HIGH] Dedup Set pruning off-by-one — `sseManager.ts:811-816`

Already covered by the fix for the Critical race above (expand window to 300; prune only when size > 500). Add a dev-only warn at 600.

**Effort:** S (absorbed above).

### [HIGH] Two live EventSource paths — `sseManager.ts:835-871` + `HttpPlatformClient.ts:228`

**Issue.** Global multiplexed EventSource + per-session `subscribeToEvents` EventSource can both be open. Watchdog reopens global without coordinating per-session.

**Fix.**
1. **Policy:** web exclusively uses global SSE. Deprecate `HttpPlatformClient.subscribeToEvents` for the web path; document as "CLI / integrations only".
2. Enforce in code: in `apps/web` paths, `ensureGlobalSSE()` is the only allowed entry; add a dev-only warning if `subscribeToEvents` is called from web.
3. If both paths still need to coexist (they do, because DirectPlatformClient goes in-process), export a shared dedup helper from `sseManager` that both paths consult.

**Effort:** M.

### [HIGH] No per-route error boundary — `router.tsx:12-24`

**Fix.** New `components/PageErrorBoundary.tsx` (class component) with `getDerivedStateFromError` + `componentDidCatch`. Wrap each lazy route in `router.tsx`. Show per-page error + a "Back to home" link + a "Retry" button. Root-level boundary remains as last-resort.

**Effort:** M.

### [HIGH] ThemeProvider unguarded localStorage — `ThemeProvider.tsx:32, 49`

**Fix.** Guard both `getItem` and `setItem` with `if (typeof window === 'undefined') return`. Already guarded on get; missing on set.

**Effort:** S.

### [HIGH] Aggressive staleTime with SSE invalidations — `QueryProvider.tsx:12-14`

**Fix.** Split defaults:
- Event-driven queries (sessions, chats, runs, stage runs, chat history) — `staleTime: 0`.
- Static queries (templates, workflow definitions, system templates, Copilot models) — `staleTime: 5 * 60_000`.
Implement via per-hook `staleTime` overrides; leave `QueryClient` default at `0` so forgetting is safe.

**Effort:** S.

### [HIGH] `getOverlappingStages()` O(n²) — `components/workflow/WorkflowMessages.tsx:59-78`

**Fix.**
1. Wrap in `useMemo([stageRuns])`.
2. Replace nested loop with sweep-line: sort events by `{time, 'end' > 'start'}`; iterate maintaining `activeSet`; for each `start`, snapshot `activeSet` into the result map; `O(n log n)`.

**Effort:** M.

### [HIGH] Chat dedup by content — `components/chat/ChatView.tsx:67-98`

**Fix.** Dedup by `turnId` (already present in `streamStore`). Propagate turn id into persisted `ChatMessage` (needs a new optional `turnId` field in `chat_messages` + schema migration or, cheaper, infer turn id from `metadata.turnId` if server includes it in the write path).

Phase 1 path: server-side, when persisting assistant/user messages for a chat, include `turnId` into `metadata`. Client filters by `turnId < stream.turnId`.

**Effort:** M. **Deps:** 1.1 migrations + server-side chat message persistence.

---

## Other Critical/High nearby (not in CODE_REVIEW but surfaced during deep-dive)

- **`_resetForTests` in production bundle.** Move behind `if (import.meta.env.DEV)`.
- **Portal stacking** for modals — use Radix Dialog eventually; interim, ensure unique z-index per modal.

(These are noted here for future attention, not part of the required Critical/High plan.)
