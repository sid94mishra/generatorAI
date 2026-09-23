# Documentation validation

The documentation is checked at three levels: source coverage and factual review, production build checks, and browser behavior. This page describes the verification scope. The original delivery summary is recorded in `AUDIT-REPORT.md`; the theme/configuration follow-up is recorded in `THEME-COVERAGE-REPORT.md` at the documentation-site root, with machine-readable evidence under `audit/`.

## Content and architecture review

The source inventory covers 10 top-level application packages and 20 shared packages. Authored guides explain the nested mobile device-key module and the separate `agent-tests` workspace as well. The generated references enumerate 331 literal server route registrations, two additional regex routes, 20 web page component files, 41 mobile route-tree files, 15 settings sections, shared schema files, and static environment reads. The CLI snapshot contains 219 commands across 25 groups and was cross-checked against the command registry during authoring.

The [coverage inventory](../reference/coverage.md) explains what these counts mean and their extraction limits. Structural coverage does not establish that every branch, provider behavior, or operating-system integration works at runtime.

Independent source reviews corrected stale claims about relay encryption, SDK publication/use, extension contribution activation, chat fork isolation, read-only file views, result validation, workflow rejection transitions, and `.env` loading.

## Build checks

`npm run check` validates Markdown structure, local file links, module coverage, and the React-only dependency declaration. The production build checks links and emits static HTML and a local search index. A clean `npm ci --ignore-scripts --offline --no-audit` was used during validation after populating this site's isolated package cache.

The site additionally validates 24 worked JSON bodies and four deliberately invalid configurations against source schemas. Configuration references expand 90 shared/CLI schemas into 2,994 field rows, with 35 supplemental route-local contracts. The theme snapshot covers 17 palettes, two appearances, and six accents.

The site uses React/Docusaurus; Vue and VitePress are absent from the final lockfile and clean installation. Two narrowly scoped transitive dependency overrides address inherited advisories. See `audit/dependency-audit.json` for the recorded npm audit result.

## Browser checks

The regression script visits all 71 generated index routes: 69 Markdown documents, the landing page, and the search page. It checks HTTP status, hydrated content, the main heading, image loading, and document-level horizontal overflow at desktop and phone widths, then saves screenshots.

Interaction checks cover:

- Landing-page navigation and deep links.
- Local search results, keyboard selection, and destination content.
- Dark mode and persistence across navigation.
- Code-copy feedback and the keyboard skip link.
- Mobile navigation and search.
- Search dropdown containment on a short phone screen.
- Not-found recovery and tablet layout.
- Application palette/accent tokens across 204 combinations, appearance persistence, keyboard dismissal, and phone controls.
- Downloadable configuration examples under the served base path.

The phone search dropdown has a viewport-relative height limit and its own scroll area, so long result lists remain reachable. The local-search page receives a main landmark through a small React theme wrapper. Both changes are confined to this documentation site.

The source supports `DOCS_BASE` for subdirectory hosting; a separate `/generatorai/` build and preview exercise that path. See [Hosting](./hosting.md) to reproduce the build settings.

## Evidence locations

| File or directory | Contents |
| --- | --- |
| `audit/source-inventory.json` | Extracted modules, routes, schemas, settings, and source-file index |
| `audit/browser-results.json` | Latest root-path browser regression results |
| `audit/subpath-browser-results.json` | Subdirectory-hosting interaction results |
| `audit/dependency-audit.json` | Dependency audit snapshot |
| `audit/screenshots/` | Per-page desktop/phone images and interaction screenshots |
| `AUDIT-REPORT.md` | Original delivery results and scope notes |
| `THEME-COVERAGE-REPORT.md` | Current theme/configuration follow-up and validation results |
| `audit/configuration-inventory.json` | Expanded configuration schema fields |
| `audit/example-validation.json` | Positive and negative configuration example checks |
| `audit/theme-tokens.json` | Source-derived palette/mode/accent combinations |

Screenshots and local baseline hashes are ignored by Git; they remain available for local review. The documentation and reproducible test scripts are ordinary files within this folder.

## Scope and limitations

This task documents the application and tests the documentation website. It does not rerun every GeneratorAI agent workflow or certify iOS/Android native behavior. Provider accounts, release packaging, deployment infrastructure, and accessibility conformance beyond the listed browser checks need their own validation.

All writes performed by this documentation task are inside `apps/Documentation Site`; no changes were staged or committed. A baseline hash check also observed concurrent changes in product files outside this folder. Those files were not edited or reverted by this task, so the report does not claim the entire shared working tree stayed unchanged.
