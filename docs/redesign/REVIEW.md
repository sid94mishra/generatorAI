# Final review of the redesign plan (2026-09-25)

Independent review of `docs/redesign/` before handing it to a fresh implementation session. The review covered cross-document consistency, more than 90 code-truth checks against the repo (`desktop_redesign @ a83a7bf`), executability of P0/P1/P3/P4, board and route coverage, mobile readiness and sequencing.

## Verdict

**Ready to execute, after the edits below.** The plan meets all five owner requirements:
1. It is phase by phase and gives the reasoning for each decision (D-01…D-42).
2. It has a consolidated primitive and composite index (README, the two `03-` inventories, and the shared-across-screens matrix).
3. Mobile preparation now maps each item to a task (new table in 07).
4. It is self-contained.
5. The standing owner rules are now all written into the proposed `.claude/CLAUDE.md`.

The problems found were drift between documents, not design flaws:
- stale phase assignments (palette, Dialog, L-03, RightPane, cmdk);
- two competing definitions (`setChromeColors` vs `setAppearance`; the `CHROME` key shape; the rail inset of 22px vs 30px);
- P0 tooling scripts that no task owned;
- a handful of wrong counts.

`07-phases.md` stays canonical, and every other document now agrees with it.

**Code-truth summary.** Over 90 claims were checked, including:
- paths, line references and giant-file sizes;
- dependency versions (Tailwind 4.2, Vite 6.4, react-router-dom 7, lucide 0.460, tailwind-merge 2.6, React 19.2.4);
- scripts (`check:tokens`, `tokens:write`, `check:design`, `check:bundle`, `dev:web`, `dev:desktop`, `tokens:check`);
- `node_modules/.bin/playwright-cli`, the 13 e2e specs and 69 vitest files / 650 tests;
- `SETTINGS_NAV` (15 sections), the 4 dead shims, the zero importers of ProjectPicker/CodebasePicker, the CI branches `[main, dev]`, the Faux env var, `.claude/launch.json` `start:web` (broken, as the plan says) and `.claude/CLAUDE.md` (1 byte).

About ten were wrong and are fixed below. `check:css`, `storybook`, `test:stories` and `pnpm vrt` do not exist yet. The plan creates them, and each is now tied to its task.

**Coverage.**
- **Boards:** `canvas.json` lists 78 boards and the snapshot holds 60 (18 theme boards omitted). All 55 screen boards are mapped in 04 with a phase owner; the other 5 are reference boards.
- **Routes and settings:** all 24 current routes, 19 page files and 15 settings sections are accounted for in 04.

## Edits made

