# 00 — Context and analysis

Everything a new session needs to understand *why* the plan looks the way it does. Numbers were measured on `desktop_redesign @ a83a7bf` (2026-09-23/24) with grep/tsc unless marked as estimates. Raw research reports are in `research/`.

---

## 1. The product surfaces in scope

| Surface | Code | Role in this pass |
|---|---|---|
| Web SPA | `apps/web` (React 19.2, Vite 6.4, Tailwind v4.2, Radix, zustand 5, TanStack Query 5, react-router 7) | **Rebuilt** view layer |
| Desktop | `apps/desktop` (Electron 42) | Loads the same SPA from an embedded server; window chrome, native menu, tray, deep links, and a native `WebContentsView` for the chat Browser tab. **Chrome and contracts updated** |
| Mobile | `apps/mobile` (Expo 57, RN 0.86, NativeWind 4 / Tailwind v3) | **Not rebuilt in this pass.** Shared foundations are prepared (see `08-mobile-readiness.md`) |
| Server | `apps/server` | Only the API gaps listed in `05-gap-matrix.md` |

## 2. How the web and desktop clients work today (mental model)

```
apps/desktop (Electron main)
  index.ts ── spawns embedded server (apps/server serving apps/web/dist at "/" + /api) on a loopback port
  window-manager.ts ── BrowserWindow → loadURL(http://127.0.0.1:<port>/)   (dev: Vite URL; remote: other server)
     per-OS frame (platform.ts): mac hiddenInset + trafficLightPosition · win hidden + titleBarOverlay (h 40)
                                 · linux native frame (custom only with GENERATORAI_LINUX_CUSTOM_TITLEBAR=1)
  menu.ts / tray.ts / deep-link.ts / updater.ts ── native UI; commands sent to the renderer as DesktopCommand
  browser-host.ts ── one WebContentsView per browser tab, bounds driven from a DOM placeholder
  preload/index.ts ── window.generatoraiDesktop bridge (chrome, theme, dialogs, find, settings, browser.*)
  resources/{splash,error,prompt}.html ── static pages with hard-coded hex colours

apps/web (renderer)
  App.tsx: ThemeProvider → QueryProvider → PlatformProvider → AuthGate (pairing UI) → RouterProvider
  router.tsx: one layout route "/" → AppLayout; 23 lazy routes + a static `*` 404 route
  AppLayout: TitleBar (desktop only) · Sidebar · Header (route-sniffing, chat actions) · <Outlet/> · RightPane (dock)
  view layer: pages/* (21), components/<domain>/* (~230 files), components/ui/* (thin primitives)
  data layer (STABLE — do not rewrite):
    platform/HttpPlatformClient.ts (REST+SSE) · platform/authRuntime.ts, authTransport.ts (DPoP, device key, fetch interceptor)
    platform/muxStream.ts (one EventSource per tab) → stores/sseManager.ts (processEvent: "do not rewrite")
      → stores/streamStore.ts (binds packages/client-core stream reducer) · chatStore · connectionStore · workflowRunStore
    hooks/*Queries.ts (TanStack Query wrappers over usePlatform())

packages (React-free; shared with mobile and CLI)
  client-core (stream reducer, block types, diff parser) · client-runtime (auth runtime, pairing, connections)
  client-transport · shared (types, IPlatformClient, errors) · relay-protocol · auth
  design-tokens (17 ThemeDefs → CSS layers for web, TS module for mobile, ANSI for xterm, WCAG test suite)
```

**The data/view boundary is clean enough to swap the view layer.** 43 component/page files use the `*Queries.ts` hooks. Exceptions to fix while porting:
- 18 components and 3 pages import `platform/*` directly.
- 13 files call `usePlatform()`.
- `ChatPage.tsx` issues raw `fetch('/api/workspaces/…')` from handlers (lines ~752, 774, 1538).
- `Security.tsx` calls `apiFetch`.
- Stream-derivation logic sits beside components: `components/agent/deriveTimeline*.ts`, `liveCounters.ts`, `components/workflow/redesign/deriveRunView.ts`.

## 3. What is wrong with the current UI (diagnosis)

