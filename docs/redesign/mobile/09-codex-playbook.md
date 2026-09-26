# 09 — Codex playbook (how to work through this plan)

This is the session protocol for the Codex agent that implements the mobile overhaul. The binding rules are in `apps/mobile/AGENTS.md`; this document explains how to apply them day to day.

---

## 1. Session start (every session, including resumes)

1. `cd` to the worktree (`/Users/sidmishra/Desktop/Projects/mobile_redesign`).
2. `git status` must be clean, and `git branch --show-current` must print `mobile_redesign`.
3. Read `docs/redesign/mobile/README.md`: the progress table and the **Resume point**.
4. Read `01-decisions.md` and the current phase in `07-phases.md`.
5. Read the latest file in `docs/redesign/mobile/reviews/`, if any.
6. If this is the start of a phase, or a week has passed, merge `desktop_redesign` (§5).
7. Check the design version (MD-44). If you can open https://claude.ai/artifact/3bBuQ3vGwYbJh7A2yX7kqA, compare its version with `docs/redesign/boards/mobile/VERSION`. If you cannot, mention it in the phase summary as a non-blocking question and continue on the snapshot. Never rewrite the snapshot yourself.
8. Make sure the board PNGs exist: `node scripts/mobile/render-boards.mjs`, which takes about 2 minutes and whose output is gitignored.
9. Start the sandbox and pair the devices (`08-verification.md` §2), unless the task is docs or packages only.

---

## 2. Per task

1. **Write the task packet** as a short note at the top of your working context, not as a file:

```text
Task: <ID> <title>                      (07-phases.md)
Boards: <MBoard…> — PNG: docs/redesign/boards/png/mobile/<Board>.dark.png (+ .light)
Decisions: MD-xx …   Design feedback: MDF-xx …
Components: MP/ML/MB ids to use or create (03-components.md)
Route/data: 04-screen-map.md row, APIs / MG gaps (05-gap-matrix.md)
Legacy to delete: files
Acceptance: (from 07)
Verification: per-task loop (08-verification.md §3.1, mirrored in apps/mobile/AGENTS.md) + the screen's Maestro flow
```

2. **Look at the design.** Open the PNGs, both iOS and Android sides, dark and light. For exact numbers, grep the `.dc.html` for the element's text and read its inline style and classes, then translate them with §4. Never copy inline styles or pixel values into code: use the vocabulary and tokens (`02-design-system.md`).
3. **Check the kit first.** Look in `03-components.md` and the Storybook stories. Reuse a component, or add a variant in `src/ui` with a story. Never fork a component in a feature.
4. **Implement.**
   - The data comes from `features/<area>/queries.ts` hooks (client-core API).
   - Designed data that has no API is not rendered (MD-27).
   - Apply the MDF resolution wherever the board is wrong (`10-design-feedback.md`).
5. **Run the Done loop** (`08-verification.md` §3.1, mirrored in `apps/mobile/AGENTS.md`), on both platforms, and fix until it is green.
6. **Delete** the legacy code this task replaced.
7. **Update** the README progress row. If you decided something new, add an `MD-xx` to `01-decisions.md`.
8. **Commit:** `mobile(<task-id>): <summary>`. Keep commits small and one per task. A shared-package or server change in the same task goes in a separate commit in the same task, logged in `COORDINATION.md`.

**Parallel work.** If your Codex environment can run parallel tasks or sub-agents, hand out only independent `ui/` components (M4) or independent settings sections (M7), each in its own worktree or branch off `mobile_redesign`. You then integrate and verify them yourself. Anything touching the shell, the chat screen, services, tokens or native code is done sequentially.

---

## 3. Batch end (A–F in `07-phases.md` §0)

1. **Run the batch checks** (`08-verification.md` §3.2) and collect the evidence into `docs/redesign/mobile/reviews/<batch>/` (`SUMMARY.md` plus the files listed in `08-verification.md` §7):
   - commit range;
   - tasks done;
   - the `DIFF.md` files per screen;
   - VRT and Maestro results;
   - perf and a11y numbers;
   - deviations and new MD-xx entries.
