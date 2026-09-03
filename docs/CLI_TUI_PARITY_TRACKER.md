# CLI/TUI Post-Overhaul Parity — Implementation Tracker

Plan of record: [CLI_TUI_POST_OVERHAUL_PARITY_AUDIT_2026.md](CLI_TUI_POST_OVERHAUL_PARITY_AUDIT_2026.md).
Branch `arch-redesign`. 10 phases (0–9); this tracker follows the audit's §12 phase list.

**Process per item:** implement → hermetic test → typecheck the touched package →
run the touched package's full suite → record file:line evidence here. An item
is "done" only when a test exercises the fixed behavior, not merely restated.

**Verification rule.** A row citing a fix is not evidence the fix exists — it is
paired with the test file that proves it, and every row below was checked with
`tsc --noEmit` plus a fresh `vitest run` of the touched package(s) before being
marked done.

**Open questions / pending decisions.** Per instruction, decisions that would
otherwise block progress are not stopped on mid-phase — they're made with the
best available judgment, implemented, and logged here with the reasoning, to
be reviewed as a batch at the end of all phases rather than one at a time.
Nothing in this list should be read as "undecided and blocking" — every row
already has a real, working implementation behind it; the entry exists so it
can be revisited, not because anything is left broken.

| # | Phase | Question | What was implemented | Why |
|---|---|---|---|---|
| 1 | 3 (item 6) | Should opening a chat/run/etc. that is already open in another pane focus that pane instead of opening a duplicate tab? | Not built. `openPane` now returns a stable pane handle (see Phase 3 §item 6), which is the plumbing this would need, but the dedup behavior itself was left as a noted follow-up rather than added | The audit's item 6 asks specifically for stable handles + no focus race, not dedup — building it now would be a real UX decision (what counts as "the same entity"? does it apply across tabs and splits equally?) bundled into an unrelated fix; a five-line add if wanted, but not implied by the item as written — ✅ **RESOLVED — Enter on a row whose pane is already open now focuses it (`findOpenPane`, matched on `(kind, entityId)` so a workspace’s diff and file-tree panes still coexist). The decision sits in `openSelected`, not `openEntity`, which takes its deps explicitly and must stay testable without a global store.** |
| 2 | 3 (item 3) | The mux-stream client was verified against the real server ROUTE code and a faithful fake-server test double, never against an actually-running GeneratorAI server (none available in this environment) | Shipped as the default (`createCliClient.ts` now always uses `MuxStreamClient`), not gated behind a flag | The audit explicitly asks to REPLACE the old per-scope transport, not add an alternative; the new client is a faithful, tested port of a protocol already proven live for the web app. Real residual risk: an auth-timing or load-behavior surprise that only a live-server smoke test would catch — worth doing once a server is available, before this ships to real users |
| 3 | 3 (item 3) | The history↔live-stream duplicate-render seam (opening a chat pane can briefly show a message from both the history fetch and the live stream) has no dedup, and can't be given one client-side | Left as-is (a rare, cosmetic, self-resolving-on-reopen duplicate) rather than adding a content-based heuristic | Real dedup needs a server change (an "as-of sequence" watermark on the messages endpoint, or live chat events carrying the persisted message's real id) — a content-based guess client-side risks dropping a genuinely different message that happens to share text, which is a worse failure mode than the cosmetic duplicate it would be avoiding |
| 4 | 3 (item 4) | List panes (chats/runs/etc.) only refresh on a poll timer, never on an event, because nothing server-side publishes "a chat was created"/"a run's status changed" to any scope a list pane could subscribe to | Not built — a concrete design was scoped (server: have `ChatManagementService`/`WorkflowRunService`/`AutomationService` also publish lifecycle events to `global`; client: one app-level `global` subscription patching `state.data`, poll kept as repair) but not implemented | This is a real, two-sided feature addition (new server broadcast behavior + client consumption), not a bugfix — bigger and more product-facing than the client-only fixes in the rest of this phase, and better done as its own deliberate piece of work than squeezed in — ✅ **RESOLVED — a closed list of entity lifecycle kinds now fans out to `scope=global`; the client applies deletions and status changes directly and asks for a refetch on creations (a creation event cannot supply the row a list renders). Polling stays as repair.** |
| 5 | 3 (item 5) | Hidden (background-tab) panes still receive and apply every stream event at full rate — no priority/pause for panes the user can't currently see | Not built | Pausing a background pane's subscription risks silently missing messages the user expects on switching back; the safer alternative (still receive, delay applying) has unclear benefit over the coalescing already shipped without a product decision on the actual desired behavior — ✅ **RESOLVED — hidden panes still RECEIVE every event (pausing would lose messages); what changed is when they are APPLIED. Visible panes flush per microtask, hidden ones on a 250 ms timer, and becoming visible flushes immediately.** |
| 6 | 3 (item 5) | No metrics/instrumentation exist for the CLI's stream health (queue depth, drop counts, latency) | Not built | No existing convention for where such metrics would surface in `apps/cli` (unlike `apps/server`'s real OTel wiring) — inventing one unasked risks infrastructure nobody ends up using — ✅ **RESOLVED — `StreamReconciler.stats()` counts received/applied/flushes/reconnects/queue depth, surfaced in a new client diagnostics pane (leader `i`). `system doctor` is a SERVER command and can see none of it.** |
| 7 | 4 (item 1) | The TUI's 11 independent `useInput`/`useKeys`/`useKeymap` registrations are genuinely "parallel listeners," not a consumable router — the leader/composer double-fire (item 2) was the one demonstrated concrete symptom, now fixed, but the general architecture is unchanged | Not rewritten | A full router (every candidate handler returning consumed-or-not, one arbiter deciding) means touching every interactive `tui-kit` component's input handling — high blast-radius, no way to verify full correctness without exercising every interactive mode by hand. A future hard-coded chord colliding with a `global`/`leader` binding would double-fire the same way, silently, with nothing to catch it short of a full audit |
| 8 | 4 (docs) | `.github/docs/apps.md` and `.github/docs/usage-cli.md` both describe a defunct pre-rewrite TUI design (5 numbered views, `Esc`/`Ctrl+B` for "back") that matches nothing in the current keymap | Not fixed | Rewriting it properly means documenting the actual current keymap in full (g-prefix nav, leader ops, per-context composer/chat bindings) — a real doc-writing task, out of scope for the leader-key fix that surfaced it — ✅ **RESOLVED — the keymap section of `usage-cli.md` is now GENERATED from `DEFAULT_KEYMAP` (`toKeymapDocs`), like the command tables, and covered by the same CI drift check. Hand-writing it was why it drifted.** |
| 9 | 4 (item 6) | `app.back` (Escape)'s fallback pane-close still bypasses the new terminate-on-close confirm — only `pane.close` (leader x) asks | Left as-is, not gated | Escape is a frequently-mashed "navigate back" gesture; gating every incidental Escape-driven close behind a confirm dialog would make basic navigation naggy. A real, deliberate trade-off — Escape can still silently orphan a terminal/browser resource in a way `pane.close` no longer can — ✅ **RESOLVED — Escape now goes through the same `closePaneWithTerminationChoice` as leader-x. The "naggy" worry does not apply: `decideClosePane` returns `closeOnly` for every pane that owns no terminable resource, so the common Escape is unchanged.** |
| 10 | 4 (item 7) | Terminal panes have no scroll-offset/paging mechanism at all (`TerminalPane` always renders the fixed last N lines) — so `terminal.search` couldn't be built the way `chat.search` was; there is nowhere for a match to jump TO | Not built | Building terminal-pane paging first, then wiring search to it, is real, separate, undone work — a search feature can't be faked on top of a rendering model that has no concept of "scrolled position" yet — ✅ **RESOLVED — the headless emulator keeps a real scrollback buffer, `bufferToLines` takes an absolute first row, and PgUp/PgDn/End plus `alt+s` search now work. Search runs through the same emulator, so a match refers to a row the user can actually see.** |
| 11 | 4 (item 7) | Full tmux-style copy mode (cursor + text selection + terminal clipboard yank) was in the audit's item 7 wording | Not attempted | A real selection model over rendered terminal text plus clipboard integration is its own, separately-sized feature — scoped down to the two tractable, real pieces (in-transcript search, unseen-output indicator) instead of a partial/fake copy mode — ✅ **RESOLVED as far as is honest — `y` copies the visible screen through OSC 52 (which works over SSH, unlike a clipboard binary). A character-level selection model is still not built, and is a genuinely separate feature.** |
| 12 | 5 (item 3) | The headless-terminal cell walk (`terminalRender.tsx`) doesn't map VT100 blink (`isBlink()`) or overline (`isOverline()`) cell attributes | Left unmapped | Ink's `<Text>` has no blink/overline equivalent prop at all — there is nothing to map onto. Both are rare in practice (blink is disabled by most modern terminal profiles anyway) and this is strictly no worse than today's zero ANSI handling |
| 13 | 5 (item 3) | The terminal pane's column/row budget (`termColumns - 6`, `height - 5`) and "fresh `Terminal` instance per scrollback/size change, disposed on every change" have no prior precedent in this codebase to match — this is the first Ink-embedded terminal emulator here | Sizing matched `ChatPane`'s existing width-budget convention in the same file; the fresh-instance choice was made for simplicity/safety over reusing+`reset()`-ing one instance, acceptable since it fires on explicit scrollback fetches, not per-keystroke | Both are real, reasonable defaults rather than derived requirements — worth a design pass once real usage surfaces whether the row/column budget feels right in practice |
| 14 | 5 (item 5) | No design precedent existed anywhere for terminal resize authority with 2+ attached clients — pre-fix behavior was unarbitrated last-write-wins | First-attacher-is-owner; a non-owner's `resize` is silently ignored (not an error); ownership transfers to the next-oldest still-attached connection if the owner disconnects. Implemented entirely at the WS layer (`ResizeAuthority` in `apps/server/src/terminal-ws.ts`), zero protocol/client changes, zero behavior change for the single-attacher case | A real product decision was needed and none existed to defer to; this is the simplest policy that makes the common single-client case a true no-op, gives a sane predictable default for the multi-client case (whoever opened it first drives sizing), and is fully reversible/replaceable later behind the same seam if product wants a different rule (e.g. an explicit "make me primary" action) |
| 15 | 6 (item 4) | No precedent existed for how a stage-tree-plus-detail view should be laid out in a fixed-width terminal pane | A single on-demand overlay (stage list + inline detail for the selected one), triggered by `s`, rather than a second permanently-visible region inside `RunPane` | Leaves `RunPane`'s existing flat-timeline layout (its own real value — a chronological event log) untouched; a permanent split-pane stage tree is a real, separate, larger layout change if wanted later |
| 16 | 6 (item 4) | No prior per-pane preference concept existed anywhere in this codebase for `run.verbosity` to build on | Pane-scoped, in-memory, lost on close (absent = today's exact behavior, unaffecting every non-run pane) | Matches every other pane-keyed ephemeral setting already in `store.ts` (`selection`, `search`); a persisted-across-sessions default is new scope beyond what the audit item asks for |
| 17 | 6 (item 6) | No automation-wide live stream scope exists server-side — only a per-execution one, keyed by the execution's own id (confirmed by tracing `apps/server/src/composition-root.ts`'s `bridgeEvent`) — so a pane showing an automation's full execution history can only ever have ONE execution's live progress attached at a time | Attach to whichever execution is still running/pending at open time; every other execution in the list is REST-snapshot only, never live | Best fit for the real server-side scope model without adding new server plumbing (an automation-wide scope, or N simultaneous per-execution subscriptions) that this item didn't ask for and would be its own, separate piece of work — ✅ **RESOLVED — `automation_execution.*` events carry `automationId`, so they now fan out to the automation as well as the execution. A pane showing an automation’s history no longer follows only whichever execution was running when it opened.** |
| 18 | 6 (items 2/3) | `AgentQuestion.multiSelect` is real but no overlay in this codebase supports a multi-pick answer | Answered as a single choice via the existing single-select `select` overlay | Honest (not silently wrong) and unblocks the common single-select/freeform shape now; a genuine multi-pick overlay is separate, undone work |
| 19 | 6 (items 2/3) | The `/attach` → `chat.send`'s `flags.attach` threading has no dedicated test — `submitComposer` isn't exported and `tui-e2e.test.tsx` has no mocked `api.chats.sendWithAttachments` to assert against | Left covered only by typecheck + the crash-safety sweep test, not a targeted assertion | Building new e2e mock infrastructure for one command's flag-plumbing is disproportionate scope; worth adding if `/attach` sees real use and regresses silently — ✅ **RESOLVED — the command half was already covered (`chat-send.test.ts`); the untested part was the TUI’s decision, now extracted to `composerInput.ts` and covered by 15 cases.** |
| 20 | 6 (item 5) | No design precedent existed anywhere (incl. `apps/web`) for a global blocked-work/notification queue; the audit's own wording is a one-line spec with no shape attached | Scoped to workflow-stage approvals + chat plan/question gates only (not background-task failures/plain errors); jumps to the pane rather than resolving the gate inline from the overlay | A broader "everything that happened" feed is a different, larger feature than what the wording asks for; one resolution code path (the pane's own existing keybindings) beats two kept in sync |
| 21 | 7 (item 2) | `diff.comment` needed a line number with no line-cursor concept anywhere in `ChangesPane` to supply one from | Added a "which line?" chained input prompt rather than a fabricated default or a full cursor-navigation feature | A real line-cursor UX (arrow through lines, comment inline) is a separate, larger feature; the prompt is honest and unblocks the command today — ✅ **RESOLVED — a real line cursor (↑/↓ in a diff). It supplies `startLine` AND `side`, which the old "which line?" prompt could not: a typed number never said whether it meant the old file or the new one.** |
| 22 | 7 (new `'workspace'` stream scope) | `bridgeEvent` (the EventBus→StreamBroker fan-out) has no dedicated test for its new `workspaceId` branch — it's an unexported closure inside `composition-root.ts`'s setup function | Left untested at the bridge level, same as the pre-existing `'automation'` scope | Testing it means either exporting an internals-only closure or a full composition-root integration test; better done once, covering every scope, than per-scope — ✅ **RESOLVED — the bridge’s scope logic is extracted to `deriveStreamScopes` and covered by 13 cases, including that high-frequency events must NOT reach the global scope.** |
| 23 | 7 (process) | `apps/server`/`packages/db`/`packages/core` use composite TS project references with checked-in `dist` — plain `tsc --noEmit` on one of them alone silently checks against stale referenced-project `.d.ts` output instead of fresh source | `pnpm turbo typecheck --filter=<pkg>` used instead for the rest of Phase 7/8 | Not a design decision so much as a documented process correction — logged so it isn't rediscovered at cost again |
| 24 | 7 (items 1/3) | Uploading a brand-new local file into the `Workspace` model has no server route at all (confirmed by re-grepping `workspaces.ts` and `workspace.commit`'s handler) | Not built; the `$EDITOR` handoff sidesteps needing it for EDITING an existing file via a direct-to-disk design instead | Would need new server work (a write/upload route) — out of scope for a CLI/TUI-only implementation pass — ✅ **RESOLVED — `PUT /api/workspaces/:id/files/content` added (mirroring the read route’s source/alias resolution and traversal guard exactly), plus `workspace put` and a `u` binding on the workspace pane.** |
| 25 | 7 (items 1/3) | **Confirmed pre-existing bug** — `dataKeysFor('changes')` sized a changes/diff pane's `selection` (and with it `diff.nextFile`/`.prevFile`) against `s.data.workspaces.length`, the generic workspace LIST cache, rather than the diff's own `state.files.length`: a shorter workspace list left later files unreachable, a longer one let the cursor run past the end | ✅ **RESOLVED in the second pass.** The selector is now a pure, exported `paneListRows()` with a `changes` branch of its own (mirroring the `workspace` branch), plus dedicated tests | Originally deferred to avoid a drive-by edit inside unrelated item 1/3 work; fixed properly once it could be given its own tests |
| 26 | 7 (items 1/3) | No nested-directory-tree UI precedent exists anywhere in this codebase, and `workspace.tree`'s real data has no directory-entry concept server-side to build one from | `WorkspacePane` is a flat, filterable file list, not a tree | Reusing the existing `ListPane` filter convention over inventing tree-drilling from scratch for one pane — ✅ **RESOLVED — the tree is DERIVED from the path segments, which is how every editor builds one; the server sends no directory rows to anyone. Flat stays as a mode, and a filter switches to it automatically.** |
| 27 | 7 (item 4) | A spec with fifteen flags (`automation create`) renders fifteen rows to scroll | Flat field list in declaration order | Any grouping (required-first, paged) is an opinion the spec does not carry; declaration order at least matches `--help` and the docs exactly |
| 28 | 7 (item 4) | `v` on a workflow stage opens `workflow stage update`'s whole form rather than a key/value variables editor | Reused the form — `--var name=value` (repeatable) IS the variables surface | A purpose-built editor needs its own semantics for “unset a variable”, which the command has no flag for |
| 29 | 7 (item 4) | Stage hooks are managed one at a time through `--config` JSON | Mirrors the precedent `hook test` already set | A guided per-hook-type form (three config shapes behind one `--type`) needs a “shape depends on another flag” concept `CommandFlag` does not have |
| 30 | 8 (item 2) | Sixel and half-block image output are refused rather than approximated | Refused with the reason, falling back to the system viewer | Both need a PNG decoder this CLI does not have; a degraded guess would be worse than an honest fallback. A sixel user sees a file open rather than a picture inline — ✅ **RESOLVED — `png.ts` decodes PNG with `zlib` alone (~120 lines), so half-block, sixel and ASCII all render. Half-block covers every 256-colour terminal; refusing them was right against a guess and wrong against a decoder.** |
| 31 | 8 (item 2) | Inline image drawing suspends the whole TUI | Suspend, draw, wait for a key, resume | The only way to keep an image escape out of Ink’s redraw path; drawing into a pane region would need Ink to leave a hole in the frame, which it cannot |
| 32 | 8 (item 4) | The widget contract’s state editing is a whole-snapshot JSON write | Matches what the route takes | Editing one field means retyping the rest; a field-level editor needs a schema for widget state that no descriptor supplies |
| 33 | 8 (item 4) | `widget read` reports a widget as “orphaned” when called without a scope | Left as-is | Accurate about what THAT call could see (the render payload only exists on the list route, within a scope) but could mislead someone who simply forgot the flag — ✅ **RESOLVED — `orphaned` (a descriptor was looked for and not found) is now distinct from `unresolved` (the call named no scope, so nothing looked). The first is a broken install; the second is a missing flag.** |
| 34 | 8 (item 5) | The administration views are read-mostly | Create/delete only where the command exists (webhook, connect, device, extension, agent) | Editing a device’s scopes or a webhook’s URL in place needs per-view update commands that mostly do not exist yet |
| 35 | 9 (items 1/2) | **Measured cold start is 417 ms against a 250 ms budget**, and that is a lower bound (no terminal, no connection, no first paint) | Measured and logged, not fixed | It is a bundle-size / import-graph problem — the registry itself builds in 7.7 ms — so it is real, separate work rather than a tweak inside this pass — ✅ **RESOLVED, and the ORIGINAL FINDING WAS WRONG — see below.** |
| 36 | 9 (item 3) | The reducer no longer raises the unseen-output badge for an event it does not model | Deliberate behaviour change, with a test pinning both halves | The correct reading of the badge (“new content arrived while you weren’t looking”) — but a future pane that renders something from a currently-unmodelled kind will not badge until the reducer models it |
| 37 | 9 (item 6) | Migration, downgrade and clean-uninstall tests are unwritten | Not attempted | All three need a released prior version to migrate FROM, and this branch has never been released; writing them against a synthetic “old config” would test a fixture, not a migration path — ✅ **RESOLVED, and it found a data-loss bug — see below.** |
| 38 | 9 (item 5) | Coverage thresholds are ratchets set at what the suite achieves, not at a target | Global floor plus per-area floors for the four areas the audit names | A threshold above current coverage fails immediately and gets deleted. `errors/CliError.ts` (53%) and `client/` (29%) are the weakest remaining; the latter needs a live server |
| 39 | 7 (item 2) | The changes pane auto-refreshes on a live `workspace.changed` only while it is the FOCUSED pane | Left as-is; `R` refreshes manually, and reopening refetches | The effect reads the focused pane’s timeline revision. Watching every open changes pane means a store-wide subscription whose cost falls on every pane — worth doing if background staleness turns out to matter in practice — ✅ **RESOLVED — every open changes pane refreshes, not just the focused one, keyed on a per-pane revision string so one pane’s event does not refetch the others.** |
| 40 | 8 (item 3) | `GENERATORAI_TUI_GRAPHICS=sixel` is honoured by capability DETECTION and then declined by RENDERING | Left as-is | Coherent (detection reports what the terminal claims; rendering reports what this build can produce) but reads oddly. Worth collapsing once a decoder exists — ✅ **RESOLVED — sixel and half-block are drawn for real now (see #30), so detection and rendering agree.** |

Rows 27–40 were added in the second implementation pass (phases 7–9 and 0).
Each one is also written up, with its full reasoning, in its own phase's
“Open questions logged from…” section below.


## Open-question decision pass

Every open question was decided on merit rather than left for review. **20 of
the 40 are now resolved in code**; the rest were decided to STAND, with the
reasoning already in their row. Nothing was closed by re-labelling it.

Three of them turned out to be hiding real bugs, and one of them was a
finding of mine that was simply wrong.

### #35 — the cold-start finding was wrong, and the real one is better

The previous pass reported "cold start is 417 ms against a 250 ms budget" and
called it a miss. That number was measured as raw wall time. On this machine
`node -e 0` alone takes 240–400 ms, so the figure was mostly Node's own
startup — a number that attributes the platform's floor to the application,
which is worse than no number because it sends someone optimising the wrong
thing. The benchmark now measures the floor with the same spawn mechanism and
reports the CLI's own share separately.

With that in hand the real cause was findable, and it was not what the
original note guessed. `src/index.tsx` already loads the workbench through
`await import('./tui/launch.js')` — but the bundle was a SINGLE FILE, so
esbuild inlined the dynamic import and the laziness bought nothing at
runtime. Measured from the bundle metafile, `generatorai --version` was
parsing **~4 MB of TUI-only code**: highlight.js (1.4 MB), react-reconciler
(1.1 MB), react-devtools-core (0.7 MB), parse5, yoga-layout, @xterm/headless,
ink, react.

Fixed by turning on code splitting (`outdir` + `splitting`, with
`outExtension` keeping the `bin` target's name) and stubbing out
`react-devtools-core`, which Ink imports unconditionally and uses only when
`DEV` is set. **The entry file went 7.49 MB → 1.26 MB**, and the CLI's own
share of cold start went 308 ms → 245 ms on an interleaved A/B. The packed
tarball was installed into a clean directory and run, because code splitting
is exactly the kind of change that works in the repo and breaks once packed.

### #37 — the deferral was reasonable and the code underneath was not

"No released prior version to migrate from" was true, and it hid this:

```ts
const parsed = CliConfigSchema.safeParse(data);
return parsed.success ? parsed.data : CliConfigSchema.parse({});
```

A config file the schema cannot parse was silently replaced by DEFAULTS. What
makes that data loss rather than a nuisance is the next step: `config set`
reads through that same function and then WRITES the result, so one
unrecognised key turned into "every setting you ever changed is gone", with
no message.

`migrateConfig` salvages instead: it parses section by section, then key by
key within a failed section, keeping everything still valid and reporting
what it could not. A bad `tui.accent` now costs an accent colour rather than
the user's server URL, connections and profiles. It also reports keys zod
silently STRIPS, which is what a version upgrade most needs to say.

### #4/#17/#22 — the bridge had no test, and two scopes were missing

The EventBus→StreamBroker fan-out decided who sees which event from an
unexported closure inside a 1000-line setup function, with no test — so both
scopes previously added to it shipped on a read-it-and-hope basis. It is now
`deriveStreamScopes`, pure and covered by 13 cases, and it gained two more
scopes: `automation_execution.*` fans out to its automation as well as its
execution (#17), and a **closed list** of entity lifecycle kinds fans out to
`global` (#4). Closed, not a prefix match, because the bridge sees every
event on the bus — one `harness.token` per streamed character reaching a
scope every client subscribes to would multiply the busiest traffic in the
system by the client count, to say something no view renders.

### What was decided to STAND

- **#2** (mux client never verified against a live server) — unchanged; it
  needs a running server, not a decision.
- **#3** (history↔live duplicate render) — still needs a server-side
  watermark; a content-based client heuristic risks dropping a real message.
- **#7** (parallel key listeners rather than a consumable router) — the
  demonstrated symptom is fixed, the surface snapshot now records every
  binding's owner, and the sweep test drives all 165. A full router remains a
  high-blast-radius rewrite with no way to verify it short of exercising every
  interactive mode by hand.
- **#12** (blink/overline) — Ink has no equivalent prop; there is nothing to
  map onto.
- **#13/#14/#15/#16/#18/#20/#23/#27/#28/#29/#31/#32/#34/#36/#38** — each
  already had a defensible answer; re-reading them changed nothing. #18
  (multi-select answers) and #34 (editable admin rows) are the two most
  worth revisiting when the underlying commands exist.

---

## Status summary

| Phase | Scope | State |
|---|---|---|
| **0** | Freeze claims, baseline | ✅ Complete — done LAST, deliberately: a snapshot of the surface is worth more taken against the finished state. `CommandFlag.unsupported` marks an option that is accepted but inert, reaching `--help`, the docs, the RPC descriptors and the form; a contract test forbids describing an option as inert without marking it. `docs/CLI_SURFACE_SNAPSHOT.md` (218 commands, 150 bindings, 22 admin views) makes the exit gate — *no feature called full on registry presence alone* — checkable in a diff, and records **who executes each binding**: shell / component / **none = 0**. `HANDLED_ACTIONS` is now typed against the handler map, so a bound key with no handler is a compile error. Three CI drift/idempotency/coverage jobs added |
| **1** | Security & correctness stabilization | ✅ Complete — both P0s, §5.3 contract mismatches, §5.4 ignored-options, the `as never` ban, §5.5 output-contract, and §5.6 bin/build packaging all fixed+tested, adversarially re-reviewed (`/code-review --level xhigh`, all 10 findings fixed), then the table-driven contract suite (7 real gaps found+fixed), `usage-cli.md`/`docs:check`, and the 5 flaky chat-surface e2e tests (fixed by design decision — see below) all closed out. Remaining items are explicitly deferred product/scope decisions, not open defects (see "Not yet done" below) |
| **2** | Distribution & protocol hardening | 🔶 6 of 7 items done (2 already done via Phase 1, protocol negotiation, ACP decision, shell completion) — only checksums/provenance deliberately deferred |
| **3** | Stream and state correctness | ✅ Complete for what's client-achievable — mux-stream client (1/2), cross-scope identity dedupe + coalescing (parts of 3/5), stable pane handles + teardown-leak cleanup (6/7) all done+tested. Remaining pieces of items 3/4/5 need a server-side change or a product decision this session couldn't make unilaterally — scoped and logged as open items, not silently dropped |
| **4** | Multiplexer and input core | ✅ Complete for what's safely buildable — items 2/3/4/5/6/7/8 all fixed+tested. Item 1 (replace parallel key listeners with a full consumable router) deliberately not rewritten — its one demonstrated concrete symptom (the leader/composer double-fire) is fixed via item 2; the general architecture risk is logged as an open item, not silently implied as resolved. Full tmux-style copy mode and terminal-pane scrollback paging also logged as real, separate follow-ups |
| **5** | Terminal resource parity | ✅ Complete — all 6 items done+tested: real raw `terminal attach` incl. the TUI's Ink-suspension takeover, watermark ACKing, xterm-headless embedded rendering, a genuine-product-decision resize authority policy, and a session chooser/kill-confirm/idle-state UI (which also caught and fixed a real runtime bug in `terminals.list()`'s wire contract along the way) — every judgment call logged/reasoned in the open-questions table |
| **6** | Chat, run, and HITL workbenches | ✅ Complete — all 6 items done+tested: critical stage-lifecycle/HITL reducer bug fixed; attachment upload; chat-scoped plan-review/question banners + background-task visibility (incl. a second declared-vs-emitted event bug found and fixed); run stage tree/detail/hooks/verbosity; automation execution fan-out; a global blocked-work/notification queue built with no design precedent to draw on (logged as an open item) |
| **7** | Workspace, SCM, review, and workflow authoring | ✅ Complete — all 6 items done+tested. Items 1/3 (workspace tree, `$EDITOR` handoff) plus items 2/4/5/6 (SCM workbench, schema-driven authoring forms, DAG editing with a real cursor, navigable validation). 11 real bugs found and fixed across the phase, including a dead `if (!result.valid)` branch that could never run because the validate route's 422 body was thrown away, a `HookPhase` the type declared but the schema rejected, and the pre-existing `ChangesPane` diff-navigation sizing bug (open question #25 — fixed, not just flagged). New server capabilities: the `'workspace'` stream scope (added mid-phase, now actually consumed by a live changes pane) and structured `DAGValidationIssue`s |
| **8** | Browser, computer, extensions & administration | ✅ Complete — all 6 items done+tested. Semantic browser/computer inspectors (incl. a new `read-page` route for the accessibility tree, which had no HTTP surface at all); capability-specific inline image rendering with an explicit external-open fallback; consent/grant answering and a visible "the agent can control this desktop right now" boundary; a written and implemented textual widget degradation contract; all twelve administration surfaces as ONE command-backed pane over a declared, registry-checked table; and settings that are editable in place and say when each one takes effect. **9 more real bugs found and fixed**, seven of them response-envelope mismatches that made a command list nothing, always |
| **9** | Performance, accessibility & release closure | ✅ Items 1–5 and 7 complete; item 6 partial. **3 of §6.4's named performance risks were real defects**, all fixed: history hydration bypassed the timeline retention bound entirely; two different text-width algorithms disagreed, so row budgeting and painting used different numbers; and the reducer allocated a new state for every event it does not model, costing a render and a full reconciliation pass each time. 19-case terminal/environment matrix added — which found `LANG=C`/`POSIX`/`ISO-8859-1` being treated as UTF-8-capable. Resource-leak and coverage-threshold suites added; `dagLayout.ts` and `format.ts` had **no tests at all** and now have 54. Coverage 79.9% → 83.8%. **Measured cold start is 417 ms against a 250 ms budget** — a real, logged miss. Migration/downgrade/uninstall tests deliberately unwritten: no released prior version to migrate from |

### Test baseline (this session)

- `@generatorai/cli-core`: 94 → **160 passed** (17 files). New: `auth/__tests__/localBootstrap.test.ts` (13), `commands/__tests__/device.test.ts` (5), `commands/__tests__/workspace.test.ts` (9), `commands/__tests__/review.test.ts` (3), `commands/__tests__/hook.test.ts` (7), `commands/__tests__/chat-send.test.ts` (8), `commands/__tests__/script-run.test.ts` (2), `commands/__tests__/chat-update.test.ts` (3), `commands/__tests__/automation-create.test.ts` (13), `commands/__tests__/workflow-stage.test.ts` (3).
- `@generatorai/client-core`: 137 → **147 passed** (6 files). New wire-contract cases in `api/__tests__/wireContract.test.ts`: `hook wire contract` (2), `review wire contract` (1), `chat attachment wire contract` (1), `chat update wire contract` (1), `automation wire contract (create/update)` (2), `workflow stage/edge wire contract` (2), `agent resolve-preview wire contract` (1).
- `@generatorai/cli`: 40 → **62 passed, 5 skipped, 0 failed** (8 files). The 5 chat-surface tests that previously failed against a live `http://127.0.0.1:3100` now skip cleanly via a reachability probe (see below) instead of failing. New: `companion/__tests__/server.test.ts` (10, incl. 3 real-socket/named-pipe integration tests), `render/__tests__/Renderer.test.ts` (8), `__tests__/session.test.ts` (4), `__tests__/helpers/liveServerProbe.ts`.
- `@generatorai/cli-core`: **580 passed** (18 files) after the registry-contract suite (417) and the second review round's 3 fixes (below) landed.
- `@generatorai/server`: full suite (211 tests, 18 files) re-run clean after the two `apps/server/src/routes/*.ts` fixes below — confirms they didn't disturb existing coverage, including for the same two route files.
- `tsc --noEmit` and `eslint` clean on every touched package (`cli-core`, `client-core`, `cli`, `server`) after every change in this session.

### Adversarial review round (`/code-review --level xhigh` on the full diff above)

All 10 findings verified real and fixed — several were substantially deeper than their one-line description once investigated:

| # | Finding | Fix |
|---|---|---|
| 1 | `chat send --no-stream`/streaming both reported success (exit 0) even when the awaited turn ended in `harness.error` — `isDone` treats it as an ordinary terminal condition, so the promise resolves normally either way | `streamTurn()` now tracks `errored`/`errorMessage` regardless of `silent`; both call sites in `chat.send` set `exitCode: RESULT_FAILED` when the turn actually failed |
| 2 | The companion's NOAUTH frame on a bad nonce was never actually delivered to a socket client — `handleLine` only writes it after `handle()` resolves, but `onAuthFailure()` had already run (and, in the session's earlier fix, deferred a `socket.destroy()`) before that write. **Chasing this properly also surfaced a genuine race in the fix itself**: `setImmediate`/`nextTick`-deferred `destroy()` intermittently dropped the write on a Windows named pipe, and `socket.end()` (no race) only half-closes a connection, so a peer that never itself closes hangs forever waiting for `close`. The actual fix is passing the destroy as `socket.write`'s own completion callback (Node only invokes it once the OS has the data) | [`apps/cli/src/companion/server.ts`](../apps/cli/src/companion/server.ts) — `closeAfterWrite` flag + write-callback-triggered `destroy()`. **Also found and fixed a latent bug in the test itself**: `attacker` had no `data` listener, so the socket stayed in Node's paused mode — once the server started actually sending a payload before closing (this fix), the unread buffered data stalled that socket's own `close` event too. Root-caused via 15+ full-suite reruns after the fix looked complete twice more, both times with a new, more nuanced explanation for a race that measured differently each time — see the file's own comment for the two rejected intermediate fixes and why. |
| 3 | Same defect as #1's mechanism, different angle: `--no-stream`'s `silent` flag only gated `streamTurn`'s own callback, not `streamUntil`'s unconditional generic `stream`-event emit — so `--ndjson --no-stream` still echoed every intermediate token/tool-call frame despite the flag's own doc comment claiming silence | Added a real `silent` option to `streamUntil()` itself (`packages/cli-core/src/commands/_shared.ts`) gating the generic emit and the reconnect/disconnect log lines too, not just the caller's callback |
| 4 | `hook test --config`'s JSON could carry its own `"type"` that silently overrode `--type` inside `config` while the outer body's `type` stayed as `--type` — an internally inconsistent request the executor resolves by trusting `config.type` | Now rejects a `--config` `"type"` that disagrees with `--type` (`VALIDATION`) instead of silently preferring one; matching ones now always land in both places |
| 5 | `automation create --input-mode loop\|batch` was still completely broken after the §5.3 field-name fixes — the server's `CreateAutomationSchema` refuses `loop` mode without non-empty `loopItems` and `batch` mode without `batchDataFormat`+`batchData`, and neither had ever been exposed as a CLI flag at all | Added `--loopItems` (JSON array), `--batchData`, `--batchDataFile` flags with the same required-when-that-mode validation pattern already used for `--schedule`/`--loopVariable` |
| 6 | `--maxConcurrency` (automation create/update) and `--retries` (workflow stage add/update) accepted any positive integer client-side; the server caps both at 10, so valid-looking input still 400'd raw instead of getting the same clean `CliError.usage` treatment applied elsewhere in this exact diff | Added `.max(10)` to all four schemas, updated flag descriptions to state the cap |
| 7 | `device invite`'s "requested flags are ignored" warning was conditional (only shown when `--scopes`/`--ttl` were actually passed) on the bootstrap-file path but unconditional on the admin-token recovery path — plain `generatorai device invite` on a lost-device machine warned about flags nobody set | Recovery path now uses the same `flags.scopes \|\| flags.ttl !== 10` condition as the bootstrap-file path |
| 8 | `serveStdio` discarded the `abortAll` cleanup `createConnectionHandler` returns, unlike `serveSocket`'s `socket.on('close', abortAll)` — ordinary stdio teardown (parent closed stdin, SIGINT) never aborted that connection's in-flight requests/timers | `serveStdio` exported with injectable `{input, output}` streams (for testability) and now calls `abortAll()` on `rl`'s `close` event |
| 9 | `localBootstrap.ts`'s `isLoopbackOrigin` reimplemented a loopback check that already exists, more carefully (IPv4 octet-range validation, bare-host/`host:port` support, long-form `::1`), as `isLoopbackHost` in `packages/shared/src/utils/hostMatcher.ts` — a third independent definition of "is it safe to send this secret here" that could quietly drift from the other two | `isLoopbackOrigin` now delegates to `isLoopbackHost`; all 13 existing tests still pass unchanged, confirming behavioral compatibility |
| 10 | The `as never` ESLint ban was scoped only to `packages/cli-core/src/commands`; the identical bug shape (a cast standing in for a type that reflects what a preceding `validate()` middleware already guarantees) existed in `apps/server/src/routes/agents.ts`, `apps/server/src/routes/automations.ts`, and `apps/web/src/hooks/automationQueries.ts` | Fixed all three (each was genuinely unnecessary — the validated body's real shape, once named instead of re-widened to `unknown`/`Record<string,unknown>`, needed no cast at all) and widened the ESLint rule to `apps/server/src/routes/**` and `apps/web/src/hooks/**`, individually re-verifying zero remaining `as never` in both before widening the glob to them |

Two more `as never` casts turned up in `apps/server/src/routes/agents.ts` (import) and `auth.ts` while chasing #10 — both were false positives (a doc comment containing the literal substring "as never" inside other words, e.g. "was never shown"), confirmed by direct inspection, not fixed because there was nothing to fix.

---

## Phase 0 — freeze claims and establish a baseline

Not started this session. Remaining:

1. Mark false-success options/commands `UNSUPPORTED` (`chat send --attach`/per-turn `--model`/`--agent`, `chat send --no-stream`, `run start --name`, `script run --watch`, `terminal attach`, palette required-flag refusal).
2. Snapshot registry/keymap/OpenAPI/route inventory/parity matrix.
3. Add CI jobs: docs-drift check, clean-generation check, exact-bin-build check, targeted coverage report.
4. Record perf baselines (cold start, memory, idle CPU, event throughput, frame timing).
5. ~~Convert audit into tracked issues~~ — this file is that tracking surface; per-item owners are not yet assigned (single-contributor session so far).

## Phase 1 — security and correctness stabilization

### ✅ Done and tested this session

| Item | Fix | Evidence |
| --- | --- | --- |
| **P0 §5.1** — local admin token could be sent to an unverified `ctx.baseUrl`, at a nonexistent route (`/api/auth/devices/invites`) | `device invite`'s bootstrap fallback rewritten: (1) prefers reading the server's self-minted `bootstrap-pairing.json` directly off disk — no token, no network call at all; (2) falls back to the real recovery route (`POST /internal/desktop/pairing`, confirmed against `apps/server/src/routes/internal-desktop.ts`) through a new `requestRecoveryPairing()` that refuses outright unless the target origin is verified loopback, **before** anything is sent | New module [`packages/cli-core/src/auth/localBootstrap.ts`](../packages/cli-core/src/auth/localBootstrap.ts); rewritten handler in [`packages/cli-core/src/commands/device.ts`](../packages/cli-core/src/commands/device.ts#L376); tests: [`auth/__tests__/localBootstrap.test.ts`](../packages/cli-core/src/auth/__tests__/localBootstrap.test.ts) (13 cases incl. non-loopback refusal, token-redaction, 401/network-failure mapping), [`commands/__tests__/device.test.ts`](../packages/cli-core/src/commands/__tests__/device.test.ts) (4 cases incl. remote-baseUrl refusal) |
| **P0 §5.2** — companion socket auth/in-flight state shared across all accepted sockets; bad nonce killed the whole process | Split `createHandler` into `createSharedState` (process-wide: registry, methods, underlying authenticated client) and `createConnectionHandler` (fresh `authenticated`/`inFlight` per accepted socket, called inside `net.createServer`'s per-connection callback); bad-nonce action is now an injected `onAuthFailure` — `socket.destroy()` for the socket transport, `process.exit(77)` only for stdio (which has exactly one peer); socket `close` now aborts that connection's in-flight controllers | [`apps/cli/src/companion/server.ts`](../apps/cli/src/companion/server.ts#L232); tests: [`companion/__tests__/server.test.ts`](../apps/cli/src/companion/__tests__/server.test.ts) (8 cases — 6 unit-level on `createConnectionHandler`, 2 real socket/named-pipe integration tests proving two live connections don't share auth state and a bad nonce only drops the offending socket) |
| **Newly found, not in original audit** — `workspace cat` without `--alias` called `ctx.api.workspaces.fileContent(...)`, a method that **does not exist** on the client (`workspaces` only has `treeFile`); every non-aliased `workspace cat` threw a `TypeError` at runtime. The aliased path also read `.content` from a response whose real field is `.contents` (nullable for binary/oversized files) | Both paths now go through `treeFile` (its `alias` param is optional); `contents === null` now raises a clear `USAGE` error naming binary/too-large instead of silently writing an empty string | [`packages/cli-core/src/commands/workspace.ts`](../packages/cli-core/src/commands/workspace.ts#L183); tests: [`commands/__tests__/workspace.test.ts`](../packages/cli-core/src/commands/__tests__/workspace.test.ts) (4 cases incl. the no-alias path, the aliased `.contents` field, binary rejection, `--out` write) |
| **§5.3** — `review create` sent `{path, body, line, side:'old'\|'new'}` cast `as never`; the real route needs `scopeId`, `startLine`/`endLine`, `side:'additions'\|'deletions'`, and optional checkpoint/anchor fields | Added `--startLine`/`--endLine`/`--anchorText`/`--scope`/`--scopeId`/`--baseCheckpoint`/`--headCheckpoint`/`--intent` flags; `scope`/`scopeId` auto-derive from the workspace's owner when it is a chat, otherwise the command fails explicitly (`USAGE`) rather than guessing — a `stage_run`/`workflow_run`-owned workspace has no safe automatic mapping to a review scope. Removed a second, harmless-but-unnecessary `as never` on `review reply`'s `addComment` call | [`packages/cli-core/src/commands/platform.ts`](../packages/cli-core/src/commands/platform.ts#L711) (`review.create`); tests: [`commands/__tests__/review.test.ts`](../packages/cli-core/src/commands/__tests__/review.test.ts) (3 cases), [`wireContract.test.ts`](../packages/client-core/src/api/__tests__/wireContract.test.ts) (`review wire contract`, 1 case) |
| **§5.3** — `workspace changes`: one-file mode stringified the whole `ChangeFilePatch` wrapper object instead of the patch text; list mode looked for a `.files` field that does not exist (`ChangeSummary` groups files under `.repos[].files`) | One-file mode now returns `patch.patch` (with a warning, not silent truncation, when `patch.truncated`); list mode flattens `repos[].files` and tags each row with its repo `alias` | [`packages/cli-core/src/commands/workspace.ts`](../packages/cli-core/src/commands/workspace.ts#L213); tests: [`commands/__tests__/workspace.test.ts`](../packages/cli-core/src/commands/__tests__/workspace.test.ts) (3 new cases) |
| **§5.3** — `hook test` sent `{phase, payload}`; the route 400s on every call because `type` is required and never sent. Even with `type` added, the executor filters hooks by `.enabled` and loops `attempt <= hook.retries` — an omitted `enabled`/`retries`/`timeoutMs` makes the hook run **zero times** while the route still answers `{success:true}`. `hook list` typed the grouped `{workflowHooks, globalHooks}` response as a bare array | `hooks.test()` now builds a full `HookDefinition` body (`enabled:true`, numeric `retries`/`timeoutMs` defaults, `config.type` set from `--type`); the CLI command forces `exitCode: RESULT_FAILED` when the server reports `success:false` instead of exiting 0 on a failed dry run. `hooks.sessionHooks()` is now typed `SessionHooks`; `hook list` flattens `globalHooks` (full rows) and per-workflow `hookOverrides` (partial rows, tagged so missing fields read as missing, not wrong) | [`packages/client-core/src/api/admin.ts`](../packages/client-core/src/api/admin.ts#L607) (`hooks.test`, `hooks.sessionHooks`, new `SessionHooks` type); [`packages/cli-core/src/commands/platform.ts`](../packages/cli-core/src/commands/platform.ts#L1210) (`hook.test`, `hook.list`); tests: [`commands/__tests__/hook.test.ts`](../packages/cli-core/src/commands/__tests__/hook.test.ts) (5 cases), [`wireContract.test.ts`](../packages/client-core/src/api/__tests__/wireContract.test.ts) (`hook wire contract`, 2 cases) |
| **Foundation** — the error vocabulary had no code for "accepted option/command with no effect", so every prior fix in this row group could only warn-and-succeed or misuse `USAGE` | Added `CliErrorCode: 'UNSUPPORTED'` (exit code 3) and `CliError.unsupported()`, distinct from `USAGE` (caller's mistake) — reserved for "you asked correctly, the CLI just can't do that yet" | [`packages/cli-core/src/errors/CliError.ts`](../packages/cli-core/src/errors/CliError.ts) |
| **§5.4** — `chat send --model`/`--agent` were accepted and warned but the prompt still sent without them (there is no server route for a per-turn override at all) | Both now throw `UNSUPPORTED` before sending anything, with a hint to `chat update` first | [`packages/cli-core/src/commands/chat.ts`](../packages/cli-core/src/commands/chat.ts#L344); tests: [`commands/__tests__/chat-send.test.ts`](../packages/cli-core/src/commands/__tests__/chat-send.test.ts) (2 cases) |
| **§5.4** — `chat send --attach` was accepted, warned "not sent by this command yet", and silently dropped every file | Real implementation: new `chats.sendWithAttachments()` posts multipart (`prompt` + files under `attachments`, matching the server's `multer.array('attachments', 10)`) using Node's native `FormData`/`Blob`; the CLI reads each `--attach` path off disk and fails clearly (not partially) if one cannot be read | [`packages/client-core/src/api/client.ts`](../packages/client-core/src/api/client.ts#L787) (`chats.sendWithAttachments`); [`packages/cli-core/src/commands/chat.ts`](../packages/cli-core/src/commands/chat.ts#L358) (`readAttachments`); tests: [`commands/__tests__/chat-send.test.ts`](../packages/cli-core/src/commands/__tests__/chat-send.test.ts) (2 cases), [`wireContract.test.ts`](../packages/client-core/src/api/__tests__/wireContract.test.ts) (`chat attachment wire contract`, 1 case) |
| **§5.4** — `chat send --no-stream` returned right after the `POST`, before the turn had actually finished — the opposite of its own description ("return once the turn completes") | `streamTurn()` gained a `silent` mode that still waits for the same completion event the streaming path waits for, just prints nothing meanwhile; the command now returns the chat's latest message once the turn is genuinely done | [`packages/cli-core/src/commands/chat.ts`](../packages/cli-core/src/commands/chat.ts#L55) (`streamTurn` `silent` param); tests: [`commands/__tests__/chat-send.test.ts`](../packages/cli-core/src/commands/__tests__/chat-send.test.ts) (1 case) |
| **§5.4** — `run start --name`: confirmed genuinely unsupported (`CreateWorkflowRunSchema` has no `name` field anywhere server-side, and there is no `runs.rename`/`.update` method) | Left as a non-fatal warning (unlike model/agent, an unapplied run name cannot cause the run itself to execute with the wrong configuration) but the flag's own `--help` description now says outright that it has no effect, instead of only a runtime warning | [`packages/cli-core/src/commands/run.ts`](../packages/cli-core/src/commands/run.ts#L298) |
| **§5.4** — `script run --watch` started the run and printed a suggestion to run `run watch` — it never actually watched | Exported `run.ts`'s `watchRun()` and calls it directly; `script run --watch` now subscribes to the run's stream and blocks until terminal, same as `run start --watch` | [`packages/cli-core/src/commands/run.ts`](../packages/cli-core/src/commands/run.ts#L149) (`export watchRun`); [`packages/cli-core/src/commands/platform.ts`](../packages/cli-core/src/commands/platform.ts#L333) (`script.run`); tests: [`commands/__tests__/script-run.test.ts`](../packages/cli-core/src/commands/__tests__/script-run.test.ts) (2 cases) |
| **§5.4** — `terminal attach` emitted `terminal.attach_requested` and returned a success record with `{workspaceId, terminalId}`, but no binary-surface consumer opens the WebSocket or proxies stdin/stdout — the user is told they're attached to nothing | Now fails immediately with `UNSUPPORTED` (before creating any server-side PTY resource) and points at `terminal scrollback` / the TUI / web workbench as working alternatives. Real raw-PTY takeover is Phase 5 scope (WS auth, raw mode, resize, signal handling, guaranteed restoration) — not something to half-implement here | [`packages/cli-core/src/commands/workspace.ts`](../packages/cli-core/src/commands/workspace.ts#L630) (`terminal.attach`); tests: [`commands/__tests__/workspace.test.ts`](../packages/cli-core/src/commands/__tests__/workspace.test.ts) (2 cases, incl. the `isTTY` USAGE case staying `USAGE` not `UNSUPPORTED`) |

### ✅ `as never` ban — done and tested this session

Added `no-restricted-syntax` to [`eslint.config.mjs`](../eslint.config.mjs) banning `TSAsExpression[typeAnnotation.type='TSNeverKeyword']` in `packages/cli-core/src/commands/**/*.ts` (test files exempted; verified the rule both fires on a deliberately-introduced violation and stays silent on legitimate test-fixture casts). Fixing every real `as never` this surfaced — 9 `resolveRef` candidate casts were harmless (removed clean, no compile error), but the remaining ones hid genuinely broken commands, all fixed and covered by new wire-contract tests:

| Command | Real bug the cast was hiding | Evidence |
| --- | --- | --- |
| `chat update --agent` | Flag didn't exist at all — and `chats.update()`'s type was missing `agentRef`, the field `PATCH /chats/:id` actually reads to bind an agent | [`client.ts`](../packages/client-core/src/api/client.ts#L855) (`agentRef` added); [`chat.ts`](../packages/cli-core/src/commands/chat.ts#L446) (`--agent` flag, `'none'` unbinds); this also fixed the `chat send --agent` error hint added earlier today, which had been pointing at a command that couldn't do what it said |
| `automation create` | Sent `workflowDefinitionIds`/`schedule`/`batchFormat`/`errorPolicy`/`enabled` — **none of the real field names** (`workflowIds`/`cronExpression`/`batchDataFormat`/`onError`); `enabled` doesn't exist as a create-time field at all. `--trigger schedule --schedule "..."` created a schedule trigger with **no cron expression**. `--onError` also offered an invalid `'retry'` value the real `AutomationErrorPolicy` doesn't have. `--dataSource` built a `{scriptId}` object with no `type` discriminant, which cannot match any real `DataSourceConfig` variant | [`automation.ts`](../packages/cli-core/src/commands/automation.ts) (`parseDataSourceConfig`, corrected field names, `enable()` called as a follow-up); tests: [`commands/__tests__/automation-create.test.ts`](../packages/cli-core/src/commands/__tests__/automation-create.test.ts) (5 cases) |
| `automation update` | Same `schedule`/`errorPolicy` name bugs | [`automation.ts`](../packages/cli-core/src/commands/automation.ts) |
| `workflow stage add` / `stage update` | Sent `prompt`/`model`/`timeoutSeconds`/`maxRetries` — real fields are `prompts: PromptDefinition[]`, `harnessConfigOverrides.model`, `timeoutMs`, and `retryPolicy.maxRetries`. `updateStage()`'s client method was typed as a bare `Record<string, unknown>`, so this had no compile error at all despite being the same class of bug | [`admin.ts`](../packages/client-core/src/api/admin.ts#L203) (`updateStage` retyped to `Partial<Omit<CreateStageParams,...>>`); [`workflow.ts`](../packages/cli-core/src/commands/workflow.ts) (`stage.add`/`stage.update`) |
| `workflow edge add --condition` | `CreateEdgeParams` has no `condition` field at all — conditional branching is a property of a *stage* (`StageCondition`), not an edge. Removed the flag entirely rather than leave a promise the data model cannot keep | [`workflow.ts`](../packages/cli-core/src/commands/workflow.ts) (`edge.add`) |
| `agent resolve` | Structurally fine field names; the cast only existed because `compact()` widened the always-present required `scope` field to optional | [`platform.ts`](../packages/cli-core/src/commands/platform.ts) (`agent.resolve`) |
| `review submit` | Same `compact()`-widens-a-required-field issue on `threadIds` | [`platform.ts`](../packages/cli-core/src/commands/platform.ts) (`review.submit`) |
| `hook test` `config` field | Genuinely unprovable statically (arbitrary `--config` JSON must satisfy a discriminated union) — replaced `as never` with a named `as HookDefinition['config']`, which the new lint rule allows (it only forbids `never` specifically) | [`platform.ts`](../packages/cli-core/src/commands/platform.ts) |

Tests: [`commands/__tests__/chat-update.test.ts`](../packages/cli-core/src/commands/__tests__/chat-update.test.ts) (3), [`commands/__tests__/automation-create.test.ts`](../packages/cli-core/src/commands/__tests__/automation-create.test.ts) (5), and new `wireContract.test.ts` blocks: `chat update wire contract` (1), `automation wire contract (create/update)` (2), `workflow stage/edge wire contract` (2), `agent resolve-preview wire contract` (1).

### ✅ §5.5 output contract — done and tested this session

- **`--json`/`--yaml` no longer interleave stream frames with the final document.** `Renderer.handleEvent()` previously wrote every live `chunk`/`log`/`stream` event to stdout immediately in `json`/`ndjson` mode, and then `render()` wrote the final envelope on top — a `--json` consumer got several concatenated JSON values, not the one document the mode promises (and `--yaml` mode mixed raw progressive text in with the YAML document via the human-mode switch). `handleEvent()` now no-ops entirely for `json`/`yaml`; the command's own return value is the single source of truth for what gets printed.
- **`--ndjson` frames are now versioned and self-describing.** Every line is now `{v:1, frame:'lifecycle'|'data'|'warning'|'error'|'completion', kind, ...}` instead of the raw internal `CliEvent` dumped as-is with no version and no way to tell "more data coming" from "command is done." `render()` always ends an NDJSON stream with exactly one `completion` frame.
- **Unbounded streams (`chat watch`) now refuse `--json`/`--yaml` outright** instead of hanging with zero output until killed — added `OutputSpec.unbounded` (audit's "reject unbounded watch commands"), set on `chat.watch`, checked in `createContextFor()` before any request goes out. `--ndjson` (designed for unbounded output) is unaffected. `run.watch`/`script run --watch` were checked and confirmed bounded (they poll to a terminal run state), so they were not marked.

Evidence: [`apps/cli/src/render/Renderer.ts`](../apps/cli/src/render/Renderer.ts) (`NdjsonFrame`, `eventToFrame`, `writeFrame`); [`apps/cli/src/session.ts`](../apps/cli/src/session.ts) (`createContextFor` rejection); [`packages/cli-core/src/registry/CommandSpec.ts`](../packages/cli-core/src/registry/CommandSpec.ts) (`OutputSpec.unbounded`); [`packages/cli-core/src/commands/chat.ts`](../packages/cli-core/src/commands/chat.ts) (`chat.watch`). Tests: [`render/__tests__/Renderer.test.ts`](../apps/cli/src/render/__tests__/Renderer.test.ts) (8 cases), [`__tests__/session.test.ts`](../apps/cli/src/__tests__/session.test.ts) (4 cases).

Not done: `--json` on a *bounded* stream command still buffers nothing mid-flight beyond "print the final result" — there is no bounded-operation size cap yet (audit: "buffer bounded operations... reject unbounded"), since every currently-bounded stream command's final `result.data` is already small (a message, a run object). Revisit if a future bounded stream command could return an unbounded amount of data.

### ✅ §5.6 bin/build packaging — done and verified this session (real clean-install, not just code review)

Three separate, compounding defects, each confirmed by actually building, packing, and installing the artifact (not just reading the config):

1. **`build` never produced the declared `bin`.** `dist-bundle` only ever came from the separate `bundle` script; nothing in CI or `turbo build` ran it. Confirmed by grepping every workflow — the entire release pipeline (`release.yml`) only builds/packages **the desktop app** (`electron-builder`), never the CLI. There was no evidence this had ever been packed and installed outside the workspace.
2. **The published `files` list would have shipped the wrong content entirely.** `apps/cli/package.json` had no `files` field, so a real `npm pack` (verified) included the **whole `src/` tree, `tsconfig.tsbuildinfo`, and 114 files total — and, because `dist-bundle/` is gitignored and npm mirrors `.gitignore` by default, EXCLUDED the actual `bin` target.** A package built exactly as configured would have installed with a `bin` pointing at a file that does not exist in the tarball.
3. **`dependencies` was actively broken for a real install, in two directions.** `better-sqlite3`/`node-pty`/`playwright`/`playwright-core` — esbuild's own `EXTERNAL` list, i.e. the packages the bundle genuinely still needs at runtime — were **not listed as dependencies at all**. Meanwhile every `@generatorai/*` workspace package (already fully inlined by the bundle) *was* listed, and since those are never published anywhere, a plain `npm install` of the packed tarball failed outright with `EUNSUPPORTEDPROTOCOL … workspace:*` before even reaching the missing-native-deps problem.

**Fix, each part verified locally end to end (Windows), not just read:**

- Added `files: ["dist-bundle"]` to `apps/cli/package.json`. Re-verified with `npm pack --dry-run`: tarball dropped from 114 files/18.3 MB unpacked to exactly 4 (`README.md`, `package.json`, `dist-bundle/generatorai.mjs`, `dist-bundle/generatorai.mjs.map`).
- Added the four real externals as `dependencies` (versions matched to `apps/desktop/package.json`, which already depends on the same four for the same reason). Moved every `@generatorai/*` workspace package and every other now-bundled-in package (`ink`, `react`, `commander`, `zod`, `pino`, …) to `devDependencies` — needed for this repo's own build/dev/test, not by the published artifact.
- Ran the exact sequence a consumer would: `pnpm --filter @generatorai/cli run bundle` → `pnpm pack` → `npm install <tarball>` into a directory with **no pnpm workspace symlinks** → `node .../dist-bundle/generatorai.mjs --version` and `... system doctor` → also `npx generatorai --version` to exercise the `bin` resolution specifically. All of it passed, including with `--ignore-scripts` (proving `--version`/`system doctor` never touch the native modules' compiled addons, matching `requiresServer: false`).
- Added that same sequence as a new CI step (all 3 OS) in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — `Bundle and smoke-test the packaged CLI`, right after the existing web-bundle-size check.

**Not done / explicitly not decided:** whether this package is ever actually `npm publish`ed (still `private: true`), what its published name would be, whether standalone platform binaries (SEA/pkg/Bun) are wanted instead of an npm-installable Node package, checksums/provenance, or an upgrade path — all genuine product/distribution decisions the audit itself flagged as needing an explicit choice, not something to decide unilaterally while fixing a packaging defect. The fix here makes the npm-package distribution model (the one the code already implies via `EXTERNAL`) actually work; it does not commit to that model being final.

Evidence: [`apps/cli/package.json`](../apps/cli/package.json), [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (`Bundle and smoke-test the packaged CLI`). No new automated test file — the verification was the real pack/install/run sequence performed directly (documented above), plus the new CI job running that same sequence going forward.

### ✅ Table-driven command-contract suite — done and verified this session

[`packages/cli-core/src/commands/__tests__/registryContract.test.ts`](../packages/cli-core/src/commands/__tests__/registryContract.test.ts) (new). Every one of the 208 registered commands, run through a shared `deepStub()` fake `Api` (any property/call resolves permissively) and a real `CliContext`: (1) the command's own Zod schema accepts a minimal input built from its own declared `args`/`flags`, (2) the handler either succeeds or throws a `CliError` — any other thrown value fails the test as a real bug, the exact class this session's hand-driven review found (wrong property path, calling a method that doesn't exist). 417 assertions (208 commands × 2, minus a few `describe`-level ones), first run surfaced **7 real failures**, all triaged to genuine (small) product gaps rather than test-harness noise, and fixed rather than special-cased away:

- **3 commands read a file the caller points a flag/arg at without ever wrapping the read** (`agent.import`, `script.validate`, `workflow.importJson`) — a typo'd path threw a raw Node `ENOENT` that `toCliError`'s fallback reports as `INTERNAL` ("something is broken in the tool"), not `VALIDATION`/`USAGE` ("you gave me a bad path"). Two other commands (`run.ts`'s `loadRunProfile`, `chat.ts`'s `readAttachments`) already wrapped this correctly — the fix generalizes their pattern into a shared `readTextFile()` helper ([`_shared.ts`](../packages/cli-core/src/commands/_shared.ts)) and applies it at every remaining unwrapped call site: `platform.ts` (agent import, script validate), `workflow.ts` (import-json, stage add/update `--prompt-file`), `project.ts` (config upload), `automation.ts` (`--batch-data-file`) — 7 call sites total, not just the 3 the generic test happened to reach.
- **`harness.switch <provider>` had no way to express its enum constraint on the arg** — `CommandFlag` has always had `choices`; the parallel positional-`CommandArg` interface never did, so this command's one arg silently accepted anything until the server 400'd. Added `choices?: readonly string[]` to `CommandArg` ([`CommandSpec.ts`](../packages/cli-core/src/registry/CommandSpec.ts)), set it on `harness.switch`'s `provider` arg, and wired it into shell-completion (`toCompletions.ts`'s positional-arg branch) the same way flag choices already were — this command had never had tab-completion for its one argument.
- **3 URL-typed args/flags** (`connect.add`, `connect.endpoint.add`, `webhook.create`) reject a bare word — correct product behavior, just not something the generic `'placeholder'` string satisfied. Fixed in the test harness only: the generic placeholder is now `'https://example.com'`, which is simultaneously a valid URL and a valid plain string for every other schema that just needs `z.string()`.

Verified: `vitest run` → 417/417 across all 208 commands; `tsc --noEmit` clean on `cli-core`; full `cli-core` suite (577 tests, 18 files) re-run clean; the one existing test that exercises `--batch-data-file` (`automation-create.test.ts`, mutual-exclusivity rejection) confirmed unaffected — it throws before reaching the now-wrapped read.

### ✅ `usage-cli.md` / `docs:check` — done and verified this session

Regenerated via `pnpm --filter @generatorai/cli run docs`; `docs:check` now passes. The diff (18 lines changed) is entirely the accumulated command surface from earlier fixes this session (`chat update --agent`, `automation --loop-items/--batch-data/--batch-data-file`, `run hitl changes-request`, `hook test --type/--config/...`, `review create`'s line-range/checkpoint fields, `config get/show --reveal`, etc.) — nothing new from today's change beyond `device invite --data-dir` and `run hitl approve/reject --follow-up`, which were already-registered commands the doc generator had simply never been re-run against.

### ✅ Chat-surface TUI e2e tests — done this session, by deliberate scope decision

The 5 pre-existing failures (`tui-e2e.test.tsx`'s "TUI · chat surface" — 4 tests, not 5; `chat-probe.test.ts` — the 5th) all share one root cause: they exercise a chat with real pre-existing history and a real model catalog, which only exists on an actual, already-running GeneratorAI server — they are developer probes, not hermetic tests, and were failing in CI with a raw "fetch failed" because nothing is listening at `127.0.0.1:3100` there.

Three fix shapes were weighed (real in-process `apps/server` composition root on an ephemeral port; a lightweight fake HTTP server implementing just the chat endpoints; leaving the gap documented) — **explicitly decided: leave the gap documented, not build new server test infrastructure.** A real ephemeral server was investigated far enough to find it is a real, non-trivial undertaking (nothing in the repo does this today — `apps/cli` has never depended on `apps/server` internals, and `apps/server` exposes no `exports` map for it; the composition root is large, with at least one concrete Windows landmine found — `dbPath: ':memory:'` combined with the *real* `createSecurityContext`, unlike the existing mocked-container test helper, resolves `path.dirname(path.resolve(':memory:'))` for the secrets directory, which is not a safe pattern on Windows and was never exercised by any existing test). Building a fake transport instead would have been the lower-risk option but wasn't chosen either.

What was actually fixed: these tests now **skip cleanly with a real reachability probe** ([`apps/cli/src/__tests__/helpers/liveServerProbe.ts`](../apps/cli/src/__tests__/helpers/liveServerProbe.ts) — a bounded `fetch` to `/api/health`) instead of failing. This is deliberately a reachability check, not an env-var check: a developer with `pnpm dev:server` already running on the default port still gets the full assertions; an unattended CI run reports 5 SKIPPED with a clear reason instead of 5 FAILED that look like a product regression. Verified: full `apps/cli` suite now **62 passed | 5 skipped | 0 failed** (was 62 passed | 5 failed); `tsc --noEmit` and `eslint` clean on both touched test files and the new helper.

**Investigated, not fixed:** the `MaxListenersExceededWarning` ("11 uncaughtException/exit listeners") only reproduces when running the *whole* `apps/cli` suite (not any single file) — confirmed by re-running file-by-file vs. all-together. Traced as far as: `ink`'s own `restoreCursor`/`cli-cursor`/`signal-exit` chain registers real `process.on('exit'|'uncaughtException', …)` listeners guarded by a "already registered" flag that lives in each module's own instance — and Vitest's default per-file module isolation gives every test *file* (not every test) a fresh copy of that module graph while `process` itself stays the one real singleton, so the guard resets per file but the real listener does not get removed. That would explain an accumulation capped near "one or two per test file" (8 files here), consistent with what's observed. This is dependency + test-runner interaction, not application code, and no code in this repo calls `process.on('exit'|'uncaughtException', …)` directly (checked). Left as a documented, understood, cosmetic warning rather than patching a third-party package or globally raising `process.setMaxListeners()` to mask it without being fully sure of the mechanism.

### Second adversarial review round (`/code-review --level high` on the full working-tree diff, run before starting Phase 2)

Run over the *whole* uncommitted working-tree diff, per the user's "thorough review before moving to the next phase" instruction — which meant it also swept a large, unrelated, concurrently-in-flight peer session's changes to `packages/agent-harness-providers` and `packages/core`'s durable-execution/HITL services. Of the 10 most-severe findings reported, **3 were in CLI/TUI Phase 1 code this session actually touched and were fixed+tested here; 7 belong to that other, unrelated workstream and were deliberately left alone** — fixing another session's in-flight work without coordination risks a real conflict, and it is out of this phase's scope regardless.

**Fixed (in scope):**

| # | Finding | Fix |
|---|---|---|
| 1 | `hook.list`'s workflow-scoped-hooks loop rendered `name`/`phase`/`type`/`failurePolicy`/`enabled` as `undefined` for any override that didn't itself set them, even though the adjacent code comment (written earlier this session) already documented that `hookOverrides` is a partial patch whose unset fields live on the global hook — the comment described the fix, the code never implemented it. | [`platform.ts`](../packages/cli-core/src/commands/platform.ts) — look up the matching global hook by id and merge (`override.field ?? base?.field`) for every column. The existing test ([`hook.test.ts`](../packages/cli-core/src/commands/__tests__/hook.test.ts)) had encoded the bug as its expected output (`type: undefined`, etc.) — corrected to the merged values, plus a new case covering an override that *does* set some fields (those win) while others still fall back. |
| 2 | `terminal.attach`'s `CommandSpec` declared `output: { kind: 'stream' }` without the `unbounded: true` flag this session's own earlier fix introduced (and set on `chat watch`) — the `--json`/`--yaml` unbounded-stream guard in `session.ts` keys off exactly that flag, so this command would slip past it. Currently unreachable (the handler always throws `UNSUPPORTED` first — real attach isn't implemented yet), but the flag needs to already be correct for the day that stub is filled in. | [`workspace.ts`](../packages/cli-core/src/commands/workspace.ts) — added `unbounded: true`; new assertion in [`workspace.test.ts`](../packages/cli-core/src/commands/__tests__/workspace.test.ts) pins the full output spec so this can't silently drift back. |
| 3 | `automation create --enabled` captured `created` from the pre-enable `create()` response, then awaited `enable()` but discarded its result — the command's own returned/`--json` record said `enabled: false` for an automation the server had just enabled. | [`automation.ts`](../packages/cli-core/src/commands/automation.ts) — use `enable()`'s response when it succeeds, keep the pre-enable record (with the existing warning) only when `enable()` throws. Two new cases in [`automation-create.test.ts`](../packages/cli-core/src/commands/__tests__/automation-create.test.ts) cover both paths. |

Verified: `tsc --noEmit` clean; full `cli-core` suite **580 passed** (18 files, up from 577); `eslint` clean on every touched file.

**Found, deliberately not fixed — out of this phase's scope, belongs to a concurrent unrelated workstream:** an ACP provider dropped a truncation/max-tokens tool-call safety guard other harness providers still have (`AcpProvider.ts`); a durable-execution iteration-key format change with no migration for already-persisted rows (`DurableExecutionEngine.ts`); two HITL resume/cancel race windows between an in-memory token map and its DB write (`HitlService.ts`); a cancel path that discards already-streamed partial text contrary to its own comment (`AgentHostClient.ts`); an ACP harness config's transport model changed (`address` → `command`) with no migration (`HarnessFactory.ts`); a capability-lookup that wasn't updated for new per-instance provider routing (`MultiHarness.ts`). These are real, verified findings — surfaced here so whoever owns that workstream sees them, not silently dropped, but not actioned by this session.

### 🔶 Not yet done (audit §5.3–§5.7, in priority order)

1. `chat send --model`/`--agent` (turn-level) should switch from `UNSUPPORTED` to actually applying them if a per-turn override route is ever added server-side — the current fix's correctness depends on "no server route at all" staying true. `--agent` at the *chat* level (not per-turn) now works via `chat update --agent`.
2. `StageCondition` (conditional stage execution) has no CLI surface at all yet — `workflow stage add`/`update` don't expose `--condition`, and it isn't clear that should live on `edge add` given the data model (see the `edge add --condition` removal above).
3. Audit likely still has more boundary mismatches outside `packages/cli-core/src/commands` (e.g. inside `apps/cli/src/tui`) that the new ESLint rule does not cover, since it is scoped to `cli-core/src/commands` only. One instance already spotted: `apps/cli/src/session.ts`'s `emit: (event) => session.renderer.handleEvent(event as never)` — not a wire-payload bug (both sides are structurally compatible in practice), but the same syntax the ban forbids inside `cli-core/src/commands`.
4. Checksums/provenance/signing and an explicit npm-vs-standalone-binary decision for real releases (see "not decided" note above) — a product decision, not a defect fix.
5. Sourcemap size: the bundle ships a 9.9 MB `.map` alongside a 6.4 MB `.mjs` — roughly doubles package size. Left as-is (debugging value); worth a deliberate decision if package size becomes a concern.

## Phase 2 — distribution and protocol hardening

Item-by-item status against the audit's §12 list:

| # | Item | State |
|---|---|---|
| 1 | Produce the declared executable in the standard build | ✅ Already done — Phase 1's §5.6 fix |
| 2 | Clean-directory install + smoke tests on all supported OSes | ✅ Already done — same fix, `ci.yml`'s 3-OS matrix |
| 3 | CLI/server protocol negotiation with compatible version ranges and feature flags | ✅ Done this session — see below |
| 4 | Version every machine output frame and companion method schema | ✅ Frames (`{v:1,...}`) done in Phase 1; companion frames already carry `v: PROTOCOL_VERSION`; method descriptors already carry `sinceVersion` — nothing further needed once item 5 was resolved as "don't touch the companion's protocol shape" |
| 5 | Decide whether companion adopts ACP directly or an adapter alongside GeneratorAI RPC | ✅ Decided — **don't build ACP into the companion at all** (see below) |
| 6 | Complete hierarchical shell completion and dynamic ID completion | ✅ Done this session — see below |
| 7 | Publish artifact checksums and provenance in release automation | 🔶 Deliberately deferred — a signing/provenance policy decision, not a defect; low-cost to defer, doesn't block anything else in this phase |

### ✅ Decision: companion does not adopt ACP

Investigated before asking: `apps/server` already has a separate, real, substantial (515-line) ACP-agent bridge — `apps/server/src/acp-entry.ts` (W10) + `apps/server/src/acp/AcpInboundAdapter.ts` — using the actual `@agentclientprotocol/sdk` (already a dependency, already used the OTHER direction by `packages/agent-harness-providers/src/providers/acp/AcpProvider.ts`, which drives OTHER agents via ACP as a harness backend). Any ACP-compatible editor can drive GeneratorAI's chat harness TODAY via `pnpm --filter @generatorai/server acp`, with zero companion involvement.

Given that, building ACP support into `apps/cli`'s companion (`apps/cli/src/companion/server.ts`) would duplicate the one slice ACP actually covers (chat/session control) while adding nothing for the other ~200 commands (workflows, automations, review, hooks, browser, computer-use, …) ACP has no vocabulary for at all. **User decision: keep the companion as GeneratorAI's own protocol; harden it instead (items 3/4) rather than build ACP into it.**

### ✅ Item 3 — CLI/server protocol negotiation — done and tested this session

Starting state was worse than "not implemented" — it looked implemented but silently wasn't:

- `/api/auth/server-info` has published `protocolVersion: 2` (`apps/server/src/routes/auth.ts:130`) since this field existed, but the CLI's `probeEndpoint()` read it under fabricated field names (`info.version`, `info.name`) that response has **never** contained — it actually sends `protocolVersion` and `serverName`. So `probe.serverName`/the version were silently `undefined` for every real server, for as long as this code has existed.
- `system version`'s own summary is *"CLI and server versions, and whether they are compatible"* — but with the field-name bug, it always printed `'unknown'` and never actually answered that question. `system doctor` had the same `serverName` bug baked into its `server.reachable` check (always fell back to the literal string `'ok'`).
- There was no version-RANGE concept anywhere, and no feature-flag surfacing — `authentication`/`transports` sub-objects the server already sends were fetched and discarded entirely; nothing client-side ever read them.

Fixed:
- [`ConnectionManager.ts`](../packages/cli-core/src/connection/ConnectionManager.ts) — `probeEndpoint()` reads the real field names; `ProbeResult` gained `protocolVersion: number`, corrected `serverName`, and `capabilities: { authentication, transports }` (previously-discarded data now actually surfaced). Added `SUPPORTED_PROTOCOL_VERSIONS = { min: 2, max: 2 }` and `checkProtocolCompatibility()` — a real range check (`'unknown' | 'compatible' | 'server-too-old' | 'server-ahead'`), not the exact-match-or-nothing pattern the companion's own `PROTOCOL_VERSION` gate already uses. Both ends of the range are `2` today only because `2` is the only value this protocol has ever had — a future bump on either side is a data change here, not new branching logic at every call site.
- [`createCliClient.ts`](../packages/cli-core/src/client/createCliClient.ts) — `selectEndpoint()` (now exported for direct testing) runs the check right alongside the existing host-pinning check: `server-too-old` throws `CliError('VERSION_MISMATCH', ...)` with upgrade guidance, mirroring that same function's existing NOAUTH-on-impersonation pattern; `server-ahead` is non-fatal and surfaced as a new `CliClient.protocolWarning` field for the caller to decide how to show.
- Three callers wired to actually show `protocolWarning` once: [`apps/cli/src/session.ts`](../apps/cli/src/session.ts) (`ctx.emit({type:'log', level:'warn', ...})`, the binary surface), [`apps/cli/src/tui/launch.tsx`](../apps/cli/src/tui/launch.tsx) (a toast, matching the existing `authState` pattern right above it), [`apps/cli/src/companion/server.ts`](../apps/cli/src/companion/server.ts) (`logger.warn`, logged once since `getClient()`'s promise is memoized per connection).
- [`system.ts`](../packages/cli-core/src/commands/system.ts) — `system version` now actually answers its own summary (`compatible: true|false`, `protocolVersion`, a real `serverName`, and a warning when incompatible/ahead); `system doctor` gained a `server.protocol` check.

Verified: `tsc --noEmit` clean on `cli-core` and `cli`; new tests in [`ConnectionManager.test.ts`](../packages/cli-core/src/connection/__tests__/ConnectionManager.test.ts) (7), [`createCliClient.test.ts`](../packages/cli-core/src/client/__tests__/createCliClient.test.ts) (5, using a real temp-dir-backed `ConnectionManager` + stubbed `fetch` — not a mock of the function under test), [`system-version.test.ts`](../packages/cli-core/src/commands/__tests__/system-version.test.ts) (6) — one of which caught a real bug in this same change before it shipped: `system version`'s `compatible` field was computed as `compat === 'compatible' || compat === 'unknown'`, which evaluated to `false` for the "server-ahead" case despite "ahead" being explicitly designed as non-fatal/compatible; fixed to `compat !== 'server-too-old'`. `cli-core` suite: 580 → **598 passed** (21 files). `apps/cli` suite unchanged at 62 passed / 5 skipped / 0 failed. `eslint` clean on every touched file.

### ✅ Item 6 — hierarchical shell completion and dynamic ID completion — done and tested this session

Diagnosed three confirmed bugs in [`toCompletions.ts`](../packages/cli-core/src/registry/toCompletions.ts) before touching anything:

1. **`completeDynamic`'s group/verb-selection branch returned full multi-word paths, not the next word.** For input `"run "` it called `registry.search('run', 30).map(commandPath)`, returning `["run start", "run cancel", …]` — whole paths, useless to a shell completing one word at a time. `registry.search()`'s fuzzy scoring is right for the TUI palette; it's the wrong tool for literal shell completion.
2. **`request.line.trim()` silently destroyed trailing-space information**, making `"run"` (still typing the group name) indistinguishable from `"run "` (group committed, starting the verb) — both produced identical tokens.
3. **bash/zsh/powershell/nushell's static scripts were not hierarchical at all.** `entries()` emitted one flat list of full paths, and bash's own fallback logic meant pressing Tab right after `run ` offered all ~208 full command paths, not just `run`'s own verbs. **fish was the one generator already doing real hierarchical completion** (`__fish_use_subcommand` / `__fish_seen_subcommand_from`) — but had its own bug: a multi-word verb (`stage add`) was emitted as `-a 'stage add'`, and fish's `-a` takes a space-separated list of *independent* candidates, offering "stage" and "add" as siblings at the same level instead of "stage" → (once seen) → "add".

Fixed with one shared primitive, `prefixMap(specs)`: a `prefix → next-words[]` map built once by walking every command's full path word-by-word (`''` → group names, `'run'` → its verbs, `'run hitl'` → its sub-verbs, …). `completeDynamic` now looks a committed prefix up in this map directly (fixing bugs 1 and 2 — a new `splitLine()` helper preserves trailing-whitespace information, used only in this branch so the already-correct resolved-command branch below it is untouched, per instruction). bash/zsh/powershell serialize the same map as a native associative array/hashtable, so completing a group or verb never spawns the CLI process at all — only once the typed prefix walks off the end of the map (a flag, a positional id, …) does the script fall through to `${binary} __complete`. fish's generator now emits one chained `__fish_seen_subcommand_from <words-so-far>` condition per depth instead of joining multi-word verbs into one candidate.

**A real, verified-not-assumed bash gotcha along the way:** bash rejects `arr['']=value` outright with `bad array subscript` — confirmed against a real bash 5.2 interpreter (`declare -A arr; arr[""]="x"` fails) — under every syntax tried (direct assignment, `declare -A arr=([""]=...)`, and a variable holding `""` as the subscript). The root prefix (`''`) is therefore serialized under a sentinel key (`@@ROOT@@`) in bash, zsh, and powershell (powershell's hashtables don't need this, but all three share one convention for consistency). Also caught in review before shipping: zsh's tree-key needed the same quoting as its value — an unquoted `[run hitl]` (a prefix containing a space) would parse as two separate tokens, not one associative-array subscript.

**Nushell: deliberately left as the pre-existing flat list, not fixed.** Nushell's custom-completion functions (`def "nu-complete NAME" [context?]`) can in principle receive the partial command line and could support the same prefix-map lookup, but this repo has no `nu` binary to verify the exact context-argument contract against, and that contract is version-sensitive. Shipping an unverified nushell script that silently breaks on a real install would be worse than the honest, already-working flat list — left as a known, documented gap rather than a guess.

Verified: `tsc --noEmit` clean on `cli-core`. New [`toCompletions.test.ts`](../packages/cli-core/src/registry/__tests__/toCompletions.test.ts) (18 tests) against a small synthetic registry (a 2-word verb sharing a branch with another 2-word verb, plus a 1-word verb in the same group) — covers `prefixMap`'s shape at each depth, `completeDynamic` returning single next-words (not full paths) at each depth including the exact `"run "`-trailing-space case, each shell's generated script containing the expected associative/hashtable entries for the multi-word-verb case, fish's chained conditions (and the absence of the old joined-candidate line), and that the untouched resolved-command branch (flag-value completion via `choices`) still works exactly as before. Full `cli-core` suite: 598 → **616 passed** (22 files, all green). `eslint` clean on both touched files.

**Found, deliberately not fixed (pre-existing, out of scope for this item):** the RESOLVED-command branch of `completeDynamic` (flag-value and positional-arg completion) has the exact same trailing-whitespace-loss bug as bug 2 above — `generatorai chat send --model ` (trailing space, nothing typed yet) is indistinguishable from `generatorai chat send --model` (still typing the flag name itself), so it falls into flag-NAME completion instead of flag-VALUE completion until at least one character of the value is typed. Left untouched per this task's explicit scope (only the group/verb-selection branch and the top-level tokenization); worth a follow-up using the same `splitLine()` helper.

## Phase 3 — stream and state correctness

### ✅ Items 1/2 — shared mux-stream client, replacing `SharedStreamPort` — done and tested this session

Starting state (confirmed via a dedicated research pass before writing anything): every pane subscribed to its own independent HTTP/SSE connection (`createCliClient.ts`'s old `stream.subscribe()`), each with its own `Backoff`/reconnect loop. `SharedStreamPort` (`packages/cli-core/src/client/SharedStreamPort.ts`, since deleted) sat on top and deduped only IDENTICAL `scope:id` pairs — its own doc comment said the real fix ("one connection for ALL scopes") needed server-side protocol support, and `apps/cli/src/tui/store.ts` had carried a literal `TODO(mux-stream-cli-full)` pointing at it.

That server-side protocol already exists and is already live: `apps/web/src/platform/muxStream.ts` is the browser half of a real, working mux protocol (`POST /api/stream/connections`, `POST /api/stream/connections/:id/subs`, `GET /api/stream?c=<id>`, all real routes in `apps/server/src/routes/stream.ts`) — and that file's own comment on the OLDER single-scope endpoint says explicitly: *"Everything below it is the single-scope endpoint, which stays for the CLI, curl and any client that has not moved."* The CLI was simply never migrated. Confirmed the GET side does not need the browser's ticket mechanism either — `handleMultiplexed` (`stream.ts`) accepts the same `req.principal` every other authenticated CLI request already carries; tickets exist only because browser `EventSource` cannot send custom headers.

Built [`packages/client-core/src/stream/MuxStreamClient.ts`](../packages/client-core/src/stream/MuxStreamClient.ts) — a Node-native port of `muxStream.ts`'s design (not a reinvention: it keeps every one of that file's hard-won fixes — resume via a client-owned cursor MAP, cross-scope dedup on the server's global event-row id, reconciliation instead of sequencing so a lost mutation self-heals, filter-union subscriptions) but as an instantiable class (not a module-level singleton — a Node process can reasonably run more than one, e.g. multiple TUI mounts in one test worker, which this repo has hit real `MaxListenersExceededWarning` issues from before) and using `fetch`+`ReadableStream`+`SseParser` (already in `client-core`) instead of a browser `EventSource`. Required adding `@generatorai/client-transport` as a real dependency of `client-core` (for `Backoff`) and widening `client-core`'s `tsconfig.json` `lib` to include `DOM`/`DOM.Iterable` (matching `cli-core`'s and `client-transport`'s own tsconfig — needed for `Response`/`RequestInit` types, harmless to the barrel's "platform-free" intent since it's a type-only addition, not a runtime one).

Wired into [`createCliClient.ts`](../packages/cli-core/src/client/createCliClient.ts): the old per-scope `stream` object and `SharedStreamPort` wrapper are gone; `stream: streamClient` is now one `MuxStreamClient` instance for the whole client. Deliberately still uses `runtime.fetch` directly (not the timeout-bounded `apiFetch`) for the same reason the old code did — a stream connection must not be aborted by `--timeout`. `SharedStreamPort.ts` deleted (dead code once nothing called it) along with its `index.ts` export; `store.ts`'s stale comment/TODO rewritten to describe the real thing.

Verified: `tsc --noEmit` clean on `client-core`, `cli-core`, `cli`. New [`MuxStreamClient.test.ts`](../packages/client-core/src/stream/__tests__/MuxStreamClient.test.ts) (9 tests, against a fake server implementing the real 3-endpoint protocol) — coalesced connection-open for a same-tick subscription burst, correct frame delivery, cross-scope event-id dedup, filter-union + local re-filtering, cursor carried into the POST body on reconnect, `afterSequence` seeding, `gap`-frame handling, clean `disposeAll()`, and no connection opened at all when every subscriber unsubscribes before the coalescing microtask fires. `client-core` suite: 147 → **156 passed**. Full `cli-core` suite (616) and `cli` suite (62 passed/5 skipped at the time) re-run clean after the swap, including the real TUI mount suites (`tui-e2e.test.tsx`, `tui-sweep.test.ts`) — meaningful because those tests actually exercise a pane trying to open a stream against a genuinely unreachable server (`http://127.0.0.1:3100`, nothing listening in this environment) and would surface a crash/hang in the new retry path, not just a mocked unit-test success.

**Honest limit, logged as an open item below:** this was verified against the real, read server-side ROUTE code and a faithful fake-server test double — not against an actually-running GeneratorAI server, because none was available in this environment. The unit tests prove the client's own state machine is correct against the documented protocol; they cannot prove there is no subtle real-world interaction (auth timing, the server's connection cap, restart/reap behavior under load) that only shows up against the live server.

### 🔶 Item 3 — snapshot+cursor hydration and identity dedupe — partially done; the rest needs a server change

Two genuinely separate things were found under this one item, with different outcomes:

- **Cross-scope identity dedupe: done**, as part of `MuxStreamClient` above — the same server-side event id (`e` in the wire frame) delivered under more than one subscribed scope (a chat event also publishes to its session) is now dropped after the first delivery, tested directly. This did not exist AT ALL before this session.
- **Snapshot-to-live-stream dedup (the history/live "seam"): NOT achievable client-side as things stand, and not attempted.** Traced the actual mechanism: `timelineFromHistory()` (`packages/cli-core/src/viewmodels/runTimeline.ts`) deliberately sets `lastSequence: 0` on a history-seeded timeline, with its own comment explaining why — "history carries no stream sequence numbers, and claiming one would make the reducer discard the replayed events that follow." That's the correct, conservative choice given what the server currently returns: `GET /api/chats/:id/messages` (`apps/server/src/routes/chats.ts`) returns a plain paginated list with no "as of stream sequence N" watermark at all, and live-arriving timeline items get a locally-generated id (`itemId()` in `runTimeline.ts`) that has no relationship to a persisted message's real database id — so there is no shared identity OR shared sequence space to dedupe against between "what history returned" and "what just arrived live." `seedTimeline` (`store.ts`) still just concatenates the two with zero dedup, exactly as found. Closing this properly needs a server-side change (either the messages endpoint reporting the sequence it's "as of," or live chat events carrying the persisted message's real id) — not a client-side heuristic. A content-based guess (e.g. "same text, drop it") was considered and rejected: it risks discarding a genuinely different message that happens to share text, which is worse than the current rare, cosmetic, self-resolving-on-reopen duplicate-render.

### 🔶 Item 4 — normalize list cache updates from events — investigated, not built; needs a server feature that does not exist yet

Confirmed poll-only today: `TuiState.data` (the list cache backing chat/run/workflow/etc. list panes) is written only by `loadData()` (`apps/cli/src/tui/App.tsx`), on mount and every `refreshMs` tick. No event ever patches it — `applyEvent`/`applyEvents` only ever touch `state.timelines[paneId]`. A run finishing or a new chat appearing is invisible in a sibling list pane until the next poll.

Investigated whether a `global`-scope subscription could fix this without server changes — it cannot. `global` scope is real and live (`apps/server/src/composition-root.ts`'s `primaryScopeFor`), but grepping every actual publisher (`ChatManagementService`, `AutomationService`, etc.) shows every one of them publishes only to that resource's OWN scope (`chat:<id>`, `run:<id>`, …) — nothing publishes "a chat was created" or "a run's status changed" to `global` today, because the ONLY current publisher to `'__global__'` is `ExtensionManager` (extension lifecycle, unrelated). A list pane has no scope to subscribe to for "the set of things changed" until the resource already exists — which is exactly backwards for "a new chat appeared."

Closing this needs a real, coordinated server-side addition (have `ChatManagementService.createChat()`/deletion, `WorkflowRunService`'s status transitions, `AutomationService`'s trigger/execution lifecycle also publish a lightweight event to `global`) plus the client-side consumption (one `global` subscription at the app level, patching `state.data` incrementally, keeping the poll as the repair path the item's own wording asks for — "retain polling only as repair"). Scoped as a real, ready-to-pick-up backlog item rather than guessed at now; logged in the open-questions table below with this exact design.

### ✅ Item 5 — coalescing — the core piece done and tested; hidden-tab priority and metrics deliberately deferred

Confirmed: zero coalescing existed in the CLI's own event path — `StreamReconciler` applied every single incoming event straight to `applyEvent` (`store.ts`), one `set()` + one store notification per event, so a fast-streaming turn's hundreds of `harness.token` deltas each cost their own render pass. (A real coalescing implementation, `StreamEventRouter`, already exists in `packages/client-core/src/stream/eventRouter.ts` — but it's coupled to a completely different rendering model, the web app's "block" system (`PlanBlock`/`QuestionBlock`/`WidgetBlock`), not the CLI's linear `TimelineItem[]` transcript; adopting it would mean replacing the CLI's whole rendering model, far beyond this item's actual ask, so it was not reused.)

Fixed in [`store.ts`](../apps/cli/src/tui/store.ts): added `applyEvents(paneId, events[])` (folds a whole batch through the reducer in ONE `set()`); `StreamReconciler` now buffers incoming events per pane and flushes once per microtask tick via `queueMicrotask` instead of applying each one synchronously. A same-tick burst now costs exactly one render. Also guards against a real edge case the fix itself could have introduced: if a pane closes between an event being buffered and the flush running, the flush now checks the pane is still `active` before applying — otherwise it would resurrect `timelines[paneId]` immediately after item 7's teardown fix just deleted it.

Verified: new tests in [`apps/cli/src/tui/__tests__/store.test.ts`](../apps/cli/src/tui/__tests__/store.test.ts) (2 tests) — a 3-event same-tick burst produces exactly one store notification with all three folded in order; events buffered for a pane closed before the flush are dropped, not resurrected. Full `cli` suite: 68 → **70 passed**, still 5 skipped/0 failed (11 files).

**Deliberately not built — logged as open items, not defects:**
- **Hidden-tab priority** (deprioritizing/pausing panes not on the visible tab): a real product-behavior decision, not a mechanical fix — pausing a background pane's subscription risks silently missing messages the user expects to see on switching back, and the safer alternative (still receive, just delay applying) has unclear enough benefit over the coalescing already shipped that it needs a product call, not a guess.
- **Metrics/instrumentation** (queue depth, drop counts, latency): no existing convention in this codebase for where such metrics would even surface (no OTel wiring in `apps/cli` today, unlike `apps/server`) — building one anyway, unasked, risks inventing infrastructure nobody will use.

### ✅ Item 7 — pane teardown leak — done and tested this session

Confirmed: `TuiState.timelines`/`selection`/`search` (all keyed by paneId, `apps/cli/src/tui/store.ts`) were never cleaned up when a pane closed — `closeActivePane`/`closeActiveTab` only ever mutated the workbench tree (`closePane`/`closeTab` in `packages/cli-core/src/session/PaneModel.ts`). Pane ids come from an ever-incrementing counter that is never reused (`PaneModel.ts`'s `nextId`), so this was unbounded, permanent growth for the life of the process — one leaked entry per pane ever opened-and-closed in a session, in all three records.

Fixed in [`store.ts`](../apps/cli/src/tui/store.ts): `closeActivePane` captures the focused pane's id BEFORE `closePane` removes it from the tree, and deletes that id from all three records in the same `set()` call. `closeActiveTab` does the same for EVERY leaf in the tab being closed (a tab can hold more than one pane via splits — closing it removes all of them, not just the focused one), via a new small `omitKeys()` helper.

Verified: new [`apps/cli/src/tui/__tests__/store.test.ts`](../apps/cli/src/tui/__tests__/store.test.ts) (4 tests) — closing a split pane cleans up just that pane's entries; closing a tab with a split cleans up every pane in it; closing one pane leaves an unrelated pane's entries untouched; pane ids are confirmed never reused (so the leak could never self-heal by coincidental id reuse).

### ✅ Item 6 — stable pane handles, no focus race — done and tested this session

Confirmed real race in [`open.ts`](../apps/cli/src/tui/open.ts)'s `openEntity`: it opens a placeholder pane (`open(placeholder, 'tab')`), then after an `await opener.build(...)`, calls `open(content, 'replace')` — but `'replace'` mode resolved `tab.focusedPaneId` **at the time the second call ran**, not the id of the pane the first call actually created. If focus changed while `build()` was in flight (including a second Enter-press opening a second placeholder tab — the file's own comment acknowledged this is expected to happen), the fetched content landed on whatever pane was *currently* focused, not its own. The same post-hoc-focus lookup existed for seeding history (`focusedPaneId()`).

Fixed:
- `TuiActions.openPane` (`store.ts`) now returns the id of the pane the content actually landed in, instead of `void` — a stable handle the caller can hold onto across an `await`. Threaded through `App.tsx`'s `open` callback.
- Added an optional `targetPaneId` parameter to `openPane`/`open` for `'replace'` mode, so a caller can target a SPECIFIC pane it already knows about instead of "whichever pane is focused right now" — which every OTHER `'replace'` call site (the `goto.*` keymap actions) still genuinely wants and keeps unchanged (omitting the parameter preserves the old behavior exactly).
- `openEntity` now captures the placeholder's real id from the first `open()` call and passes it explicitly to the second (`open(content, 'replace', paneId)`) and to `seedTimeline`, instead of re-deriving "the focused pane" after the fact. The now-dead `focusedPaneId()` helper was removed.
- Deliberately NOT added: "this chat is already open in a pane, focus it instead of opening a new tab" dedup — related but a distinct UX decision the audit item doesn't ask for here; noted as a candidate follow-up, not built.

Verified: new [`apps/cli/src/tui/__tests__/open.test.ts`](../apps/cli/src/tui/__tests__/open.test.ts) (2 tests) — one drives the exact race (starts opening row A, changes focus to a newly-opened row B's placeholder *before* A's `build()` resolves, then resolves it) and asserts A's content lands on A's own pane while B's placeholder is untouched; the other confirms history seeding survives a focus change the same way.

**Found, not fixed (pre-existing, outside this item's scope):** `packages/cli-core/src/session/__tests__/closePane.test.ts`'s `splitPane(state, { kind: 'runs', title: 'Runs' }, 'vertical')` call has its last two arguments backwards — `splitPane`'s real signature is `(state, direction, content)`, not `(state, content, direction)`. Test files are excluded from this package's `tsc --noEmit` (see its `tsconfig.json`'s `exclude`), so this isn't caught at typecheck time, and the test still passes at runtime because it only asserts pane *counts*, never the actual direction/content values — so the swap is silently inert rather than a failure. Not a product bug (application code never calls `splitPane` with the wrong order), and out of this item's scope to fix.

Combined verification for both items: `tsc --noEmit` clean on `cli-core` and `cli`; full `cli-core` suite unchanged at 616 passed; full `cli` suite **62 → 68 passed**, **5 skipped** (unrelated, pre-existing — no live server available), **0 failed** (10 files, up from 8) — including the full `tui-e2e.test.tsx`/`tui-sweep.test.ts` suites, which exercise real pane open/close/split behavior end to end and would have caught a regression here. `eslint` clean on every touched file (pre-existing, unrelated warnings on `App.tsx`/`store.ts` confirmed via `git diff` to predate this change).

### Third adversarial review round (`/code-review --level high` on the full working-tree diff, run before starting Phase 4)

10 findings reported; 4 in this session's Phase 3 code (`MuxStreamClient.ts`, `toCompletions.ts`), all real and fixed. The other 6 belong to the same concurrent, unrelated peer workstream flagged after the Phase 1 review (PTY-host process split, ACP provider, relay) — logged, not touched, for the same reason as before: fixing another session's in-flight work risks a real conflict and is out of this plan's scope regardless.

**Fixed (in scope):**

| # | Finding | Fix |
|---|---|---|
| 1 | `MuxStreamClient`'s data-frame and control-frame dispatch loops (`handleDataFrame`, `forEachHandler`) called subscriber handlers/callbacks with no isolation — unlike the deleted `SharedStreamPort.ts`, which explicitly protected against exactly this. One pane's handler throwing would propagate out of `readLoop()`'s read loop into its `catch`, tearing down and reconnecting the ONE shared connection for every other pane riding on it. | Both loops now wrap each handler/callback call in try/catch, logging and continuing rather than propagating. New test: a throwing handler doesn't stop a co-resident handler from receiving the same or later events, and doesn't trigger a reconnect. |
| 2 | `scheduleRetry()` had no attempt cap — unlike the deleted single-scope implementation, which gave up after 20 attempts and reported a terminal `onDisconnected`. A process pointed at a permanently unreachable server would retry forever at up to 30s intervals instead of ever reaching a state a caller could act on. | Added the same 20-attempt cap; past it, every scope gets `onDisconnected('giving up after 20 attempts')` and no further timer is scheduled. New test drives this with fake timers and confirms no further `fetch` calls happen after giving up. |
| 3 | (Lower-severity, flagged but not in the top-10) `connect()` could leak a server-side connection record: if every scope unsubscribed while the `POST /connections` was in flight, the function returned without ever attaching to (or otherwise releasing) the connection the server had just created. | Now attaches via `readLoop()` and immediately tears it down in that case — exercising the server's ordinary "client attached, then disappeared" disconnect path (which it already has to handle for every real reconnect/app-close) instead of leaving an untested "created, never attached" record. |
| 4 | (Lower-severity) `subscribe()` threw synchronously when called after `disposeAll()` — reachable via a genuine race (e.g. `StreamReconciler` mid-`reconcile()` while the connection concurrently tears down), and would surface as an uncaught exception in a caller with no reason to wrap the call. | Now logs and returns a harmless no-op disposer instead of throwing. The existing test asserting a throw was updated to assert the no-op instead. |
| 5 | `toCompletions.ts`'s fish generator: `__fish_seen_subcommand_from run hitl` (multiple words passed to ONE call) is OR across its arguments — satisfied the instant "run" alone is typed, not "run then hitl in sequence" as the hierarchical design intended. | Each already-seen word now gets its OWN repeated `-n '__fish_seen_subcommand_from <word>'` condition on the same `complete` call — fish ANDs repeated `-n` conditions, which is the real AND semantics the single-joined-phrase version never had. Fixed for both the verb-chain and the flag-completion lines. Existing test updated to assert the corrected multi-`-n` form and explicitly assert the old joined-phrase form is gone. |
| 6 | `toCompletions.ts`'s bash generator uses `declare -A`/`[[ -v arr[key] ]]`, which need bash 4.2+ — stock macOS ships bash 3.2 (its last GPLv2 release) as the default `/bin/bash`. Sourcing the generated script there fails partway through (`declare: -A: invalid option`) with everything after it, including the tree population, running against a variable that was never actually an array. | The whole hierarchical branch is now gated behind a runtime `if ((BASH_VERSINFO[0] >= 4))` check, with a real (non-hierarchical, flat full-path list) fallback function defined in the `else` branch under the SAME function name, so `complete -F` at the end works regardless of which branch ran. New test asserts the guard, both branches, and that the fallback still contains the full command list. |

Verified: `tsc --noEmit` clean on `client-core` and `cli-core`; `client-core` suite 147 → **158 passed** (2 new tests); `cli-core` suite **617 passed** (1 new test); `cli` suite unchanged at 70 passed/5 skipped/0 failed; `eslint` clean except 3 new, harmless `no-console` warnings on the new error-isolation logging in `MuxStreamClient.ts` (this package has no injected logger to use instead, and the rule is a warning here, not an error, matching how this codebase already treats `no-console` elsewhere).

**Found, deliberately not fixed — out of this phase's scope, belongs to the same concurrent unrelated workstream flagged after Phase 1:** a dropped ACP truncation-guard variant (`AcpProvider.ts` ~line 424, plus a related dropped `'shell-unrestricted'` keyword fallback ~line 190); an ACP provider exit-listener that overwrites a deliberate `shutdown()`'s `'stopped'` state back to `'error'`; a provider-instance-routing id mismatch in `MultiHarness.ts`; a PTY-host adapter (`PtyHostAdapter.ts`) that permanently caches a failed startup promise instead of allowing retry; the server's `composition-root.ts` never calling `.stop()` on the opt-in out-of-process PTY host on shutdown; a WebSocket leak in `apps/relay/src/cell.ts`'s `revoke_device` path; a stale `'fallback'` host-kind badge in `apps/web`'s `TerminalPanel.tsx` for the new out-of-process PTY host; a PowerShell fast-start flag gap in `apps/pty-host/src/PtyHostServer.ts` for extensionless shell paths; and (mentioned but cut for the finding cap) an unawaited orchestrator wave-state write race and an undeclared `tsx` runtime dependency for host-client fork calls — the latter investigated further by the review's own sub-agent and found to be a real but not-yet-reachable gap (the desktop packaging pipeline doesn't currently ship the affected host bundles at all, a more fundamental, separately-tracked gap).

## Phase 4 — multiplexer and input core

A dedicated research pass (before touching anything) mapped all 8 items against the real code first — summary of findings that shaped scope below; each item's own section has the full evidence.

### ✅ Item 2 — resolve the default leader conflict, add leader-specific conflict diagnostics — done and tested this session

Confirmed via direct code reading (not just the research pass's summary, which was re-verified and corrected in one respect — see below): the leader arms through its OWN independent `useKeymap(keymap, ['global'], {'pane.leader': ...}, {isActive: !suspended && !leaderArmed && overlay.kind === 'none'})` registration in `App.tsx`, separate from the main dispatcher. Because Ink does not stop propagation between independent `useInput` registrations, this hook and any OTHER handler bound to the same chord in a DIFFERENT, simultaneously-active context both fire on the same keypress — this is not "shadowing" (`Keymap.lookup`'s normal innermost-first resolution, which correctly picks one), it's parallel, unconditional double-firing, because the leader-arming hook bypasses that resolution entirely by construction.

The shipped default hit this directly: `pane.leader` (`global`) and `composer.charLeft` (`composer`) were BOTH declared at `ctrl+b` in [`Keymap.ts`](../packages/cli-core/src/keymap/Keymap.ts). Pressing it while a chat composer had focus moved the text cursor left AND armed the leader, simultaneously — not "leader unreachable while composing" (the research pass's initial framing), but a genuine double-fire, confirmed by tracing both hooks' actual `isActive`/context-gating logic line by line.

Fixed:
- Changed the default `pane.leader` chord to `alt+l` — not just "any free chord": `ctrl+b` is also tmux's own default prefix (a second, independent collision risk for anyone running this inside real tmux), and every single-letter `ctrl+` chord not already bound in this keymap has its own terminal-level baggage (`ctrl+h`/backspace, `ctrl+i`/tab, `ctrl+m`/enter, `ctrl+q`/`ctrl+s`/flow control, `ctrl+z`/SIGTSTP) that could make it silently fail to reach the app at all on some terminals. `alt+l` is unused anywhere in this keymap, mnemonic (L for Leader), and in a chord family (`alt+`) already proven to parse correctly here (`alt+a/b/d/e/f/r` are existing bindings).
- Added `Keymap.checkLeaderConflicts()`, run inside the existing `index()` validation: any OTHER binding (default or user-remapped) sharing a chord with `pane.leader` (in ANY context, not just `global`) now throws a clear `CliError` at construction time, explaining WHY (the leader arms independently of normal context shadowing) rather than silently reproducing this exact bug for a future rebind. Deliberately narrow — NOT a general "flag every global-vs-context chord reuse" rule: several such reuses in this same keymap are correct, intentional context-overrides through normal `lookup()` (e.g. `ctrl+k` is both `app.palette` (global) and `composer.killLine` (composer) — while composing, `ctrl+k` SHOULD kill text, not open the palette; that's `lookup`'s innermost-first resolution working as designed, not a bug). Only the leader's own chord needs this — it's the one binding that doesn't go through that resolution.
- Found and fixed a related, fully dead config field while in this code: `session.config.tui.leaderKey` (`packages/cli-core/src/config/schema.ts`, defaulted to `'ctrl+b'`) was never read anywhere — the real (and only working) way to remap the leader is the generic `config.keymap['pane.leader']` override already passed to `new Keymap(session.config.keymap)` in `launch.tsx`. A user who discovered and set `tui.leaderKey` (a documented-sounding, plausible field with a "tmux-compatible prefix" comment) would have had zero effect and no error. Removed the dead field rather than wire it up as a second, redundant way to configure the same thing — Zod's default unknown-key-stripping behavior (no `.strict()` anywhere in this schema) means a leftover `leaderKey` in an existing config file degrades to exactly its current (silently ignored) behavior, not a validation error.
- Updated every hard-coded `ctrl+b`-as-leader reference found by grep: [`sequences.test.ts`](../packages/cli-core/src/keymap/__tests__/sequences.test.ts) (one assertion), [`tui-sweep.test.ts`](../apps/cli/src/__tests__/tui-sweep.test.ts) and [`tui-e2e.test.tsx`](../apps/cli/src/__tests__/tui-e2e.test.tsx) (6 direct `KEY.ctrl('b')` presses across the leader/pane test suite) — the latter two now read the real chord from `DEFAULT_KEYMAP`/a new `KEY.alt()` helper instead of a second hard-coded literal, so a future leader rebind can't silently desync the tests from the app again the same way it apparently never had to before (nothing previously exercised a mismatch, because nothing had ever changed the leader before).

Verified: `tsc --noEmit` clean on `cli-core` and `cli`. New tests in [`Keymap.test.ts`](../packages/cli-core/src/keymap/__tests__/Keymap.test.ts) (4 new, in a `leader conflicts` block) — the default doesn't collide (regression pin), rebinding the leader onto an in-use chord is rejected, rebinding another action onto the leader's chord is rejected, a binding set with no leader at all doesn't crash. `cli-core` suite: 617 → **621 passed**. Full `cli` suite: unchanged at 70 passed/5 skipped/0 failed, including all 5 leader/pane tests in `tui-e2e.test.tsx` (now driven by the new default) and the full `tui-sweep.test.ts` binding-by-binding sweep (which drives ALL leader-context bindings through the real chord). `eslint` clean on every touched file.

**Found, not fixed (pre-existing, unrelated to this fix, flagged for the record):** `.github/docs/apps.md` and `.github/docs/usage-cli.md` both describe a completely different, defunct TUI design in their TUI sections (a "5 views: Dashboard/Chats/Workflows/Runs/Settings" model with `1`-`5` view-jump keys and `Esc`/`Ctrl+B` for "back") that predates this whole architecture rewrite and doesn't correspond to anything in the current keymap (`g`-prefix navigation, leader-based pane ops, etc.) at all — not something this specific fix introduced or made worse, but real, currently-live documentation actively describing the wrong TUI. Rewriting it properly is a real doc-writing task (documenting the actual current keymap in full), out of scope for a leader-key fix specifically — logged as an open item below.

### 🔶 Item 1 — replace parallel key listeners with a consumable input router — NOT attempted as a full rewrite; the one confirmed concrete symptom is fixed, the rest is scoped and logged, not built

Confirmed real: 11 independent `useInput`/`useKeys`/`useKeymap` registrations exist across `apps/cli/src/tui/App.tsx` and `packages/tui-kit/src/{input.tsx,overlays.tsx}`, each guarding itself with its own locally-computed `isActive`/`textInputActive` boolean rather than going through one arbiter with explicit consume-vs-pass-through semantics — genuinely "parallel listeners," not a router, matching the audit's own description. A full replacement (one central dispatcher, every candidate handler returning whether it consumed the keypress, the router trying the next candidate only if not) would mean rewriting how EVERY interactive `tui-kit` component (`TextInput`, `Composer`, `Select`, `Confirm`, `SearchInput`, all four overlay types) receives input — a genuinely large, high-blast-radius change: getting consume semantics wrong risks breaking text entry, overlay dismissal, or general navigation across the entire TUI, and there is no way to verify such a rewrite is fully correct without exercising every interactive surface by hand (the existing `tui-sweep.test.ts` checks frame integrity, not per-key semantic correctness across every mode).

Given that, this pass did NOT attempt the full router rewrite. What IS real and fixed: the leader/composer double-fire above was the one CONCRETE, demonstrated instance of "parallel listeners" actually causing a wrong outcome (not just an architectural smell) — fixing it via a chord change + narrow conflict validation (item 2, above) closes that specific case without needing the router. The general risk remains: any FUTURE hard-coded chord in `input.tsx`/`overlays.tsx` that happens to match a `global`/`leader` keymap chord would double-fire the same way, silently, with nothing to catch it (the new `checkLeaderConflicts()` only knows about bindings declared IN the keymap table — `input.tsx`'s emacs-style chords are hard-coded switch statements that happen to also have matching cosmetic entries in `Keymap.ts` for documentation/help-overlay purposes, e.g. `composer.charLeft`, but the keymap entries don't drive the actual behavior and nothing enforces that a NEW hard-coded chord gets a matching declared entry at all).

### ✅ Item 3 — measured pane rectangles and geometric focus — done and tested this session

Confirmed: `PaneModel.ts`'s `cyclePane` moved focus in tree/reading order only, with its own doc comment admitting geometric movement "needs rendered rectangles, which the model does not have." All 4 directional handlers in `App.tsx` (`pane.focusLeft/Right/Up/Down`) collapsed onto the same `prevPane()`/`nextPane()` pair — Left and Up were literally identical, and so were Right and Down. `Split` (`packages/tui-kit/src/layout.tsx`) never called Ink's `measureElement` or anything else that would give focus math real coordinates.

**Deliberately did NOT use Ink's `measureElement`** for this — it turns out to only report `{width, height}`, not position (confirmed by reading its actual implementation, `node.yogaNode?.getComputedWidth()/getComputedHeight()`); recovering absolute x/y would mean reaching into the Yoga node's parent chain, an internal API even `measureElement` itself only half-exposes, and would need a real Ink render pass to exist at all (unusable before the first layout, and awkward in a headless test harness). Instead, added [`computeRects`](../packages/cli-core/src/session/PaneModel.ts) — a pure function that MIRRORS `Split`'s own layout math (a fixed percentage of one axis for the first child, the rest for the second, same `0.15`/`0.85` clamp) directly against the `PaneNode` tree. `Split`'s layout is a deterministic function of (direction, ratio, container size) with no content-dependent sizing at the pane-rectangle level, so this is exact, not an approximation — and it works from the very first render, with no "wait for a layout pass" step, and is fully unit-testable with no renderer involved at all.

Added `focusDirectional(state, direction, containerWidth, containerHeight)` — standard nearest-neighbor window navigation (filter to panes on the correct side by center point, then rank by primary-axis distance with cross-axis misalignment weighted higher) — wired to all 4 directional handlers in `App.tsx`, replacing the `prevPane()`/`nextPane()` collapse. Uses the raw terminal `columns`/`rows` (not the exact pane-tree sub-region, which isn't in scope where the handlers are defined) — correct because every pane's rectangle scales by the same factor either way, so relative positions (all nearest-neighbor selection needs) come out identical. Two distinct "nothing to do" cases handled differently, on purpose: no usable rectangles at all (single pane, or a zero/negative container size — i.e. before the terminal has reported a real one) falls back to `cyclePane`'s reading-order move; rectangles exist but nothing is actually positioned in the pressed direction (already leftmost, pressing left) is a no-op, matching tmux/vim window navigation rather than wrapping or substituting some other pane.

Verified: `tsc --noEmit` clean on `cli-core` and `cli`. New tests in [`PaneModel.test.ts`](../packages/cli-core/src/session/__tests__/PaneModel.test.ts) (9 new, split across `computeRects` and `focusDirectional` blocks) — `computeRects` matches `Split`'s stacked-vs-side-by-side math exactly and clamps an out-of-range ratio the same way; simple 2-pane horizontal and vertical splits agree with reading order (the common case); a 2x2 grid case explicitly PROVES the geometric math does something reading order gets wrong (pressing right from the top-left pane correctly reaches the top-right pane, while `cyclePane`'s reading-order `next` would incorrectly land on the bottom-left one — asserted side by side in the same test); single-pane no-op; degenerate-container fallback to reading order. `cli-core` suite: 621 → **628 passed**. Full `cli` suite (including `tui-e2e.test.tsx`/`tui-sweep.test.ts`, which exercise real pane navigation end to end) reran clean throughout. `eslint` clean on every touched file.

A real, mounted-TUI geometric test (open a 2x2 grid in a real Ink render, press a directional key, assert the correct pane's focus border) was considered but not added — the `PaneModel`-level tests already prove the underlying math is correct and are the more important coverage; a mounted version would mainly be testing that `App.tsx`'s wiring (a single, small, already-typechecked change) passes the right arguments through, which is lower-value given the unit coverage that already exists.

### ✅ Item 8 — `--inline` flag and a real screen-reader/reduced-motion profile — done and tested this session

Confirmed gaps: no `--inline` flag existed anywhere (`tui`'s only option was `--restore`; `launchTui` hard-required a TTY and unconditionally called `enterAlternateScreen`). Screen-reader capability was detected (`TerminalCapabilities.screenReader`/`.reducedMotion`) and passed through to Ink's own `isScreenReaderEnabled` render option (genuinely engaged, not ignored), but nothing at the APPLICATION level branched on it beyond that pass-through — `packages/tui-kit/src/data.tsx`'s `Spinner` had a comment claiming "CI logs and screen readers both get a static marker instead," but its actual animate-gate never read `screenReader` at all, so the comment overstated the code; `reducedMotion` had zero consumers anywhere.

Fixed:
- **`--inline`** ([`launch.tsx`](../apps/cli/src/tui/launch.tsx), [`index.tsx`](../apps/cli/src/index.tsx)): a new `LaunchOptions.inline` flag skips the `enterAlternateScreen`/`leaveAlternateScreen` calls entirely, so the first frame and everything after it lands in normal scrollback instead of the alt-screen buffer. Wired to a new `--inline` option on both the `tui` subcommand and the bare/`-i` launch path. Deliberate scope decision: `--inline` changes ONLY which screen buffer the frames land in — the app still requires a real interactive terminal (stdin *and* stdout) to function, matching the existing `isTTY` check unchanged. A fully headless "render with no terminal at all" mode is a materially different, much bigger feature (no way to receive keyboard input to react to) that the audit item's own one-line wording doesn't ask for; `--inline` serves its two named audiences (a screen reader, which handles sequential scrollback far better than in-place full-screen redraws, and a real terminal session being captured to a log/recording, where alt-screen escape codes are noise) without attempting that separate problem.
- **Screen-reader/reduced-motion profile** ([`theme.tsx`](../packages/tui-kit/src/theme.tsx), [`data.tsx`](../packages/tui-kit/src/data.tsx)): `Theme` now carries `screenReader`/`reducedMotion` (from the `TerminalCapabilities` `ThemeProvider` already receives — no new plumbing needed, just reading fields nothing previously read). `Spinner`'s animate-gate now actually checks both, matching its own comment for the first time. A second, independently meaningful fix in the same class: `ProgressBar` rendered a repeated fill/empty glyph bar (`###....`) even for a screen reader — twenty repeated "hash"/"dot" characters read aloud as pure noise. It now renders the plain percentage (`"42%"`) instead when `screenReader` is set — the same information, spoken once, actually useful rather than just quieter.
- `reducedMotion` already defaults `true` under CI/non-TTY (`TerminalCapabilities.ts`'s existing logic, unrelated to this fix) — wiring it into `Spinner` means the "CI logs" half of that component's own comment is now also actually true, not just claimed.

Verified: `tsc --noEmit` clean on `cli-core`, `cli`, and `tui-kit`. New tests: [`tui-e2e.test.tsx`](../apps/cli/src/__tests__/tui-e2e.test.tsx) (1 — `--inline` produces no `[?1049h`/`[?1049l` in the raw output while the workbench still renders real content; the existing "enters the alternate screen" test is the unchanged regression guard for the default path); [`components.test.tsx`](../packages/tui-kit/src/__tests__/components.test.tsx) (5 — `ProgressBar` renders a plain percentage under `screenReader` and not otherwise; `Spinner` renders the static marker under `screenReader`, under `reducedMotion` alone, and the normal animating glyph under neither). `cli` suite: 70 → **71 passed** (5 skipped, 0 failed, unchanged). `tui-kit` suite: 82 → **88 passed**. `eslint` clean on every touched file.

### ✅ Item 4 — pane resize, tab reorder, tab navigator, last-tab, tab-strip overflow — done and tested this session

Five confirmed gaps, all real and all fixed:

- **No pane resize.** `PaneNode`'s split `ratio` had exactly one writer (`splitPane`, hard-coded to `0.5`) and no keymap binding to change an existing one.
- **No tab reorder.** `addTab`/`closeTab`/`selectTab`/`cycleTab` were the entire API — nothing moved a tab's position in the array.
- **No tab navigator.** Only sequential `pane.nextTab`/`pane.prevTab` existed; no jump-by-number/name overlay.
- **No "last tab" toggle** (tmux's `last-window`) — `WorkbenchState` had nothing tracking which tab was active before the current one.
- **Tab-strip overflow could hide the active tab with zero indication.** `Tabs` (`packages/tui-kit/src/layout.tsx`) always filled visible tabs from index 0 forward with a trailing `+N` — if the active tab didn't fit from the front, it rendered completely off-screen, indistinguishable from any other hidden tab.

Fixed, all in [`PaneModel.ts`](../packages/cli-core/src/session/PaneModel.ts) unless noted:

- **`resizeSplit(state, 'grow' | 'shrink')`** — finds the NEAREST split ancestor of the focused pane (not some outer one further up the tree — matches tmux's own `resize-pane` scope) via a new `findNearestSplit`, and nudges its ratio by a fixed step, clamped to the same `0.15`/`0.85` range `computeRects`/`Split` already clamp to. New leader bindings `pane.growSplit`/`pane.shrinkSplit`. **Not** bound to `+`/`-`: `Keymap.ts`'s own `normalise()` treats a literal hyphen as the `ctrl-k`-style modifier separator (`.replace(/-/g, '+')` before splitting on `+`), so a bare `-` chord collapses to the same empty key as a bare `+` — the two would have collided with EACH OTHER. Caught by the existing `new Keymap()` conflict-detection test firing immediately on the first attempt; rebound to `}`/`{` instead.
- **`moveTab(state, delta)`** — reorders the ACTIVE tab one position earlier/later; a no-op past either end (reordering does not wrap, unlike `cycleTab`'s focus movement). New leader bindings `pane.moveTabLeft`/`pane.moveTabRight` (`<`/`>`).
- **Tab navigator** — a real searchable/numbered overlay ([`overlays.tsx`](../apps/cli/src/tui/overlays.tsx)'s new `TabNavigator`, modeled directly on the existing `CommandPalette`): lists every open tab with its number and running-state glyph, filters by typing, jumps straight to a 1-9 digit without needing Enter, marks the current tab. New `OverlayKind: 'tabs'` variant, new leader binding `pane.tabNavigator` (`t`).
- **Last-tab toggle** — `WorkbenchState` gained `previousActiveTabId`, maintained by a new `withActiveTab` helper used everywhere `activeTabId` changes (`addTab`, `selectTab`, `cycleTab`, and `closeTab`'s forced fallback — which deliberately does NOT record the just-closed tab as "previous", since landing on a neighbor was forced by the close, not a real switch). `toggleLastTab(state)` swaps to it — `withActiveTab` recording the OUTGOING tab every time means two presses ping-pong back and forth rather than a one-way jump. New leader binding `pane.lastTab` (`` ` ``  — not `l`, already `pane.focusRight`'s alternate).
- **Tab-strip overflow** ([`layout.tsx`](../packages/tui-kit/src/layout.tsx)'s `Tabs`) — new `computeVisibleTabWindow`: tries filling from index 0 first (unchanged output for the common case, active tab near the front); only when the active tab wouldn't fit from there does it grow a window AROUND the active tab (alternating sides) instead, with a leading AND trailing `+N` count so hidden tabs on both sides are distinguishable from each other.

Verified: `tsc --noEmit` clean on `cli-core`, `tui-kit`, `cli`. New tests: [`PaneModel.test.ts`](../packages/cli-core/src/session/__tests__/PaneModel.test.ts) (9 — resize no-ops on a single pane, grows/shrinks correctly whether the focused pane is `first` or `second`, clamps at both ends, resizes the nearest split not an outer one; move-tab reorders and no-ops at both boundaries; last-tab pings back and forth and tolerates the previous tab having been closed), [`components.test.tsx`](../packages/tui-kit/src/__tests__/components.test.tsx) (3 — active tab stays visible when it wouldn't fit from the front, the common case is unchanged, both leading+trailing `+N` counts appear when the active tab is in the middle), [`store.test.ts`](../apps/cli/src/tui/__tests__/store.test.ts) (3 — the new store actions wire through to the right `PaneModel` functions), and 4 REAL mounted-TUI tests in [`tui-e2e.test.tsx`](../apps/cli/src/__tests__/tui-e2e.test.tsx) driving the actual leader chords end to end (navigator opens/lists/digit-jumps, last-tab round-trips, move-tab reorders, resize doesn't corrupt the frame). `cli-core` suite: 628 → **641 passed**. `cli` suite: 71 → **78 passed** (5 skipped, 0 failed) — including the full `tui-sweep.test.ts` binding-by-binding sweep, which now also drives every new binding through a real render without corrupting a frame. `eslint` clean on every touched file.

### ✅ Item 5 — split geometry persistence with responsive restore constraints — done and tested this session

Confirmed: `serialise`/`deserialise` deliberately discarded the split tree entirely — `version: 1`'s own doc comment argued that replaying exact ratios into a resized terminal could leave a pane a few columns wide, so it always flattened to content and `deserialise` always re-split `'vertical'` at a flat `0.5`, regardless of the ORIGINAL direction/ratio, with no way to tell at restore time whether the real geometry would actually have been a problem or not.

Fixed in [`PaneModel.ts`](../packages/cli-core/src/session/PaneModel.ts):

- New `SerialisedWorkbenchV2` (`version: 2`) persists the REAL tree — a `SerialisedPaneNode` mirroring `PaneNode` (direction + ratio per split), plus `focusedLeafIndex` (a position in `leaves()` traversal order, since pane ids are minted fresh on every restore and can't identify which leaf was focused across a save/restore round trip). `SerialisedWorkbenchV1` is kept, unmodified, as its own type — `SerialisedWorkbench` is now `V1 | V2`.
- **Responsive restore constraint** (the item's own wording) — new `violatesMinimumPaneSize`, which mirrors `computeRects`'s exact layout math (same rounding, same ratio clamp) against a NEW `width`x`height`, recursively, asking exactly the question the real renderer will face rather than an approximation of it. `deserialise` now takes an optional `viewport: {columns, rows}` (the CURRENT terminal size, plumbed from `launch.tsx`'s `session.capabilities`) and decides PER TAB: real geometry restores exactly when the viewport is known and safe; a `version: 1` file, no known viewport at all, or a `version: 2` tree that would violate the minimum in the CURRENT terminal all fall back to the original flatten-and-resplit-evenly path (`restoreFlat`, extracted from the old `deserialise` body) — never a partially-cramped exact restore.
- The `version: 1` restore path is untouched in behavior (verified by a new backward-compatibility test against a literal hand-written `version: 1` object) — including its original quirk of landing focus on the LAST pane added, which `restoreFlat`'s explicit `focusedIndex` parameter now reproduces deliberately rather than by accident.

Verified: `tsc --noEmit` clean. New tests in [`PaneModel.test.ts`](../packages/cli-core/src/session/__tests__/PaneModel.test.ts) (5 — real geometry restores with a large-enough viewport; the correct pane (by position) stays focused after a real-geometry restore; a lopsided split that's fine wide but would violate the minimum in a narrow viewport falls back to even per-tab, verified with the SAME saved data restored into both a wide and a narrow viewport side by side; an old `version: 1` object still restores, focus-quirk included; the pre-existing "no viewport known" test's name/comment updated to state precisely which case it now exercises). `launch.tsx` updated to pass the real terminal size on restore. `cli-core` suite counted together with item 4's above (**641 passed** total, up from 621 before either item).

### ✅ Item 6 — close / detach / attach / terminate — done and tested this session

Confirmed: `pane.close` only ever removed local UI state — for a terminal/browser pane, this silently orphaned the live PTY/browser session server-side, since neither `terminal.kill` nor `browser.stop` ever got called. `pane.detach` only cleared `PaneContent.attachment` (the chat/run SSE subscription) — a no-op for terminal/browser panes, which track their resource via `content.state.terminalId`/`state.url` instead, despite being a generic leader binding that implied it worked everywhere. A real server-side `browser.stop` command existed with nothing bound to it — no user-reachable way to stop a browser session from the TUI at all. `terminal.attach`'s keymap description ("Attach (raw mode)") also overstated what its handler does (`refreshTerminal` — a scrollback re-fetch, not a raw stdin/stdout takeover; the real raw-attach *command* unconditionally throws `UNSUPPORTED`) — the exact class of bug this whole audit exists to catch, left alone behaviorally (raw attach is explicitly out of scope here) but with its label corrected to match reality.

Fixed in [`App.tsx`](../apps/cli/src/tui/App.tsx):

- **`pane.close`** now asks, for a terminal pane with a live `terminalId` or any browser pane bound to a workspace, whether to ALSO terminate the resource — reusing this app's own existing confirm-before-a-real-server-effect convention (`run.cancel`) rather than a passive toast, so the user gets an actual choice at the moment it matters. "No"/Escape still closes the pane (matching `Confirm`'s own "n / Esc cancel" wording as "cancel the OPTIONAL part," the same reading `run.cancel` already relies on) — the question is only whether to terminate, never whether to close. The decision logic is a new pure, exported `decideClosePane(content)` (not a `useCallback` closure), specifically so it's unit-testable without mounting the TUI — terminal/browser panes need real server-populated local state to test the OLD way, which a live server in this environment can't provide.
- **`pane.detach`** is now explicit rather than silently inert for terminal/browser panes: it still works exactly as before for chat/run panes with a real `attachment`, and now says outright ("Detach only applies to chat/run panes...") for terminal/browser panes instead of quietly doing nothing — because there genuinely isn't an equivalent to detach FROM for those (their connection to the resource is periodic polling/explicit refresh, never a subscription, and clearing their local state would just make the pane forget which resource it was showing with no reattach mechanism to get it back).
- **`browser.stop`** — new keymap binding (`browser` context, `k`) and handler, confirm-gated, mirroring `terminal.kill`'s existing pattern. Distinct from `pane.close`'s new terminate-on-close: this stops the session while KEEPING the pane open.
- [`Keymap.ts`](../packages/cli-core/src/keymap/Keymap.ts): `terminal.attach`'s description corrected from "Attach (raw mode)" to "Refresh scrollback."

**Deliberate asymmetry, logged, not fixed:** `app.back`'s (Escape) fallback close path still calls `closeActivePane()` directly, bypassing the new confirm — Escape is a frequently-mashed, incidental "navigate back" gesture (it only closes a pane when there's nowhere else to go back to), and gating it behind a confirm dialog would make basic navigation naggy. `pane.close` (leader `x`), the deliberate, explicit close action, is the one that asks. This means Escape can still silently orphan a terminal/browser resource in a way `pane.close` no longer does — a real, intentional trade-off, not an oversight.

Verified: `tsc --noEmit` clean on `cli-core`/`cli`. New [`App.decideClosePane.test.ts`](../apps/cli/src/tui/__tests__/App.decideClosePane.test.ts) (5 tests) — closes outright for chat/run/no-content; asks-and-terminates for a terminal pane with a live `terminalId`; closes outright for a terminal pane with no terminal created yet; asks-and-stops for a browser pane bound to a workspace; closes outright for a browser pane with no workspace (defensive, "should not happen" case). `cli` suite counted together with item 7 below.

### ✅ Item 7 — real in-transcript search and an "unseen output" tab indicator — done and tested this session; full copy mode deliberately not attempted

Confirmed: `pane.scrollMode` was a single-shot scroll-by-5 increment, not a mode (no cursor, no selection, no yank). `app.search` (`/`) filters LIST rows (dashboard/list panes) — it does not search text inside a chat/terminal transcript, a genuinely different operation. No "unseen output" indicator existed anywhere; `TabItem.badge` (`packages/tui-kit/src/layout.tsx`) existed unused — `App.tsx` only ever set `tone: 'running'` for any pane with a live subscription, focused or not, which answers "is this tab connected," not "did something new arrive while I wasn't looking."

**Full tmux-style copy mode (cursor + text selection + terminal clipboard yank) was explicitly out of scope and not attempted** — a real selection model over rendered text plus clipboard integration is its own, separately-sized feature.

Fixed:

- **Real in-transcript search** — new `chat.search` binding (`chat` context, `alt+s` — not `/`, which would never fire anyway while composing: `chat` nests under `composer`, and `useKeymap`'s own text-input guard skips any bare/printable chord there so it can be typed as message text instead; a modifier chord is required, matching why `chat.stop`/`chat.clear`/`chat.toggleThinking` are already modifier-based). New pure, exported [`findTranscriptMatch(items, query, afterScrollBack)`](../apps/cli/src/tui/panes.tsx) does a case-insensitive substring search and returns the `scrollBack` value that brings a match into view — walking strictly OLDER than the current position first (so repeated searches step backward through matches one at a time), wrapping to the newest match once it runs out of older ones, the same "keep going, then wrap" convention terminal/editor search already uses. **Terminal-pane search was scoped out, not built**: unlike a chat pane, a terminal pane has no scroll-offset concept at all today — `TerminalPane` always renders the fixed last N lines of `state.scrollback` — so "jump a match into view" has nowhere to jump TO without first building real terminal scrollback paging, which is its own separate piece of work (logged below).
- **Unseen-output tab indicicator** — new `unseen: Record<string, true>` in [`store.ts`](../apps/cli/src/tui/store.ts)'s `TuiState`. `applyEvent`/`applyEvents` mark a pane unseen only when it is genuinely NOT one of the leaves currently painted on screen (checked against the active tab, both sides of a split included, via new `isPaneInActiveTab` — avoids a one-frame flicker on the common case of an event landing on the pane you're actually looking at). New `Pane` (panes.tsx) calls a new `markSeen(paneId)` action on every render with no dependency array — deliberate: `Pane` is only ever invoked for a leaf that's actually on screen, so every render of it is proof this exact pane has just been seen, and it needs to keep proving that on every subsequent render, not just once at mount, or a later event arriving while the pane stayed mounted and visible would never get cleared again. `markSeen` is a genuine no-op (returns the same object reference, no `set()` mutation) once there's nothing left to clear, so the render-triggers-clear-triggers-render loop this could otherwise cause terminates immediately. `App.tsx`'s `tabItems` now populates `TabItem.badge` with the unseen-pane count per tab, alongside the existing `tone: 'running'` tone. Cleaned up alongside `timelines`/`selection`/`search` on pane/tab close (no new leak class).

**Found, not fixed (out of scope for this item, logged as a real follow-up):** terminal-pane scrollback has no paging/scroll-offset mechanism at all — only the fixed tail. Building one (and then wiring `terminal.search` to it) is real, separate, undone work.

Verified: `tsc --noEmit` clean on `cli-core`/`tui-kit`/`cli`. New [`panes.findTranscriptMatch.test.ts`](../apps/cli/src/tui/__tests__/panes.findTranscriptMatch.test.ts) (7 tests — case-insensitivity, no-match, empty/whitespace query, newest-match-by-default, walks to the next older match, wraps around, empty transcript) and 5 new tests in [`store.test.ts`](../apps/cli/src/tui/__tests__/store.test.ts) (marks unseen only when off-screen; does not mark when on-screen; `markSeen` clears it; `markSeen` is a genuine no-op when nothing to clear; close cleans it up). Combined with item 6 above: `cli` suite 78 → **95 passed**, 5 skipped (pre-existing, unrelated), 0 failed (12 files) — including the full `tui-sweep.test.ts` binding-by-binding sweep (which exercises every OTHER leader/context binding too, unaffected) and `tui-e2e.test.tsx`. `eslint` clean on every touched file across all three packages (pre-existing, unrelated warnings in `App.tsx`/`store.ts`/`panes.tsx` confirmed via `git diff` to predate both items' changes).

**Phase 4 is now addressed in full** — 6 of 8 items done and tested (2, 3, 4, 5, 6, 7), item 8 done and tested by a sibling task, item 1 deliberately not rewritten (its one demonstrated concrete symptom is fixed via item 2; the general architecture risk is logged as an open item, not silently implied as resolved).

### Fourth adversarial review round (`/code-review --level high` on the full working-tree diff, run before starting Phase 5)

10 findings reported; 3 in this session's Phase 3/4 code, all real and fixed. The other 7 belong to the same concurrent, unrelated peer workstream flagged after the Phase 1 and Phase 3 reviews (orchestrator wave-state/convergence, ACP provider, PtyHostAdapter, browser-host accessibility snapshots, STT boot gating) — logged, not touched, for the same reason as before.

**Fixed (in scope):**

| # | Finding | Fix |
|---|---|---|
| 1 | `MuxStreamClient.connect()`'s "everyone unsubscribed while the POST was in flight" branch had a comment claiming it would "attach and immediately abort," but nothing actually called `.abort()` on that path — `readLoop(...).then(() => this.teardown())` waits for `readLoop` to SETTLE before tearing down, and nothing inside `readLoop` ever settles on its own (only an external abort makes it resolve). The GET connection this opened stayed open for the rest of the process's life. | `readLoop` now accepts an externally-supplied `AbortController`; `connect()` creates one, passes it in, and calls `.abort()` on it immediately after starting the fetch — genuinely attaching-then-aborting instead of waiting for a settle that would never come. New test drives the exact race (unsubscribe while the POST is in flight) with a signal-aware fake GET that would hang the test forever if the fix regressed — it doesn't. |
| 2 | `isPaneInActiveTab` (`apps/cli/src/tui/store.ts`, Phase 4 item 7's unseen-output indicator) only checked "is this leaf anywhere in the active tab's tree" — true for BOTH sides of a split even when the tab is zoomed or the terminal is narrow enough that `App.tsx`'s `renderNode` collapses the split down to ONE side. A pane hidden by zoom or a narrow breakpoint was wrongly treated as visible, so new output arriving in it never set the indicator. | Added `PaneModel.visibleLeafIds(tab, {showRight, breakpoint})` — a pure function mirroring `App.tsx`'s exact zoom/collapse render logic. `App.tsx` now computes it every render (`useEffect` keyed on `tab`/`rightPaneVisible`/`breakpoint`) and reports it into a new `visiblePaneIds` store field via `setVisiblePaneIds`; `isPaneInActiveTab` consults it when available, falling back to the old coarser tab-membership check only in the narrow window before the first render has reported anything. 5 new `PaneModel.test.ts` cases (wide/zoomed/collapsed/right-hidden/2x2-grid) plus 2 new `store.test.ts` cases (the exact same-tab-different-visibility regression, and the pre-first-render fallback). |
| 3 | `chat update --agent ''` didn't unbind the agent as the flag's OWN help text promises ("`''` or `'none'` unbinds it") — the handler only ever checked for the literal string `'none'`, so an empty string fell through unchanged and was sent to the server as `agentRef: ''` instead of `agentRef: null`. | Handler now treats `''` the same as `'none'`. New test in `chat-update.test.ts` pins it. |

Verified: `tsc --noEmit` clean on `client-core`, `cli-core`, `cli`. `client-core` suite unchanged at 159 passed (1 new test replacing/extending existing coverage). `cli-core` suite 641 → **647 passed** (5 new `PaneModel` tests + 1 new `chat-update` test). `cli` suite 95 → **97 passed**, 5 skipped (pre-existing, unrelated), 0 failed — including the full `tui-sweep.test.ts`/`tui-e2e.test.tsx` suites. `eslint` clean (pre-existing warnings on `App.tsx`/`store.ts`/`MuxStreamClient.ts`'s `console.error` isolation logging confirmed unrelated/predating this round).

**Found, deliberately not fixed — out of this phase's scope, belongs to the same concurrent unrelated workstream flagged twice before:** an orchestrator convergence check that miscounts cancelled/needs_review workers as converged, plus a fire-and-forget wave-state DB write that can lose the crash-durability guarantee it was added for (`OrchestratorService.ts`); a per-instance-routing gap in `resumeConversation()`/`capabilitiesFor()` that resolves the wrong provider adapter (`MultiHarness.ts`, the same class of bug flagged after Phase 1's review); a `PtyHostAdapter` that permanently caches a failed startup promise with no retry; an unbounded accessibility-snapshot recursion in `browser-host` that can produce multi-MB payloads on a DOM-heavy page; a duplicate `harness.cancelled` broadcast race in the ACP provider's abort path; and a `GENERATORAI_STT=0` gate that stops the WebSocket route but not the STT engine's own eager model load at boot.

## Phase 5 — terminal resource parity

Evidence-mapped first (background research agent, before any code): the server-side PTY stack (`apps/server/src/terminal-ws.ts`, `TerminalService.ts`) is fully real already — REST+WS transport, real `node-pty` backend, watermark flow control at two layers, auth via single-use stream tickets, idle reaping. This phase was entirely client-side work, with a working reference implementation to port from for every item except one (item 5, resize authority, which has no design precedent anywhere in the codebase or docs).

### ✅ Items 1/2/4 — real raw `terminal attach`, Ink terminal-suspension takeover, and client-side watermark ACKing — done and tested this session

Previously: `terminal.attach`'s handler in [`workspace.ts`](../packages/cli-core/src/commands/workspace.ts) unconditionally threw `UNSUPPORTED` — nothing proxied stdin/stdout to a PTY anywhere in the binary CLI, and the TUI's own `terminal.attach` keybinding just re-fetched the scrollback buffer (`refreshTerminal`), explicitly commented as "Ink owns the keyboard here, and a raw attach needs the plain binary surface."

Fixed, as one shared piece plus two thin surface-specific wrappers:

- **New shared attach loop** — [`apps/cli/src/terminal/attachLoop.ts`](../apps/cli/src/terminal/attachLoop.ts)'s `attachToTerminal()`. Speaks the exact same wire protocol `apps/web`'s `TerminalPanel` and `apps/mobile`'s `TerminalView` already use against `terminal-ws.ts` (binary frames = raw PTY bytes; JSON control frames = `input`/`resize`/`ack`/`signal`/`kill` out, `ready`/`exit`/`resized`/`error` in). Creates a session if none was given, replays scrollback before going live (ordering matters — live bytes must land after the backlog), opens the WS, puts the given `stdin` into raw mode, forwards every byte typed as `{t:'input'}` except a literal Ctrl+] (`0x1D`, never part of a UTF-8 continuation byte or normal input), which detaches WITHOUT killing the session — matching the command's own long-standing summary text ("Ctrl+] detaches"). ACKs every 64KB of binary output received (matching `apps/web`/`apps/mobile`'s own constant), which is what keeps a long-running build streaming instead of stalling once the server's `HIGH_WATERMARK_BYTES` is crossed (item 4). Restores the terminal's original raw-mode state in every exit path (remote exit, detach, socket error, or an external `AbortSignal` firing) via a single `teardown()`.
- **`CliContext` port** — new `TerminalAttachPort`/`TerminalAttachRequest`/`TerminalAttachOutcome` types in [`CliContext.ts`](../packages/cli-core/src/context/CliContext.ts). `cli-core` still does not import `ws` (unchanged design constraint) — every surface constructing a `CliContext` now supplies a `terminalAttach` implementation: the binary CLI ([`session.ts`](../apps/cli/src/session.ts)) wires a real one using `attachToTerminal` + `process.stdin`/`process.stdout`; the TUI ([`launch.tsx`](../apps/cli/src/tui/launch.tsx)) and the companion RPC server ([`companion/server.ts`](../apps/cli/src/companion/server.ts)) both wire one that refuses cleanly with a clear message, since `terminal.attach` is `inPalette: false, inRpc: false` and neither surface can ever legitimately reach it that way.
- **`terminal.attach` handler** (`workspace.ts`) now resolves the workspace and delegates to `ctx.terminalAttach.attach(...)`, turning a port-reported error into a real `CliError.internal` and an exit/detach outcome into the appropriate success message, instead of throwing `UNSUPPORTED` unconditionally.
- **TUI takeover** (`App.tsx`'s new `attachRawTerminal`) — the terminal pane's `terminal.attach` keybinding now calls `useTerminalSuspension()` (already built and already wired to `$EDITOR` composing, per its own doc comment naming "raw PTY attach" as a design goal) around the same `attachToTerminal`, using the streams Ink hands back (`useStdin`/`useStdout`) and a new `socketUrl` prop threaded from `launch.tsx`'s `client.socketUrl`. `actions.setSuspended(true)`/`(false)` bracket the call — the store's `suspended` flag already gated both of `App.tsx`'s top-level `useKeymap` registrations (`isActive: !suspended`) but had no real caller before this; wiring it here is what stops Ink's own input handling from also reacting to the bytes this function is forwarding to the PTY. Falls back to the passive scrollback view (`refreshTerminal`) once the takeover ends, either way.

Verified: `tsc --noEmit` clean on `cli-core`/`cli`. New [`terminal/__tests__/attachLoop.test.ts`](../apps/cli/src/terminal/__tests__/attachLoop.test.ts) (8 tests, against a hand-rolled fake `ws.WebSocket` — session creation sized to the real terminal, scrollback replay ordering, raw-mode enable/restore across both normal detach and abort, the detach-chord byte split, binary-frame ACKing at the 64KB threshold, exit-frame/error-frame mapping). `workspace.test.ts`'s `terminal attach` suite rewritten for the real handler (5 tests: unreachable from palette/RPC, USAGE without a real terminal, delegates to the port with/without an explicit terminal id, maps a port error to `CliError.internal`). `cli-core` suite 647 → **650 passed**. `cli` suite 97 → **105 passed**, 5 skipped (pre-existing, unrelated), 0 failed — including the full `tui-sweep.test.ts`/`tui-e2e.test.tsx` suites, confirming the new `socketUrl` prop and `suspended` wiring didn't disturb the existing TUI e2e coverage. `eslint` clean on every touched file in both packages.

**Found, deliberately not fixed — a real limitation of this fix, logged as an open item:** raw stdin bytes are forwarded as `chunk.toString('utf8')`; a multi-byte UTF-8 character split exactly across two separate `stdin` `'data'` chunks would corrupt on that one keystroke. Real-world risk is low (typed input and even IME/paste bytes overwhelmingly arrive as complete chunks from the OS), and every existing reference client (`apps/web`, `apps/mobile`) makes the same plain-string assumption at the protocol level, but it is a real, not-fully-eliminated edge case.

### ✅ Item 3 — xterm-headless embedded rendering for the terminal pane — done and tested this session

Previously: `TerminalPane` (`apps/cli/src/tui/panes.tsx`) handed `state.scrollback` — raw PTY output, ANSI escapes and all — straight to `CodeBlock`, a syntax highlighter with zero SGR/cursor-movement interpretation. Any colored `ls`, vim, or htop rendered as literal escape-code garbage. `@xterm/headless` was already a real dependency but had no production consumer anywhere in the repo, only a test-only usage in `tui-e2e.test.tsx` — this was genuinely new implementation work, not a port.

Fixed — new [`apps/cli/src/tui/terminalRender.tsx`](../apps/cli/src/tui/terminalRender.tsx): `useTerminalScreen(text, cols, rows)` feeds text through a fresh headless `Terminal` sized to the pane (a write's completion callback is required since `Terminal.write()` is not guaranteed synchronous), and `bufferToLines()` walks the resulting cell buffer into styled spans — coalescing adjacent same-styled cells into one run so a plain line stays one `<Text>` node rather than one per character. Color/attribute mapping is 1:1, no lookup table: Ink's `<Text color/backgroundColor>` is chalk-backed and accepts `ansi256(n)`/`#rrggbb` directly, and `inverse`/`bold`/`italic`/`dimColor`/`underline`/`strikethrough` all pass straight through to Ink's own props. `TerminalPane` now renders via `TerminalScreen`/`useTerminalScreen` instead of `CodeBlock`, and no longer pre-truncates the scrollback text to a tail before rendering (the old `tail()` helper, removed) — a text-level line-slice on a string full of SGR escapes can discard the very escape that set the visible tail's current color; the headless terminal's own bounded viewport (`rows`) does the truncation correctly instead, the same reason `apps/web`'s real xterm.js is never handed pre-truncated text either.

Verified: `tsc --noEmit` clean on `cli`. New [`tui/__tests__/terminalRender.test.tsx`](../apps/cli/src/tui/__tests__/terminalRender.test.tsx) (13 tests — plain text, blank-line padding, palette/RGB/background color boundaries, bold/italic/dim/underline/inverse/strikethrough, invisible-text-as-blanks, multi-line ordering, viewport tail-tracking on overflow, trailing-styled-run vs. trailing-padding trim, wide-character filler-cell skipping, plus 3 `ink-testing-library` tests for the async write→state→render path, a resize/reattach transition, and the empty-text fallback). `cli` suite 105 → **118 passed**, 5 skipped (pre-existing, unrelated), 0 failed — independently re-confirmed by re-running the full suite myself, not just taking the implementing agent's word for it. `eslint` clean (same pre-existing warnings as baseline, none new).

### ✅ Item 5 — terminal resize authority — done and tested this session (genuine product decision, logged as an open question below)

Previously: `apps/server/src/terminal-ws.ts`'s `case 'resize':` applied ANY connected client's resize unconditionally — confirmed by code, not inferred, that 2+ attached clients on the same session had unarbitrated last-write-wins behavior, with zero owner/primary concept anywhere in the codebase or docs (grepped for "resize authority"/"authoritative"/"primary client" near terminal/PTY code: zero matches).

This is a genuine product decision with no prior design to defer to — implemented with the best defensible default rather than left blocking, per standing instruction, and logged below for sign-off. **Policy implemented: first-attacher-is-owner, ownership transfers to the next-oldest still-attached connection if the owner disconnects.** A non-owner's `resize` message is silently ignored (not an error — a passive viewer's own window resizing locally is a normal, expected event). New `ResizeAuthority` class (`terminal-ws.ts`, right before `attachTerminalWebSocket`) — a pure, in-memory `Map<sessionId, WebSocket[]>` keyed by attach order, `attach()`/`detach()`/`isOwner()`, session entries dropped once empty so a later reattach starts clean. Wired into the existing `handleConnection`/`case 'resize':`/`ws.on('close', ...)` call sites. Deliberately touches nothing else — no `TerminalService`, `TerminalRecord`, wire-protocol (`packages/shared/src/types/Terminal.ts`), or client change: no client needs to be told whether it's the owner for this to work, and the single-attacher case (overwhelmingly the common one) is a true no-op, unchanged from before.

Verified: `tsc --noEmit` clean on `server`. New [`apps/server/src/__tests__/terminal-ws.test.ts`](../apps/server/src/__tests__/terminal-ws.test.ts) — the first test ever written against this file (11 tests: 4 integration tests against a real `http.Server` + real `ws` client sockets on loopback covering the single-attacher regression case, a second attacher's resize being ignored while the owner is connected, ownership transfer on owner disconnect, and a full-detach-then-fresh-reattach starting clean; 7 pure unit tests directly on `ResizeAuthority`). `server` suite 215 → **226 passed** (21 files), 0 failed — independently re-confirmed by re-running the full suite myself. `eslint` clean, 0 new warnings.

### ✅ Item 6 — session chooser, kill confirmation, idle-state display — done and tested this session

Previously: the data plane was fully real server-side (`GET .../terminals` lists sessions; `TerminalService.reapIdle` computes and enforces a 30-minute idle timeout) but had zero UI anywhere in the whole product — not just the TUI. `TerminalPanel.tsx`/`TerminalView.tsx` (web/mobile) always reuse one cached session id or create a new one; neither has a "here are your N running terminals, pick one" screen. Killing a terminal was immediate and unconfirmed everywhere. There was no idle indicator anywhere, only a post-hoc "exited" banner once something had already killed it.

**Found and fixed along the way, before it could ship a broken feature:** `AdminApi.terminals.list()` (`packages/client-core/src/api/admin.ts`) was typed as returning `TerminalRecord[]` directly, but the route (`apps/server/src/routes/terminals.ts`) actually wraps its response as `{ terminals: [...] }` — calling `.list()` and then `.map()`/iterating the "array" would have thrown at runtime (`TypeError`, not a compile error, since `request<T>()` casts the parsed JSON with no runtime validation). Nothing had ever called it to notice; this session's chooser is its first real consumer. The old `TerminalRecord` type was also missing `pid`/`exitCode`/`exitSignal`/`lastActivityAt`/`host` entirely — real fields the route always sends. Fixed: `list()` now unwraps the envelope and returns the real `TerminalSessionDescriptor[]` (from `@generatorai/shared`, the same canonical type every other terminal endpoint already uses). Separately, `ApiClient.terminals.get()`'s `TerminalDescriptor` type was missing `lastActivityAt` too (additive fix, no behavior change for `apps/mobile`'s existing use of the same type).

Fixed, in the TUI:

- **Session chooser** — new `pickTerminal()` (`App.tsx`), bound to a new `l` keybinding (`terminal.list` in the keymap, matching the command id the REST list endpoint is already named after). Fetches the workspace's terminals, shows them through the existing generic `select` overlay (same mechanism `chat.model`/`chat.agent` already use — no new overlay kind needed) labeled with shell + idle state, and switches the pane's PASSIVE view on selection (not an immediate raw takeover — a surprising side effect for what reads as a "look at this one" action; the user can still press the attach key afterward).
- **Kill confirmation** — `terminal.kill`'s handler now shows the same `confirm` overlay pattern `pane.close`'s `closePaneWithTerminationChoice` already established for this exact underlying action, instead of firing immediately.
- **Idle-state display** — new `terminalActivityLabel()` (`panes.tsx`), reusing the app's existing `formatRelative()` convention ("just now"/"5m ago"/"2h ago") rather than inventing a new time format. `refreshTerminal` now fetches the session descriptor alongside the scrollback (only on an explicit user action — attach/create/switch — never a new poll loop) and both the terminal pane's subtitle and the chooser's list rows show it. This is a live indicator, not a countdown/warning toward the server's actual timeout — the timeout value itself isn't exposed at this layer, and building a real "about to be reaped" warning is a bigger, separate piece of work.

Verified: `tsc --noEmit` clean on `cli-core`/`client-core`/`cli`. New [`terminal wire contract`](../packages/client-core/src/api/__tests__/wireContract.test.ts) test pins the envelope-unwrap fix. New [`tui/__tests__/terminalActivityLabel.test.ts`](../apps/cli/src/tui/__tests__/terminalActivityLabel.test.ts) (5 tests — active/just-now/elapsed-via-formatRelative/exited-including-code-0/still-running-despite-a-null-exit-code). `client-core` suite 159 → **160 passed**. `cli-core` suite unchanged at **650 passed** (a `Keymap` binding addition, no test depends on the exact terminal-category binding set). `cli` suite 118 → **123 passed**, 5 skipped (pre-existing, unrelated), 0 failed — including the full `tui-sweep.test.ts` binding-by-binding sweep, which now also drives the new `l` binding and the kill-confirm flow, unaffected. `eslint` clean across all three packages (same pre-existing warnings as every prior baseline in this phase, none new).

**Phase 5 is now complete — all 6 items done and tested.**

## Phase 6 — chat, run, and HITL workbenches

Evidence-mapped first, the same way Phase 5 was: a background research pass read `packages/cli-core/src/viewmodels/runTimeline.ts` (the one reducer both `ChatPane` and `RunPane` render from), `apps/cli/src/tui/store.ts`'s `StreamReconciler`, `App.tsx`'s chat/run keymap handlers, and `packages/shared/src/types/AgentEvent.ts` (the real ~130-kind event union the server actually emits) against `apps/cli/src/tui/panes.tsx`'s actual rendering, before any code changed.

### ✅ Item 1 (critical fix) + part of item 3 — the reducer's HITL/stage-lifecycle event names were never real, plus real context-usage wiring — done and tested this session

**This was the single most load-bearing bug the research pass found, and it was bigger than first reported.** `reduceEvent`'s stage-lifecycle cases switched on `stage.started`/`stage_run.started` (for "a stage began") and `stage.awaiting_input`/`stage.resumed` (for HITL gates) — **confirmed against every real producer in `packages/core/src/services/*.ts` (`StageExecutionService.ts`, `HitlService.ts`) that none of these four kinds has ever been emitted.** The real kinds are `stage_run.running` (a stage actually starting), `stage_run.awaiting_input`, and `stage_run.input_received` — and the awaiting-input case also read the wrong field (`data.stageId`/`data.id`; the real field is `data.stageRunId`). Net effect against a real server, before this fix: **no stage ever visibly "started" in a run pane, the HITL approval banner (`RunPane`'s pending-approval box) could never appear, and `run.approve`/`run.reject` were unreachable dead code** — despite all of that UI being fully built and wired. The exact same bug, in the exact same shape, existed independently in `run.ts`'s `watchRun` (backing the non-interactive `run start --watch`/`run watch`), which never printed a single "▶ stage" progress line or the "waiting for approval" hint against a real run either.

Fixed in [`runTimeline.ts`](../packages/cli-core/src/viewmodels/runTimeline.ts) and [`run.ts`](../packages/cli-core/src/commands/run.ts):
- `stage_run.running` now drives the "stage started" card (the harmless `stage.started` alias is kept only in case an old recording/fixture still carries it — confirmed nothing real still sends it).
- `stage_run.awaiting_input`/`stage_run.input_received` now drive `pendingApproval`, reading the real `stageRunId` field. `stage_run.resumed` — a distinct, real, unrelated event (generic pause/resume) — is deliberately NOT treated as an approval-clearing signal, since conflating the two was part of the original bug's shape.
- Stage completion/failure now match by the stage run's own id (`stageRunId`), not by matching `stageName` text — a real correctness gap on its own: two stage runs (a retry, or two branches of a loop template) can share a name, and text-matching risked marking the wrong one complete.
- `watchRun` gets the identical fix for the identical reason.

Folded into the same fix (item 3): `harness.context_usage` — a real, provider-reported context-window snapshot — was not handled by the reducer at all, so both `ChatPane`'s token count and `RunPane`'s `ContextGauge` only ever showed accumulated usage-delta totals against a **hardcoded 200,000-token ceiling**, which doesn't fall back down after a compaction and isn't the model's real limit. New `TimelineState.contextUsage` field, populated from the real event (sub-agent snapshots — `data.agentId` set — are ignored; no sub-agent gauge exists yet to show them in). Both panes now prefer it when available, falling back to the old accumulated-usage number only when no provider snapshot has arrived. `ContextGauge` ([`packages/tui-kit/src/data.tsx`](../packages/tui-kit/src/data.tsx)) gained an additive `compactionThreshold` prop — colors amber/red against the provider's real auto-compaction point when known, instead of only the raw window edges (a provider compacts well before the raw window fills, so the old coloring could read "safe" green right up to the moment compaction was about to happen). The tone decision itself was pulled into a pure, exported `contextGaugeTone()` specifically so it's unit-testable without needing Ink to actually emit ANSI color (which depends on chalk's own env-detected level, decided once at module load — not something a single test can force after the fact).

Verified: `tsc --noEmit` clean on `cli-core`/`tui-kit`/`cli`. New [`viewmodels/__tests__/runTimeline.test.ts`](../packages/cli-core/src/viewmodels/__tests__/runTimeline.test.ts) (12 tests — real stage_run.running/completed/failed/awaiting_input/input_received shapes, stageRunId-based identity matching across same-named stage runs, stage_run.resumed NOT clearing an approval, the legacy alias not crashing, context-usage recording/sub-agent-filtering/replacement). New [`commands/__tests__/watchRun.test.ts`](../packages/cli-core/src/commands/__tests__/watchRun.test.ts) (6 tests — the first tests `watchRun` has ever had). 2 new tests in `tui-kit`'s `components.test.tsx` for `contextGaugeTone`. `cli-core` suite 650 → **668 passed**. `tui-kit` suite 93 → **95 passed**. `cli` suite unchanged at **123 passed**, 5 skipped, 0 failed (no dedicated new TUI test needed — the reducer-level tests fully cover the fixed logic the panes consume; the full `tui-sweep.test.ts`/`tui-e2e.test.tsx` suites re-ran clean, confirming no regression). `eslint` clean across all three packages (one pre-existing, unrelated `no-control-regex` directive warning in `components.test.tsx`, confirmed via `git diff` to predate this session's edits to that file, same as every other "pre-existing" note in this tracker).

### ✅ Item 4 — run stage tree, stage detail, hooks, variables, and per-run verbosity — done and tested this session

Previously: two keymap ids were registered with zero implementation anywhere — `run.stageDetail` (key `s`) and `run.verbosity` (key `v`) were dead keys, confirmed via a repo-wide grep turning up only their own declarations. `RunPane` was a flat timeline with no stage tree, no hook visibility, no variable inspector, and no way to reduce noise per pane.

Fixed:
- **Stage tree + stage detail, as one overlay** — a new `stageDetail` overlay kind (`store.ts`) fetches the run's stages (`ctx.api.runs.stages`) and variables once on open; the stage list IS the tree (status-colored, navigable), and selecting a row shows its detail (timing, retry count, error, steps) inline below, rather than inventing a second permanently-visible region inside `RunPane` for what reads as one connected concept.
- **Hooks** — new `hook.started`/`hook.completed`/`hook.failed` reducer cases in `runTimeline.ts`, verified against the real producer (`packages/core/src/services/HookExecutor.ts:149-181`) rather than assumed from `AgentEvent.ts`'s type names alone — and a good thing: hooks are correlated to the whole run (`workflowRunId`) only, with **no `stageRunId`/`stageId` at all** on the real event, contradicting what the type union's placement might suggest. Shown run-wide, not per-stage.
- **Steps** — new `stage_run.step_started`/`.step_completed` reducer cases, verified against `StageExecutionService.ts:1312-1321,1513-1516`, correctly scoped by `stageRunId` + step index (not "the first running step of any stage").
- **Variables** — folded into the stage-detail overlay (`JsonView`, reusing the same component `InspectorPane` already uses) rather than a separate keybinding, since the plan never registered one and the run's variables are naturally shown alongside its stage state.
- **Per-run verbosity** (`run.verbosity`, key `v`) — implemented per-PANE (not per-run-definition), stored in a new `store.ts` `verbosity: Record<paneId, level>` field: absent means "today's exact behavior," so a pane that never presses `v` — and every non-run pane — is byte-for-byte unaffected. Cycling it threads through to `reduceEvent`'s existing `showThinking`/`showTools`/`minimal` options.
- **Reviewed and tightened before merging**: the new step/hook reducer cases did not originally respect `showTools`/verbosity at all — always rendering regardless of the pane's level, which would have undercut the entire point of adding a verbosity control to begin with. Added the same `if (options.showTools === false) return base;` guard `harness.tool_start`/`.tool_complete` already use, to both the start AND completion sides of each new case, with a new test pinning that "minimal" verbosity actually suppresses step/hook noise (and that a completion for something suppressed at start stays a safe no-op).

Verified: `tsc --noEmit` clean on `cli-core`/`cli`. New tests: 8 in `runTimeline.test.ts` for steps/hooks (+1 more from this session's own tightening pass — 21 total in that file now), [`nextVerbosity.test.ts`](../apps/cli/src/tui/__tests__/nextVerbosity.test.ts) (2), 5 new cases in `store.test.ts` for per-pane verbosity. `cli-core` suite 668 → **677 passed**. `cli` suite 123 → **130 passed**, 5 skipped, 0 failed — including the full `tui-sweep.test.ts`/`tui-e2e.test.tsx` suites, independently re-run and confirmed by the parent session (not just taking the implementing pass's word for it). `eslint` clean, 0 new warnings on either package.

### Open questions logged from item 4 (no design precedent existed; implemented with best judgment)

- **Stage-tree layout**: no precedent existed for how a stage-tree-plus-detail view should be laid out in a fixed-width terminal pane. Implemented as a single on-demand overlay (list + inline detail) rather than a permanently-visible second region inside `RunPane`, to leave that pane's existing flat-timeline layout (its own real value — a chronological event log) untouched. A permanent split-pane stage tree is a real, separate, larger layout change if wanted later.
- **Verbosity scope and persistence**: no prior per-pane preference concept existed in this codebase. Implemented as pane-scoped, in-memory, lost on close — matching every other pane-keyed ephemeral setting already in `store.ts` (`selection`, `search`). A persisted-across-sessions default would be new scope beyond what the audit item asks.

### ✅ Item 6 — automation execution fan-out and nested run navigation — done and tested this session

Previously: the automation pane was `kind: 'inspector'` — a static `JsonView` dump of `api.automations.get(id)` with no live `attachment` at all, so it never subscribed to any stream. No execution list, no fan-out view, no way to navigate from an execution into the workflow run it spawned.

**A significant architecture finding changed the implementation from what was initially assumed, the same discipline as item 1/4's producer-verification work**: `AgentEvent.ts` declares `automation_execution.iteration_started`/`.iteration_completed`/`.iteration_failed`, each carrying a `workflowRunId` — but grepping every real emitter in `packages/core/src/services/AutomationService.ts` turns up **zero producers of any of the three**; they are not handled in the reducer, since handling a kind that never arrives would be dead code pretending otherwise. More consequentially: tracing the actual delivery path (`apps/server/src/composition-root.ts`'s `bridgeEvent`) showed automation execution events are republished to `scope: 'automation', id: <executionId>` — **keyed by the execution's own id, not the automation's id** — so there is no automation-wide live stream scope to attach a pane to at all, only a per-execution one. The only reliable source of which workflow run(s) an execution spawned is the REST route backing `automation.execution.show` (`AutomationService.getExecutionWithRuns`, returning `{...execution, runs: [{workflowRunId, ...}]}`), not the event stream.

Fixed, adapted to that real constraint:
- New `AutomationPane` (`panes.tsx`): a live execution list (REST snapshot via `ctx.api.automations.executions(id)`, sorted newest-first) plus a live log for whichever execution is still `running`/`pending` at open time — the one execution that actually has a real scope to attach to. Older/finished executions are REST-snapshot only; this is a direct, load-bearing consequence of the scope finding above, not an arbitrary limitation.
- `open.ts`'s automation opener rebuilt around this: fetches executions, computes the live-attachable one (if any), and opens a real `kind: 'automation'` pane instead of the old static inspector dump.
- New keymap context `'automation'` with 4 real bindings (`automation.nextExecution`/`.prevExecution` to navigate the list, `automation.openRun` to jump into the spawned workflow run — 0 runs toasts, 1 opens directly, >1 shows a picker — and `automation.cancelExecution`, reusing the runner's existing destructive-command confirm gate rather than adding a second one).
- `StreamPort.subscribe`'s scope union and `PaneModel`'s `attachment.scope` type both widened to include `'automation'` (a real, if narrow, type-safety gap: the scope existed and worked at the wire level already, just wasn't a type-checkable value anywhere in `cli-core`).
- Found and fixed the same class of client-type/wire-contract gap Phase 5 item 6 found for `terminals.list()`: `AdminApi.automations.execution()` was typed as a bare `Record<string, unknown>`, hiding the real `runs`/`workflowRunId` fields the route actually returns — retyped to the real `AutomationExecutionWithRuns`.
- 7 new reducer cases (`automation_execution.started`/`.progress`/`.completed`/`.failed`/`.cancelled`/`.recovered`/`.iteration_retried`) — every field verified against its real producer (`AutomationService.ts`/`AutomationRecoveryService.ts`, the latter being where `.recovered` actually lives — a second file, not the one the kind name would suggest).

Verified: `tsc --noEmit` clean on `cli-core`/`client-core`/`cli` (independently re-run, not just taking the implementing pass's word for it). New/updated tests: 5 more automation_execution cases in `runTimeline.test.ts` (26 total now), new [`automationOpener.test.ts`](../apps/cli/src/tui/__tests__/automationOpener.test.ts) (6 tests). `cli-core` 677 → **682 passed**. `client-core` unchanged at **160 passed** (a type-only fix — no behavior to newly test). `cli` 130 → **136 passed**, 5 skipped, 0 failed — including the full `tui-sweep.test.ts` binding sweep, which now also drives the 4 new automation bindings. `eslint` clean across all three packages, 0 new warnings.

### ✅ Item 2 (attachment upload) + item 3 remainder (chat-scoped HITL questions/plan-review, background-task visibility) — done and tested this session

Previously: no way to attach a file to a chat message from the TUI at all (the `chat.send --attach` command path was real and tested, but nothing in the composer exposed it); `chat.plan.*`/`chat.question.*` events (a distinct HITL subsystem from the workflow-stage gate already wired in item 1 — `AgentInteractionService`, whose gates block an in-memory SDK callback and so *expire* rather than *resume* on a restart) were not consumed by any TUI code at all; background-task lifecycle events (`OrchestratorService.ts`'s worker-chat spawn/status/completion) were invisible in the parent chat pane.

Fixed:
- `/attach <path>` slash command in the composer queues a path (validated with `fs.access` for fast feedback; `chat.send --attach`'s own `readAttachments` still does the real read/validation at send time) into `pendingAttachments` pane state; the next non-slash send threads it through as `chat.send`'s existing `flags.attach` and clears it. No second upload mechanism — reuses the one path `chat.send --attach` already validates and sends through.
- `runTimeline.ts`: new `PendingChatInteraction`/`PendingQuestion`/`PendingQuestionOption` types and a `TimelineState.pendingInteraction` field, with 8 new reducer cases for `chat.plan.review_requested`/`.decided`/`.expired` and `chat.question.asked`/`.answered`/`.expired`, plus 4 for `chat.background_task.spawned`/`.status`/`.completed`/`.failed`. Every field verified against the real emitters (`ChatManagementService.ts`'s `buildPlanReviewHandler`/`announceQuestionGate`/`answerQuestion`, and the expiry path in `createCoreServices.ts`; `OrchestratorService.ts` for the background-task family) — not assumed from `AgentEvent.ts`'s declared shapes.
- **A real gap found in review and fixed before merging, the same class of bug as item 1's**: `chat.background_task.failed` is declared in `AgentEvent.ts` but has **zero real producers anywhere in `packages/core`** (confirmed by grep) — a worker failure instead arrives as `chat.background_task.completed` with `data.status === 'failed'` (`OrchestratorService.ts`, the `sendPrompt(...).catch()` at the spawn site sets `record.status = 'failed'`, which is only actually emitted once the idle-wait resolves and reads it back as `finalStatus`). The merged reducer's `.completed` case rendered every completion as a plain "completed" info notice regardless of status, making a failed background task visually indistinguishable from a successful one. Fixed: `.completed` now branches on `data.status`, rendering `'failed'` as an error card (red, `level: 'error'`) with the same "Background task failed: …" text the (dead, but harmless, kept defensively) `.failed` case already used. New regression test added.
- `ChatPane` (`panes.tsx`) now shows a warning-bordered banner for a pending plan review or question — same visual treatment as `RunPane`'s existing stage-approval box — with `viewport` height budget adjusted to reserve room for it.
- New `chat.respond` keybinding (`alt+g`, context `chat`) → `App.tsx`'s `respondToChatGate()`: a plan review reuses the existing binary `chat.plan --approve/--reject[--note]` command (the server defaults an omitted `action` to the plan's own `recommendedAction`, so nothing is lost the CLI's own command doesn't already forgo); a clarifying-question gate is answered directly via `api.chats.respond()` (no command wraps it — same pattern `pickModel` already uses for `api.copilot.models()`), asking multiple questions sequentially, palette-style, one overlay at a time.
- Background-task events render as inline `notice`/`error` timeline cards (the same treatment stage/hook/step/automation events already get), not toasts — the reducer is pure and has no toast-triggering mechanism.

Verified: `tsc --noEmit` clean on `cli-core`/`cli` (independently re-run). `cli-core` 682 → 694 (fork) → **695 passed** (my added regression test for the `.completed`/`status:'failed'` fix). `cli` unchanged at **136 passed**, 5 skipped, 0 failed — including the full `tui-sweep.test.ts` binding sweep, which now also drives `chat.respond` without crashing. `eslint` clean on both packages, 0 new warnings (confirmed the one flagged `panes.tsx:973` `theme` unused-var warning is pre-existing, in the unrelated `BrowserPane`, not touched by this work).

**Real, documented gap, not fixed — logged below:** no dedicated test asserts the `/attach` → `flags.attach` threading itself arrives correctly (`submitComposer` isn't exported, and `tui-e2e.test.tsx` has no mocked `api.chats.sendWithAttachments` to assert against); it's covered only by typecheck + the crash-safety sweep test, not a targeted assertion. The reducer-level logic for every other sub-feature here is fully unit-tested; this one piece of glue code is not.

### Open questions logged from items 2/3 (no design precedent existed, or a real test-coverage gap; implemented/left with best judgment)

- **Multi-select question answering**: `AgentQuestion.multiSelect` is real, but no existing overlay in this codebase collects a multi-pick answer. Answered as a single choice via the existing single-select `select` overlay — honest (not silently wrong), and unblocks the far more common single-select/freeform shape now; a genuine multi-pick overlay is separate, undone work.
- **`/attach` has no dedicated test for the flag-threading path itself** (see above) — the reducer/UI-decision logic around it is tested, but the actual "does the queued path arrive in `chat.send`'s `flags.attach`" wiring is only covered by typecheck + the crash-safety sweep, not a targeted assertion. Left as-is rather than building new e2e mock infrastructure (`tui-e2e.test.tsx` has no mocked `api.chats` today) for one command's flag-plumbing; worth adding if `/attach` sees real use and regresses silently.

### ✅ Item 5 — global blocked-work/notification queue — done and tested this session

No design precedent existed anywhere in this codebase, or in `apps/web`, for aggregating pending HITL gates across panes/tabs — the audit's own wording ("Add a global blocked-work/notification queue") is a one-line spec. Rather than invent a new interaction shape, this was built as a thin aggregation over state that already exists (`TimelineState.pendingApproval`/`.pendingInteraction`, both real since item 1/3), reusing the exact UX pattern `pane.tabNavigator` (leader `t`, Phase 4 item 4) already proved: a filtered list, Enter jumps.

Implemented:
- `blockedWorkItems(workbench, timelines)` (`store.ts`) — a pure scan over every open pane in every tab (not just the active one), returning one entry per pane with a non-null `pendingApproval` or `pendingInteraction`, each with a human summary line. Deliberately excludes background-task events and plain errors: those already surface inline in their own pane and don't block anything — this queue is specifically "work waiting on you," not "everything that happened."
- New store action `jumpToPane(paneId)` — finds whichever tab contains the pane (searching every tab, not just the active one, unlike `focusPaneDirection`), switches to it via the existing `selectTab`, then focuses that exact pane within it via `PaneModel.focusPane`. Composing the two in that order matters: `focusPane` only ever looks at the already-active tab, so calling it before `selectTab` would silently no-op. (Side effect: this also uses the `focusPane` import in `store.ts` that had sat unused since before this session, clearing a pre-existing lint warning.)
- New `NotificationQueue` overlay (`overlays.tsx`, `kind: 'notifications'`), bound to `pane.notifications` (leader `b` — the one free key in that context table). Lists every blocked pane (`{tab} → {pane} — {summary}`); Enter calls `jumpToPane` and closes. Deliberately does NOT answer the gate itself from inside the overlay — once jumped to, the pane's own existing `chat.respond`/`run.approve` handling resolves it, keeping exactly one code path that actually resolves a gate rather than two.
- Tab strip: a tab containing any blocked pane now renders `tone: 'warning'` (taking priority over the existing `tone: 'running'`) — the passive, always-visible half of "notification queue," so a blocked gate is noticeable without opening the overlay at all. Subscribed via a joined-string primitive selector (`blockedPaneIdsKey`), not a direct `timelines` subscription — `timelines` gets a new object identity on every single streamed token in any pane, which would have re-rendered the whole app shell per-token; a string primitive compares by value under `useSyncExternalStore`'s equality check, so the shell only actually re-renders when the blocked *set* changes, not on every token. `unseenCount`'s existing `unseen`-object subscription does not have this problem since it only changes when a pane's seen-state flips, not continuously.

Verified: `tsc --noEmit` clean on `cli-core`/`cli`. New tests: 6 in `store.test.ts`'s new `blockedWorkItems + jumpToPane` describe block (empty case, stage-approval gate, plan-review gate, gate clearing, cross-tab jump, no-op on an unknown pane id). `cli-core` unchanged at **695 passed** (a `Keymap.ts`-only addition, already covered by the existing conflict-detection suite). `cli` 136 → **142 passed**, 5 skipped, 0 failed — including the full `tui-sweep.test.ts` binding sweep, which now also drives `leader b` without corrupting a frame. `eslint` clean on both packages — 6 warnings on `cli` (down from 7: the stale `focusPane` unused-import warning is now gone), all pre-existing baseline.

**Phase 6 is now fully done — all 6 items implemented and tested.**

### Open question logged from item 5 (no design precedent existed anywhere; implemented with best judgment)

- **Scope of the queue**: only workflow-stage approvals and chat-scoped plan/question gates are treated as "blocked work" — background-task failures, plain errors, and any other notice-level timeline item are deliberately excluded, even though they're also things a user might want a cross-pane view of. A broader "everything that happened across every pane while I wasn't looking" feed is a different, larger feature (closer to a notification history/log than a blocked-work queue) and wasn't what the audit's wording asked for.
- **No overlay-side "respond directly"**: the queue only jumps to the blocked pane; it does not let you approve/answer from inside the overlay itself. Keeps exactly one code path resolving each gate type (the existing per-pane keybindings) rather than a second, parallel resolution path to keep in sync — a `respond-from-the-list` shortcut is a real, separate enhancement if the extra keystroke to jump first proves annoying in practice.

## Phase 7 — workspace, SCM, review, and workflow authoring

An Explore pass mapped what already exists against the audit's 6 items before any implementation, the same discipline used for every prior phase (the audit is known to be stale) — full inventory in the agent transcript; findings folded into the items below as they're closed out.

### ✅ Three concrete bugs found by the evidence-mapping pass — fixed and tested this session

All three were found by reading the real handler code, not by testing against a live server (none is available in this environment) — each is a genuine defect that would reproduce against any real deployment.

1. **The `workspaces` opener always showed "No changes," regardless of a workspace's actual state.** `open.ts`'s `workspaces` opener parsed `api.workspaces.changes()`'s response as if it might be a bare array with a top-level `files` — the real response (`ChangeSummary`, `client.ts:423-428`) is never either of those; every file is one level down, grouped by repo/worktree alias (`.repos[].files`). `files` was therefore always `[]`. Fixed by flattening `repos` the same way `workspace.changes`'s own CLI handler already did (`workspace.ts:263-269`) — the TUI opener had just never gotten the equivalent fix. New test: [`workspacesOpener.test.ts`](../apps/cli/src/tui/__tests__/workspacesOpener.test.ts) (3 tests).
2. **`diff.comment` (the `c` binding in a changes/diff pane) threw a validation error on every single use.** It called `review.create` without `startLine`, which the command's schema marks `required: true` — there was also no line-cursor concept anywhere in `ChangesPane`'s state to have supplied one from. Fixed by asking for the line number via a chained `input` overlay (same chaining pattern `runFromPalette` already uses for a command's required args) before asking for the comment body — not a fabricated default like line 1, since there was no honest way to infer it. A real line-cursor-in-diff UX (highlight a line, comment on it directly) is a larger feature than this fix; logged below.
3. **`Alt+E` double-fired**, the same class of bug as Phase 4 item 2's leader/composer conflict. `chat.editor`'s keymap binding is `alt+e`, a modified chord — `isPrintableChord` (`hooks.ts:337`) never suppresses modified chords while a text field is focused, so App.tsx's OWN `useKeymap` handler for `chat.editor` (a stale placeholder toast: `"Alt+E opens $EDITOR from the prompt."`) fired on every press alongside `Composer`'s real, working, internal `Alt+E` handler (`tui-kit/src/input.tsx`) that actually spawns `$EDITOR` — popping a "here's how" toast over the editor it had just opened. Fixed by making the App-level handler a genuine no-op, kept in the handlers map only so `chat.editor` still counts as "implemented" for the help overlay.

Verified: `tsc --noEmit` clean on `cli-core`/`cli`. `cli` 142 → **145 passed**, 5 skipped, 0 failed (incl. the full `tui-sweep.test.ts` binding sweep). `eslint` clean, 0 new warnings.

### ✅ New real server capability — a `'workspace'` stream-broker scope — done and tested this session

The evidence-mapping pass found that `checkpoint.created`/`.restored` and `workspace.changed` (`WorkspaceCheckpointService.ts`) are real, correctly-shaped, genuinely-emitted events that were nonetheless **unreachable by any live subscriber** — `composition-root.ts`'s universal EventBus→StreamBroker bridge only fanned events out to `session/run/chat/global/automation` scopes, with no `'workspace'` scope at all, so a workspace-keyed pane could only ever poll, never subscribe. This blocks any live-updating changes/checkpoint pane (item 2) from being more than a snapshot view.

Fixed with the exact precedent Phase 6 item 6 already established for the `'automation'` scope: every event carrying `data.workspaceId` (all three kinds above do) now also fans out to `scope: 'workspace', id: <workspaceId>`, making `GET /api/stream?scope=workspace&id=<id>` real. Widened end to end: `StreamScope` (`packages/db/src/repositories/StreamCursorRepository.ts`), `VALID_SCOPES` (`apps/server/src/routes/stream.ts`), `SseScope` + its `DEFAULT_CAPS_BY_SCOPE` (`apps/server/src/composition/sseConnectionCap.ts` — a `Record<SseScope, number>`, so the compiler forces completeness), `StreamPort.subscribe`'s scope union (`packages/cli-core/src/context/CliContext.ts`), and `PaneContent.attachment.scope` + `allAttachments()`'s return type (`packages/cli-core/src/session/PaneModel.ts`). `MuxStreamClient`'s own scope parameter is already a bare `string` — no widening needed there.

**Process note for the rest of this phase (and any future server/db work): `apps/server` and `packages/db`/`packages/core` use TS composite project references with checked-in `dist` output.** A plain `pnpm --filter @generatorai/server exec tsc --noEmit` (the pattern used successfully all session for `cli-core`/`client-core`/`cli`, which have no such references) fails with stale-looking errors after editing a type in a referenced package — not because the edit is wrong, but because `tsc --noEmit` alone doesn't rebuild referenced projects' `dist` first, so it type-checks against whatever `.d.ts` was already sitting in `dist`. **`pnpm turbo typecheck --filter=<pkg>` is the correct invocation** — turbo rebuilds the dependency graph in order first. Cost real time to diagnose (deleted `.tsbuildinfo` files and then `dist` itself before recognizing the actual cause); worth remembering for the remainder of Phase 7/8 given how much of the remaining work touches `apps/server`.

Verified: `pnpm turbo typecheck --filter=@generatorai/server` — 13/13 tasks pass (rebuilds `db`/`core`/etc. first). `pnpm turbo typecheck` for `cli-core`/`client-core`/`cli` — 22/22 tasks pass. `apps/server`'s full suite: **226 passed** (20 files), no regressions. `cli-core` unchanged at **695 passed**. `eslint` clean on `server`/`db` — the files touched (`stream.ts`, `sseConnectionCap.ts`, `StreamCursorRepository.ts`) show 0 warnings; the rest of each package's pre-existing baseline warnings (unrelated files, concurrent work) are unchanged.

**Real, documented gap, not fixed — logged below:** there is no dedicated test for `bridgeEvent`'s new `workspaceId` branch (it's an unexported closure inside `composition-root.ts`'s giant setup function) — this matches the EXACT same gap the `'automation'` scope already had when it landed in Phase 6 item 6 (also untested at the bridge level, verified only via the client-side reducer consuming the resulting events). Not a new regression; a pre-existing testing gap in how this bridge is structured, now shared by two scopes instead of one.

### Open questions logged from the bug-fix pass and the new stream scope

- **`diff.comment`'s line-number prompt vs. a real line cursor**: fixed the crash-every-time bug with a "which line?" input prompt rather than building line-cursor navigation inside the diff view (select a line with arrow keys, comment on it directly) — `ChangesPane` has no cursor concept at all today, and building one is a real, separate, larger feature. The prompt is honest and unblocks the command; a cursor-based UX is a genuine future improvement.
- **`bridgeEvent`'s untested closure** (see above) — not fixed, since it would mean either exporting an internal implementation detail purely for testability or writing a full composition-root integration test, and the existing `'automation'` scope shipped without one too. Worth doing once, covering every scope at once, rather than per-scope.
- **`tsc --noEmit` vs. `turbo typecheck` for composite packages** (see above) — a real process gotcha now documented here and in project memory so it doesn't cost time again in Phase 8, which also touches `apps/server` extensively.

### ✅ Items 1 + 3 — workspace tree/artifacts/worktrees/downloads, and a real `$EDITOR` handoff for workspace files — done and tested this session

Investigated first (per this session's standing discipline) whether uploading a NEW local file into the `Workspace` model has any real server route to call — confirmed it does not (re-grepped `workspaces.ts`'s full route list and `workspace.commit`'s handler, which is message-only with no file-content payload). Rather than build a UI element calling a non-existent endpoint, upload was explicitly scoped OUT as a genuine server-side gap (logged below), and the investigation redirected productively: it surfaced that `WorkspaceInfo`'s `rootPath`/`workingDirectory` fields (real, on the wire DTO — `packages/shared/src/types/Workspace.ts:128-141`, confirmed returned verbatim by `GET /:id`) mean the CLI and server share a filesystem in the common self-hosted case, so **editing a workspace file can be direct-to-disk, with no upload/download round-trip needed at all** — a materially better design than the one originally assumed blocked.

Implemented:
- New `WorkspacePane` (`panes.tsx`) — a flat, filterable file list (not a nested tree: `workspace.tree`'s real data has no directory-entry concept server-side, and no hierarchical-tree UI precedent exists anywhere in this codebase, so `ListPane`'s existing filter convention was reused rather than inventing tree-drilling), combining git-tracked files (`GET /:id/tree`) with untracked/artifact files (`GET /:id/files` — confirmed the only route that walks untracked files, which is what makes it the real source for browsing generated artifacts that are never git-tracked).
- `resolveWorkspaceLocalPath` (pure, exported from `App.tsx`) — resolves a row to an absolute on-disk path using the real alias-resolution rules traced from `RepoDiscovery.ts` (`.` = `workingDirectory` itself; a worktree alias = `rootPath` + its own `worktreePath`); a `kind: 'generated'` nested-repo alias is explicitly declined rather than guessed, since nothing in the API reliably exposes that repo's own directory name.
- `editWorkspaceFile` — reuses the existing `useTerminalSuspension` primitive (the same one Phase 5's raw terminal attach and the chat composer's `$EDITOR` handoff already use) to spawn `$EDITOR`/`$VISUAL` directly on the resolved local path; a resolution failure (no shared filesystem, or a declined generated-repo case) is reported honestly via a toast, never silently swallowed.
- `downloadWorkspaceRow` — a real "save to local disk" action for a file, reusing the same path-resolution + the workspace's real `GET /:id/files/content` route.
- **5 real bugs found and fixed along the way** (found by reading real route/service handlers, not assumed): (1) `workspace.tree --alias` parsed the real tree response as a bare array or `{entries:[...]}`, matching neither — always returned nothing; (2) `workspace.tree` with no `--alias` called `.files()`, whose real response is never an array — both branches collapsed into one correct `.tree()` call; (3) `workspace.worktrees`'s output columns used keys `path`/`branch` when the real fields are `worktreePath`/`branchName` — both columns rendered empty for every row; (4) `.worktrees()` was mistyped client-side as an unrelated `WorktreeInfo` (a different, project/codebase-scoped type sharing two field names by coincidence) instead of the real `WorktreeDetail`; (5) `.files()` was mistyped as `FileEntryRecord[]` when the real response is a grouped object of bare path-string arrays, never an array itself.

Verified (independently re-run, not just the fork's own report): `tsc --noEmit` clean on `cli-core`/`client-core`/`cli`. `cli-core` 695 → **699 passed**. `client-core` 160 → **163 passed**. `cli` 145 → **154 passed**, 5 skipped, 0 failed (incl. the full `tui-sweep.test.ts` binding sweep). `eslint` clean on all three packages — 0 new warnings, same pre-existing baselines as every prior phase. New tests: [`workspaceTree.test.ts`](../apps/cli/src/tui/__tests__/workspaceTree.test.ts) (9), plus additions to `workspace.test.ts` (+4) and `wireContract.test.ts` (+3).

**A genuine pre-existing bug found (flagged in the fork's report, independently confirmed by re-tracing the code) — NOT fixed, logged as an open item:** `dataKeysFor('changes')` (`store.ts:859`) maps a `changes`-kind pane to the `'workspaces'` data-cache key, the same generic list-cache the `workspaces` LIST pane uses — so `App.tsx`'s shared `listRows`/`selection` (used by `diff.nextFile`/`diff.prevFile`) is sized against `s.data.workspaces.length`, NOT the changes pane's own `content.state.files.length`. A changes pane opened where the workspace list-cache is shorter (or empty) than the diff's real file count can leave `diff.nextFile`/`.prevFile` unable to reach every file, or size the selection index against the wrong bound. This predates this session (the `changes`/`workspaces`/`workspace` three-way `dataKeysFor` mapping is old); item 1's own `content?.kind === 'workspace'` special-case in `listRows` (added this session) fixed the NEW `workspace` pane kind's sizing but left the pre-existing `changes` kind's mismatch untouched, since fixing it risked regressing an already-shipped, tested Phase 7 feature without a dedicated re-verification pass of `ChangesPane`'s full diff-navigation test coverage. Real fix: give `changes` its own `content.state.files`-sized branch in the same `listRows` selector, mirroring the pattern `workspace` just established.

### Open questions logged from items 1/3

- **Uploading a new local file into the `Workspace` model has no server route** — confirmed by re-grepping `workspaces.ts`'s full route list and `workspace.commit`'s handler. Out of scope for this session (would need new server work); the `$EDITOR` handoff's direct-to-disk design sidesteps needing it for the file-EDITING case, but a genuine "add a brand-new file" upload flow remains unbuilt.
- **`ChangesPane`'s diff-navigation sizing bug** (see above) — a real, pre-existing, reproducible bug, confirmed but not fixed this session; flagged for a dedicated fix + re-verification pass rather than a same-commit patch bundled into unrelated item 1/3 work.
- **`list.edit`/`list.delete` are now overloaded by pane kind** (on the new `workspace` pane, "Edit" opens `$EDITOR` and "Delete" downloads — reusing existing bindings rather than adding new ones for a net-new pane kind). Every other kind's existing behavior is provably unchanged (each new behavior is gated behind a new `if (content?.kind === 'workspace')`-style branch, falling through to prior code otherwise) — but the label mismatch ("Delete" → downloads, not deletes) is a real, mild UX-clarity issue worth a friendlier binding/label later.
- **Flat filterable list, not a nested tree, for `WorkspacePane`** — `workspace.tree`'s real data has no directory-entry concept server-side to build a hierarchy from, and no tree-drilling UI precedent exists anywhere in this codebase; reusing the flat-list-with-filter convention was the defensible choice over inventing one from scratch for a single pane.

### ✅ Items 2 + 4 + 5 + 6 — SCM workbench, schema-driven authoring forms, DAG editing, validation navigation — done and tested this session

The evidence pass for these four found that the blocker was never the missing
UI — it was that **the palette refused, outright, every command with a
required FLAG** (`commandRunner.ts`: *"This command needs options the palette
cannot collect yet"*), which is every authoring command in the registry.
`runFromPalette` could chain single-line prompts for required ARGS and
nothing else. So the fix for item 4 ("build forms from schemas") is also the
fix for one of Phase 0's own false-success items, and it unblocks items 2/5/6
at the same time.

**New: the sixth derivation from `CommandSpec`** — [`toForm.ts`](../packages/cli-core/src/registry/toForm.ts)
(`formFieldsForSpec` / `formValuesToInput` / `missingRequiredFields`), joining
commander, completions, palette, RPC and docs. Pure, no rendering: a spec
becomes field descriptors, filled-in descriptors become the `{args, flags}`
pair `validate()` already takes. The round trip is what the tests pin — an
empty optional field is OMITTED rather than sent as `''` (several server
schemas treat a blank string as a real value), a boolean is sent only when
ON (a schema defaulting to `true` would be silently overridden by an explicit
`false`), a variadic splits on commas or whitespace, and an unparseable
number is left as text so the spec's own zod message survives instead of
`NaN`. `FormOverlay` (`overlays.tsx`) paints them with one `TextInput`
mounted at a time — mounting one per field would give every keystroke to
every field, the same parallel-listener hazard Phase 4 item 2 hit with the
leader key. `runFromPalette` now routes through it, so the refusal is gone
and optional flags are reachable from the palette for the first time.

**Item 2 — the SCM half of the changes workbench.** `workspace checkpoints`/
`restore`/`commit`/`pr` and `review list`/`reply`/`submit` were all real,
tested commands with **nothing bound to them**: a user could read a diff in
the TUI but had to leave it to checkpoint, restore, commit, open a PR or
answer a thread. New `diff` bindings `p`/`C`/`P`/`T`/`S`/`R`, each running
the same registry command the binary does. `workspace pr` is one command
with two behaviours (lists without `--title`, creates with it) — the form
makes that visible rather than hiding it behind two keys onto one command.

**The changes pane is now live, not a snapshot.** `open.ts` attaches it to
`{scope:'workspace', id}` — the scope added earlier this phase, which until
now had no consumer. `runTimeline.ts` gained the three real events
(`workspace.changed`, `checkpoint.created`, `checkpoint.restored`) and a new
`TimelineState.workspaceRevision` counter. `workspace.changed` bumps the
counter and adds **no** timeline item on purpose: it fires on every debounced
write burst during a turn, so a line each would bury a chat transcript in
noise carrying nothing a refreshed file list does not already have.
`App.tsx` subscribes to that counter (not to `timelines`, whose identity
changes on every streamed token in any pane) and refetches.

**Items 5/6 — the workflow pane was read-only with no cursor**, so none of the
real `workflow stage`/`workflow edge` commands had any terminal surface at
all. `Dag` already had both halves of item 5's rendering (wide layered ASCII,
narrow indented dependency tree below 100 columns) — what was missing was
something to act on. New `workflow` key context (12 bindings), a
`selectedStageId` cursor threaded into `Dag`'s existing `selectedId`, a stage
detail strip (edges/variables/hooks/condition/agent), and
`workflowPaneContent()` shared by the initial open and every post-edit
reload — preserving the cursor across a reload, because a cursor that reset
to stage one after every edit makes editing two stages in a row unusable.

**Item 6 needed a server change, and found a bug on the way.**
`POST /workflow-definitions/:id/validate` answers **422** when a definition is
invalid, with the findings in the body — and `request()` threw that away, so
`ctx.api.definitions.validate()` raised `ApiError("422 Unprocessable
Entity")` with no errors at all and `workflow validate`'s own
`if (!result.valid)` branch was **unreachable dead code**. Fixed with
`requestAllowing()` (`client.ts`), a deliberately narrow tolerance: only the
statuses a caller names are treated as answers, so a 500 or 401 on the same
route still throws.

Then made the findings navigable: `DAGValidationResult` gained
`issues: DAGValidationIssue[]` — the same findings with the responsible
`stageIds`/`edge`/`field` attached — alongside byte-identical `errors`/
`warnings` string arrays, so every existing consumer is untouched. Both are
built from one `fail()`/`warn()` helper, so an issue can never drift from its
string or be forgotten on a new check (a test pins one issue per string, same
order, same text). `ValidationOverlay` lists them and Enter moves the DAG
cursor to the stage at fault.

**Also closed: two long-standing gaps found while building the forms.**
`CreateStageSchema` has always accepted `variables`, `hooks` and `condition`;
no CLI surface set any of them, so a terminal user could not give a stage a
variable or a run condition at all (`condition` is the Phase 1 leftover
"`StageCondition` has no CLI surface"). Added `--var name=value` (repeatable,
JSON-parsed values, merging on update with `--clear-vars` to replace),
`--condition`/`--condition-expression`, and four new commands:
`workflow stage variables`, `workflow stage hook list`/`add`/`remove`.

**Two more real bugs found and fixed:**

1. **`on_session_cancelled` could never be persisted.** W13/Finding-7 added it
   to the `HookPhase` TYPE with an explicit comment that authors must opt into
   it separately from `on_session_error` — but it was never added to
   `HookDefinitionSchema`'s zod enum, so the route rejected any hook declaring
   it. Found by a test asserting the CLI offers every phase the server
   accepts; the CLI reads that list off `HookDefinitionSchema.shape.phase.options`
   rather than retyping it, so the two can no longer drift.
2. **Open question #25 (the pre-existing `ChangesPane` diff-navigation bug) —
   now fixed, not just logged.** `dataKeysFor('changes')` maps to the
   `'workspaces'` list cache, so `selection` (and with it `diff.nextFile`/
   `.prevFile`, which clamp against `listRows.length`) was sized against how
   many WORKSPACES exist rather than how many FILES the diff has — a shorter
   workspace list left later files unreachable, a longer one let the cursor
   run past the end. The selector is now a pure, exported `paneListRows()`
   with its own tests, covering the `workspace` branch too.

Verified (independently re-run): `pnpm turbo typecheck --filter=@generatorai/server`
14/14; `tsc --noEmit` clean on `cli-core`/`client-core`/`cli`. Suites:
`cli-core` 699 → **740**, `client-core` 163 → **166**, `cli` 154 → **165**,
`core` 962 → **970**, `shared` **115**, `server` **226** — all passing, no
regressions. `eslint` on all three CLI packages: 15 warnings, identical to the
pre-existing baseline, **0 new**. New tests:
[`toForm.test.ts`](../packages/cli-core/src/registry/__tests__/toForm.test.ts) (16),
[`workflowAuthoring.test.ts`](../apps/cli/src/tui/__tests__/workflowAuthoring.test.ts) (11),
plus additions to `DAGValidator.test.ts` (+8), `workflow-stage.test.ts` (+12),
`runTimeline.test.ts` (+6) and `wireContract.test.ts` (+3).

### Open questions logged from items 2/4/5/6

- **The form is one flat field list, not a wizard.** A spec with 15 flags
  (`automation create`) shows 15 rows to scroll. Grouping required-vs-optional,
  or paging, is a real design improvement — but any grouping is an opinion the
  spec itself does not carry, and a flat list in declaration order at least
  matches `--help` and the docs exactly.
- **`workflow.variables` (`v`) opens `workflow stage update`'s whole form**,
  not a dedicated key/value editor — `--var name=value` (repeatable) IS the
  variables surface, so the form's own variadic field is the editor. A
  purpose-built two-column editor would be nicer and would need its own
  semantics for "unset a variable", which the command has no flag for.
- **Stage hooks are managed one at a time through `--config` JSON**, mirroring
  the precedent `hook test` already set. A guided per-hook-type form (three
  different shapes behind one `--type`) is a real improvement the flat
  `CommandFlag` model cannot express today — the flag would need a
  "shape depends on the value of another flag" concept that does not exist.
- **`diff.refresh` (`R`) is kept even though the pane is now live.** The
  live path depends on a working subscription; a manual refetch is the honest
  fallback when the stream is down, and costs one binding.

## Phase 8 — browser, computer, extensions, and administration

### ✅ All 6 items — done and tested this session

The evidence pass for this phase found the same pattern behind almost every
item: the SERVER capability already existed and the client either could not
reach it or mis-read its response. Nine confirmed bugs, all of the
silent-wrong-answer kind that types cannot catch because `request<T>()` casts
with zero runtime validation.

**Item 1 — semantic inspectors, ahead of image rendering.**
`BrowserService.readPage()` — the page's serialised accessibility tree, the
single best representation of a page for a non-graphical client — existed
only as an agent tool with **no HTTP route at all**, so no client could ask
for it. Added `POST /api/workspaces/:id/browser/read-page` (POST because it
re-issues element refs on the host, so it drives the page rather than reading
a cacheable resource), `api.browser.readPage`, and `browser read`. The
`BrowserPane` rendered `content.state.snapshot` — **which nothing anywhere
ever set**, so that branch had never once executed and every browser pane
showed the same "this terminal cannot display images" empty state forever; it
now shows the tree with real paging. `browser dom` exposes the full DOM
snapshot action, also previously unreachable outside the SPA.

**Item 2 — capability-specific renderers and an external-open fallback.**
`TerminalCapabilities.graphics` had been detected since capabilities existed
and used by **nothing**. New [`imageRender.ts`](../apps/cli/src/tui/imageRender.ts):
kitty (APC, chunked at 4096 base64 chars — an oversized APC is dropped with
no error, which looks exactly like the feature not working; format keys on
the first chunk only, or later chunks paint as separate images) and iTerm2
(OSC 1337, with the decoded byte length it rejects the sequence without).
The other three protocols are refused explicitly with the reason, because
sixel/halfblock/ascii all need a PNG decoder this CLI does not have — a
degraded guess would be worse than an honest fallback. Drawing suspends Ink
first: an image escape written into a live frame is overwritten by the next
redraw and, on kitty, anchors a placement to a cell Ink then reuses.

**`browser screenshot` was broken outright** and is fixed as part of this: it
POSTed to `/browser/capture`, whose schema REQUIRES a `clip` rectangle (it is
the SPA's region-capture endpoint) and which answers raw `image/png` — so
`--full-page` 400'd on the missing clip, and a valid call would have thrown
inside `request()`'s `res.json()`. It now uses the real `screenshot` action
and reads the artifact back through a new `api.browser.file`.

**Item 3 — consent and visible security boundaries.** `computer status` could
REPORT a pending consent prompt; nothing could answer one. Added
`computer pending`, `computer answer` and `computer runtime` (the last marked
`destructive` — starting the driver hands an agent control of a real
desktop). The `ComputerPane` is rewritten around the question a user actually
has: it leads with whether the agent can control this desktop *right now*,
then sections for prompts / standing grants / audit.

**Item 4 — the textual widget degradation contract.** Written as a five-point
contract in [`widgetDegradation.ts`](../packages/cli-core/src/viewmodels/widgetDegradation.ts)
and implemented as a pure function, because the failure mode of best-effort
rendering is a pane that shows something plausible and wrong. In short: a
widget's `props`/`state` are real data and are shown *as data*; the component
is never executed and never claimed to be; state stays WRITABLE
(`PATCH /widgets/:id/state` takes a full snapshot) so the degraded
interaction is real rather than a placeholder; an *orphaned* instance (no
descriptor — its extension is disabled or gone) is a distinct reported state,
not an empty widget; and everything not shown is named in `limitations`.
`widget set-state` is the new command behind point three.

**Item 5 — the twelve administration surfaces.** Built as **one**
command-backed pane over a declared table
([`adminViews.ts`](../packages/cli-core/src/registry/adminViews.ts)), not
twelve components: each view is a command id plus presets, and the pane
renders it with that command's OWN `output.columns`. A view therefore cannot
advertise a column its command does not return, and the whole table is
walkable in a test — which is what catches a view naming a command that no
longer exists, the failure a hand-built pane hides until someone opens that
one pane. Nine assertions run against the REAL registry, including "presets
only flags the command declares" and "prompts for every required argument it
does not preset". One entry point (`g m`), 21 views.

**Item 6 — settings are editable.** The pane was a read-only six-line summary
that ended by telling the user to leave and run `generatorai config set`. It
now lists every setting the schema declares, edits in place through the same
`config.show`/`config.set`/`config.unset` commands the binary uses, and — the
part that makes it honest — says **when each setting takes effect**
(`live` / `next-command` / `restart`), because a settings screen that
silently needs a restart for half its rows teaches people that settings do
not work. Values are validated against the real schema BEFORE writing:
`config set` writes first and the schema only rejects on the next load, by
which point the file on disk is already broken.

### Nine real bugs found and fixed in this phase

| # | Bug | Effect before the fix |
|---|---|---|
| 1 | `browser screenshot` posted to `/browser/capture` | 400 on the missing required `clip`; a valid call would have thrown parsing `image/png` as JSON |
| 2 | `BrowserPane`'s `state.snapshot` branch was set by nothing | Every browser pane showed the same empty state forever; the render path was dead code |
| 3 | `api.browser.snapshots` typed `{artifacts}` as a bare array | `browser snapshots` listed nothing, always |
| 4 | `api.computer.grants` typed `{grants}` as a bare array | `computer grants` listed nothing, always |
| 5 | `api.computer.activity` typed `{entries}` as a bare array | `computer activity` listed nothing, always |
| 6 | `api.computer.frames` typed `{enabled, frames}` as a bare array | `computer frames` listed nothing, always |
| 7 | `api.widgets.get`/`setState` typed `{instance}` as the instance | `widget read` printed a one-key envelope; every field a caller read was `undefined` |
| 8 | `widget list` called a route that returns nothing without a scope | Always empty, with no indication a scope was required |
| 9 | `BrowserService.readPage()` had no HTTP route | The best page representation for a terminal was unreachable by any client |

Verified (independently re-run): `pnpm turbo typecheck --filter=@generatorai/server`
13/13; `tsc --noEmit` clean on `cli-core`/`client-core`/`cli`. Suites:
`cli-core` 740 → **785**, `client-core` 166 → **177**, `cli` 165 → **176**
(5 skipped), `server` **226** — all passing, including the full
`tui-sweep.test.ts` binding sweep, which now drives the new `workflow`,
`command` and `computer` key contexts too. New tests:
[`adminViews.test.ts`](../packages/cli-core/src/registry/__tests__/adminViews.test.ts) (9),
[`settingsView.test.ts`](../packages/cli-core/src/config/__tests__/settingsView.test.ts) (14),
[`widgetDegradation.test.ts`](../packages/cli-core/src/viewmodels/__tests__/widgetDegradation.test.ts) (10),
[`imageRender.test.ts`](../apps/cli/src/tui/__tests__/imageRender.test.ts) (11),
plus 11 envelope/wire-contract cases in `wireContract.test.ts`.

### Open questions logged from Phase 8

- **Sixel and half-block image output are refused, not approximated.** Both
  need a PNG decoder; adding one is a dependency decision (and a real amount
  of code) for a screenshot feature. The refusal names the reason and falls
  back to the system viewer, which is a working path — but a sixel user on
  xterm sees a file open rather than a picture in their scrollback.
- **Inline drawing suspends the whole TUI.** It is the only way to keep an
  image escape out of Ink's redraw path with the renderer this app uses.
  Drawing into a pane region would need Ink to leave a hole in the frame,
  which it has no concept of.
- **The widget contract's state editing is a whole-snapshot JSON write.**
  That is what the route takes, so it is honest — but it means editing one
  field of a widget's state requires retyping the rest. A field-level editor
  would need a schema for widget state, which no descriptor supplies.
- **`widget read` reports a widget as "orphaned" when called without a
  scope**, because the render payload only exists on the LIST route and only
  within a chat/run/session. The alternative (silently omitting the
  limitations) would be worse, but the wording could mislead someone who
  simply forgot the flag — it is accurate about what this call could see, not
  about the widget.
- **The administration views are read-mostly.** Create and delete exist where
  the command does (`webhook`, `connect`, `device`, `extension`, `agent`);
  everything else is a list plus an inspector. Editing a device's scopes or a
  webhook's URL in place would need per-view update commands that mostly do
  not exist yet.

## Phase 9 — performance, accessibility, and release closure

### ✅ Items 1–5 and 7 done; item 6 partially (see below)

**Items 1/2 — profiling and the §6.4 budgets.** The audit's §6.4 lists nine
named performance RISKS and eight budgets. Three of the risks turned out to
be real defects, not just risks:

1. **"REST hydration can push a timeline beyond its nominal retention
   bound."** It did. `maxItems` was a `reduceEvent` option, and history came
   in through a different door — `timelineFromHistory` returned every stored
   message and `seedTimeline` concatenated it under the live items with no
   cap at all. Opening a chat with fifty thousand stored messages loaded all
   fifty thousand into memory and into the render path, and the bound only
   started applying at message fifty-thousand-and-one. Fixed with one
   `DEFAULT_TIMELINE_RETENTION` applied on both paths, plus a
   `mergeHistoryIntoTimeline` that trims the MERGED result — two
   individually-capped halves still exceed the cap once concatenated, which
   is exactly what the old code did.
2. **"Width calculations use multiple algorithms, creating emoji/CJK
   disagreement."** `panes.tsx` hand-rolled an approximation over a handful
   of codepoint ranges while everything that actually PAINTS (`tui-kit`'s
   `Table`/`Composer`/`Select`, `Renderer.ts`) used `string-width`. The two
   disagreed on ZWJ emoji sequences (one glyph, many codepoints — the range
   list counted each as 2), combining marks (zero width, counted as 1),
   variation selectors, and several CJK blocks the list omitted. So
   `estimateLines`/`clipLines` budgeted a different row count than the
   renderer drew, which is how a message ends up written over a pane border.
   Now one algorithm, and it is the renderer's.
3. **"Every store update reruns attachment reconciliation over the whole
   workbench."** The reducer returned a FRESH object for an event it does not
   model, defeating `applyEvent`'s `next === current` skip — so every
   unmodelled event kind the server emits cost a store notification, a
   render, and a full reconciliation pass over every pane. It now returns the
   same object unless something actually changed, while still advancing
   `lastSequence` when the event carries one, so resume-after-reconnect does
   not stall on a run of unmodelled events.

   This one changed a real behaviour: an event that renders nothing no longer
   raises the unseen-output tab badge. That is the correct reading of the
   badge ("new content arrived while you weren't looking"), and there is now
   a test pinning both halves.

[`performanceBudgets.test.ts`](../packages/cli-core/src/viewmodels/__tests__/performanceBudgets.test.ts)
measures the four budgets that are properties of this code, with deliberately
loose thresholds — a unit test on shared CI hardware cannot certify a p95, but
it catches the regression that matters (an accidental O(n²) misses by three
orders of magnitude at a 2000-item timeline, not by 20%).

**Item 4 — baselines.** `pnpm --filter @generatorai/cli baseline` records what
is honest to measure from a script and says plainly what it is not measuring,
rather than reporting a number obtained another way under the same name.
Measured on this machine (node 26, win32):

| Measure | Value | Budget |
|---|---:|---|
| Cold start (spawn → `--version` exits) | **417 ms** | p95 below 250 ms to first stable frame |
| Registry construction | 7.7 ms | — |
| Keymap construction incl. conflict detection | 0.4 ms | — |
| Timeline reducer throughput | 1.66 M events/s | soak is 100 events/s |
| Items retained after 50k token events | 1 | bounded |
| Heap after registry + keymap + 50k events | 60 MB | — |

**Cold start misses its budget, and the number above is a LOWER bound** — it
is process start plus argument parsing, with no terminal, no connection and
no first paint. Logged as an open item; it is a bundle-size/module-graph
problem, not something to patch inside this pass. *(A caught error worth
recording: the first version of this benchmark sent `{ delta }` on
`harness.token`, whose real field is `text` — the reducer returned early on
the empty string and the harness reported ~2M events/s for work that never
happened. The reducer was right; the benchmark was wrong.)*

**Item 3 — the environment matrix.** The audit names sixteen environments.
Nine are distinguishable from the environment alone and are now pinned in
[`terminalMatrix.test.ts`](../packages/cli-core/src/capabilities/__tests__/terminalMatrix.test.ts)
(19 cases): `NO_COLOR` including its empty-string spelling, every
`FORCE_COLOR` level, `TERM=dumb`, 16/256-colour, tmux/screen (which must NOT
inherit the outer terminal's protocol — TERM is rewritten and APC passthrough
is off by default), sixel never being guessed, kitty/iTerm2/WezTerm/Ghostty/
Alacritty/Windows Terminal identification, WSL, conhost, screen readers and
reduced motion. The rest (a real screen reader, SSH latency, actual conhost
repaint) are runtime properties only a real-console smoke test can observe,
and are named as such rather than faked.

**A real bug this found:** `detectUnicode` returned `true` for ANY non-empty
locale on a unix-like system — so `LANG=C`, `POSIX`, and
`en_US.ISO-8859-1` were all treated as UTF-8-capable, and box-drawing
characters and emoji were written to terminals that render them as mojibake.
A locale that NAMES a charset and does not name UTF-8 is positive evidence
against unicode, not the absence of evidence. `LANG=en_US` (no charset
suffix) still assumes UTF-8, which is the unchanged and correct default.

**Item 5 — coverage.** `packages/cli-core/vitest.config.ts` now carries
thresholds, set at what the suite achieves rather than at an aspiration that
would fail immediately and get deleted: a global floor plus per-area floors
for the four areas the audit names — command contracts, input routing, pane
state and timeline reduction — and capability detection. Getting there meant
writing the tests for two modules that had **none at all** and are used by
every surface: `dagLayout.ts` (20 cases — layer assignment, cycle handling,
the narrow-terminal tree fallback, and the diamond that would otherwise
recurse forever) and `format.ts` (34 cases). Overall cli-core coverage went
**79.9% → 83.8%** statements.

**Item 4 (leaks) —** [`resourceLeaks.test.ts`](../apps/cli/src/tui/__tests__/resourceLeaks.test.ts)
covers the four ways a days-long TUI session leaks without ever throwing:
per-pane records that outlive their pane (ids are never reused, so an
uncleaned entry is unreachable AND permanent), subscriptions not disposed on
close, buffered events resurrecting a closed pane's timeline after teardown,
and an unbounded timeline. All seven passed first time — the lifecycle
bookkeeping is genuinely correct.

**Item 7 — docs.** `usage-cli.md` regenerated (218 commands, 25 groups) and
the new `CLI_SURFACE_SNAPSHOT.md` added (below).

### 🔶 Item 6 — packaging: partially covered, deliberately

The clean-install-and-run check already exists from Phase 1 (`ci.yml` packs
the tarball, installs it into a directory with no workspace symlinks, and
runs the binary, on all three OSes). **Migration, downgrade and
clean-uninstall tests are NOT written.** All three need a released prior
version to migrate FROM, and this branch has never been released — writing
them against a synthetic "old config" would be testing a fixture, not a
migration path. Logged.

## Phase 0 — freeze claims and establish a baseline

Done last, deliberately: Phase 0 asks for a snapshot of the surface and a
gate against false claims, and both are worth more taken against the finished
state than against the state at the start.

**Item 1 — mark false-success options.** New `CommandFlag.unsupported` /
`CommandArg.unsupported`: a reason string for an option that is ACCEPTED but
does not do what its name implies. Removing such a flag outright breaks
scripts that already pass it, so it stays accepted — and the marking reaches
every derived surface (`--help`, the generated docs, the RPC descriptors, the
schema-driven form) because the string lives on the spec rather than in one
renderer's prose. Only one flag needs it today (`run start --name`); the
audit's other named cases were all fixed for real in Phases 1–8 rather than
labelled.

The gate that matters is
[`falseSuccess.test.ts`](../packages/cli-core/src/commands/__tests__/falseSuccess.test.ts):
**no option may describe itself as inert in prose without being marked**, a
marked option must carry a real reason, must not also be required (requiring
a value that is discarded is a contradiction the user cannot satisfy), must
still parse, and must appear in the docs and RPC descriptors. That is what
stops the marking being forgotten on the next one.

**Item 2 — the surface snapshot.** [`CLI_SURFACE_SNAPSHOT.md`](CLI_SURFACE_SNAPSHOT.md),
generated from the live registry, keymap and administration-view table:
**218 commands, 150 bindings, 22 administration views.** Its columns are
chosen so Phase 0's exit gate — *"no feature is called full based only on
registry presence"* — is checkable in a diff: whether a command reaches a
server, whether it is reachable from the palette at all, what it requires,
and **who executes each binding**.

That last column found and then dissolved a scare. The first version reported
**21 bindings with no handler**; all 21 turned out to be legitimately owned by
a component (every `composer` binding is executed inside `Composer`, because
an edit must read the caret position the PREVIOUS keystroke wrote and a
keymap dispatch only sees render-old state; `pane.leader` has its own
registration because it changes which context the next key resolves in). A
column that reported those as broken would have been 21 false alarms hiding a
real one. It now distinguishes `shell` / `component` / `none` — and `none` is
**0**.

`HANDLED_ACTIONS` in `App.tsx` is now declared data, and the handler map is
TYPED against it, so a handler without a binding or a binding without a
handler is a compile error rather than a key that silently does nothing. This
session had already found three of exactly that (`run.stageDetail` and
`run.verbosity` bound to nothing; `chat.editor` firing a stale toast over the
editor `Composer` had already opened).

**Item 3 — CI jobs.** Three added to `ci.yml`, all the same shape (an
artifact derived from the code, regenerated and diffed): docs+surface drift,
generation idempotency (a generator that is not idempotent makes every diff
noisy and trains reviewers to ignore it), and the targeted coverage run. The
exact-bin-build check already existed from Phase 1.

**Item 4 — baselines.** See Phase 9 item 4 above.

### Open questions logged from Phases 9 and 0

- **Cold start is 417 ms against a 250 ms budget**, measured, and that is a
  lower bound. Fixing it means attacking bundle size and the import graph
  (the registry alone builds in 7.7 ms, so it is not the cost) — a real,
  separate piece of work, not a tweak.
- **Migration / downgrade / clean-uninstall tests are unwritten** because
  there is no released prior version to migrate from. They should be written
  with the first release, against a real previous artifact.
- **The coverage thresholds are ratchets, not targets.** They are set at what
  the suite achieves today. `errors/CliError.ts` (53%) and `client/` (29%) are
  the weakest remaining areas; the latter needs a live server.
- **The reducer no longer badges a tab for an event it does not model.** This
  is a deliberate behaviour change and, I believe, the correct reading of the
  badge — but if a future pane starts rendering something from an event kind
  the reducer ignores, that pane will not raise a badge until the reducer
  models it.
- **`GENERATORAI_TUI_GRAPHICS=sixel` remains the only way to get sixel**, and
  the renderer refuses it anyway (Phase 8). The override is honoured by
  detection and then declined by rendering, which is coherent but reads
  oddly; worth collapsing once a decoder exists.