| Area | Finding | Numbers |
|---|---|---|
| Tokens | Only colours are tokenized on the web. There are no type, spacing, shadow, z-index or height tokens. `rounded-lg`/`rounded-xl` follow the theme radius only by accident (a Tailwind name collision) | 577 arbitrary font sizes (`text-[11px]` ×217, `text-[10px]` ×214 …); z-index values `z-[1000]`, `z-[1100]`, `z-[1200]` … |
| Colour discipline | Tokens are bypassed | ≈1,400–1,500 `[var(--color-*)]` arbitrary values in 62–69 files (1,403/62 or 1,509/69 depending on the regex); 299 hard-coded palette classes (`RuntimeStageNode.tsx` alone 58–75, depending on the regex); 32 white/black; 26 hex; 79 inline `style={{}}` |
| Primitives | Thin. No cva (installed, unused). `Button` has no `asChild`. `Tabs` has one style | `variant="unstyled"` escape hatch ×51; 4 hand-rolled tab strips; 70 hand-rolled card divs vs 5 `<Card>`; ~15 local status maps/pills |
| Giant files | Transport, state and view mixed | ChatInput 2,122 lines · BrowserPanel 2,105 · ChangesSurface 1,890 · ChatPage 1,632 · Security 1,420 · ProjectDetailPage 1,389 · ComputerPanel 1,201 · CreateAutomationPage 1,119 (40 `useState`) · AgentEditorPage 1,024 · TerminalPanel 979 · RightPane 967 |
| Shell | Layout logic is spread out | `Header.tsx` works out the title from the URL, runs chat queries and owns chat actions; ChatPage owns its own split-resize state |
| Enforcement | Weak | ESLint design rules are `warn`. CI fails only on ratchet *increases*, and the ratchet ignores arbitrary values, hex, `var()` bypass and `unstyled`. No visual tests. The `design-system-baseline.json` is stale |
| Docs | Out of date | `DESIGN_SYSTEM.md` has wrong prop names and "planned" items that exist; `.claude/CLAUDE.md` is empty; `.github/AGENTS.md` describes the old UI |
| Libraries | Stale | tailwind-merge ^2.6 targets Tailwind v3; lucide 0.460 (1.x renamed icons); cmdk last released March 2024; highlight.js duplicates Shiki (used by @pierre/diffs); `material-file-icons` unused |

