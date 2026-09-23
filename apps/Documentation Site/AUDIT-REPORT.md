# Documentation site delivery and audit

This records the original documentation delivery. See [the theme/configuration follow-up](THEME-COVERAGE-REPORT.md) for the current expanded site and validation results.

Date: 20 September 2026. Scope: the GeneratorAI working tree available during this task.

## Delivered

Created a self-contained **React 19.2.0 + Docusaurus 3.10.2** documentation application inside `apps/Documentation Site`. Product guides are ordinary Markdown, so they can be read directly or published as the generated static website. Vue and VitePress are absent from the final dependency lockfile and clean installation.

The site includes a custom landing page, grouped navigation, page outlines, breadcrumbs, previous/next links, heading anchors, local full-text search, light/dark themes, syntax highlighting, code-copy controls, keyboard focus styles, reduced-motion support, and responsive layouts. The production output needs only static hosting.

All changes made by this task are inside this folder. Nothing was staged or committed.

## Framework research and decision

[Docusaurus](https://docusaurus.io/docs) supplies a React component model, Markdown documentation, static generation, navigation, and theming. These match the requested React stack and reduce custom infrastructure needed to maintain the handbook. Next.js with a documentation theme was a React-compatible alternative, but this site does not need application-server behavior. The [framework decision](docs/about/site.md) records the comparison.

The [official search documentation](https://docusaurus.io/docs/search) describes hosted and community search options. [EasyOps local search](https://github.com/easyops-cn/docusaurus-search-local) was selected so the generated index travels with the static files and does not require a hosted search account. Domain and subdirectory settings follow the [Docusaurus deployment model](https://docusaurus.io/docs/deployment).

Versions and the npm lockfile are pinned within this folder. Two narrowly scoped transitive overrides address inherited build/development dependency advisories; the clean installation, production build, and browser checks validate the resulting dependency set.

## Documentation coverage

There are **50 Markdown pages**, organized as follows:

| Area | Pages | Coverage |
| --- | ---: | --- |
| Getting started | 4 | Concepts, setup, first tasks, greenfield and brownfield scenarios |
| Features | 15 | Navigation, projects, chats, interactions, workspace panels, agents, workflows, runs, scripts, automations, integrations, extensions, source control, settings |
| Clients and configuration | 7 | Desktop, web, mobile, CLI/TUI, SDK/MCP, settings, capability differences |
| Architecture | 11 | Modules, storage, execution, providers, security, transports, processes, workspaces, extensions, voice and observability |
| Design | 1 | Shared design system, layout, tokens, platform-specific controls and behavior |
| Technical reference | 6 | API, configuration, source coverage, HTTP routes, environment reads, CLI surface |
| Operations | 3 | Development, deployment, troubleshooting |
| Documentation maintenance | 3 | Framework decisions, hosting, validation |

The generated [source coverage inventory](docs/reference/coverage.md) accounts for:

- **10 top-level application packages and 20 shared packages**; authored guides also cover the nested mobile device-key module and separate `agent-tests` workspace.
- **331 literal HTTP route registrations**, plus two separately documented regex routes for browser files and widget assets.
- **20 web page component files** and **41 mobile route-tree files**, including layouts and redirects; these are structural counts, not unique visible screens.
- **15 settings sections** implemented by 13 settings component files.
- **222 distinct environment-variable names found in static reads**, 15 shared schema files, and 1,435 indexed runtime source files. Environment names are documented; private `.env` values are not read or copied.
- A CLI snapshot with **219 commands across 25 groups**, 192 server-backed commands, 34 destructive commands, and 165 keybindings. Command IDs were cross-checked against the registry during authoring.

See [source-inventory.json](audit/source-inventory.json) for the machine-readable structural inventory. Generated references state their extraction limits. Counts alone do not establish that every runtime branch was exercised.

## Source accuracy findings

The documentation follows current implementation rather than repeating stale README claims. Independent reviews corrected and documented these distinctions:

- The live relay path is not end-to-end encrypted against the relay operator; available encryption primitives are not wired into that complete path.
- The SDK is a private, internal, in-process surface used by the MCP CLI, rather than a published HTTP SDK.
- Some standalone host processes are optional or not the default execution path. SQLite remains the operational database; the optional DeltaLog path does not provide replay-based recovery.
- Forking a chat shares its workspace. The Files pane is read-only and delegates editing to an external editor.
- Workflow JSON validation and LLM validation have narrower behavior than their labels could imply. Rejection, failure edges, stage capacity, and human-review waiting are described with their actual transitions.
- Extension widgets and custom tools activate, while other declared contribution types have staged or unwired paths. Workspace installation requires explicit API context where the current UI omits it.
- Server environment loading, database defaults, development ports, pairing, provider support, service-account verification, and native-client capabilities are documented with their actual constraints.

These are documentation findings. Product code was not changed by this task.

## Validation results

| Check | Result |
| --- | --- |
| Markdown structure, local links, module coverage, React dependency guard | Passed for all 50 documents |
| Clean isolated dependency installation | Passed; no Vue/VitePress packages |
| Production root-path build | Passed with strict broken-link checks and local search generation |
| Production `/generatorai/` build | Generated successfully |
| Full root-path browser regression | **114/114 passed**, zero unexpected browser console or page errors |
| `/generatorai/` browser interactions | **10/10 passed**, zero unexpected browser console or page errors |
| Dependency audit snapshot | **0 advisories** reported |

The full browser sweep visits **52 generated routes**—50 documents, the homepage, and the search page—at 1440 × 1000 and 390 × 844. Every route returned successful content, hydrated, displayed its main heading, loaded its images, and avoided document-level horizontal overflow. Screenshots were saved for each page at both sizes.

Ten additional checks cover homepage navigation, search results and keyboard selection, dark-theme persistence, code-copy feedback, keyboard skip navigation, the mobile drawer, mobile search, a 360 × 640 search dropdown, not-found recovery, and the 820 × 1180 tablet layout. The intentional missing-page request is required to return HTTP 404; its expected console entry is recorded separately from unexpected errors. Automation used Playwright's Chromium driver with the installed Google Chrome executable. Safari and Firefox were not exercised. The site was also opened and inspected in the in-app browser, including the homepage, source coverage, search, and mobile navigation.

Issues corrected during verification:

1. Added a main landmark to the search page through a small React theme wrapper.
2. Constrained search results to the available viewport height, with scrolling for long result lists on short phones.
3. Normalized documentation links and fixed generated route joins.
4. Kept dependency installation isolated and removed obsolete framework packages with a clean lockfile installation.
5. Switched local search to filename hashing to avoid query-string asset redirects in subdirectory preview. Preview also uses the same `DOCS_BASE` as its build; the hosting guide includes both commands.
6. Made the browser runner save its evidence before teardown and bound the shutdown wait, after a Chrome close handshake stalled. The subsequent subdirectory run exited successfully.

Machine-readable evidence: [root browser results](audit/browser-results.json), [subdirectory browser results](audit/subpath-browser-results.json), and [dependency audit](audit/dependency-audit.json).

Selected screenshots:

- [Desktop homepage](audit/screenshots/desktop-home.png)
- [Architecture guide](audit/screenshots/desktop-architecture-overview-.png)
- [Mobile client guide](audit/screenshots/mobile-clients-mobile-.png)
- [Dark theme](audit/screenshots/home-dark.png)
- [Mobile navigation](audit/screenshots/mobile-navigation.png)
- [Short-phone search](audit/screenshots/small-phone-search.png)
- [Tablet homepage](audit/screenshots/home-tablet.png)

## Scope and remaining limits

This task analyzed the application source and tested the documentation website. It does **not** certify every GeneratorAI agent execution, provider account, desktop release package, mobile native integration, or operating-system behavior. Accessibility checks here cover the stated landmarks, keyboard behavior, focus styles, and responsive layouts; they are not a complete WCAG conformance audit.

The working tree already contained product changes. A comparison against 2,864 baseline file hashes also observed concurrent updates outside this folder. Those files were neither edited nor reverted by this task. Consequently, the scope check reports those differences instead of claiming the entire shared working tree remained unchanged. The staging area remained empty.

The website is running locally; it has not been published. Set a real `DOCS_URL` and, if needed, `DOCS_BASE` before deployment. The default public origin is an explicit placeholder. Node 26 emitted a nonfatal experimental localStorage warning during the build; the static output and browser checks passed.

## Run and maintain

```bash
cd 'apps/Documentation Site'
npm ci
npm run dev
```

Use `npm run build` and `npm run preview` to test production search. Edit content under `docs/`, regenerate source references after structural product changes, and rerun the content/build/browser checks before publishing. The [README](README.md) and [hosting guide](docs/about/hosting.md) contain the reproducible commands.
