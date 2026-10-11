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
| U-4 | Changes → Branch vs develop (61 files) | The header shows "61 changes" but the file list area stays blank for several seconds on first open (the diff highlighter worker starting) — no loading indicator | low | open |
| U-5 | Changes → commit bar | After the agent committed everything (clean tree, 8 commits ahead), the bar still offers a commit message box and "Commit & push" | medium | fixed — a clean tree shows no message box; the action reads Push / Open pull request |
| U-6 | Changes → Commit & push (project codebase) | Fails at **Sync with base**: `merge: origin/develop - not something we can merge` (and the error prints the internal workspace path). Nothing is pushed | **high — blocks every PR** | fixed — sync fetches `+refs/heads/<base>:refs/remotes/origin/<base>` explicitly |
| U-7 | Project codebase → Fetch / new chats | A remote codebase is a bare clone with no fetch refspec: **Fetch** updates nothing and every new chat branches from the base as it was at clone time — after a PR merges, the next iteration would start from stale `develop` | **high** | fixed — bare clones get `+refs/heads/*:refs/remotes/origin/*` (and Fetch repairs older ones); new worktrees cut from a freshly fetched `origin/<base>` |
| U-8 | Project → Pull requests / Issues | GeneratorAI can open a PR but **cannot merge** one, has **no GitHub issues** (no list/create, no tab) and agents have no issue tools — so "raise an issue → a workflow fixes it" is impossible in-app | **high — missing capability** | fixed — D-146: Merge card (merge/squash/rebase), Issues tab + issue page + Fix in chat, `github_*` agent tools (writes ask; merge always asks a person) |
| U-9 | Changes → Open pull request | A token without the right permission fails with GitHub's raw JSON (`GitHub createPullRequest failed (403): {"message":"Resource not accessible by personal access token",…}`) instead of naming the missing permission | medium | open |
| U-10 | Generated PR description | The generated PR body says "Test plan — Not verified … does not indicate whether they were run" although the chat had just reported 101 passing tests; PR generation ignores the chat's own results | medium | open |
| U-11 | Chat → "create a workflow" | A plain chat has **no workflow tools** (the per-chat "Workflows" toggle was never registered) and nothing says how to get them; the agent could only describe the workflow | **high** | fixed — built-in **Workflow Author** agent (workflows + authoring on) and a **Describe it** start on New workflow that opens a chat with it; also works by granting an agent the Workflows/Workflow authoring capabilities |
| U-12 | Workflow builder | A 14-stage agent-drafted workflow opens at 20% zoom — unreadable until the user zooms | low | open |
| U-13 | Workflow builder banner | "Drafted by **Orchestrator** in a chat" — shows the role, not the agent ("Pulse Tech Lead") | low | open |

## Journey log
- **Iteration 1 (orchestrator chat, ~30 min):** Pulse Tech Lead planned and delegated — Architect (spec + ADR), Backend (Codex Terra: shared/checker/api), Frontend (Sonnet: web), QA (Codex Luna: clean-checkout run), Reviewer (Opus: 15 fixes). 61 files, 8 commits, **101 tests pass**, lint/format/build green. Pushed and **PR #9** opened from the Changes tab (after U-6 fix + token permissions); CI ran on GitHub Actions.
- **Workflow authoring:** a plain chat could not author (U-11); granted the Tech Lead *Workflows* + *Workflow authoring* in the agent editor and it drafted **Pulse Feature Pipeline** (spec → backend ∥ frontend → QA loop with pnpm check stages → review → verify → approval → commit/push/PR), validated with 0 issues, dry-run plan clean; reviewed in the builder (risk chips: writes files, commits, pushes, opens a PR, runs repo code) and **published v1**.

