---
title: Web application
description: The React application, route map, browser capabilities, and development workflow.
---

# Web application

The web client is a React 19 application built with Vite and React Router. It is also the desktop renderer. It provides the primary visual authoring surfaces for chats, reusable agents, workflow graphs, automations, project configuration and integrations.

## Run locally

From the repository root:

```bash
pnpm dev
```

The normal development setup runs the backend on port `3100` and Vite on `5173`. The Vite configuration forwards API traffic to the backend. Open the Vite address printed by the command, pair the browser when required, and confirm the selected backend before starting work.

```bash
pnpm --filter @generatorai/web build
pnpm --filter @generatorai/web typecheck
pnpm --filter @generatorai/web test
pnpm --filter @generatorai/web check:bundle
pnpm --filter @generatorai/web check:design
```

A production server can serve `apps/web/dist`; hosting only the static SPA does not provide the API, event streams, workspace filesystem or provider runtimes.

## Every routed surface

| Route | Screen and main responsibility |
| --- | --- |
| `/` | Dashboard: recent/active work and navigation |
| `/chats` | Chat catalogue and creation |
| `/chats/:id` | Streaming conversation and workspace workbench |
| `/agents` | Agent catalogue |
| `/agents/new`, `/agents/:id` | Agent creation and editing |
| `/workflows` | Workflow catalogue |
| `/workflows/new` | Visual workflow creation |
| `/workflows/:id` | Definition summary, configuration and runs |
| `/workflows/:id/edit` | DAG/stage/edge builder |
| `/workflows/:id/runs/:runId` | Run progress, stage inspection and workspace review |
| `/automations` | Automation catalogue |
| `/automations/new` | Trigger, input and execution configuration |
| `/automations/:id` | Automation configuration and execution history |
| `/projects` | Project catalogue |
| `/projects/new` | Project creation |
| `/projects/:id` | Project settings, codebases and scoped resources |
| `/projects/:id/codebases/:cid` | Repository/codebase detail |
| `/projects/:id/codebases/:cid/pull-requests/:number` | Pull request inspection |
| `/scripts` | Programmatic workflow catalogue |
| `/scripts/:id` | Script metadata, profiles and execution |
| `/settings`, `/settings/:section` | [Application settings](./settings.md) |
| Unmatched route | In-app 404 |

The routed pages are lazy loaded with a page-scoped error boundary and a loading fallback. A page error should leave the surrounding navigation usable. Authentication is checked before the router mounts, preventing an unpaired client from issuing a page full of protected requests.

## Browser-specific behavior

The integrated Browser panel shows a server-side Chromium session. Full user interaction is initially disabled in the web UI for performance; enable it in **Settings → Browser & Terminal** when you want to navigate, click and type. Inspection and observing an agent-driven page have separate behavior. Desktop uses its native bridge and does not share this web-only toggle.

Terminal commands execute on the host, with xterm providing the browser UI. Browser API availability also affects clipboard, microphone access, downloads and folder selection. Use a secure context where a browser requires it, and prefer an actual native mobile build when testing phone-specific behavior.

The layout uses a collapsible sidebar and a resizable right pane. At narrow widths the workbench panel becomes an overlay sheet. The viewport becoming phone-sized does not turn the React SPA into the Expo application.

## State ownership

TanStack Query caches server resources. Zustand stores UI/session state. Streaming and platform access come through the shared client packages. Theme choices, default chat model, terminal preferences and pane widths are device-local; provider settings, source-control accounts and many integration settings belong to the selected server.

If a setting appears different in another browser, first check whether it is a local preference. If a server mutation fails, check scope grants and connectivity rather than treating a stale optimistic view as success.

## Troubleshooting

- **Pairing screen:** establish the browser's device credential with the intended host; changing host identity is not a normal route failover.
- **Chat stops updating:** inspect connection status and reconnect behavior. Reloading can restore persisted events, but does not cancel work.
- **Browser has no interactive control:** enable the web interactivity preference and confirm `exec:browser`.
- **Two scrollbars or clipped panels:** check viewport size, collapsed navigation and page-specific panel state; the intended shell constrains each pane's scroll owner.
- **Build passes but native behavior differs:** desktop bridge operations and mobile native APIs need their own runtime validation.

Sources: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/src/{App,router}.tsx`, `apps/web/src/components/AuthGate.tsx`, `apps/web/src/components/layout/`, `apps/web/src/components/settings/sections/BrowserTerminal.tsx`, `apps/web/src/providers/`.