| # | File | Section | What / why |
|---|---|---|---|
| 1 | 07 | P0-01 | 59 → 60 boards. Added `side-by-side.mjs`, which the Done loop step 8 uses but no task created. PNGs are gitignored per 09 §4.6, so the task no longer says they are "committed". |
| 2 | 07 | P0-02 | `launch.json`: P0 adds `dev`, P1-SB adds `storybook`, P2-00 adds `sandbox`. Added `make-dummy-repo.mjs`, which no task owned (owner rule: SCM tests use a dummy repo). |
| 3 | 07 | P0-04 | The vitest config gets the `projects` form with a `unit` project from P0, so the Done loop's `--project unit` works. Adds `@testing-library/user-event` and the `check:css` script. |
| 4 | 07 | P1-S3 | Route modules are `app/routes/<area>.routes.tsx` (from 06 §2.4). The split lands after P1-U4, so it imports from `react-router`. |
| 5 | 07 | P1-T6 | Added the `geometry.ts` per-platform schema (M-04 had no task). |
| 6 | 07 | P1-SB | VRT `routes` project depends on P2-00; falls back to P3-08. |
| 7 | 07 | P3-01, P3-07, P4-06, P4-07, P5-01 | Added the `ui-contract` (M-11) and copy (M-13) deliverables. |
| 8 | 07 | P3-05 | Palette builds P-31 Dialog, S-10 and C-21, which were stuck in P4/P5. **`cmdk` is no longer deleted in P3:** `SearchableSelect` (used by AgentPicker) still depends on it through `ui/primitives/command.tsx`, so it is removed with them in P5. Entity search stays in P5-12. |
| 9 | 07 | P3-07 | "New chat" opens the legacy `CreateChatDialog` until P5-09. |
| 10 | 07 | P4-05 | Dialog removed (it now lands in P3-05). Switch is conditional, matching P5-01 and 03-kit. |
| 11 | 07 | P4-06, P4-12 | Only the panel imports are swapped in the legacy run page. `RightPane.tsx` itself stays until PW or the D-35 fallback, matching 04 §2.1 and P7-01. |
| 12 | 07 | P5-01 | Removed CommandList and S-10 (moved to P3) and L-03 (built in P3-04). |
| 13 | 07 | new section | "Mobile-readiness deliverables → tasks": maps M-01…M-14 to task IDs. |
| 14 | 01 | D-08 | Vocabulary now lists `focus`, the status text/hue split, and the extra heights and widths. This reconciles 02 §14.1 #3 and 03-kit §10 #1. |
| 15 | 01 | D-35 | Wrong file reference `03-component-inventory.md` → `03-component-inventory-domain.md` §4. |
| 16 | 01 | D-37 | Upgrade order now matches 07 P1-U1…U5; tailwind-merge moves to P1-T9. |
| 17 | 01, 00, 02, 03-kit | D-01/D-06/D-17; §3; §3 table | Counts corrected: `var(--color-*)` ≈1,400–1,500 (regex-dependent); lucide 147 measured vs the Audit board's 174; router 23 lazy routes + `*`; RuntimeStageNode 58–75; accent codemod 53/18; `subtle` 72 vars. |
| 18 | 02 | §6.3 | Added `h-panel-bar` 40, `h-dialog-bar` 48, `h-footer` 56 (03-kit §10 #1). |
| 19 | 02 | §8 | `CHROME` key shape is owned by 06 §3.1 (the nested draft is kept for its values only). `SHELL.dialogWidth` corrected to 420/640/960/1040. The mac rail inset is 30px `--gai-page-inset-left`, not 22px. |
| 20 | 02 | §11.3, §13 T8/T11 | `setChromeColors` replaced by 06's `IPC.setAppearance`. `CHROME` moved from T11 to P1-S1. |
| 21 | 02 | §14.1 | Status line: all nine issues resolved (with the D-xx for each). |
| 22 | 03-kit | §1.3, §1.4, P-06, P-19, P-22, P-31, S-03, S-05, S-06, S-10, C-21, L-03 | Focus ring uses the `focus` token (D-12). StatusBadge has 19 statuses. Switch off-thumb is `bg-surface`, so no new token is needed. Inset variable names fixed. Palette parts and Dialog moved to P3. L-03 moved to P3. `CHROME.strip.height`. |
| 23 | 03-kit | §8 delete list | CommandPalette deleted in P3. ProjectPicker/CodebasePicker deleted in P0-05. RightPane: see edit 11. `cmdk` removed with `SearchableSelect`. |
| 24 | 03-kit | §9 build order, §10 | Build order aligned with 07. Status line on the issues. |
| 25 | 03-domain | F-chats-03 | **Duplicate NewChatDialog resolved:** F-create-02 is the one component. F-chats-03 is retired (ID kept, marked). |
| 26 | 03-domain | B-06 | Old files are deleted in P0-05; B-06 is built new in P5. |
| 27 | 03-domain | §3.11, §2.x, §7 | `useCreateChatForm` location. StatusBadge 19 statuses, `ChatStatusBadge` 254–289. Status line on the discrepancies. |
| 28 | 04 | §0 | Route modules live in `app/routes/` (agrees with 06/07). Removed the stale "M-12 says features/composer" note. |
| 29 | 04 | §2.1, §2.5, §1 | Dead files deleted in P0-05. CommandPalette owner is P3 + P5 (it disagreed with 04's own route table). AuthGate `:160`. |
| 30 | 05 | §5 item 1 | G-01 depends on the status map from P1-T10; it no longer builds its own. |
| 31 | 06 | §10 | Added the local-ID → 07-ID mapping. P3-S2 no longer deletes `CommandPalette.tsx` (P3-S3 does). ChatPage drops `legacyHeader` in P4-12, not P4-S1. Smoke file `dock-desktop-smoke.mjs` (does not exist) → the rewritten `right-pane-desktop-smoke.mjs`. |
| 32 | 06 | §2.4, §11 | RR8 paragraph follows the 07 order. Issue 14 resolved (Vite 7 is in D-37). Status line: all 14 issues mapped to D-xx. CSP line `:34`. |
| 33 | 08 | §1 | Vocabulary path is `css/vocabulary.css` (02 §10.2). 48 icon concepts. NAV/commands path is `ui-contract/commands.ts`. Composer state ids match 03-domain. `copy.ts` lives in `ui-contract`. Every M-item carries its task ID. |
| 34 | 09 | §6 heading, §7.2 | Repo-root `CLAUDE.md` → `.claude/CLAUDE.md`. |
| 35 | 09 | §6.1 | Added "when each step becomes available", so a P0/P1 session knows which Done-loop steps it can run yet. |
| 36 | 09 | §6.2, §6.6, §6.7, §3.1, §3.4, §4.6, §5.2, §6.5 | Sandbox is owned by P2-00. Each script's task ID is named. Mac inset variable fixed. New smoke unified as `desktop-dock-browser-smoke.mjs` (it had two names). |
| 37 | 09 | Issues | Status line: all seven resolved. |
| 38 | 10 | §2 CLAUDE.md, §5 | Added the missing owner rules: all 3 OSes first-class, playwright-cli path and flags, no backward compatibility, explicit subagent models, Codex test models. Route-module path fixed. The CLAUDE.md file is described as effectively empty. |
| 39 | 11 | DF-02, DF-19…22 | DF-02 matched to D-12. Added the D-42 deviations (pairing code, "Custom" exposure, "Agents & models") and the focus/switch-thumb deviations. |
| 40 | README | map, index | 60 boards; PNGs are local. chats/create entries reflect the NewChatDialog ID resolution. |

## Open issues for the owner

1. **P0-06 is an owner action.** The PD-19 amendment text in `07-phases.md` §Coordination has to be applied to the Workflow Overhaul Plan artifact by you.

Resolved by the plan author after review (2026-09-25, recorded in `01-decisions.md`):
- **Pairing code** — verified in code: `packages/shared/src/utils/pairingCode.ts` defines `PAIRING_CODE_LENGTH = 12` and `PAIRING_CODE_GROUP_SIZE = 4`. `PairingCodeInput` (C-28) renders 3 groups of 4 from those constants; the board's 6 boxes are a design error (DF-19, D-42).
- **Tray order** — the tray follows `NAV_DESTINATIONS` (sidebar order, D-22/D-24). No `trayOrder` field.
- **Device-scoped appearance on desktop remote mode (06 §6.5)** — deferred, out of scope for this pass (D-39). Appearance stays per server origin (D-25).

## Confidence per phase

| Phase | Confidence | Note |
|---|---|---|
| P0 | High | Every script and config change now has an owning task and a concrete acceptance. |
| P1 | High for U/S tasks, medium-high for tokens | Token work is detailed (02 §13); risk is in the size of T5/T6 and in the 252-combination suite. |
| P2 | Medium-high | Shapes are well specified; G-10/G-15 depend on the Workflow Overhaul Plan's migration. |
| P3 | Medium-high | The shell is the riskiest cross-OS PR (P3-04 is large). The palette now has all its parts in the same phase. |
| P4 | Medium | Largest regression surface (composer, native browser, dock). Mitigated by characterization tests, two-PR splits and 3-OS smokes. The D-33 virtualization spike may fall back. |
| P5 / P6 | High | Parallelizable ports on a finished kit; gaps are named. |
| PW / P7 | Medium | Depends on the other plan's timing; the D-35 fallback keeps P7 unblocked. |