2. **Get an independent review.** Start a **fresh Codex session** with no prior context and give it the **REVIEW PROMPT** from `CODEX_PROMPT.md`, filled with the batch id and commit range. Either use a new interactive session, or run it non-interactively with `codex exec "<review prompt>"` if the `codex` CLI is on PATH and allowed in your sandbox; otherwise ask the owner to open a new Codex session with the prompt (the batch waits for the review). If your Codex has a built-in review command for a branch diff, you may use that as well, but the review prompt's checklist is required. The reviewer does not edit code; it writes `reviews/<batch>-review.md`.
3. **Fix** every Critical and Major finding, and Minor ones unless deferred with a reason in the review file.
4. **Re-review** in a new fresh session only if a Critical or Major was found. At most 3 rounds; if Critical or Major findings are still open after that, stop and ask the owner.
5. **Close the batch:** update the README progress table and the resume point, commit, and give the owner a short summary covering what shipped, the review outcome, deviations, owner actions, and **Owner-confirm** decisions used.

---

## 4. Translating board CSS into the kit (the class mapping)

The boards are HTML. Their class names map to kit components and vocabulary as follows. The class inventory is in `research/boards-core.md` §B.0.

| Board class / pattern | Meaning | Mobile implementation |
|---|---|---|
| `.phone.ios` / `.phone.and`, `.safe-top-*`, `.safe-bot-*` | device frame, safe areas | not built: `Screen` handles safe areas |
| `.glass` | iOS glass material | `GlassSurface` (MP-38; iOS floating chrome only, 02 §8) |
| `.gbtn` (44 circle), `.gcap` (capsule of buttons) | iOS header buttons | `Header` iOS toolbar items / `IconButton` glass |
| `.atop` (64 top app bar), `.aib` (48 icon button) | Android top app bar | `Header.android` + `IconButton` |
| `.afab` | Android extended FAB | `NewAction` (Android) |
| `.mbtn` / `.mbtn-p` | iOS capsule button / filled primary | `Button variant="secondary"` / `variant="primary"` (MD-22: one per screen; sizes MD-51) |
| `.abtn` / `.abtn-p` | Android outlined / filled button | `Button` (same variants; platform tokens) |
| `.mchip` / `.achip` (+ `.on`) | chips (selected) | `Chip` (selected) |
| `.igroup` + `.irow` | iOS grouped inset list + row | `ListSection` + `ListRow` |
| `.arow` | Android list item | `ListRow` (Android tokens) |
| `.sheet-i` + `.grab` / `.sheet-a` + `.agrab` | sheet + grabber | `Sheet` (formSheet / TrueSheet); the grabber is native |
| `.scrim` | modal scrim | `SidePanel` / `Sheet` built-in |
| `.drawer-i` / `.drawer-a`, `.dnav` / `.dnav-a` (active), `.dsec` | drawer, nav item, section label | `Drawer` in `SidePanel`, `ListRow` nav kind, `SectionHeader` |
| `.pane-i` / `.pane-a`, `.ptab-i` / `.ptab-a` | pane, pill / underline tabs | `PaneShell` + `PaneTabStrip` |
| `.hscroll` | horizontal scroller | `ScrollView horizontal` (blocks the panel pan, MD-19) |
| `.bdg` + `.s-idle/.s-run/.s-warn/.s-ok/.s-err` | status badge | `StatusBadge` (shared status map, MD-25) |
| `.dot` | status dot | `StatusDot` |
| `.mono` | machine text | `Text role="mono"` / `"monoSm"` / `"monoLg"` (JetBrains Mono; 02 §4.1) |
| `.trunc` | single-line truncate | `Text numberOfLines={1}` |
| `.i12`…`.i24`, `.i` | icon sizes | `Icon size` from tokens, concept names only |
| `.c-2` / `.c-3` / `.c-ok` / `.c-err` / `.c-warn` / `.c-run` | text colours | `text-fg-2`, `text-fg-3`, `text-ok`, `text-err`, `text-warn`, `text-run` |
| `.i-lt`, `.i-t2`, `.i-hd`, `.i-bd`, `.i-cb`, `.i-sub`, `.i-fn`, `.i-cap` | iOS type steps | `Text` roles (02 §4) |
| `.a-hl`, `.a-tl`, `.a-tm`, `.a-bl`, `.a-bm`, `.a-lb` | Android type steps | `Text` roles (02 §4) |
| `.card` | card surface | `ListSection` (iOS) / tonal container (Android); never a status tint |
| `.seg` | segmented control | `SegmentedControl` (native; MD-47) |
| `.plabel`, `.board`, `.pair`, `.app`, `.tr` | board scaffolding (labels, layout) | not built |
| `--surface`, `--raised`, `--fg-2`… in inline styles | tokens | the same names as vocabulary classes (`bg-surface`, `text-fg-2`) |

The boards contain **sample data** (names, counts, times). It is never shipped; real data comes from APIs.

---

