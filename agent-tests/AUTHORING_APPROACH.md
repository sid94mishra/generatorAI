# Web E2E authoring approach (playwright-cli driven)

We author each spec by **driving the live app with the `playwright-cli` skill first**, then encoding the verified flow into a deterministic Playwright spec. One feature-area = one phase; each phase is closed (green + reviewed) before the next.

## Per-phase loop
1. **Explore** — `playwright-cli open <url>` → `snapshot` to read the accessibility tree + element refs. Identify every interactive element and scenario (happy path, validation, empty state, edge cases) for that page.
2. **Record (codegen)** — perform each interaction with `playwright-cli` (`click`, `fill`, `select`…). Each prints the equivalent Playwright line using **semantic role locators**. Collect these.
3. **Trace (evidence/debug)** — wrap a representative flow in `tracing-start`/`tracing-stop` to confirm selectors, network calls, and console are clean; keep the trace as evidence.
4. **Author** — translate the recorded actions into a spec under `e2e/`, using the shared `helpers/` (API seeding + auto-cleanup, `gotoApp` with `load`, `mockAiStream` for AI runs). Add assertions (codegen captures actions, not expectations). Prefer role/text selectors; add `data-testid` only where role/text is ambiguous.
5. **Run & review** — `pnpm test:e2e` for the phase's spec; fix selectors/waits; confirm green; review coverage vs the scenario list; mark phase closed.

## Determinism rules (recap from TEST_PLAN §2)
- Seed via API, never click-to-create for setup.
- `waitForLoadState('load')`, never `networkidle` (SSE never settles).
- AI runs: `mockAiStream` (default) or live opt-in; assert status/structure, not generated text.
- Stable keys via backend ids; debounce/layout settle with short explicit waits.

## Phase order (Web)
- **W1 — Settings + Dashboard + Templates** (deterministic, read-mostly) ← validate the methodology first
- **W2 — Chats** (list/filter/create dialog/detail)
- **W3 — Automations** (list + create: triggers × input modes)
- **W4 — Projects** (list/create/detail tabs)
- **W5 — Workflow Builder** (stages/edges/config/validate/save) — adds first `data-testid` batch
- **W6 — Workflow Run + streaming + conditional routing + controls/HITL** (uses `mockAiStream`)

Then: core HIGH-gap Vitest → SDK facades → CLI.
