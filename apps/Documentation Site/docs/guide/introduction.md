# GeneratorAI documentation

GeneratorAI is an agent workspace for working on code through chats, reusable agents, workflows, and automations. Desktop, web, mobile, and terminal clients connect to a shared service layer that coordinates providers, files, tools, execution history, and review.

This handbook describes the **current implementation in this checkout**, including uncommitted changes present when the documentation was written. GeneratorAI is alpha software; client capabilities and provider capabilities are not identical.

## Choose a starting point

| What you want to do | Start here |
| --- | --- |
| Install dependencies and run the application | [Quick start](./quickstart.md) |
| Learn the vocabulary | [Core concepts](./concepts.md) |
| Find a feature or control | [Feature catalogue](../features/index.md) |
| Compare desktop, web, mobile, and terminal | [Client capability map](../clients/overview.md) |
| Understand how a request executes | [Architecture](../architecture/overview.md) |
| Integrate with the running host | [HTTP API](../reference/api.md) |
| Change settings or environment configuration | [Settings](../clients/settings.md) and [configuration](../reference/configuration.md) |
| Operate, troubleshoot, or extend the application | [Operations](../operations/deployment.md) and [development](../operations/development.md) |
| Review what has been documented | [Source coverage](../reference/coverage.md) |

## How to read these docs

Feature guides explain user actions, outcomes, prerequisites, and limitations. Client guides explain how those features appear on each client. Architecture guides explain service boundaries and implementation paths. Generated references enumerate source structure so less visible modules remain discoverable.

A **Source evidence** section names repository paths you can inspect alongside the Markdown. Those paths are code references, not links to a public repository or files copied into the hosted site. Generated route listings identify source line numbers for implementation lookup.

The site itself is static. Browsing an example does not run an agent, modify a project, or connect to a GeneratorAI server. Documentation examples are instructions for a future session, not actions performed during this documentation work.

## Implementation, availability, and validation

A feature can exist in source while requiring a configured provider, a granted scope, an operating-system permission, or an optional host process. Read the prerequisites before assuming it is available on every client.

The [validation report](../about/validation.md) records checks performed on **this documentation site**. It does not certify that all product workflows were executed in this task.