## 5. Keeping up with the desktop run (merge procedure)

The web/desktop redesign keeps landing shared foundations on `desktop_redesign` (`07-phases.md` §2).

```text
git fetch --all --prune            # if the owner uses a remote; otherwise the local branch is already current
git merge desktop_redesign          # into mobile_redesign; never the other way round
# conflicts outside apps/mobile/** and docs/redesign/mobile/**: keep BOTH sides; desktop wins only on lines both
# branches changed; then re-apply any mobile addition listed in COORDINATION.md that the merge lost, and run that
# package's tests. Never drop mobile's additive shared/server changes.
pnpm install
pnpm --filter @generatorai/mobile typecheck && pnpm --filter @generatorai/mobile test && pnpm check:tokens
# if shared contracts changed: grep this branch's uses and adapt mobile (never change the shared package back)
git commit (merge commit)          # message: "mobile: merge desktop_redesign @ <sha>"
```

- **When to merge:** at every phase start, at least weekly, and whenever a desktop item that you need (§2 table in 07) has landed.
- **After a merge,** check the desktop `docs/redesign/01-decisions.md` for new D-xx entries. If one changes a shared contract mobile uses, note it in the phase summary.

---

## 6. Shared packages and server (additive rules)

- **Allowed:** new files, new exports, new optional fields, and new client-core API methods and query keys. Examples: `GEOMETRY.ios/android` values, icon `sfSymbol`/`material` names, `emit/uniwind.ts`, `resolveAccentFromSeed`, `DEEP_LINK_QUERY_KEYS`, `attentionItemRoute`, the live-state model.
- **Not allowed:**
  - renaming, removing or changing behaviour of anything web uses;
  - editing `apps/web`, `apps/desktop`, or the desktop plan docs;
  - rewriting `packages/client-*`.
- **Server:**
  - append-only in `apps/server/src/routes/index.ts`, `openapi.ts`, `HttpPlatformClient` and `IPlatformClient`;
  - prefer JSON settings over DB migrations;
  - if a migration is unavoidable, use the next number and note it for renumbering at merge time.
- **Every such change** gets a line in `docs/redesign/mobile/COORDINATION.md`: date, task, files, what and why. The owner uses it at the final merge.

---

## 7. Evidence and files

| What | Where |
|---|---|
| Screenshots | `docs/redesign/shots/mobile/<route>/<platform>-<device>-<theme>-<mode>-<text>[-<orientation>].png` (`08-verification.md` §3.3) |
| Board comparisons | `node scripts/mobile/compare.mjs --board=<M…> --mode=<m> --ios=… --android=…` → `compare-<mode>.png`; you then write `DIFF.md` by hand next to it (Matches / Intentional deviations (cite MD / MDF) / Defects; 08 §3.4) |
| Reviews and batch evidence | `docs/redesign/mobile/reviews/<batch>/` (evidence, `08-verification.md` §7) and `reviews/<batch>-review.md` (the review) |
| Maestro flows | `apps/mobile/.maestro/<area>/<flow>.yaml` |
| Stories | next to each component |
| VRT baselines | `apps/mobile/vrt/` |

---

## 8. Stop and ask the owner when

- the Codex sandbox or approval policy blocks a needed command (network installs, simulator/emulator control, local ports) — ask the owner to relaunch with the permissions in `CODEX_PROMPT.md` §0;
- the Workflow Overhaul APIs are still missing when M10 starts (follow `07-phases.md` §1 and tell the owner);
- a decision is not covered by the plan and cannot be derived from the plan or the code;
- a batch still has Critical or Major findings after 3 review rounds, or an exit criterion fails after reasonable effort;
- the work needs an edit to `apps/web`, `apps/desktop`, the desktop plan docs, or a non-additive change to a shared package;
- the design artifact changed in a way that contradicts `01-decisions.md`;
- an owner machine action is needed (`sudo xcode-select`, installs that need a password, store accounts, signing, push credentials);
- anything is destructive outside this worktree, or you would push, open a PR or merge into `desktop_redesign`;
- M8 would start before the Workflow Overhaul APIs have landed;
- you intend to adopt an **Owner-confirm** decision (MD-04 workflows scope, MD-42 crash reporting, MD-96 no Widget tab) differently from the default.

---

## 9. Context hygiene for long runs

- Keep all state in files: README progress + resume point, reviews, COORDINATION.md. After a context reset, re-read §1 and continue from the first unfinished task.
- Don't paste board HTML into context. Grep for the element you need.
- For the long docs, read the table of contents and then the section you need.
