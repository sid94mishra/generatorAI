# User journey: building "Pulse" with GeneratorAI (2026-10-11)

The owner asked for a real-user run: build a production-grade project end to end using only GeneratorAI —
projects, specialist agents, orchestrator mode with Claude + Codex, chats, workflows, automations, source
control (commit → PR → merge) and GitHub issues — against the sample repo
`github.com/sid94mishra/WORKFLOW_TEST` (base `develop`), logging every product issue met on the way, fixing
it, and carrying on.

**Pulse** — self-hosted uptime monitoring and public status pages. pnpm monorepo: Fastify 5 API + SQLite
(`apps/api`), React 19 + Vite dashboard and status page (`apps/web`), zod schemas (`packages/shared`), check
engine (`packages/checker`); Vitest + Playwright; GitHub Actions CI. Iterations land as PRs to `develop`.

## Setup done as a user
- Project **Pulse** with codebase `pulse` (git remote, `develop`) — cloned, Ready.
- Agents (project scope): Pulse Architect (Claude Opus), Pulse Backend Engineer (Codex GPT-5.6-Terra),
  Pulse Frontend Engineer (Claude Sonnet), Pulse QA Engineer (Codex GPT-5.6-Luna), Pulse Reviewer (Claude
  Opus), Pulse Tech Lead (orchestrator, Claude Opus, team = the five).
- GitHub account connected in Settings → Source control (fine-grained token, this repo only).

## Issues found (product)
| # | Where | What a user sees | Severity | Status |
|---|---|---|---|---|
| U-1 | Project header | The project's internal app-data path (`…/Application Support/@generatorai/desktop/data/artifacts/projects/<id>`) is printed under the title | low | fixed — path stays in Settings (with Copy) and the ⋯ menu |
| U-2 | Agent editor → Runtime | With Provider = Codex, the Model picker opens on Claude Code's models; the user has to switch provider again inside the picker | medium | fixed — `ModelPicker.preferredProvider`; changing Provider clears a model of another provider |
| U-3 | New chat → Agent | A project's own agents (Pulse Tech Lead) are not in the Agent list until a Project is picked — and Project sits below Agent, so search finds nothing | medium | fixed — project agents are listed before a project is chosen; picking one selects its project (dialog and full page) |