The design's own audit board (`boards/web/Audit.dc.html`) measured the running app and reached the same conclusion:
- 16 font sizes, 10 of them arbitrary.
- 174 lucide icons used for about 35 concepts (the Audit board's figure; measured in `apps/web/src`: 147 direct `lucide-react` imports).
- 7 tab strips in 5 styles.
- 6 disagreeing stage-status colour maps.
- 11 hand-rolled menus.
- 344 palette classes.
- 19 screens with horizontal overflow.

Its verdict: the token system "is sound and stays"; nothing above it is shared.

## 4. What the design asks for (web/desktop, v2 — 78 boards)

Source: https://claude.ai/artifact/9dDDpwCiWcs5jEUA8ivPUs (snapshot in `boards/web/`, 60 boards + `canvas.json`; the 18 per-theme boards other than ThemeInstrument (17 themes + ThemeGallery) are omitted because the token registry is their source).

- **One design system.** A byte-identical `<helmet><style>` block across all 60 non-theme boards defines the token names and ~20 primitive classes. Everything else is inline composites built from them.
- **Tokens.** New semantic names (ground/surface/raised/overlay/sunken, hover/selected, line-soft/line/line-strong, fg/fg-2/fg-3, run/ok/warn/err + tints, add/del, shadow-pop, scrim). The existing 17 themes map onto these names exactly — the reviewer verified all 34 appearance variants against the current resolver.
- **New pieces.** One new theme (**Instrument**, default) and one new accent (**ink**, default). A 7-step type scale (11–28). Radii 4/5/6/7/8/10/12. Control heights 24/28/32. Bundled Instrument Sans + JetBrains Mono. Density and interface-font-size settings.
- **Status.** An 8-state status map (Queued, Running, Waiting, Needs you, Paused, Succeeded/Done, Failed, Skipped). "Waiting" was added in v2.
- **Shell.** Sidebar with server switcher, Needs you and Running lists; 48px rail below 1200px; inset main card with its own 44px page header; Settings as a 960×640 modal; right dock with a pinned Files tab and an overlay sheet on narrow windows; per-OS title chrome.
- **Screens.** 10 layout families (see `03-component-inventory-kit.md` for T-01..T-05, L-01..L-05).
- **Workflow boards.** The workflow/automation/scripts boards in v2 draw the end state of the separate Workflow Overhaul Plan — see §6.

## 5. Independent review of the earlier plan (what changed and why)

A first plan (`research/plan-audit.md` audits it) proposed a separate `packages/ui`, a kit built before any page, an alias-based token rename, and an early Tailwind namespace reset. An independent adversarial review checked it against the code:

| Finding | Severity | How this plan addresses it |
|---|---|---|
| The design needs server/API work; "data layer unchanged" was false (attention feed, stats, project columns, plan revisions …) | Critical | D-36, `05-gap-matrix.md`, Phase P2 backend track |
| Collision with the Workflow Overhaul Plan (PD-19) → workflow UI built 3× | Critical | D-35: those screens are built once, on the kit, by that plan |
| Early Tailwind namespace reset silently blanks unported pages | Critical | D-07: reset at lockdown, gated on zero usage |
| Removing the global Header before pages are ported loses chat actions and breaks smokes | Critical | D-21: `LegacyHeader` slot per route |
| Kit-before-pages bakes in wrong APIs while the design still changes | Major | D-01: vertical slices; each primitive lands with its first consumer |
| Token aliasing is wrong (old→new mapping differs in light vs dark); footprint 3× larger than estimated | Major | D-06: additive layer; codemod only colliding names |
| tailwind-merge drops custom classes | Major | D-09: v3 with a generated config + tests |
| `packages/ui` costs plumbing with one consumer | Major | D-04: `apps/web/src/ui` + lint boundaries |
| Desktop gaps: narrow dock sheet hides its own browser view; mac lights vs 48px rail; per-OS title heights; Chrome-reserved shortcuts | Major | D-19, D-23, D-24 |
| No characterization tests for giant files; no screenshot baselines | Major | `09-verification.md` |
| Undesigned screens, toasts, density, virtualization, i18n | Major | D-15, D-30, D-32, D-33, D-39 |

The reviewer kept: the layer model, the token engine and WCAG suite, Radix→(now Base UI) wrapped behind the kit, cva, page-by-page strangler, delete-as-you-go, and the design-class→component "Rosetta" table ("the single most useful LLM aid").

## 6. Relationship to the Workflow Overhaul Plan

- **Where it lives:** https://claude.ai/artifact/Kqrzv5CnsYg13EdQNTp2gC — v1.2, dated 2026-09-24, same base commit. It is strictly sequential, P00–P09, about 28–34 engineer-weeks.
- **What it delivers:**
  - workflow versions and draft/publish (P01);
  - a shared session editor, and permissions for automations (P02);
  - engine v2 with Waiting/Paused/attempts and stage conversation (P03/P03b);
  - one invocation path with Setup/Finalize lifecycle and the RunDialog (P04);
  - loop/map/wait/check/sub-workflow stages (P05);
  - workflow tools in chat (P06);
  - economy and version diff (P07).
- **The conflict:** its decision PD-19 builds that UI on the *existing* components and has the redesign "reskin afterwards".
- **The resolution (D-35):** that plan builds those screens once, on this plan's kit, after redesign P4. This plan provides the kit, shell, transcript kit, workflow kit pieces (WF-xx) and chat extension points. `07-phases.md` §Coordination has the exact amendment text for that plan.

## 7. Mobile design (considered, not implemented)

Source: https://claude.ai/artifact/3bBuQ3vGwYbJh7A2yX7kqA (131 boards). It reuses the desktop token names and values unchanged, the same 7 accents, the same drawer order as the new desktop sidebar, the same status list, the icon set and the card vocabulary. It has per-platform type ramps (iOS body 17 / Android 16) and radii. `08-mobile-readiness.md` lists what this pass prepares so the mobile overhaul can start immediately afterwards, and the mobile-specific decisions deferred to that pass.

## 8. Non-negotiable constraints

1. **Cross-platform.** Windows, Linux and macOS are first-class. No fix may correct only the platform being tested. Platform differences go through shared helpers/constants (`CHROME`, `lib/desktop.ts`), not ad hoc `process.platform` checks.
2. **Verification.** Features are verified by driving the running app with `playwright-cli --browser=chrome --headed` as a user would, in addition to automated tests.
3. **SCM safety.** Git/source-control features are tested against a throwaway dummy repo, never this checkout.
4. **No backward compatibility.** Clean cut-overs, deleting old code in the same PR; temporary scaffolding only as listed in D-02.
5. **Desktop contracts** (`06-desktop-and-shell.md`):
   - same-origin SPA with relative API calls;
   - `window.generatoraiDesktop` feature detection through `lib/desktop.ts`;
   - drag regions and insets;
   - `<html>` state classes;
   - the overlay contract;
   - the `DesktopCommand` set;
   - client-side routing via `pushState` (a real main-window navigation orphans native browser tabs);
   - `window.showDirectoryPicker` shim;
   - IPC reachable only from the main window's top frame.
6. **Security invariants** keep passing (`scripts/check-no-app-wide-cdp.mjs`, `scripts/check-security-invariants.mjs`).
7. **Data layer stability.** `platform/*`, `stores/sseManager.ts`, `stores/streamStore.ts`, the `client-*` packages and `shared` are not rewritten. New behaviour goes into `client-core` (so mobile follows) or into new query hooks.
